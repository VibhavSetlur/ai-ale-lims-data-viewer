import type { PublicAppError } from "../errors/AppError";

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

export interface ApiWarning {
  code: string;
  message: string;
}

export interface ResponseMeta {
  snapshotId?: string;
  dataRevision?: string;
  warnings?: ApiWarning[];
  nextCursor?: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  request: RequestContext;
  meta?: ResponseMeta;
}

export interface ApiFailure {
  ok: false;
  error: PublicAppError;
  request: RequestContext;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function success<T>(data: T, request: RequestContext, meta?: ResponseMeta): ApiSuccess<T> {
  return meta === undefined ? { ok: true, data, request } : { ok: true, data, request, meta };
}
