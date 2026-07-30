import { AppError } from "../../../../../shared/errors/AppError";
import { scientificRepository } from "../../../../../server/db/scientific";
import { jsonError, jsonSuccess, requestContext } from "../../../../../shared/http/api";

export async function GET(request: Request) { const context = requestContext(request.headers); try { const snapshotId = new URL(request.url).searchParams.get("snapshotId"); if (!snapshotId) throw new AppError("INVALID_INPUT", "snapshotId is required."); return jsonSuccess(await scientificRepository().factors(snapshotId), context); } catch (error) { return jsonError(error, context); } }
