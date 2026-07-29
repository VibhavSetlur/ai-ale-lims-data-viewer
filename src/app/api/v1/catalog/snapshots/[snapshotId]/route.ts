import { getSnapshot } from "../../../../../../modules/snapshots/catalog/repository";
import { jsonError, jsonSuccess, requestContext } from "../../../../../../shared/http/api";

export function GET(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  const context = requestContext(request.headers);
  return params
    .then(({ snapshotId }) => jsonSuccess(getSnapshot(snapshotId), context))
    .catch((error: unknown) => jsonError(error, context));
}
