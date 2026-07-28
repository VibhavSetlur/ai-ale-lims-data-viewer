'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowDownAZ, ArrowUpZA, ArrowUpDown, Search, Settings2, Eye, EyeOff,
  X, AlertCircle, Filter, Plus, ListFilter, Download, RefreshCw,
  ChevronDown, Info, Copy, Table2,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IS_STATIC } from '../lib/dataSource';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface DataTableProps {
  tableName: string;
}

type ColType = 'text' | 'number' | 'datetime' | 'boolean';

interface FilterEntry {
  id: string;
  col: string;
  operator: string;
  value: string;
}

let filterIdCounter = 0;
function newFilterId() { return `f_${++filterIdCounter}`; }

function getColType(colType: string): ColType {
  const u = colType.toUpperCase();
  if (['BOOL', 'BOOLEAN'].some(t => u.includes(t))) return 'boolean';
  if (['INTEGER', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL', 'BIGINT', 'SMALLINT', 'TINYINT', 'INT', 'NUMBER'].some(t => u.includes(t))) return 'number';
  if (['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'].some(t => u.includes(t))) return 'datetime';
  return 'text';
}

const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'in', label: 'in (csv)' },
  { value: 'notIn', label: 'not in (csv)' },
  { value: 'isNull', label: 'is null' },
  { value: 'isNotNull', label: 'is not null' },
];
const NUM_DATE_OPS = [
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'between', label: 'between (a,b)' },
  { value: 'in', label: 'in (csv)' },
  { value: 'notIn', label: 'not in (csv)' },
  { value: 'isNull', label: 'is null' },
  { value: 'isNotNull', label: 'is not null' },
];
const BOOL_OPS = [
  { value: 'equals', label: 'equals' },
  { value: 'isNull', label: 'is null' },
  { value: 'isNotNull', label: 'is not null' },
];

const NO_VALUE_OPS = new Set(['isNull', 'isNotNull']);

function opsForType(t: ColType) {
  if (t === 'boolean') return BOOL_OPS;
  if (t === 'number' || t === 'datetime') return NUM_DATE_OPS;
  return TEXT_OPS;
}

