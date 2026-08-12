import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { AssistantProxyError, chat, redactKey } from '@/lib/ops/assistant/argoClient';
import type { ChatMessage, ChatReply } from '@/lib/ops/assistant/argoClient';
import { MAX_TOOL_CALLS_PER_TURN, TOOLS, findTool, serializeToolResult } from '@/lib/ops/assistant/tools';
import type { ToolResult } from '@/lib/ops/assistant/tools';
import { readAssistantConfig } from '@/lib/ops/config';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError, assertOwned } from '@/lib/ops/guards';
import { checkRateLimit } from '@/lib/ops/rateLimit';
import { appendMessage, getConversation, listMessages } from '@/lib/ops/repo';

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };
const FALLBACK_MESSAGE = 'The assistant did not return a response for this turn.';

const SYSTEM_PROMPT =
  'You are an assistant embedded in a laboratory data viewer. You may read scientific data and the ' +
  "signed-in user's own workspace data through the tools you are given, and you may propose plate " +
  'design changes for human review. You can never execute anything yourself: you have no shell, no ' +
  'HTTP access, no raw SQL access, and no filesystem access. If the user asks for a command, return the ' +
  'command as plain, non-executing text and state explicitly that a human has to run it. Any plate ' +
  'design change you propose is only applied after the user reviews it and clicks Apply.';

const TOOLS_PAYLOAD = TOOLS.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

async function runToolCall(toolCall: { name: string; arguments: string }, userId: string): Promise<ToolResult> {
  const tool = findTool(toolCall.name);
  if (!tool) {
    return { ok: false, error: 'unknown_tool' };
  }

  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(toolCall.arguments || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'bad_arguments' };
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'bad_arguments' };
  }

  return tool.run(args, { userId });
}

function statusForProxyError(code: AssistantProxyError['code']): number {
  switch (code) {
    case 'proxy_unavailable':
      return 503;
    case 'proxy_timeout':
      return 504;
    case 'proxy_error':
      return 502;
    case 'bad_response':
    default:
      return 502;
  }
}

export const POST = handleOps(
  async (req: Request, ctx: { params: Promise<{ conversationId: string }> }) => {
    assertSameOrigin(req);
    const session = await requireSession(req);
    const { conversationId } = await ctx.params;

    const cfg = readAssistantConfig();
    if (!cfg) {
      throw new OpsHttpError(503, 'assistant_disabled', 'The assistant is not enabled on this server.');
    }

    const rate = checkRateLimit(`assistant:${session.userId}`, RATE_LIMIT);
    if (!rate.allowed) {
      throw new OpsHttpError(
        429,
        'rate_limited',
        `Too many assistant requests. Try again in ${rate.retryAfterSeconds} seconds.`,
      );
    }

    const apiKey = req.headers.get('x-argo-key');
    if (!apiKey || apiKey.trim().length === 0) {
      throw new OpsHttpError(400, 'missing_api_key', 'Enter your Argo key for this session to use the assistant.');
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > MAX_BODY_BYTES) {
      throw new OpsHttpError(413, 'too_large', 'Message body exceeds the 32KB limit');
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new OpsHttpError(413, 'too_large', 'Message body exceeds the 32KB limit');
    }

    const body = raw ? JSON.parse(raw) : {};
    const content = typeof body?.content === 'string' ? body.content : '';
    if (content.trim().length === 0 || content.length > cfg.maxMessageChars) {
      throw new OpsHttpError(400, 'invalid', 'Message content is required and must fit within the length limit.');
    }
    let model = cfg.defaultModel;
    if (body?.model !== undefined) {
      if (typeof body.model !== 'string' || body.model.trim().length === 0) {
        throw new OpsHttpError(400, 'invalid', 'model must be a non-empty string when provided.');
      }
      model = body.model;
    }

    assertOwned(await getConversation(conversationId, session.userId), session.userId);

    const priorMessages = await listMessages(conversationId, session.userId);
    await appendMessage({ conversationId, ownerUserId: session.userId, role: 'user', content });

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...priorMessages.map((row) => ({ role: row.role as ChatMessage['role'], content: row.content })),
      { role: 'user', content },
    ];

    const toolCallLog: Array<{ name: string; ok: boolean }> = [];
    const proposals: Array<{ id: string; summary: string }> = [];
    let reply: ChatReply = { content: null, toolCalls: [], finishReason: null };

    try {
      for (let iteration = 0; iteration < MAX_TOOL_CALLS_PER_TURN; iteration += 1) {
        reply = await chat(cfg, apiKey, { model, messages, tools: TOOLS_PAYLOAD, max_tokens: 2000 });
        if (reply.toolCalls.length === 0) break;

        messages.push({ role: 'assistant', content: reply.content ?? '' });
        for (const toolCall of reply.toolCalls) {
          const result = await runToolCall(toolCall, session.userId);
          toolCallLog.push({ name: toolCall.name, ok: result.ok });
          if (result.ok && toolCall.name === 'propose_design_change') {
            const data = result.data as { proposalId?: unknown; summary?: unknown };
            if (typeof data?.proposalId === 'string' && typeof data?.summary === 'string') {
              proposals.push({ id: data.proposalId, summary: data.summary });
            }
          }
          messages.push({ role: 'tool', content: serializeToolResult(result), tool_call_id: toolCall.id });
        }
      }
    } catch (error) {
      if (error instanceof AssistantProxyError) {
        throw new OpsHttpError(statusForProxyError(error.code), error.code, error.message);
      }
      throw error;
    }

    let finalContent = reply.content && reply.content.trim().length > 0 ? reply.content : FALLBACK_MESSAGE;
    finalContent = redactKey(finalContent, apiKey);

    await appendMessage({ conversationId, ownerUserId: session.userId, role: 'assistant', content: finalContent });

    return opsOk({
      message: finalContent,
      toolCalls: toolCallLog,
      proposals: proposals.map((proposal) => ({ id: proposal.id, summary: redactKey(proposal.summary, apiKey) })),
    });
  },
);
