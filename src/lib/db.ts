import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import path from 'path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

export type DbType = 'sqlite' | 'mysql';

interface DbConfig {
  type: DbType;
  sqlitePath: string;
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
}

function parseMysqlUrl(url: string): { host: string; port: number; user: string; password: string; database: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '3306', 10),
      user: decodeURIComponent(u.username) || 'root',
      password: decodeURIComponent(u.password || ''),
      database: (u.pathname || '/lims').replace(/^\//, '') || 'lims',
    };
  } catch {
    return { host: 'localhost', port: 3306, user: 'root', password: '', database: 'lims' };
  }
}

const mysqlUrl = process.env.MYSQL_URL ? parseMysqlUrl(process.env.MYSQL_URL) : null;
let config: DbConfig = {
  type: mysqlUrl ? 'mysql' : 'sqlite',
  sqlitePath: path.resolve(process.cwd(), process.env.SQLITE_PATH || 'data/lims_mirror.backup.db'),
  mysqlHost: mysqlUrl?.host ?? process.env.MYSQL_HOST ?? 'localhost',
  mysqlPort: mysqlUrl?.port ?? parseInt(process.env.MYSQL_PORT || '3306', 10),
  mysqlUser: mysqlUrl?.user ?? process.env.MYSQL_USER ?? 'root',
  mysqlPassword: mysqlUrl?.password ?? process.env.MYSQL_PASSWORD ?? '',
  mysqlDatabase: mysqlUrl?.database ?? process.env.MYSQL_DATABASE ?? 'lims',
};

let sqliteDb: Database.Database | null = null;
let mysqlPool: mysql.Pool | null = null;
let configVersion = 0;

function needsPoolReset(partial: Partial<DbConfig>): boolean {
  return 'mysqlHost' in partial || 'mysqlPort' in partial || 'mysqlUser' in partial ||
         'mysqlPassword' in partial || 'mysqlDatabase' in partial;
}

export function getDbType(): DbType {
  return config.type;
}

export function getDbConfig(): DbConfig {
  return { ...config };
}

export function setDbConfig(partial: Partial<DbConfig>): void {
  const changed = needsPoolReset(partial);
  if ((partial.type && partial.type !== config.type) || changed) {
    closeConnections();
  }
  config = { ...config, ...partial };
  if (changed) configVersion++;
}

function closeConnections(): void {
  if (sqliteDb) {
    try { sqliteDb.close(); } catch {}
    sqliteDb = null;
  }
  if (mysqlPool) {
    try { mysqlPool.end(); } catch {}
    mysqlPool = null;
  }
}

let lastSqlitePath = '';
function getSqliteDb(): Database.Database {
  if (!sqliteDb || lastSqlitePath !== config.sqlitePath) {
    if (sqliteDb) { try { sqliteDb.close(); } catch {} }
    sqliteDb = new Database(config.sqlitePath, { readonly: true, fileMustExist: false });
    lastSqlitePath = config.sqlitePath;
  }
  return sqliteDb;
}

let lastConfigVersion = -1;
function getMySqlPool(): mysql.Pool {
  if (!mysqlPool || lastConfigVersion !== configVersion) {
    if (mysqlPool) { try { mysqlPool.end(); } catch {} }
    mysqlPool = mysql.createPool({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      waitForConnections: true,
      connectionLimit: 5,
    });
    lastConfigVersion = configVersion;
  }
  return mysqlPool;
}

function quoteIdent(name: string): string {
  return config.type === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

import type { RowDataPacket } from 'mysql2/promise';

interface MysqlTableRow extends RowDataPacket { name: string }
interface MysqlColumnRow extends RowDataPacket { name: string; type: string; nullable: string; dflt_value: string | null }
interface MysqlCountRow extends RowDataPacket { count: number }
interface MysqlDataRow extends RowDataPacket { [key: string]: unknown }
interface MysqlDistinctRow extends RowDataPacket { v: unknown }

export interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null | number | undefined;
  pk: number;
}

export interface TableInfo {
  name: string;
  rowCount: number;
}

function validateTableName(tables: string[], tableName: string): void {
  if (!tables.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

export async function getTables(): Promise<string[]> {
  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MysqlTableRow[]>(
      "SELECT TABLE_NAME as name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      [config.mysqlDatabase]
    );
    return rows.map(r => r.name);
  }

  const database = getSqliteDb();
  const stmt = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return (stmt.all() as { name: string }[]).map(t => t.name);
}

export async function getTablesWithCounts(): Promise<TableInfo[]> {
  const tables = await getTables();
  const results: TableInfo[] = [];

  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    // Use INFORMATION_SCHEMA TABLE_ROWS (approximate for InnoDB but fast)
    const [rows] = await pool.query<(RowDataPacket & { name: string; n: number })[]>(
      "SELECT TABLE_NAME as name, TABLE_ROWS as n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      [config.mysqlDatabase]
    );
    const map = new Map(rows.map(r => [r.name, Number(r.n) || 0]));
    for (const t of tables) results.push({ name: t, rowCount: map.get(t) ?? 0 });
    return results;
  }

  const database = getSqliteDb();
  for (const t of tables) {
    try {
      const row = database.prepare(`SELECT COUNT(*) as c FROM ${quoteIdent(t)}`).get() as { c: number };
      results.push({ name: t, rowCount: Number(row.c) || 0 });
    } catch {
      results.push({ name: t, rowCount: 0 });
    }
  }
  return results;
}

