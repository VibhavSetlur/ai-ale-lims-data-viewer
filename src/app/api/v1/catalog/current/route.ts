import { scientificRepository } from "../../../../../server/db/scientific";
import { jsonError, jsonSuccess, requestContext } from "../../../../../shared/http/api";

export async function GET(request: Request) {
  const context = requestContext(request.headers);
  try { return jsonSuccess(await scientificRepository().provenance(), context); }
  catch (error) { return jsonError(error, context); }
}
