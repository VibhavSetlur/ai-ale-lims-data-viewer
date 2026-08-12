// Pure configuration parsing for the operational (MySQL + ORCID) data plane.
//
// No I/O here. Every function accepts an optional `env` map purely so tests
// can pass a synthetic environment; production callers pass nothing and it
// reads `process.env`. `problems` strings name only the missing/invalid
// variable, never a value — this file must never expose a secret.

export type OpsDbConfig = { url: string };
export type OrcidConfig = { clientId: string; clientSecret: string; redirectUri: string; base: string };
export type SessionConfig = { pepper: string; ttlHours: number; secureCookie: boolean };
export type OpsStatus = { dbConfigured: boolean; authConfigured: boolean; localAuthConfigured: boolean; assistantConfigured: boolean; problems: string[] };
export type AssistantConfig = {
  proxyUrl: string;
  defaultModel: string;
  timeoutMs: number;
  maxConversations: number;
  maxMessageChars: number;
};

const DEFAULT_ORCID_BASE = 'https://orcid.org';
const DEFAULT_SESSION_TTL_HOURS = 720;
const MIN_PEPPER_LENGTH = 32;
const DEFAULT_ASSISTANT_PROXY_URL = 'http://127.0.0.1:3459';
const DEFAULT_ASSISTANT_MODEL = 'gpt5mini';
const DEFAULT_ASSISTANT_TIMEOUT_MS = 120000;
const ASSISTANT_MAX_CONVERSATIONS = 5;
const ASSISTANT_MAX_MESSAGE_CHARS = 8000;

function env(source: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return source ?? process.env;
}

export function readOpsDbConfig(source?: NodeJS.ProcessEnv): OpsDbConfig | null {
  const e = env(source);
  const url = e.OPS_DB_URL;
  if (!url) return null;
  return { url };
}

export function readOrcidConfig(source?: NodeJS.ProcessEnv): OrcidConfig | null {
  const e = env(source);
  const clientId = e.ORCID_CLIENT_ID;
  const clientSecret = e.ORCID_CLIENT_SECRET;
  const redirectUri = e.ORCID_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, base: e.ORCID_BASE || DEFAULT_ORCID_BASE };
}

export function readSessionConfig(source?: NodeJS.ProcessEnv): SessionConfig | null {
  const e = env(source);
  const pepper = e.OPS_SESSION_PEPPER;
  if (!pepper || pepper.length < MIN_PEPPER_LENGTH) return null;
  const ttlRaw = e.OPS_SESSION_TTL_HOURS;
  const ttlHours = ttlRaw ? Number(ttlRaw) : DEFAULT_SESSION_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) return null;
  const redirectUri = e.ORCID_REDIRECT_URI || '';
  return { pepper, ttlHours, secureCookie: redirectUri.startsWith('https://') };
}

// ASSISTANT_PROXY_URL must resolve to a loopback host: this proxy is a local
// process, never a remote endpoint, so accepting any other host would let a
// misconfigured environment variable turn this into an open SSRF pivot.
export function readAssistantConfig(source?: NodeJS.ProcessEnv): AssistantConfig | null {
  const e = env(source);
  if (e.ASSISTANT_ENABLED !== '1') return null;

  const proxyUrlRaw = e.ASSISTANT_PROXY_URL || DEFAULT_ASSISTANT_PROXY_URL;
  let parsed: URL;
  try {
    parsed = new URL(proxyUrlRaw);
  } catch {
    return null;
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null;

  const defaultModel = e.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL;

  const timeoutRaw = e.ASSISTANT_TIMEOUT_MS;
  let timeoutMs = DEFAULT_ASSISTANT_TIMEOUT_MS;
  if (timeoutRaw) {
    const parsedTimeout = Number(timeoutRaw);
    if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
      timeoutMs = parsedTimeout;
    }
  }

  return {
    proxyUrl: proxyUrlRaw,
    defaultModel,
    timeoutMs,
    maxConversations: ASSISTANT_MAX_CONVERSATIONS,
    maxMessageChars: ASSISTANT_MAX_MESSAGE_CHARS,
  };
}

export function opsStatus(source?: NodeJS.ProcessEnv): OpsStatus {
  const e = env(source);
  const problems: string[] = [];

  const dbConfigured = readOpsDbConfig(e) !== null;
  if (!dbConfigured) problems.push('OPS_DB_URL is not set');

  if (!e.ORCID_CLIENT_ID) problems.push('ORCID_CLIENT_ID is not set');
  if (!e.ORCID_CLIENT_SECRET) problems.push('ORCID_CLIENT_SECRET is not set');
  if (!e.ORCID_REDIRECT_URI) problems.push('ORCID_REDIRECT_URI is not set');

  const pepper = e.OPS_SESSION_PEPPER;
  if (!pepper) {
    problems.push('OPS_SESSION_PEPPER is not set');
  } else if (pepper.length < MIN_PEPPER_LENGTH) {
    problems.push(`OPS_SESSION_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters`);
  }

  const ttlRaw = e.OPS_SESSION_TTL_HOURS;
  if (ttlRaw && (!Number.isFinite(Number(ttlRaw)) || Number(ttlRaw) <= 0)) {
    problems.push('OPS_SESSION_TTL_HOURS must be a positive number');
  }

  const authConfigured =
    readOrcidConfig(e) !== null &&
    readSessionConfig(e) !== null;

  const localAuthConfigured = readOpsDbConfig(e) !== null && readSessionConfig(e) !== null;

  // Not appended to `problems`: the assistant is optional, so its absence is
  // not a misconfiguration.
  const assistantConfigured = readAssistantConfig(e) !== null;

  return { dbConfigured, authConfigured, localAuthConfigured, assistantConfigured, problems };
}