export async function getTableSchema(tableName: string): Promise<ColumnSchema[]> {
  const tables = await getTables();
  validateTableName(tables, tableName);

  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MysqlColumnRow[]>(
      "SELECT COLUMN_NAME as name, DATA_TYPE as type, IS_NULLABLE as nullable, COLUMN_DEFAULT as dflt_value FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
      [config.mysqlDatabase, tableName]
    );
    return rows.map((r, i: number) => ({
      cid: i,
      name: r.name,
      type: r.type.toUpperCase(),
      notnull: r.nullable === 'NO' ? 1 : 0,
      dflt_value: r.dflt_value,
      pk: 0,
    }));
  }

  const database = getSqliteDb();
  const stmt = database.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`);
  return stmt.all() as ColumnSchema[];
}

export async function getDistinctValues(
  tableName: string,
  columnName: string,
  limit = 200
): Promise<{ values: unknown[]; truncated: boolean }> {
  const tables = await getTables();
  validateTableName(tables, tableName);
  const schema = await getTableSchema(tableName);
  if (!schema.some(c => c.name === columnName)) {
    throw new Error(`Invalid column: ${columnName}`);
  }
  const qt = quoteIdent(tableName);
  const qc = quoteIdent(columnName);
  const cap = Math.max(1, Math.min(1000, limit));

  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MysqlDistinctRow[]>(
      `SELECT DISTINCT ${qc} as v FROM ${qt} WHERE ${qc} IS NOT NULL ORDER BY ${qc} LIMIT ?`,
      [cap + 1]
    );
    const values = rows.map(r => r.v);
    const truncated = values.length > cap;
    return { values: values.slice(0, cap), truncated };
  }

  const database = getSqliteDb();
  const rows = database
    .prepare(`SELECT DISTINCT ${qc} as v FROM ${qt} WHERE ${qc} IS NOT NULL ORDER BY ${qc} LIMIT ?`)
    .all(cap + 1) as { v: unknown }[];
  const values = rows.map(r => r.v);
  const truncated = values.length > cap;
  return { values: values.slice(0, cap), truncated };
}

export interface FetchDataOptions {
  tableName: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filters?: Record<string, { value: string; operator: string }>;
  globalSearch?: string;
  filterLogic?: 'AND' | 'OR';
  columns?: string[]; // optional projection (for export); default = *
  limit?: number; // override page-based limit (for export). When set, page/pageSize are ignored.
}

function isNumericType(type: string): boolean {
  const u = type.toUpperCase();
  return ['INTEGER', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL', 'BIGINT', 'SMALLINT', 'TINYINT', 'INT', 'NUMBER'].some(t => u.includes(t));
}

function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function buildCondition(
  qi: string,
  operator: string,
  value: string,
  isNumeric: boolean,
  params: (string | number | null)[]
): string | null {
  switch (operator) {
    case 'contains': {
      params.push(`%${value}%`);
      return `${qi} LIKE ?`;
    }
    case 'notContains': {
      params.push(`%${value}%`);
      return `${qi} NOT LIKE ?`;
    }
    case 'equals': {
      params.push(value);
      return `${qi} = ?`;
    }
    case 'startsWith': {
      params.push(`${value}%`);
      return `${qi} LIKE ?`;
    }
    case 'endsWith': {
      params.push(`%${value}`);
      return `${qi} LIKE ?`;
    }
    case '>':
    case '<':
    case '>=':
    case '<=':
    case '=':
    case '!=': {
      params.push(isNumeric ? parseFloat(value) : value);
      return `${qi} ${operator} ?`;
    }
    case 'isNull':
      return `${qi} IS NULL`;
    case 'isNotNull':
      return `${qi} IS NOT NULL`;
    case 'in':
    case 'notIn': {
      const list = splitList(value);
      if (list.length === 0) return null;
      const placeholders = list.map(() => '?').join(',');
      for (const v of list) params.push(isNumeric ? parseFloat(v) : v);
      return `${qi} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`;
    }
    case 'between': {
      const parts = value.split(',').map(s => s.trim());
      if (parts.length < 2 || parts[0] === '' || parts[1] === '') return null;
      params.push(isNumeric ? parseFloat(parts[0]) : parts[0]);
      params.push(isNumeric ? parseFloat(parts[1]) : parts[1]);
      return `${qi} BETWEEN ? AND ?`;
    }
    default: {
      params.push(`%${value}%`);
      return `${qi} LIKE ?`;
    }
  }
}

// Operators that don't need a value
const NO_VALUE_OPS = new Set(['isNull', 'isNotNull']);

interface BuildWhereResult {
  whereClause: string;
  params: (string | number | null)[];
}

function buildWhere(
  schema: ColumnSchema[],
  filters: Record<string, { value: string; operator: string }> | undefined,
  globalSearch: string | undefined,
  filterLogic: 'AND' | 'OR' | undefined,
  columnNames: string[]
): BuildWhereResult {
  const filterConditions: string[] = [];
  const globalSearchParts: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters) {
    for (const [key, { value, operator }] of Object.entries(filters)) {
      if (!columnNames.includes(key)) continue;
      const needsValue = !NO_VALUE_OPS.has(operator);
      if (needsValue && (value === undefined || value === '')) continue;
      const column = schema.find(c => c.name === key)!;
      const isNumeric = isNumericType(column.type);
      const qi = quoteIdent(key);
      const cond = buildCondition(qi, operator, value, isNumeric, params);
      if (cond) filterConditions.push(cond);
    }
  }

  if (globalSearch) {
    const textColumns = schema.filter(c =>
      ['TEXT', 'VARCHAR', 'CHAR', 'CLOB', 'STRING'].some(t => c.type.toUpperCase().includes(t))
    ).map(c => c.name);
    const searchCols = textColumns.length > 0 ? textColumns : columnNames;
    const clauses = searchCols.map(col => `${quoteIdent(col)} LIKE ?`);
    globalSearchParts.push(`(${clauses.join(' OR ')})`);
    for (let i = 0; i < searchCols.length; i++) {
      params.push(`%${globalSearch}%`);
    }
  }

  const joinLogic = filterLogic === 'OR' ? ' OR ' : ' AND ';
  const combined: string[] = [];
  if (filterConditions.length > 0) {
    combined.push(`(${filterConditions.join(joinLogic)})`);
  }
  if (globalSearchParts.length > 0) {
    combined.push(...globalSearchParts);
  }
  return {
    whereClause: combined.length > 0 ? `WHERE ${combined.join(' AND ')}` : '',
    params,
  };
}

export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MysqlDataRow[]>(sql, params);
    return rows as unknown as T[];
  }
  const database = getSqliteDb();
  return database.prepare(sql).all(...params) as T[];
}

export async function getTableData({
  tableName, page, pageSize, sortBy, sortDirection, filters, globalSearch, filterLogic, columns, limit,
}: FetchDataOptions) {
  const tables = await getTables();
  validateTableName(tables, tableName);

  const schema = await getTableSchema(tableName);
  const columnNames = schema.map(col => col.name);

  if (sortBy && !columnNames.includes(sortBy)) {
    throw new Error(`Invalid sort column: ${sortBy}`);
  }

  let projection = '*';
  if (columns && columns.length > 0) {
    const safe = columns.filter(c => columnNames.includes(c));
    if (safe.length > 0) projection = safe.map(quoteIdent).join(', ');
  }

  const { whereClause, params } = buildWhere(schema, filters, globalSearch, filterLogic, columnNames);
  const orderClause = sortBy ? `ORDER BY ${quoteIdent(sortBy)} ${sortDirection === 'desc' ? 'DESC' : 'ASC'}` : '';

  const useLimitOverride = typeof limit === 'number' && limit > 0;
  const effectiveLimit = useLimitOverride ? Math.min(limit!, 100000) : pageSize;
  const effectiveOffset = useLimitOverride ? 0 : (page - 1) * pageSize;

  const qi = quoteIdent(tableName);

  if (config.type === 'mysql') {
    const pool = getMySqlPool();
    const countQuery = `SELECT COUNT(*) as count FROM ${qi} ${whereClause}`;
    const dataQuery = `SELECT ${projection} FROM ${qi} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;

    const [countRows] = await pool.query<MysqlCountRow[]>(countQuery, params);
    const totalCount = countRows[0].count;

    const dataParams: (string | number | null)[] = [...params, effectiveLimit, effectiveOffset];
    const [rows] = await pool.query<MysqlDataRow[]>(dataQuery, dataParams);

    return {
      rows,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  const database = getSqliteDb();
  const dataQuery = `SELECT ${projection} FROM ${qi} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) as count FROM ${qi} ${whereClause}`;

  const countStmt = database.prepare(countQuery);
  const dataStmt = database.prepare(dataQuery);

  const totalCount = (countStmt.get(...params) as { count: number }).count;
  const rows = dataStmt.all(...params, effectiveLimit, effectiveOffset);

  return {
    rows,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}
