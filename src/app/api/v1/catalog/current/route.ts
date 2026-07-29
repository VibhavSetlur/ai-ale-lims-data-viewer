import { getCurrentSnapshot } from "../../../../../modules/snapshots/catalog/repository";
import { jsonSuccess, requestContext } from "../../../../../shared/http/api";

export function GET(request: Request) {
  const context = requestContext(request.headers);
  return jsonSuccess(getCurrentSnapshot(), context);
}
