import { AppError } from "../../../../../shared/errors/AppError";
import { jsonError, jsonSuccess, requestContext } from "../../../../../shared/http/api";
import { mutationDatasetQuerySchema } from "../../../../../shared/contracts/mutation-dataset";
import { scientificRepository } from "../../../../../server/db/scientific";
import { cached, stableStringify } from "../../../../../server/cache/read-cache";
import { getCurrentSnapshot } from "../../../../../modules/snapshots/catalog/repository";

export async function GET(request: Request) {
  const context = requestContext(request.headers);
  try {
    const url = new URL(request.url);
    const parsed = mutationDatasetQuerySchema.safeParse({
      snapshotId: url.searchParams.get("snapshotId") ?? getCurrentSnapshot().snapshotId,
      experimentKey: url.searchParams.get("experimentKey") ?? undefined,
      registryKey: url.searchParams.get("registryKey") ?? undefined,
    });
    if (!parsed.success) throw new AppError("INVALID_INPUT", "Query parameters are invalid.");
    const query = parsed.data;
    const key = `${query.snapshotId}::mutations/dataset::${stableStringify(query)}`;
    const dataset = cached(key, 600_000, () => scientificRepository().mutationDataset(query));
    const response = jsonSuccess(await dataset, context);
    response.headers.set("Cache-Control", "private, max-age=300, stale-while-revalidate=600");
    return response;
  } catch (error) {
    return jsonError(error, context);
  }
}
