import type { RequestContext } from "../../shared/contracts/envelope";

export type LogLevel = "info" | "warn" | "error";

export interface RequestLogEvent {
  event: "request";
  level: LogLevel;
  requestId: string;
  correlationId: string;
  method: string;
  path: string;
  status: number;
}

type LogWriter = (line: string) => void;

const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api.?key|database.*url|url|sourcePath)/i;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/gi;
const SQLITE_PATH = /(?:file:)?\/?(?:[^\s/:]+\/)+[^\s/]+\.(?:sqlite|db)\b/gi;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(URL_CREDENTIALS, "$1[REDACTED]@").replace(SQLITE_PATH, "[REDACTED_PATH]");
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

export function requestLogEvent(request: Request, context: RequestContext, status: number): RequestLogEvent {
  return { event: "request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info", requestId: context.requestId, correlationId: context.correlationId, method: request.method, path: new URL(request.url).pathname, status };
}

export function writeLog(event: RequestLogEvent, writer: LogWriter = console.log): void {
  writer(JSON.stringify(redact(event)));
}
