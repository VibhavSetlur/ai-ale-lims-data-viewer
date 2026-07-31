/**
 * dataSource.ts -- integration seam for the ported legacy flagship components.
 *
 * The legacy components (MutationExplorer, GrowthCurveComparison,
 * LibraryVariantComparison, DataTable) call fetchData(url) and expect the RAW
 * legacy response body. This shim translates those legacy URLs to the viewer-2
 * /api/v1 surface, unwraps the {ok,data} envelope, and reshapes the payload
 * back to the exact legacy body shape, returning a Response the caller reads
 * with .json()/.text(). This keeps the ported components verbatim.
 */

export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// ---- current snapshot (cached module-level) ----

let snapshotPromise: Promise<string> | null = null;

async function currentSnapshotId(): Promise<string> {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const res = await fetch(`${BASE_PATH}/api/v1/catalog/current`);
      const json = (await res.json()) as { ok?: boolean; data?: { snapshotId?: string } };
      const id = json?.data?.snapshotId;
      if (!id) throw new Error("Unable to resolve current snapshot");
      return id;
    })().catch((err) => {
      snapshotPromise = null;
      throw err;
    });
  }
  return snapshotPromise;
}

// ---- helpers ----

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

type LegacyColumnType = "string" | "number" | "boolean" | "date" | "unknown";

interface CatalogColumn {
  key: string;
  label: string;
  type: LegacyColumnType;
  nullable: boolean;
}

interface RowsResult {
  columns: CatalogColumn[];
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  totalCount: number;
}

interface V1Filter {
  column: string;
  operator: string;
  value?: string | number | boolean;
}

// Legacy operator vocabulary -> v1 operators.
// v1 supports: eq neq contains startsWith gt gte lt lte isNull isNotNull.
function mapFilter(column: string, legacyOp: string, rawValue: string): V1Filter[] {
  const op = legacyOp;
  switch (op) {
    case "isNull":
      return [{ column, operator: "isNull" }];
    case "isNotNull":
      return [{ column, operator: "isNotNull" }];
    case "contains":
      return [{ column, operator: "contains", value: rawValue }];
    case "notContains":
      // v1 has no notContains; nearest safe surface is contains (documented degrade).
      return [{ column, operator: "contains", value: rawValue }];
    case "equals":
    case "=":
      return [{ column, operator: "eq", value: rawValue }];
    case "!=":
      return [{ column, operator: "neq", value: rawValue }];
    case "startsWith":
      return [{ column, operator: "startsWith", value: rawValue }];
    case "endsWith":
      // v1 has no endsWith; degrade to contains.
      return [{ column, operator: "contains", value: rawValue }];
    case ">":
      return [{ column, operator: "gt", value: rawValue }];
    case "<":
      return [{ column, operator: "lt", value: rawValue }];
    case ">=":
      return [{ column, operator: "gte", value: rawValue }];
    case "<=":
      return [{ column, operator: "lte", value: rawValue }];
    case "between": {
      const [a, b] = rawValue.split(",").map((s) => s.trim());
      const out: V1Filter[] = [];
      if (a) out.push({ column, operator: "gte", value: a });
      if (b) out.push({ column, operator: "lte", value: b });
      return out.length ? out : [{ column, operator: "contains", value: rawValue }];
    }
    case "in": {
      // Approximate CSV membership with an OR of eq handled by caller via combinator.
      const parts = rawValue.split(",").map((s) => s.trim()).filter(Boolean);
      return parts.map((v) => ({ column, operator: "eq", value: v }));
    }
    case "notIn": {
      const parts = rawValue.split(",").map((s) => s.trim()).filter(Boolean);
      return parts.map((v) => ({ column, operator: "neq", value: v }));
    }
    default:
      return [{ column, operator: "contains", value: rawValue }];
  }
}

const NO_VALUE_OPS = new Set(["isNull", "isNotNull"]);

// Parse legacy /api/data or /api/export querystring into a v1 catalog rows query.
function buildCatalogQuery(
  snapshotId: string,
  table: string,
  params: URLSearchParams,
): {
  snapshotId: string;
  table: string;
  limit: number;
  offset?: number;
  search?: string;
  where?: { combinator: "and" | "or"; filters: V1Filter[] };
  sort?: { column: string; direction: "asc" | "desc" }[];
  includeDeleted?: boolean;
} {
  const pageSize = Number(params.get("pageSize") ?? "50");
  const page = Number(params.get("page") ?? "1");
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam), 1000) : Math.min(pageSize, 1000);

  const sortBy = params.get("sortBy") ?? undefined;
  const sortDirRaw = (params.get("sortDirection") ?? "asc").toLowerCase();
  const sortDirection: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";
  const globalSearch = params.get("globalSearch") ?? undefined;
  const filterLogic = (params.get("filterLogic") ?? "AND").toLowerCase() === "or" ? "or" : "and";
  const includeDeleted = params.get("includeDeleted") === "1";

  // Reconstruct per-column filters from <col>[operator] / <col>[value].
  const filters: V1Filter[] = [];
  const opByCol = new Map<string, string>();
  const valByCol = new Map<string, string>();
  for (const [k, v] of params.entries()) {
    const mOp = k.match(/^(.+)\[operator\]$/);
    const mVal = k.match(/^(.+)\[value\]$/);
    if (mOp) opByCol.set(mOp[1], v);
    else if (mVal) valByCol.set(mVal[1], v);
  }
  for (const [col, legacyOp] of opByCol.entries()) {
    const raw = valByCol.get(col) ?? "";
    if (!NO_VALUE_OPS.has(legacyOp) && raw === "") continue;
    filters.push(...mapFilter(col, legacyOp, raw));
  }

  const query: ReturnType<typeof buildCatalogQuery> = {
    snapshotId,
    table,
    limit: limit < 1 ? 1 : limit,
  };
  if (!limitParam) query.offset = Math.max(0, (page - 1) * pageSize);
  if (globalSearch) query.search = globalSearch;
  if (filters.length) query.where = { combinator: filterLogic, filters };
  if (sortBy) query.sort = [{ column: sortBy, direction: sortDirection }];
  if (includeDeleted) query.includeDeleted = true;
  return query;
}

