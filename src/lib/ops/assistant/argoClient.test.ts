import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantConfig } from '@/lib/ops/config';
import { AssistantProxyError, chat, parseChatReply, redactKey } from './argoClient';

const CFG: AssistantConfig = {
  proxyUrl: 'http://127.0.0.1:3459',
  defaultModel: 'gpt5mini',
  timeoutMs: 5000,
  maxConversations: 5,
  maxMessageChars: 8000,
};

const REQ = { model: 'gpt5mini', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('redactKey', () => {
  it('replaces a single occurrence of the key', () => {
    expect(redactKey('token=SECRET123 sent', 'SECRET123')).toBe('token=*** sent');
  });

  it('replaces multiple occurrences of the key', () => {
    expect(redactKey('SECRET123 and SECRET123 again', 'SECRET123')).toBe('*** and *** again');
  });

  it('is a no-op when the key is empty', () => {
    expect(redactKey('nothing to redact here', '')).toBe('nothing to redact here');
  });

  it('does not corrupt text with no match', () => {
    expect(redactKey('completely unrelated text', 'SECRET123')).toBe('completely unrelated text');
  });
});

describe('parseChatReply', () => {
  it('returns content and finishReason for a normal completion', () => {
    const reply = parseChatReply({
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello there' }, finish_reason: 'stop' }],
    });
    expect(reply).toEqual({ content: 'hello there', toolCalls: [], finishReason: 'stop' });
  });

  it('returns both tool calls and skips one malformed entry without throwing', () => {
    const reply = parseChatReply({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"a":1}' } },
              { id: 'call_2', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
              { id: 'call_bad', type: 'function', function: { name: 'broken' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(reply.content).toBeNull();
    expect(reply.finishReason).toBe('tool_calls');
    expect(reply.toolCalls).toEqual([
      { id: 'call_1', name: 'lookup', arguments: '{"a":1}' },
      { id: 'call_2', name: 'search', arguments: '{"q":"x"}' },
    ]);
  });

  it('throws bad_response for an empty object', () => {
    try {
      parseChatReply({});
      throw new Error('expected parseChatReply to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistantProxyError);
      expect((err as AssistantProxyError).code).toBe('bad_response');
    }
  });

  it('throws bad_response when choices is missing', () => {
    try {
      parseChatReply({ id: 'x', object: 'chat.completion' });
      throw new Error('expected parseChatReply to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistantProxyError);
      expect((err as AssistantProxyError).code).toBe('bad_response');
    }
  });
});

describe('chat', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws proxy_error with the response status on a non-2xx response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'upstream_failure' } }),
    });

    try {
      await chat(CFG, 'SOMEKEY', REQ);
      throw new Error('expected chat to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistantProxyError);
      expect((err as AssistantProxyError).code).toBe('proxy_error');
      expect((err as AssistantProxyError).status).toBe(500);
    }
  });

  it('throws proxy_unavailable when fetch rejects with a refused connection', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:3459'),
    );

    try {
      await chat(CFG, 'SOMEKEY', REQ);
      throw new Error('expected chat to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistantProxyError);
      expect((err as AssistantProxyError).code).toBe('proxy_unavailable');
    }
  });

  it('never leaks the api key into a thrown error message even when the underlying error embeds it', async () => {
    const apiKey = 'SUPERSECRETKEY123';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(`connect ECONNREFUSED using key ${apiKey}`),
    );

    let caught: unknown;
    try {
      await chat(CFG, apiKey, REQ);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AssistantProxyError);
    const message = (caught as AssistantProxyError).message;
    expect(message).not.toContain(apiKey);
    expect(String(caught)).not.toContain(apiKey);
  });

  it('sends the api key as a Bearer token in the Authorization header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    await chat(CFG, 'SUPERSECRETKEY123', REQ);

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3459/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer SUPERSECRETKEY123');
  });
});
