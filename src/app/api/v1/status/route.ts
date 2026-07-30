import { parseConfig } from "../../../../server/config";
import { scientificRepository } from "../../../../server/db/scientific";
import { loggedJsonError, loggedJsonSuccess, requestContext } from "../../../../shared/http/api";

export async function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const config = parseConfig(process.env);
    const scientific = scientificRepository();
    return loggedJsonSuccess({ profile: config.profile, scientific: await scientific.probe(), provenance: await scientific.provenance(), capabilities: await scientific.capabilities() }, request, context);
  } catch (error) { return loggedJsonError(error, request, context); }
}