function operatorSymbol(op: string): string {
  switch (op) {
    case 'contains': return '~';
    case 'notContains': return '!~';
    case 'equals': return '=';
    case 'startsWith': return '^';
    case 'endsWith': return '$';
    case 'isNull': return 'IS NULL';
    case 'isNotNull': return 'NOT NULL';
    case 'in': return 'IN';
    case 'notIn': return 'NOT IN';
    case 'between': return 'BETWEEN';
    default: return op;
  }
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-[var(--data-mut-bg)] text-[var(--data-mut)] rounded-[2px] px-0.5">{part}</mark>
      : part
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export default function DataTable({ tableName }: DataTableProps) {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [schema, setSchema] = useState<ColumnSchema[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);

  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | undefined>(undefined);

  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [localGlobalSearch, setLocalGlobalSearch] = useState<string>('');

  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>([
    { id: newFilterId(), col: '', operator: 'contains', value: '' },
  ]);
  const [filterLogic, setFilterLogic] = useState<'AND' | 'OR'>('AND');
  const [showDeleted, setShowDeleted] = useState<boolean>(false);
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const filterPopupRef = useRef<HTMLDivElement>(null);

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColSettings, setShowColSettings] = useState(false);
  const colSettingsRef = useRef<HTMLDivElement>(null);
  const [colSearch, setColSearch] = useState('');

  const [pageJumpVal, setPageJumpVal] = useState<string>('1');
  const [fetchKey, setFetchKey] = useState(0);

  const [showSchema, setShowSchema] = useState(false);

  // Row detail drawer
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);

  // Distinct value cache (per column) — fetched on demand for filter dropdown
  const [distinctCache, setDistinctCache] = useState<Record<string, { values: unknown[]; truncated: boolean }>>({});
  const [distinctLoading, setDistinctLoading] = useState<Record<string, boolean>>({});
  const [openSuggestFor, setOpenSuggestFor] = useState<string | null>(null);
  const suggestRef = useRef<HTMLDivElement>(null);

  // Export state
  const [exporting, setExporting] = useState(false);

  // Convert filter entries to the Record format the API expects
  const appliedFilters = useMemo(() => {
    const result: Record<string, { value: string; operator: string }> = {};
    for (const entry of filterEntries) {
      if (!entry.col) continue;
      const needsValue = !NO_VALUE_OPS.has(entry.operator);
      if (needsValue && !entry.value) continue;
      // Multiple filters on same column: last write wins (limitation of Record API). Acceptable; rare.
      result[entry.col] = { value: entry.value, operator: entry.operator };
    }
    return result;
  }, [filterEntries]);

  // Reset table-specific state when switching tables
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Switching tables resets table-local controls.
    setPage(1);
    setSortBy(undefined);
    setSortDirection(undefined);
    setFilterEntries([{ id: newFilterId(), col: '', operator: 'contains', value: '' }]);
    setFilterLogic('AND');
    setShowDeleted(false);
    setGlobalSearch('');
    setLocalGlobalSearch('');
    setHiddenCols(new Set());
    setShowColSettings(false);
    setShowFilterPopup(false);
    setColSearch('');
    setDetailRow(null);
    setDistinctCache({});
    setDistinctLoading({});
    setOpenSuggestFor(null);
    setShowSchema(false);
  }, [tableName]);

  // Build query string used by both data and export endpoints
  const buildQueryString = useCallback((includePagination: boolean) => {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());
    }
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDirection) params.set('sortDirection', sortDirection);
    if (globalSearch) params.set('globalSearch', globalSearch);
    params.set('filterLogic', filterLogic);
    if (showDeleted) params.set('includeDeleted', '1');
    for (const [k, v] of Object.entries(appliedFilters)) {
      params.set(`${k}[operator]`, v.operator);
      params.set(`${k}[value]`, v.value);
    }
    return params;
  }, [page, pageSize, sortBy, sortDirection, globalSearch, filterLogic, showDeleted, appliedFilters]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (IS_STATIC) {
          // Static build: run the query in the browser against the real DB via
          // sql.js-httpvfs (deep filter/sort/search, no server).
          const { queryTableStatic } = await import('../lib/staticTable');
          const json = await queryTableStatic({
            tableName, page, pageSize, sortBy: sortBy || undefined, sortDirection,
            filters: appliedFilters, globalSearch: globalSearch || undefined, filterLogic,
            includeDeleted: showDeleted,
          });
          if (cancelled) return;
          setSchema(json.schema);
          setData(json.rows);
          setTotalCount(json.totalCount);
          setTotalPages(json.totalPages);
          setPageJumpVal(page.toString());
          setLoading(false);
          return;
        }
        const params = buildQueryString(true);
        const res = await fetch(`/api/data/${encodeURIComponent(tableName)}?${params.toString()}`);
        if (cancelled) return;
        const json = await res.json();
        if (!res.ok) { setError(json.error || 'Failed to fetch data'); setLoading(false); return; }
        setSchema(json.schema);
        setData(json.rows);
        setTotalCount(json.totalCount);
        setTotalPages(json.totalPages);
        setPageJumpVal(page.toString());
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tableName, buildQueryString, fetchKey, page, appliedFilters, sortBy, sortDirection, globalSearch, filterLogic, showDeleted, pageSize]);

  // Close popups on outside click
  useEffect(() => {
    if (!showFilterPopup && !showColSettings && !openSuggestFor) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showFilterPopup && filterPopupRef.current && !filterPopupRef.current.contains(target)) {
        // Don't close if click is inside suggestion popup (which is portaled outside via z-index)
        if (suggestRef.current && suggestRef.current.contains(target)) return;
        setShowFilterPopup(false);
        setOpenSuggestFor(null);
      }
      if (showColSettings && colSettingsRef.current && !colSettingsRef.current.contains(target)) {
        setShowColSettings(false);
      }
      if (openSuggestFor && suggestRef.current && !suggestRef.current.contains(target)
          && filterPopupRef.current && filterPopupRef.current.contains(target)) {
        // Clicking other parts of filter popup closes suggest
        setOpenSuggestFor(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilterPopup, showColSettings, openSuggestFor]);

  // Detect empty columns within current page
  const emptyCols = useMemo(() => {
    const colSet = new Set<string>();
    if (!schema.length || !data.length) return colSet;
    for (const col of schema) {
      if (data.every(row => { const v = row[col.name]; return v === null || v === undefined || v === ''; })) {
        colSet.add(col.name);
      }
    }
    return colSet;
  }, [schema, data]);

  const handleSort = (columnName: string) => {
    if (sortBy === columnName) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortBy(undefined); setSortDirection(undefined); }
    } else { setSortBy(columnName); setSortDirection('asc'); }
    setPage(1);
  };

  const applyGlobalSearch = () => { setGlobalSearch(localGlobalSearch); setPage(1); };

  const handlePageJump = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const p = parseInt(pageJumpVal, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) setPage(p);
      else setPageJumpVal(page.toString());
    }
  };

  const toggleCol = (colName: string) => {
    setHiddenCols(prev => { const n = new Set(prev); if (n.has(colName)) n.delete(colName); else n.add(colName); return n; });
  };

  const setAllColsVisible = () => setHiddenCols(new Set());
  const hideAllExceptFirst = () => {
    if (schema.length === 0) return;
    setHiddenCols(new Set(schema.slice(1).map(c => c.name)));
  };

  const visibleCols = useMemo(() => schema.filter(col => !hiddenCols.has(col.name)), [schema, hiddenCols]);
  const searchActive = globalSearch.length > 0;

  const activeFilters = useMemo(() => filterEntries.filter(e => {
    if (!e.col) return false;
    if (NO_VALUE_OPS.has(e.operator)) return true;
    return Boolean(e.value);
  }), [filterEntries]);
  const filterCount = activeFilters.length;
  const hasDeletedCol = useMemo(() => schema.some(c => c.name === 'deleted'), [schema]);

  const addFilterEntry = () => {
    setFilterEntries(prev => [...prev, { id: newFilterId(), col: '', operator: 'contains', value: '' }]);
  };

  const removeFilterEntry = (id: string) => {
    setFilterEntries(prev => prev.length > 1 ? prev.filter(e => e.id !== id) : prev);
    setPage(1);
  };

  const updateFilterEntry = (id: string, field: 'col' | 'operator' | 'value', val: string) => {
    setFilterEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, [field]: val };
      if (field === 'col') {
        const colSchema = schema.find(c => c.name === val);
        const ct = colSchema ? getColType(colSchema.type) : 'text';
        updated.operator = opsForType(ct)[0].value;
        updated.value = '';
      }
      return updated;
    }));
    setPage(1);
  };

  const clearAllFilters = () => {
    setFilterEntries([{ id: newFilterId(), col: '', operator: 'contains', value: '' }]);
    setGlobalSearch('');
    setLocalGlobalSearch('');
    setPage(1);
  };

  const filterColumnQuick = (colName: string, value: unknown) => {
    if (value === null || value === undefined) {
      setFilterEntries([{ id: newFilterId(), col: colName, operator: 'isNull', value: '' }]);
    } else {
      setFilterEntries([{ id: newFilterId(), col: colName, operator: 'equals', value: String(value) }]);
    }
    setPage(1);
    setShowFilterPopup(true);
  };

  const loadDistinct = useCallback(async (column: string) => {
    if (!column || distinctCache[column] || distinctLoading[column]) return;
    setDistinctLoading(p => ({ ...p, [column]: true }));
    try {
      if (IS_STATIC) {
        const { distinctStatic } = await import('../lib/staticTable');
        const values = await distinctStatic(tableName, column, 200);
        setDistinctCache(p => ({ ...p, [column]: { values, truncated: values.length >= 200 } }));
        return;
      }
      const res = await fetch(`/api/distinct/${encodeURIComponent(tableName)}?column=${encodeURIComponent(column)}&limit=200`);
      const json = await res.json();
      if (!res.ok) return;
      setDistinctCache(p => ({ ...p, [column]: { values: json.values || [], truncated: !!json.truncated } }));
    } finally {
      setDistinctLoading(p => ({ ...p, [column]: false }));
    }
  }, [tableName, distinctCache, distinctLoading]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const visible = visibleCols.map(c => c.name);
      if (IS_STATIC) {
        // Build the CSV in the browser from a SQL query (same filters/sort).
        const { queryTableStatic } = await import('../lib/staticTable');
        const res = await queryTableStatic({
          tableName, page: 1, pageSize: 100000, sortBy: sortBy || undefined, sortDirection,
          filters: appliedFilters, globalSearch: globalSearch || undefined, filterLogic,
          includeDeleted: showDeleted,
        });
        const cols = (visible.length > 0 && visible.length !== schema.length) ? visible : res.schema.map(c => c.name);
        const esc = (v: unknown) => {
          let s = v === null || v === undefined ? '' : String(v);
          // OWASP CSV-injection guard (matches server export route).
          if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const blobParts: string[] = [];
        let chunk: string[] = [];
        chunk.push(cols.map(esc).join(','));
        for (const row of res.rows) {
          chunk.push(cols.map(c => esc((row as Record<string, unknown>)[c])).join(','));
          if (chunk.length >= 5000) {
            blobParts.push(chunk.join('\r\n'));
            chunk = [];
          }
        }
        if (chunk.length > 0) blobParts.push(chunk.join('\r\n'));
        const blob = new Blob(blobParts, { type: 'text/csv;charset=utf-8;' });
        chunk = [];
        const blobUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;
        downloadLink.download = `${tableName}.csv`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(blobUrl);
        return;
      }
      const params = buildQueryString(false);
      params.set('limit', '10000');
      if (visible.length > 0 && visible.length !== schema.length) {
        params.set('columns', visible.join(','));
      }
      const url = `/api/export/${encodeURIComponent(tableName)}?${params.toString()}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => setExporting(false), 500);
    }
  };

  const filteredColList = useMemo(() => {
    const q = colSearch.trim().toLowerCase();
    if (!q) return schema;
    return schema.filter(c => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
  }, [schema, colSearch]);

  // Row detail navigation
  const detailIndex = useMemo(() => {
    if (!detailRow) return -1;
    return data.indexOf(detailRow);
  }, [detailRow, data]);

  const goToDetail = (delta: number) => {
    if (detailIndex < 0) return;
    const next = detailIndex + delta;
    if (next >= 0 && next < data.length) setDetailRow(data[next]);
  };

  useEffect(() => {
    if (!detailRow) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailRow(null);
      else if (e.key === 'ArrowDown' || e.key === 'j') goToDetail(1);
      else if (e.key === 'ArrowUp' || e.key === 'k') goToDetail(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Keyboard handler closes over current detail navigation.
  }, [detailRow, detailIndex, data]);

  if (error) {
    return (
      <div className="p-6 text-center text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 flex items-center justify-center gap-3">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error}</span>
        <button onClick={() => setFetchKey(k => k + 1)} className="ml-3 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium transition-colors">Retry</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] rounded-lg shadow-sm border border-[var(--border)] overflow-hidden transition-colors">
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)] gap-3 transition-colors flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative w-72 max-w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              placeholder="Search all text columns..."
              className="lims-input pl-10 pr-8"
              value={localGlobalSearch}
              onChange={(e) => setLocalGlobalSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyGlobalSearch(); if (e.key === 'Escape') { setLocalGlobalSearch(''); setGlobalSearch(''); setPage(1); } }}
              onBlur={applyGlobalSearch}
            />
            {localGlobalSearch && (
              <button onClick={() => { setLocalGlobalSearch(''); setGlobalSearch(''); setPage(1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text)]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-baseline gap-2 text-[var(--text-soft)] text-[13px] font-medium whitespace-nowrap transition-colors">
            <span className="tabular-nums">{totalCount.toLocaleString()}</span>
            <span className="text-[11px] text-[var(--text-faint)]">rows</span>
            {loading && <span className="inline-block w-3 h-3 ml-0.5 border-2 border-[var(--border)] border-t-[var(--accent-500)] rounded-full animate-spin align-middle" />}
          </div>
          <button
            onClick={() => setShowSchema(s => !s)}
            className="lims-toolbtn"
            data-on={showSchema}
            title="Toggle schema info"
          >
            <Info className="w-3 h-3" /> Schema
          </button>
          {hasDeletedCol && (
            <button
              onClick={() => { setShowDeleted(s => !s); setPage(1); }}
              className="lims-toolbtn"
              data-on={showDeleted}
              title={showDeleted
                ? 'Showing soft-deleted rows. Click to hide them.'
                : 'Soft-deleted rows are hidden. Click to show them.'}
            >
              {showDeleted ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showDeleted ? 'Showing deleted' : 'Deleted hidden'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Filters button */}
          <div className="relative" ref={filterPopupRef}>
            <button
              onClick={() => setShowFilterPopup(!showFilterPopup)}
              className="lims-toolbtn"
              data-on={showFilterPopup || filterCount > 0}
            >
              <ListFilter className="w-3.5 h-3.5" />
              Filters
              {filterCount > 0 && (
                <span className="ml-1 bg-[var(--accent-600)] text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{filterCount}</span>
              )}
            </button>

            {showFilterPopup && (
              <div className="lims-popover absolute right-0 top-full mt-1 w-[560px] z-50 p-3 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
                    <Filter className="w-4 h-4 text-[var(--accent-600)]" />
                    Column Filters
                  </h3>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-soft)]">Join with:</span>
                    <div className="flex rounded border border-[var(--border-strong)] overflow-hidden">
                      <button
                        onClick={() => setFilterLogic('AND')}
                        className={cn("px-2 py-0.5 text-[11px] font-medium transition-colors",
                          filterLogic === 'AND'
                            ? "bg-[var(--accent-600)] text-white"
                            : "bg-[var(--surface)] text-[var(--text-soft)] hover:bg-[var(--surface-3)]"
                        )}
                      >AND</button>
                      <button
                        onClick={() => setFilterLogic('OR')}
                        className={cn("px-2 py-0.5 text-[11px] font-medium transition-colors border-l border-[var(--border-strong)]",
                          filterLogic === 'OR'
                            ? "bg-[var(--accent-600)] text-white"
                            : "bg-[var(--surface)] text-[var(--text-soft)] hover:bg-[var(--surface-3)]"
                        )}
                      >OR</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {filterEntries.map((entry, idx) => {
                    const colSchema = schema.find(c => c.name === entry.col);
                    const ct = colSchema ? getColType(colSchema.type) : 'text';
                    const ops = opsForType(ct);
                    const noValue = NO_VALUE_OPS.has(entry.operator);
                    const isOpen = openSuggestFor === entry.id;
                    const distinct = entry.col ? distinctCache[entry.col] : undefined;
                    const dLoading = entry.col ? distinctLoading[entry.col] : false;
                    return (
                      <div key={entry.id} className="flex items-start gap-2 bg-[var(--surface-2)] rounded-md px-2.5 py-2 border border-[var(--border)]">
                        {idx > 0 && (
                          <span className={cn("text-[10px] font-bold uppercase tracking-wider pt-1.5 w-8 text-center",
                            filterLogic === 'AND' ? "text-[var(--accent-600)]" : "text-[var(--data-mut)]"
                          )}>{filterLogic}</span>
                        )}
                        {idx === 0 && <span className="text-[10px] font-bold uppercase tracking-wider pt-1.5 w-8 text-center text-[var(--text-faint)]">WHERE</span>}
                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <select
                              value={entry.col}
                              onChange={(e) => updateFilterEntry(entry.id, 'col', e.target.value)}
                              className="lims-select flex-1 min-w-0"
                            >
                              <option value="">-- column --</option>
                              {schema.map(c => (
                                <option key={c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>

                            <select
                              value={entry.operator}
                              onChange={(e) => updateFilterEntry(entry.id, 'operator', e.target.value)}
                              className="lims-select w-40"
                            >
                              {ops.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>

                            <button
                              onClick={() => removeFilterEntry(entry.id)}
                              disabled={filterEntries.length <= 1}
                              className="p-1.5 text-[var(--text-faint)] hover:text-red-500 disabled:opacity-30 disabled:hover:text-[var(--text-faint)] transition-colors shrink-0"
                              title="Remove filter"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {!noValue && (
                            <div className="relative">
                              {ct === 'datetime' && (entry.operator === '=' || entry.operator === '!=' || entry.operator === '>' || entry.operator === '<' || entry.operator === '>=' || entry.operator === '<=') ? (
                                <input
                                  type="datetime-local"
                                  value={entry.value}
                                  onChange={(e) => updateFilterEntry(entry.id, 'value', e.target.value)}
                                  className="lims-input"
                                />
                              ) : ct === 'boolean' && entry.operator === 'equals' ? (
                                <select
                                  value={entry.value}
                                  onChange={(e) => updateFilterEntry(entry.id, 'value', e.target.value)}
                                  className="lims-select w-full"
                                >
                                  <option value="">-- value --</option>
                                  <option value="1">true</option>
                                  <option value="0">false</option>
                                </select>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    placeholder={
                                      entry.operator === 'between' ? 'min,max' :
                                      entry.operator === 'in' || entry.operator === 'notIn' ? 'a,b,c' :
                                      'value'
                                    }
                                    value={entry.value}
                                    onChange={(e) => updateFilterEntry(entry.id, 'value', e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') setShowFilterPopup(false); }}
                                    className="lims-input flex-1"
                                  />
                                  {entry.col && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isOpen) { setOpenSuggestFor(null); return; }
                                        setOpenSuggestFor(entry.id);
                                        loadDistinct(entry.col);
                                      }}
                                      className="p-1.5 text-[var(--text-faint)] hover:text-[var(--accent-600)] rounded border border-[var(--border-strong)] bg-[var(--surface)]"
                                      title="Suggest values"
                                    >
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {isOpen && entry.col && (
                                <div ref={suggestRef} className="lims-popover absolute right-0 top-full mt-1 w-full max-h-64 overflow-auto z-50 p-1">
                                  {dLoading && (
                                    <div className="px-2 py-2 text-[12px] text-[var(--text-soft)]">Loading…</div>
                                  )}
                                  {distinct && distinct.values.length === 0 && !dLoading && (
                                    <div className="px-2 py-2 text-[12px] text-[var(--text-soft)]">No distinct values.</div>
                                  )}
                                  {distinct && distinct.values.map((v, i) => {
                                    const s = formatCell(v);
                                    return (
                                      <button
                                        key={i}
                                        onClick={() => {
                                          if (entry.operator === 'in' || entry.operator === 'notIn') {
                                            const existing = entry.value.split(',').map(x => x.trim()).filter(Boolean);
                                            if (!existing.includes(s)) existing.push(s);
                                            updateFilterEntry(entry.id, 'value', existing.join(','));
                                          } else {
                                            updateFilterEntry(entry.id, 'value', s);
                                            setOpenSuggestFor(null);
                                          }
                                        }}
                                        className="flex w-full items-center px-2 py-1 text-left text-[12px] hover:bg-[var(--surface-3)] rounded text-[var(--text)] font-mono truncate"
                                        title={s}
                                      >
                                        {s || <span className="italic text-[var(--text-faint)]">(empty)</span>}
                                      </button>
                                    );
                                  })}
                                  {distinct && distinct.truncated && (
                                    <div className="px-2 py-1 text-[10px] text-[var(--text-faint)] italic border-t border-[var(--border)] mt-1">
                                      First 200 values shown.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--border)]">
                  <button
                    onClick={addFilterEntry}
                    className="flex items-center gap-1 text-[12px] text-[var(--accent-600)] hover:text-[var(--accent-700)] font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Condition
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={clearAllFilters}
                      className="px-3 py-1 text-[12px] text-[var(--text-soft)] hover:text-red-600 font-medium"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => setShowFilterPopup(false)}
                      className="lims-btn lims-btn-primary"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Columns button */}
          <div className="relative" ref={colSettingsRef}>
            <button
              onClick={() => setShowColSettings(!showColSettings)}
              className="lims-toolbtn"
              data-on={showColSettings}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Columns <span className="text-[11px] text-[var(--text-faint)]">{visibleCols.length}/{schema.length}</span>
            </button>

            {showColSettings && (
              <div className="lims-popover absolute right-0 top-full mt-1 w-72 z-50 transition-colors flex flex-col max-h-[420px]">
                <div className="p-2 border-b border-[var(--border)]">
                  <div className="relative mb-2">
                    <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input
                      type="text"
                      placeholder="Search columns..."
                      value={colSearch}
                      onChange={(e) => setColSearch(e.target.value)}
                      className="lims-input pl-7"
                    />
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <button onClick={setAllColsVisible} className="text-[var(--accent-600)] hover:underline font-medium">Show all</button>
                    <button onClick={hideAllExceptFirst} className="text-[var(--text-soft)] hover:text-red-600 font-medium">Hide all</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-1">
                  {filteredColList.map(col => {
                    const hidden = hiddenCols.has(col.name);
                    return (
                      <button key={col.name} onClick={() => toggleCol(col.name)}
                        className="flex items-center justify-between w-full px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--surface-3)] rounded text-[var(--text)] transition-colors gap-2"
                      >
                        <span className="truncate font-mono" title={col.name}>{col.name}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-[var(--text-faint)] uppercase tabular-nums">{col.type || ''}</span>
                          {hidden
                            ? <EyeOff className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                            : <Eye className="w-3.5 h-3.5 text-[var(--accent-600)]" />}
                        </span>
                      </button>
                    );
                  })}
                  {filteredColList.length === 0 && (
                    <div className="px-2 py-3 text-center text-[12px] text-[var(--text-soft)]">No columns match.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Export */}
          <button
            onClick={exportCsv}
            disabled={exporting || totalCount === 0}
            className="lims-toolbtn"
            title={`Export current filter to CSV (up to 10,000 rows)`}
          >
            {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            CSV
          </button>

          {/* Reset */}
          {(activeFilters.length > 0 || globalSearch || sortBy || hiddenCols.size > 0) && (
            <button
              onClick={() => {
                clearAllFilters();
                setHiddenCols(new Set());
                setSortBy(undefined);
                setSortDirection(undefined);
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11.5px] text-[var(--text-soft)] hover:text-red-600 hover:bg-[var(--surface-3)] transition-colors"
              title="Reset all filters, sort, and column visibility"
            >
              <X className="w-3 h-3" /> Reset
            </button>
          )}

          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="lims-select"
            title="Page size"
          >
            {[25, 50, 100, 200, 500].map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>

          <div className="flex items-center border border-[var(--border-strong)] rounded-md shadow-sm bg-[var(--surface)] overflow-hidden h-8 transition-colors">
            <button onClick={() => setPage(1)} disabled={page === 1 || loading} className="px-2 hover:bg-[var(--surface-3)] disabled:opacity-50 disabled:hover:bg-[var(--surface)] text-[var(--text-soft)] transition-colors h-full" title="First"><ChevronsLeft className="w-3.5 h-3.5" /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading} className="px-2 hover:bg-[var(--surface-3)] disabled:opacity-50 disabled:hover:bg-[var(--surface)] text-[var(--text-soft)] border-l border-[var(--border-strong)] transition-colors h-full" title="Prev"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <div className="px-2 flex items-center gap-1 border-x border-[var(--border-strong)] h-full bg-[var(--surface-2)]">
              <input type="text" value={pageJumpVal}
                onChange={e => setPageJumpVal(e.target.value)} onKeyDown={handlePageJump}
                onBlur={() => setPageJumpVal(page.toString())}
                className="w-9 px-1 py-0 text-center text-[12.5px] border border-[var(--border-strong)] rounded focus:border-[var(--accent-500)] focus:outline-none bg-[var(--surface)] text-[var(--text)]"
              />
              <span className="text-[var(--text-soft)] font-medium text-[12.5px]">/ {totalPages || 1}</span>
            </div>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0 || loading} className="px-2 hover:bg-[var(--surface-3)] disabled:opacity-50 disabled:hover:bg-[var(--surface)] text-[var(--text-soft)] border-r border-[var(--border-strong)] transition-colors h-full" title="Next"><ChevronRight className="w-3.5 h-3.5" /></button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages || totalPages === 0 || loading} className="px-2 hover:bg-[var(--surface-3)] disabled:opacity-50 disabled:hover:bg-[var(--surface)] text-[var(--text-soft)] transition-colors h-full" title="Last"><ChevronsRight className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {/* Active filter tags bar */}
      {(activeFilters.length > 0 || globalSearch) && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent-50)] border-b border-[var(--accent-300)] flex-wrap transition-colors">
          {globalSearch && (
            <span className="lims-chip border-[var(--data-mut)] text-[var(--data-mut)] bg-[var(--data-mut-bg)]">
              <Search className="w-3 h-3" />
              <span className="font-mono max-w-[160px] truncate">{globalSearch}</span>
              <button onClick={() => { setLocalGlobalSearch(''); setGlobalSearch(''); setPage(1); }}
                className="text-[var(--data-mut)] hover:text-red-500 ml-0.5"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {activeFilters.map((e, idx) => (
            <React.Fragment key={e.id}>
              {idx > 0 && (
                <span className="text-[10px] text-[var(--accent-600)] font-bold uppercase">{filterLogic}</span>
              )}
              <span className="lims-chip lims-chip-accent">
                <span className="font-mono font-medium">{e.col}</span>
                <span className="text-[var(--accent-600)]">{operatorSymbol(e.operator)}</span>
                {!NO_VALUE_OPS.has(e.operator) && <span className="font-mono max-w-[160px] truncate">{e.value}</span>}
                <button onClick={() => removeFilterEntry(e.id)}
                  className="text-[var(--accent-600)] hover:text-red-500 ml-0.5"><X className="w-2.5 h-2.5" /></button>
              </span>
            </React.Fragment>
          ))}
          <button onClick={clearAllFilters}
            className="ml-1 text-[11px] text-[var(--accent-600)] hover:text-red-600 font-medium">Clear all</button>
        </div>
      )}

      {/* Optional schema bar */}
      {showSchema && (
        <div className="px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] text-[11px] text-[var(--text-soft)] flex items-center gap-3 overflow-x-auto whitespace-nowrap">
          <span className="font-semibold text-[var(--text)]">{tableName}</span>
          <span className="text-[var(--text-faint)]">·</span>
          <span>{schema.length} cols</span>
          <span className="text-[var(--text-faint)]">·</span>
          {schema.map(c => (
            <span key={c.name} className="font-mono">
              <span className="text-[var(--text)]">{c.name}</span>
              <span className="text-[var(--text-faint)]">:{c.type || 'TEXT'}</span>
              {c.pk ? <span className="text-[var(--data-mut)] ml-0.5">·pk</span> : null}
              {c.notnull ? <span className="text-rose-600 dark:text-rose-400 ml-0.5">·nn</span> : null}
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto relative bg-[var(--surface)] transition-colors">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead className="lims-thead sticky top-0 z-10 shadow-sm">
            <tr>
              {visibleCols.map((col) => {
                const isEmptyCol = emptyCols.has(col.name);
                const hasFilter = !!appliedFilters[col.name];
                const isSorted = sortBy === col.name;
                return (
                  <th key={col.name} className="p-0 align-top group">
                    <div className="px-3 py-2 flex flex-col">
                      <div className="lims-th-sort flex items-center justify-between cursor-pointer select-none transition-colors text-[12.5px] font-semibold text-[var(--text)]"
                        onClick={() => handleSort(col.name)}
                        title={`${col.name} (${col.type || 'TEXT'})${col.pk ? ' · PK' : ''}${col.notnull ? ' · NOT NULL' : ''}`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate max-w-[200px] font-mono">{col.name}</span>
                          {isEmptyCol && (
                            <AlertCircle className="w-3 h-3 text-[var(--data-mut)] shrink-0" />
                          )}
                          {hasFilter && <Filter className="w-3 h-3 text-[var(--accent-600)] shrink-0" />}
                        </span>
                        <span className={cn("shrink-0 transition-colors",
                          isSorted ? "text-[var(--accent-600)]" : "text-[var(--text-faint)] opacity-0 group-hover:opacity-100"
                        )}>
                          {isSorted
                            ? (sortDirection === 'desc' ? <ArrowUpZA className="w-3.5 h-3.5" /> : <ArrowDownAZ className="w-3.5 h-3.5" />)
                            : <ArrowUpDown className="w-3 h-3" />}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)] uppercase font-mono tracking-wider mt-0.5">
                        {col.type || 'TEXT'}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] transition-colors">
            {loading && data.length === 0 ? (
              <tr><td colSpan={visibleCols.length || 1} className="h-48 text-center text-[var(--text-faint)] align-middle text-sm">Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={visibleCols.length || 1} className="h-48 text-center text-[var(--text-soft)] align-middle">
                <p className="text-sm">No records found. Try clearing some filters.</p>
                {(activeFilters.length > 0 || globalSearch) && (
                  <button onClick={clearAllFilters} className="lims-btn lims-btn-secondary mt-3">Clear filters</button>
                )}
              </td></tr>
            ) : (
              data.map((row, i) => (
                <tr key={i}
                  className={cn(
                    "transition-colors group cursor-pointer",
                    searchActive ? "lims-trow-alt" : "lims-trow"
                  )}
                  onClick={() => setDetailRow(row)}
                >
                  {visibleCols.map((col) => {
                    const val = row[col.name];
                    // Identifier-like string columns render in monospace so
                    // IDs (breseq_..., TFMN1.fba.1.T1.P, sample keys) align and
                    // read as codes rather than prose.
                    const isIdCol = /(^|_)(id|ids|sample|seqsample|seqorder|registry|refgenome|barcode|well|strain|plasmid|construct|primer|accession|key|name)s?$/i.test(col.name)
                      || /^(seqsample|seqorder|breseq)/i.test(col.name);
                    const mono = isIdCol && typeof val === 'string' && val !== '';
                    return (
                      <td key={col.name}
                        className="lims-tcell px-3 py-1.5 max-w-[350px] truncate transition-colors"
                        title={val === null || val === undefined ? '' : String(val)}
                      >
                        {val === null || val === undefined ? (
                          <span className="text-[var(--text-faint)] italic text-[11.5px]">null</span>
                        ) : typeof val === 'boolean' ? (
                          <span className={cn("px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold uppercase tracking-wider",
                            val ? "bg-[var(--data-grow-bg)] text-[var(--data-grow)]"
                                : "bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300")}>
                            {val ? 'True' : 'False'}
                          </span>
                        ) : typeof val === 'number' ? (
                          <span className="font-mono text-[13px] text-[var(--text-soft)] tabular-nums">{val}</span>
                        ) : searchActive ? (
                          <span className={cn("text-[13px]", mono && "font-mono text-[12px] text-[var(--text-soft)]")}>{highlightText(String(val), globalSearch)}</span>
                        ) : (
                          <span className={cn("text-[13px]", mono && "font-mono text-[12px] text-[var(--text-soft)]")}>{String(val)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Row detail drawer */}
      {detailRow && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setDetailRow(null)}>
          <div className="absolute inset-0 bg-slate-900/30 dark:bg-black/40 backdrop-blur-[1px]" />
          <div
            className="lims-drawer relative w-[480px] max-w-full h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-2 min-w-0">
                <Table2 className="w-4 h-4 text-[var(--accent-600)] shrink-0" />
                <h3 className="text-sm font-semibold text-[var(--text)] truncate font-mono">{tableName}</h3>
                <span className="text-xs text-[var(--text-faint)] shrink-0">row {detailIndex >= 0 ? detailIndex + 1 : '?'} / {data.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToDetail(-1)} disabled={detailIndex <= 0}
                  className="p-1 rounded text-[var(--text-soft)] hover:bg-[var(--surface-3)] disabled:opacity-30" title="Previous (↑/k)">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => goToDetail(1)} disabled={detailIndex < 0 || detailIndex >= data.length - 1}
                  className="p-1 rounded text-[var(--text-soft)] hover:bg-[var(--surface-3)] disabled:opacity-30" title="Next (↓/j)">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(detailRow, null, 2))}
                  className="p-1 rounded text-[var(--text-soft)] hover:bg-[var(--surface-3)]" title="Copy as JSON">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => setDetailRow(null)}
                  className="p-1 rounded text-[var(--text-soft)] hover:bg-[var(--surface-3)]" title="Close (Esc)">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {schema.map(col => {
                const val = detailRow[col.name];
                const empty = val === null || val === undefined || val === '';
                return (
                  <div key={col.name} className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-semibold text-[var(--text-soft)] truncate" title={col.name}>{col.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9.5px] uppercase font-mono text-[var(--text-faint)]">{col.type || 'TEXT'}</span>
                        <button
                          onClick={() => filterColumnQuick(col.name, val)}
                          className="text-[var(--text-faint)] hover:text-[var(--accent-600)]"
                          title={empty ? 'Filter where this column is null' : 'Filter rows with this value'}
                        >
                          <Filter className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                    <div className="text-[12.5px] text-[var(--text)] font-mono break-all">
                      {empty
                        ? <span className="italic text-[var(--text-faint)]">null</span>
                        : typeof val === 'boolean'
                          ? (val ? 'true' : 'false')
                          : formatCell(val)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
