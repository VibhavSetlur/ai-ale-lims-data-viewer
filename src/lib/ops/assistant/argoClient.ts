// Thin client for the local Argo proxy (loopback OpenAI-compatible chat
// completions endpoint). This module never stores the API key in module
// state, never writes it anywhere, and never lets it escape in a thrown
// message or logged string: every error message is passed through
// `redactKey` before it leaves this module.

import type { AssistantConfig } from '@/lib/ops/config';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  max_tokens?: number;
};

export type ChatReply = {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string | null;
};

export type AssistantProxyErrorCode = 'proxy_unavailable' | 'proxy_timeout' | 'proxy_error' | 'bad_response';

export class AssistantProxyError extends Error {
  readonly code: AssistantProxyErrorCode;
  readonly status?: number;

  constructor(code: AssistantProxyErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AssistantProxyError';
    this.code = code;
    this.status = status;
  }
}

// Replaces every occurrence of `apiKey` in `text` with `***`. A no-op when
// `apiKey` is empty or falsy so an unset key can never turn into a
// mass-replacement of every character position in the text.
export function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('***');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Parses the OpenAI-style chat completion body. Throws `bad_response` for
// any structurally invalid body rather than returning a partial reply.
export function parseChatReply(body: unknown): ChatReply {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) {
    throw new AssistantProxyError('bad_response', 'Assistant proxy returned a response with no choices');
  }
  const choice = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new AssistantProxyError('bad_response', 'Assistant proxy returned a malformed choice');
  }

  const message = choice.message;
  const content = typeof message.content === 'string' ? message.content : null;
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;

  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      if (!isRecord(rawCall)) continue;
      if (typeof rawCall.id !== 'string') continue;
      if (!isRecord(rawCall.function)) continue;
      const name = rawCall.function.name;
      const args = rawCall.function.arguments;
      if (typeof name !== 'string' || typeof args !== 'string') continue;
      toolCalls.push({ id: rawCall.id, name, arguments: args });
    }
  }

  return { content, toolCalls, finishReason };
}

function proxyErrorCodeFromBody(body: unknown): string | undefined {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') {
    return body.error.code;
  }
  return undefined;
}

export async function chat(cfg: AssistantConfig, apiKey: string, req: ChatRequest): Promise<ChatReply> {
  let response: Response;
  try {
    response = await fetch(`${cfg.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new AssistantProxyError('proxy_timeout', redactKey('Assistant proxy request timed out', apiKey));
    }
    throw new AssistantProxyError(
      'proxy_unavailable',
      redactKey(`Assistant proxy is unavailable: ${rawMessage}`, apiKey),
    );
  }

  if (!response.ok) {
    let errorCode: string | undefined;
    try {
      const errorBody: unknown = await response.json();
      errorCode = proxyErrorCodeFromBody(errorBody);
    } catch {
      // Body was not JSON or could not be read; fall through with no code.
    }
    const detail = errorCode ? `: ${errorCode}` : '';
    throw new AssistantProxyError(
      'proxy_error',
      redactKey(`Assistant proxy returned an error (status ${response.status})${detail}`, apiKey),
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    throw new AssistantProxyError(
      'bad_response',
      redactKey(`Assistant proxy returned an unparseable response: ${rawMessage}`, apiKey),
    );
  }

  try {
    return parseChatReply(body);
  } catch (err) {
    if (err instanceof AssistantProxyError) {
      throw new AssistantProxyError(err.code, redactKey(err.message, apiKey), err.status);
    }
    throw err;
  }
}