async function postV1<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function getV1<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`);
  return unwrap<T>(res);
}

// ---- CSV builder for export (OWASP injection-guarded, matches legacy) ----

function csvEscape(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---- main shim ----

export async function fetchData(url: string, init?: RequestInit): Promise<Response> {
  // Only translate GET-style legacy data URLs; pass anything else straight through.
  const [path, qs = ""] = url.split("?");
  const params = new URLSearchParams(qs);

  try {
    // /api/mutations?experiment=&registry=
    if (path === "/api/mutations") {
      const sp = new URLSearchParams();
      const exp = params.get("experiment");
      const reg = params.get("registry");
      if (exp) sp.set("experimentKey", exp);
      if (reg) sp.set("registryKey", reg);
      const suffix = sp.toString() ? `?${sp.toString()}` : "";
      const data = await getV1<unknown>(`/api/v1/mutations/dataset${suffix}`);
      return jsonResponse(data);
    }

    // /api/growth-series?experiment=
    if (path === "/api/growth-series") {
      const sp = new URLSearchParams();
      const exp = params.get("experiment");
      if (exp) sp.set("experimentKey", exp);
      const suffix = sp.toString() ? `?${sp.toString()}` : "";
      const data = await getV1<unknown>(`/api/v1/mutations/growth-series${suffix}`);
      return jsonResponse(data);
    }

    // /api/library-variants
    if (path === "/api/library-variants") {
      const data = await getV1<unknown>(`/api/v1/mutations/library-variants-dataset`);
      return jsonResponse(data);
    }

    // /api/data/{table}?...
    const mData = path.match(/^\/api\/data\/(.+)$/);
    if (mData) {
      const table = decodeURIComponent(mData[1]);
      const snapshotId = await currentSnapshotId();
      const query = buildCatalogQuery(snapshotId, table, params);
      const pageSize = Number(params.get("pageSize") ?? String(query.limit));
      const result = await postV1<RowsResult>(`/api/v1/catalog/rows`, query);
      const schema = result.columns.map((c) => ({
        name: c.key,
        label: c.label,
        type: c.type,
        nullable: c.nullable,
      }));
      return jsonResponse({
        schema,
        rows: result.rows,
        totalCount: result.totalCount,
        totalPages: Math.max(1, Math.ceil(result.totalCount / Math.max(1, pageSize))),
      });
    }

    // /api/distinct/{table}?column=&limit=
    const mDistinct = path.match(/^\/api\/distinct\/(.+)$/);
    if (mDistinct) {
      const table = decodeURIComponent(mDistinct[1]);
      const column = params.get("column") ?? "";
      const snapshotId = await currentSnapshotId();
      const facets = await postV1<Record<string, { value: unknown; count: number }[]>>(
        `/api/v1/catalog/facets`,
        { snapshotId, table, columns: [column] },
      );
      const values = (facets[column] ?? []).map((f) => f.value);
      return jsonResponse({ values, truncated: false });
    }

    // /api/export/{table}?...&columns=
    const mExport = path.match(/^\/api\/export\/(.+)$/);
    if (mExport) {
      const table = decodeURIComponent(mExport[1]);
      const snapshotId = await currentSnapshotId();
      const query = buildCatalogQuery(snapshotId, table, params);
      // export ignores paging; use the row-limit the caller set (default high).
      delete query.offset;
      const columnsParam = params.get("columns");
      const requested = columnsParam ? columnsParam.split(",").filter(Boolean) : undefined;
      const result = await postV1<RowsResult>(`/api/v1/catalog/rows`, {
        ...query,
        limit: query.limit,
      });
      const cols = requested && requested.length ? requested : result.columns.map((c) => c.key);
      const lines: string[] = [];
      lines.push(cols.map(csvEscape).join(","));
      for (const row of result.rows) {
        lines.push(cols.map((c) => csvEscape(row[c])).join(","));
      }
      const csv = lines.join("\r\n");
      return new Response(csv, {
        status: 200,
        headers: { "Content-Type": "text/csv;charset=utf-8;" },
      });
    }

    // Fallthrough: pass through to the raw URL.
    return fetch(`${BASE_PATH}${url}`, init);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      false,
    );
  }
}
