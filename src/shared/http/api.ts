import { NextResponse } from "next/server";
import { success, type RequestContext } from "../contracts/envelope";
import { AppError } from "../errors/AppError";

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

export function jsonError(error: unknown, request: RequestContext): NextResponse {
  const publicError = error instanceof AppError ? error.toPublic() : { code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
  const status = error instanceof AppError && error.code === "SNAPSHOT_NOT_FOUND" ? 404 : 500;
  return NextResponse.json({ ok: false, error: publicError, request }, { status });
}
