/**
 * staticTable.ts — deep table querying for the STATIC build.
 *
 * Reproduces the server's getTableData behavior (src/lib/db.ts: buildCondition /
 * buildWhere / getTableData) but runs the SQL IN THE BROWSER via sql.js-httpvfs
 * (see sqlClient.ts). Same operators, same filterLogic, same hide-deleted rule,
 * same {schema, rows, totalCount, totalPages} response shape the DataTable
 * already consumes, so the static raw-table browser behaves like the server one,
 * including deep filter / sort / search over full tables.
 *
 * Only imported in static mode.
 */
import { sqlQuery, sqlScalar, quoteIdent } from './sqlClient';

export interface ColumnSchema { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number }
export interface TableQueryOptions {
  tableName: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filters?: Record<string, { value: string; operator: string }>;
  globalSearch?: string;
  filterLogic?: 'AND' | 'OR';
  includeDeleted?: boolean;
}
export interface TableQueryResult {
  schema: ColumnSchema[];
  rows: Record<string, unknown>[];
  totalCount: number;
  totalPages: number;
}

const NO_VALUE_OPS = new Set(['isNull', 'isNotNull']);

function isNumericType(type: string): boolean {
  const u = (type || '').toUpperCase();
  return ['INTEGER', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL', 'BIGINT', 'SMALLINT', 'TINYINT', 'INT', 'NUMBER'].some(t => u.includes(t));
}
function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// Mirrors server buildCondition exactly (db.ts:311).
function buildCondition(qi: string, operator: string, value: string, isNumeric: boolean, params: unknown[]): string | null {
  switch (operator) {
    case 'contains': params.push(`%${value}%`); return `${qi} LIKE ?`;
    case 'notContains': params.push(`%${value}%`); return `${qi} NOT LIKE ?`;
    case 'equals': params.push(value); return `${qi} = ?`;
    case 'startsWith': params.push(`${value}%`); return `${qi} LIKE ?`;
    case 'endsWith': params.push(`%${value}`); return `${qi} LIKE ?`;
    case '>': case '<': case '>=': case '<=': case '=': case '!=': {
      if (isNumeric) {
        const n = parseFloat(value);
        if (Number.isNaN(n)) return null;
        params.push(n);
      } else params.push(value);
      return `${qi} ${operator} ?`;
    }
    case 'isNull': return `${qi} IS NULL`;
    case 'isNotNull': return `${qi} IS NOT NULL`;
    case 'in': case 'notIn': {
      const list = splitList(value);
      if (list.length === 0) return null;
      const vals: (string | number)[] = [];
      for (const v of list) {
        if (isNumeric) { const n = parseFloat(v); if (Number.isNaN(n)) continue; vals.push(n); }
        else vals.push(v);
      }
      if (vals.length === 0) return null;
      const ph = vals.map(() => '?').join(',');
      for (const v of vals) params.push(v);
      return `${qi} ${operator === 'in' ? 'IN' : 'NOT IN'} (${ph})`;
    }
    case 'between': {
      const parts = value.split(',').map(s => s.trim());
      if (parts.length < 2 || parts[0] === '' || parts[1] === '') return null;
      if (isNumeric) {
        const lo = parseFloat(parts[0]); const hi = parseFloat(parts[1]);
        if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
        params.push(lo); params.push(hi);
      } else { params.push(parts[0]); params.push(parts[1]); }
      return `${qi} BETWEEN ? AND ?`;
    }
    default: params.push(`%${value}%`); return `${qi} LIKE ?`;
  }
}

// Mirrors server buildWhere exactly (db.ts:407).
function buildWhere(
  schema: ColumnSchema[],
  filters: TableQueryOptions['filters'],
  globalSearch: string | undefined,
  filterLogic: 'AND' | 'OR' | undefined,
  columnNames: string[],
  hideDeleted: boolean,
): { whereClause: string; params: unknown[] } {
  const filterConditions: string[] = [];
  const globalSearchParts: string[] = [];
  const params: unknown[] = [];

  if (filters) {
    for (const [key, { value, operator }] of Object.entries(filters)) {
      if (!columnNames.includes(key)) continue;
      const needsValue = !NO_VALUE_OPS.has(operator);
      if (needsValue && (value === undefined || value === '')) continue;
      const column = schema.find(c => c.name === key)!;
      const isNumeric = isNumericType(column.type);
      const cond = buildCondition(quoteIdent(key), operator, value, isNumeric, params);
      if (cond) filterConditions.push(cond);
    }
  }

  if (globalSearch) {
    const textCols = schema.filter(c => ['TEXT', 'VARCHAR', 'CHAR', 'CLOB', 'STRING'].some(t => (c.type || '').toUpperCase().includes(t))).map(c => c.name);
    const searchCols = textCols.length > 0 ? textCols : columnNames;
    const clauses = searchCols.map(col => `${quoteIdent(col)} LIKE ?`);
    globalSearchParts.push(`(${clauses.join(' OR ')})`);
    for (let i = 0; i < searchCols.length; i++) params.push(`%${globalSearch}%`);
  }

  const joinLogic = filterLogic === 'OR' ? ' OR ' : ' AND ';
  const combined: string[] = [];
  if (hideDeleted && columnNames.includes('deleted')) combined.push('"deleted" = 0');
  if (filterConditions.length > 0) combined.push(`(${filterConditions.join(joinLogic)})`);
  if (globalSearchParts.length > 0) combined.push(...globalSearchParts);
  return { whereClause: combined.length > 0 ? `WHERE ${combined.join(' AND ')}` : '', params };
}

const schemaCache = new Map<string, ColumnSchema[]>();

async function getSchema(tableName: string): Promise<ColumnSchema[]> {
  const cached = schemaCache.get(tableName);
  if (cached) return cached;
  const rows = await sqlQuery(`PRAGMA table_info(${quoteIdent(tableName)})`);
  const schema: ColumnSchema[] = rows.map(r => ({
    cid: Number(r.cid ?? 0),
    name: String(r.name),
    type: String(r.type ?? ''),
    notnull: Number(r.notnull ?? 0),
    dflt_value: r.dflt_value ?? null,
    pk: Number(r.pk ?? 0),
  }));
  schemaCache.set(tableName, schema);
  return schema;
}

/** Deep table query in the browser. Same contract as GET /api/data/[tableName]. */
export async function queryTableStatic(opts: TableQueryOptions): Promise<TableQueryResult> {
  const { tableName, page, pageSize, sortBy, sortDirection, filters, globalSearch, filterLogic, includeDeleted } = opts;
  const schema = await getSchema(tableName);
  const columnNames = schema.map(c => c.name);
  const qi = quoteIdent(tableName);

  const hideDeleted = !includeDeleted && columnNames.includes('deleted');
  const { whereClause, params } = buildWhere(schema, filters, globalSearch, filterLogic, columnNames, hideDeleted);
  const orderClause = sortBy && columnNames.includes(sortBy)
    ? `ORDER BY ${quoteIdent(sortBy)} ${sortDirection === 'desc' ? 'DESC' : 'ASC'}`
    : '';
  const offset = (page - 1) * pageSize;

  const totalCount = await sqlScalar(`SELECT COUNT(*) FROM ${qi} ${whereClause}`, params);
  const rows = await sqlQuery(
    `SELECT * FROM ${qi} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  return { schema, rows, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}

/** Distinct values for a column (server: GET /api/distinct/[tableName]). */
export async function distinctStatic(tableName: string, column: string, limit = 200): Promise<string[]> {
  const qi = quoteIdent(tableName); const qc = quoteIdent(column);
  const rows = await sqlQuery(
    `SELECT DISTINCT ${qc} AS v FROM ${qi} WHERE ${qc} IS NOT NULL AND ${qc} != '' ORDER BY ${qc} LIMIT ?`,
    [limit],
  );
  return rows.map(r => String(r.v));
}
