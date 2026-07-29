import { AppError } from "../../../../shared/errors/AppError";
import { jsonError, jsonSuccess, requestContext } from "../../../../shared/http/api";
import { scientificRepository } from "../../../../server/db/scientific";
import { cohortQuerySchema, mutationReadRequestSchema } from "../../../../shared/contracts/mutations";

export async function post(request: Request, action: (value: import("../../../../shared/contracts/mutations").MutationReadRequest) => unknown) {
  const context = requestContext(request.headers);
  try { const body: unknown = await request.json().catch(() => { throw new AppError("INVALID_INPUT", "Request body must be valid JSON."); }); const parsed = mutationReadRequestSchema.safeParse(body); if (!parsed.success) throw new AppError("INVALID_INPUT", "Request body is invalid."); return jsonSuccess(action(parsed.data), context); } catch (error) { return jsonError(error, context); }
}
export function cohort(request: Request) {
  const context = requestContext(request.headers);
  try { const url = new URL(request.url); const parsed = cohortQuerySchema.safeParse({ snapshotId: url.searchParams.get("snapshotId"), experimentKey: url.searchParams.get("experimentKey") ?? undefined, registryKey: url.searchParams.get("registryKey") ?? undefined }); if (!parsed.success) throw new AppError("INVALID_INPUT", "Query parameters are invalid."); return jsonSuccess(scientificRepository().cohort(parsed.data), context); } catch (error) { return jsonError(error, context); }
}
