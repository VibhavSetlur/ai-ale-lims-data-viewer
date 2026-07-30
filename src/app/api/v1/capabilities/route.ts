import { AppError } from "../../../../shared/errors/AppError";
import { scientificRepository } from "../../../../server/db/scientific";
import { jsonError, jsonSuccess, requestContext } from "../../../../shared/http/api";

export async function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const scientific = scientificRepository();
    const snapshotId = new URL(request.url).searchParams.get("snapshotId");
    const capabilities = await scientific.capabilities();
    if (snapshotId !== capabilities.snapshotId) throw new AppError("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    return jsonSuccess(capabilities, context);
  } catch (error) { return jsonError(error, context); }
}
