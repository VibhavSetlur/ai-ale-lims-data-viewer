import type { PublicAppError } from "../errors/AppError";

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  request: RequestContext;
}

export interface ApiFailure {
  ok: false;
  error: PublicAppError;
  request: RequestContext;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function success<T>(data: T, request: RequestContext): ApiSuccess<T> {
  return { ok: true, data, request };
}
