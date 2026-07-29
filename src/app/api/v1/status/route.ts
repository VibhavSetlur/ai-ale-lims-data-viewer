import { parseConfig } from "../../../../server/config";
import { scientificRepository } from "../../../../server/db/scientific";
import { jsonError, jsonSuccess, requestContext } from "../../../../shared/http/api";

export function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const config = parseConfig(process.env);
    const scientific = scientificRepository();
    return jsonSuccess({ profile: config.profile, scientific: scientific.probe(), provenance: scientific.provenance(), capabilities: scientific.capabilities() }, context);
  } catch (error) { return jsonError(error, context); }
}
