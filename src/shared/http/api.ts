import { NextResponse } from "next/server";
import { success, type RequestContext } from "../contracts/envelope";
import { AppError } from "../errors/AppError";
import { requestLogEvent, writeLog } from "../../server/observability";

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function headerId(value: string | null): string | undefined {
  return value !== null && ID_PATTERN.test(value) ? value : undefined;
}

export function requestContext(headers: Headers): RequestContext {
  const requestId = headerId(headers.get("x-request-id")) ?? crypto.randomUUID();
  const correlationId = headerId(headers.get("x-correlation-id")) ?? requestId;
  return { requestId, correlationId };
}

export function jsonSuccess<T>(data: T, request: RequestContext): NextResponse {
  return NextResponse.json(success(data, request));
}

const ERROR_STATUS: Readonly<Record<string, number>> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SNAPSHOT_NOT_FOUND: 404,
  CONFLICT: 409,
  LIMIT_EXCEEDED: 413,
  SEMANTIC_INVALID: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
};

export function jsonError(error: unknown, request: RequestContext): NextResponse {
  const publicError = error instanceof AppError
    ? error.toPublic()
    : { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", retryable: false };
  const status = error instanceof AppError ? (ERROR_STATUS[error.code] ?? 500) : 500;
  return NextResponse.json({ ok: false, error: publicError, request }, { status });
}

export function loggedJsonSuccess<T>(data: T, request: Request, context: RequestContext): NextResponse {
  const response = jsonSuccess(data, context);
  writeLog(requestLogEvent(request, context, response.status));
  return response;
}

export function loggedJsonError(error: unknown, request: Request, context: RequestContext): NextResponse {
  const response = jsonError(error, context);
  writeLog(requestLogEvent(request, context, response.status));
  return response;
}
