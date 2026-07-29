import { AppError } from "../../../../../shared/errors/AppError";
import { jsonError, jsonSuccess, requestContext } from "../../../../../shared/http/api";
import { scientificRepository } from "../../../../../server/db/scientific";
export async function GET(request: Request) { const context = requestContext(request.headers); try { const snapshotId = new URL(request.url).searchParams.get("snapshotId"); if (!snapshotId) throw new AppError("INVALID_INPUT", "snapshotId is required."); return jsonSuccess(scientificRepository().factors(snapshotId), context); } catch (error) { return jsonError(error, context); } }
