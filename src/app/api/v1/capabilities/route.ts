import { AppError } from "../../../../shared/errors/AppError";
import { scientificRepository } from "../../../../server/db/scientific";
import { jsonError, jsonSuccess, requestContext } from "../../../../shared/http/api";

export function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const scientific = scientificRepository();
    const snapshotId = new URL(request.url).searchParams.get("snapshotId");
    if (snapshotId !== scientific.capabilities().snapshotId) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    return jsonSuccess(scientific.capabilities(), context);
  } catch (error) { return jsonError(error, context); }
}
