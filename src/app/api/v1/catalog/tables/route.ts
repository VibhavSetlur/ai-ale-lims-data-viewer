import { AppError } from "../../../../../shared/errors/AppError";
import { jsonError, jsonSuccess, requestContext } from "../../../../../shared/http/api";
import { repository } from "../handlers";

export function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const snapshotId = new URL(request.url).searchParams.get("snapshotId");
    const scientific = repository();
    if (snapshotId !== scientific.provenance().snapshotId) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    return jsonSuccess({ tables: scientific.listTables() }, context);
  } catch (error) { return jsonError(error, context); }
}
