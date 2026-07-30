import { parseConfig } from "../../../../server/config";
import { scientificRepository } from "../../../../server/db/scientific";
import { operationalMigrationCompatible, operationalPool } from "../../../../server/db/operational/pool";
import { loggedJsonError, loggedJsonSuccess, requestContext } from "../../../../shared/http/api";

export function live(request: Request) {
  const context = requestContext(request.headers);
  return loggedJsonSuccess({ status: "live" }, request, context);
}

export async function ready(request: Request) {
  const context = requestContext(request.headers);
  try {
    const config = parseConfig(process.env);
    const scientific = scientificRepository();
    const provenance = await scientific.provenance();
    await scientific.probe();
    if (!/^[a-f0-9]{64}$/.test(provenance.sourceSha256) || /^0+$/.test(provenance.sourceSha256)) throw new Error("Scientific snapshot provenance is incomplete.");
    if (config.profile === "planes") { await operationalPool().probe(); await operationalMigrationCompatible(); }
    return loggedJsonSuccess({ status: "ready", profile: config.profile, snapshotId: provenance.snapshotId }, request, context);
  } catch (error) {
    return loggedJsonError(error, request, context);
  }
}
