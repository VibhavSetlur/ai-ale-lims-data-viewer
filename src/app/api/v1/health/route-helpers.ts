import { parseConfig } from "../../../../server/config";
import { scientificRepository } from "../../../../server/db/scientific";
import { loggedJsonError, loggedJsonSuccess, requestContext } from "../../../../shared/http/api";

export function live(request: Request) {
  const context = requestContext(request.headers);
  return loggedJsonSuccess({ status: "live" }, request, context);
}

export function ready(request: Request) {
  const context = requestContext(request.headers);
  try {
    const config = parseConfig(process.env);
    const scientific = scientificRepository();
    const provenance = scientific.provenance();
    scientific.probe();
    return loggedJsonSuccess({ status: "ready", profile: config.profile, snapshotId: provenance.snapshotId }, request, context);
  } catch (error) {
    return loggedJsonError(error, request, context);
  }
}
