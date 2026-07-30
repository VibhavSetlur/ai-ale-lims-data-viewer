import type { ScientificRepository } from "../../server/db/scientific";
import { withScientificRepository } from "../../server/db/scientific";
import { GET as capabilities } from "../../app/api/v1/capabilities/route";
import { POST as rows } from "../../app/api/v1/catalog/rows/route";
import { POST as facets } from "../../app/api/v1/catalog/facets/route";
import { POST as exportRows } from "../../app/api/v1/catalog/export/route";
import { GET as cohort } from "../../app/api/v1/mutations/cohort/route";
import { POST as mutations } from "../../app/api/v1/mutations/compare/route";
import { POST as growth } from "../../app/api/v1/mutations/growth/route";
import { POST as libraryVariants } from "../../app/api/v1/mutations/library-variants/route";
import { POST as copyNumber } from "../../app/api/v1/mutations/copy-number/route";
import { GET as factors } from "../../app/api/v1/plates/factors/route";

export type ApiContractFixture = { name: string; method: "GET" | "POST"; path: string; body?: unknown };
export type ApiContractResult = { status: number; payload: unknown; csv?: string };

const headers = { "x-request-id": "reconcile-request", "x-correlation-id": "reconcile-correlation" };

/** The caller supplies both the repository and fixture values, so this harness neither creates connections nor mutates global backend configuration. */
export async function runApiContractFixtures(repository: ScientificRepository, fixtures: readonly ApiContractFixture[]): Promise<Record<string, ApiContractResult>> {
  return withScientificRepository(repository, async () => {
    const snapshotId = (await repository.provenance()).snapshotId;
    const results: Record<string, ApiContractResult> = {};
    for (const fixture of fixtures) {
      const path = fixture.path.replaceAll("sqlite-placeholder", encodeURIComponent(snapshotId));
      const body = fixture.body === undefined ? undefined : replaceSnapshotId(fixture.body, snapshotId);
      const request = new Request(`http://reconcile.local${path}`, {
        method: fixture.method,
        headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const response = await route(path.split("?")[0], request);
      const payload = await response.json();
      results[fixture.name] = { status: response.status, payload, csv: path.split("?")[0] === "/api/v1/catalog/export" && response.ok ? String((payload as { data?: { csv?: unknown } }).data?.csv ?? "") : undefined };
    }
    return results;
  });
}

function replaceSnapshotId(value: unknown, snapshotId: string): unknown {
  if (value === "sqlite-placeholder") return snapshotId;
  if (Array.isArray(value)) return value.map((item) => replaceSnapshotId(item, snapshotId));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceSnapshotId(item, snapshotId)]));
  return value;
}

async function route(path: string, request: Request): Promise<Response> {
  if (path === "/api/v1/capabilities") return capabilities(request);
  if (path === "/api/v1/catalog/rows") return rows(request);
  if (path === "/api/v1/catalog/facets") return facets(request);
  if (path === "/api/v1/catalog/export") return exportRows(request);
  if (path === "/api/v1/mutations/cohort") return cohort(request);
  if (path === "/api/v1/mutations/compare") return mutations(request);
  if (path === "/api/v1/mutations/growth") return growth(request);
  if (path === "/api/v1/mutations/library-variants") return libraryVariants(request);
  if (path === "/api/v1/mutations/copy-number") return copyNumber(request);
  if (path === "/api/v1/plates/factors") return factors(request);
  throw new Error(`Unsupported API contract fixture path: ${path}`);
}
