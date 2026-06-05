'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import DataTable from './DataTable';
import MutationExplorer from './MutationExplorer';
import {
  Database, Search, Sun, Moon, Table2, Dna,
  Server, HardDrive, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, X, Clock,
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TableInfo {
  name: string;
  rowCount: number;
}

interface DashboardProps {
  initialTables: string[];
}

type DbType = 'sqlite' | 'mysql';

const ACTIVE_TABLE_KEY = 'lims:activeTable';
const SIDEBAR_COLLAPSED_KEY = 'lims:sidebarCollapsed';
const ACTIVE_VIEW_KEY = 'lims:activeView';

type ActiveView = 'tables' | 'mutations';

interface MirrorInfo {
  driver: 'sqlite' | 'mysql';
  path?: string;
  snapshot_at?: string;
  mtime?: string;
  table_counts: Record<string, number>;
}

function formatSnapshot(iso?: string): string {
  if (!iso) return '—';
  // Render YYYY-MM-DD HH:MM (UTC-agnostic — just show what's in the string).
  const cleaned = iso.replace('T', ' ').replace(/\.\d+$/, '').replace(/Z$/, '');
  return cleaned.length >= 16 ? cleaned.slice(0, 16) : cleaned;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return n.toLocaleString();
}

export default function Dashboard({ initialTables }: DashboardProps) {
  const [activeTable, setActiveTable] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const [tables, setTables] = useState<TableInfo[]>(
    initialTables.map(name => ({ name, rowCount: 0 }))
  );
  const [tablesLoading, setTablesLoading] = useState(false);
  const [dbType, setDbType] = useState<DbType>('sqlite');
  const [dbConnected, setDbConnected] = useState(true);
  const [dbPath, setDbPath] = useState<string>('');
  const [showDbSwitcher, setShowDbSwitcher] = useState(false);
  const dbSwitcherRef = useRef<HTMLDivElement>(null);
  const [mysqlHost, setMysqlHost] = useState('localhost');
  const [mysqlPort, setMysqlPort] = useState('3306');
  const [mysqlUser, setMysqlUser] = useState('root');
  const [mysqlPassword, setMysqlPassword] = useState('');
  const [mysqlDatabase, setMysqlDatabase] = useState('lims');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('tables');
  const [mirrorInfo, setMirrorInfo] = useState<MirrorInfo | null>(null);
  const [showMirror, setShowMirror] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Restore persisted UI state
  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (c === '1') setCollapsed(true);
      const v = localStorage.getItem(ACTIVE_VIEW_KEY);
      if (v === 'mutations' || v === 'tables') setActiveView(v);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_VIEW_KEY, activeView); } catch {}
  }, [activeView]);

  // Persist sidebar state
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  // Restore previously selected table once tables arrive
  useEffect(() => {
    if (tables.length === 0) { setActiveTable(''); return; }
    try {
      const saved = localStorage.getItem(ACTIVE_TABLE_KEY);
      if (saved && tables.some(t => t.name === saved)) {
        setActiveTable(saved);
        return;
      }
    } catch {}
    setActiveTable(prev => prev && tables.some(t => t.name === prev) ? prev : tables[0].name);
  }, [tables]);

  // Persist active table
  useEffect(() => {
    if (!activeTable) return;
    try { localStorage.setItem(ACTIVE_TABLE_KEY, activeTable); } catch {}
  }, [activeTable]);

  // Load tables + counts + db config
  const refreshTables = async () => {
    setTablesLoading(true);
    try {
      const [cfgRes, tblRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/tables?withCounts=1'),
      ]);
      const cfg = await cfgRes.json();
      const tbl = await tblRes.json();
      setDbType(cfg.type);
      setDbConnected(!cfg.error && !tbl.error);
      if (cfg.mysqlHost) setMysqlHost(cfg.mysqlHost);
      if (cfg.mysqlPort) setMysqlPort(String(cfg.mysqlPort));
      if (cfg.mysqlDatabase) setMysqlDatabase(cfg.mysqlDatabase);
      if (cfg.sqlitePath) setDbPath(cfg.sqlitePath);
      if (Array.isArray(tbl.tables)) {
        setTables(tbl.tables as TableInfo[]);
      }
    } catch {
      setDbConnected(false);
    } finally {
      setTablesLoading(false);
    }
  };

  useEffect(() => {
    refreshTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMirror = async () => {
    try {
      const r = await fetch('/api/mirror-info');
      if (!r.ok) return;
      const j: MirrorInfo = await r.json();
      setMirrorInfo(j);
    } catch {}
  };
  useEffect(() => { refreshMirror(); }, [dbType]);

  useEffect(() => {
    if (!showMirror) return;
    const handler = (e: MouseEvent) => {
      if (mirrorRef.current && !mirrorRef.current.contains(e.target as Node)) setShowMirror(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMirror]);

  // Close db switcher on outside click
  useEffect(() => {
    if (!showDbSwitcher) return;
    const handler = (e: MouseEvent) => {
      if (dbSwitcherRef.current && !dbSwitcherRef.current.contains(e.target as Node)) {
        setShowDbSwitcher(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDbSwitcher]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
  };

  const switchDatabase = async (type: DbType) => {
    setSwitching(true);
    setSwitchError(null);
    try {
      const body: Record<string, unknown> = { type };
      if (type === 'mysql') {
        body.mysqlHost = mysqlHost;
        body.mysqlPort = parseInt(mysqlPort, 10);
        body.mysqlUser = mysqlUser;
        body.mysqlPassword = mysqlPassword;
        body.mysqlDatabase = mysqlDatabase;
      }
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setSwitchError(data.error);
        setDbConnected(false);
      } else {
        setDbType(data.type);
        setShowDbSwitcher(false);
        setDbConnected(true);
        await refreshTables();
      }
    } catch (e: unknown) {
      setSwitchError(e instanceof Error ? e.message : String(e));
      setDbConnected(false);
    } finally {
      setSwitching(false);
    }
  };

  const filteredTables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(t => t.name.toLowerCase().includes(q));
  }, [tables, searchQuery]);

  const totalRows = useMemo(() => tables.reduce((acc, t) => acc + (t.rowCount || 0), 0), [tables]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Top header */}
      <header className="bg-white dark:bg-gray-800 border-b border-slate-200 dark:border-gray-700 px-4 py-2.5 flex items-center justify-between shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">A</div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-slate-800 dark:text-gray-100 tracking-tight">AI-ALE LIMS</h1>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">Laboratory Information Management</p>
            </div>
          </div>
          <div className="h-6 w-px bg-slate-200 dark:bg-gray-700" />

          {/* DB connection indicator + switcher */}
          <div className="relative" ref={dbSwitcherRef}>
            <button
              onClick={() => setShowDbSwitcher(!showDbSwitcher)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              title={dbType === 'sqlite' ? dbPath : `${mysqlHost}:${mysqlPort}/${mysqlDatabase}`}
            >
              {dbType === 'mysql' ? (
                <Server className={cn("w-3.5 h-3.5", dbConnected ? "text-blue-500" : "text-red-400")} />
              ) : (
                <HardDrive className={cn("w-3.5 h-3.5", dbConnected ? "text-green-500" : "text-red-400")} />
              )}
              <span className="text-[11px] font-medium text-slate-600 dark:text-gray-300">
                {dbType === 'mysql' ? 'MySQL' : 'SQLite'}
              </span>
              {switching ? (
                <RefreshCw className="w-3 h-3 text-slate-400 animate-spin" />
              ) : dbConnected ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500" />
              )}
            </button>

            {showDbSwitcher && (
              <div className="absolute left-0 top-full mt-1 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-slate-200 dark:border-gray-700 z-50 p-3 transition-colors">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-gray-200 mb-2">Database Connection</h3>

                <div className="text-[11px] text-slate-500 dark:text-gray-400 mb-3 break-all">
                  {dbType === 'sqlite'
                    ? <>Current: <span className="font-mono">{dbPath || '(not set)'}</span></>
                    : <>Current: <span className="font-mono">{mysqlHost}:{mysqlPort}/{mysqlDatabase}</span></>}
                </div>

                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => switchDatabase('sqlite')}
                    className={cn(
                      "flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border transition-colors",
                      dbType === 'sqlite' && dbConnected
                        ? "bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300"
                        : "bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-600"
                    )}
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    SQLite
                  </button>
                  <button
                    onClick={() => switchDatabase('mysql')}
                    className={cn(
                      "flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border transition-colors",
                      dbType === 'mysql' && dbConnected
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                        : "bg-white dark:bg-gray-700 border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-600"
                    )}
                  >
                    <Server className="w-3.5 h-3.5" />
                    MySQL
                  </button>
                </div>

                {dbType === 'mysql' && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input value={mysqlHost} onChange={e => setMysqlHost(e.target.value)}
                      placeholder="Host" className="col-span-1 px-2 py-1.5 text-xs border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                    <input value={mysqlPort} onChange={e => setMysqlPort(e.target.value)}
                      placeholder="Port" className="col-span-1 px-2 py-1.5 text-xs border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                    <input value={mysqlUser} onChange={e => setMysqlUser(e.target.value)}
                      placeholder="User" className="col-span-1 px-2 py-1.5 text-xs border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                    <input type="password" value={mysqlPassword} onChange={e => setMysqlPassword(e.target.value)}
                      placeholder="Password" className="col-span-1 px-2 py-1.5 text-xs border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                    <input value={mysqlDatabase} onChange={e => setMysqlDatabase(e.target.value)}
                      placeholder="Database" className="col-span-2 px-2 py-1.5 text-xs border border-slate-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 outline-none" />
                    <button
                      onClick={() => switchDatabase('mysql')}
                      className="col-span-2 mt-1 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Connect MySQL
                    </button>
                  </div>
                )}

                {switchError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="break-all">{switchError}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mirror snapshot badge */}
          <div className="relative" ref={mirrorRef}>
            <button
              onClick={() => setShowMirror(s => !s)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-slate-200 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors text-[11px]"
              title={mirrorInfo?.path || 'LIMS mirror snapshot'}
            >
              <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-gray-400" />
              <span className="font-medium text-slate-600 dark:text-gray-300 tabular-nums">
                {mirrorInfo?.snapshot_at ? formatSnapshot(mirrorInfo.snapshot_at) : 'snapshot —'}
              </span>
            </button>
            {showMirror && mirrorInfo && (
              <div className="absolute left-0 top-full mt-1 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-slate-200 dark:border-gray-700 z-50 p-3 text-[11.5px] text-slate-700 dark:text-gray-200">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-gray-200 mb-2">LIMS Mirror Snapshot</h3>
                <div className="space-y-1">
                  <div><span className="text-slate-500 dark:text-gray-400">Driver:</span> <span className="font-mono">{mirrorInfo.driver}</span></div>
                  <div className="break-all"><span className="text-slate-500 dark:text-gray-400">Source:</span> <span className="font-mono">{mirrorInfo.path}</span></div>
                  <div><span className="text-slate-500 dark:text-gray-400">Latest sync:</span> <span className="font-mono tabular-nums">{mirrorInfo.snapshot_at ? formatSnapshot(mirrorInfo.snapshot_at) : '—'}</span></div>
                  {mirrorInfo.mtime && (
                    <div><span className="text-slate-500 dark:text-gray-400">File mtime:</span> <span className="font-mono tabular-nums">{formatSnapshot(mirrorInfo.mtime)}</span></div>
                  )}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-gray-700">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-1">Row counts</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[11px]">
                    {Object.entries(mirrorInfo.table_counts).map(([t, n]) => (
                      <div key={t} className="flex justify-between">
                        <span className="truncate text-slate-600 dark:text-gray-300">{t}</span>
                        <span className="text-slate-500 dark:text-gray-400">{n.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[10.5px] text-slate-500 dark:text-gray-400 leading-snug">
                  This viewer reads a backup snapshot of the live LIMS mirror — visualizations reflect the source DB at the timestamp above. To refresh, restart the sync job or point <code className="font-mono text-[10px]">SQLITE_PATH</code> at a newer file.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {activeView === 'tables' && activeTable && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md text-xs font-medium border border-blue-200 dark:border-blue-800">
              <Table2 className="w-3 h-3" />
              <span className="font-mono">{activeTable}</span>
            </div>
          )}
          {activeView === 'mutations' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-md text-xs font-medium border border-purple-200 dark:border-purple-800">
              <Dna className="w-3 h-3" />
              <span>Mutation Explorer</span>
            </div>
          )}

          <button
            onClick={refreshTables}
            className="p-1.5 rounded-md text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
            title="Refresh tables"
          >
            <RefreshCw className={cn("w-4 h-4", tablesLoading && "animate-spin")} />
          </button>

          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
            title={mounted ? (dark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
          >
            {mounted ? (dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />) : <div className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={cn(
          "bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-700 flex flex-col shrink-0 z-10 transition-all duration-200",
          collapsed ? "w-10" : "w-72"
        )}>
          {!collapsed ? (
            <>
              {/* Top-level view switcher */}
              <div className="p-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/80">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 flex-1">Views</div>
                  <button
                    onClick={() => setCollapsed(true)}
                    className="p-1 rounded text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-700"
                    title="Collapse sidebar"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => setActiveView('tables')}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] transition-colors text-left mb-1",
                    activeView === 'tables'
                      ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold"
                      : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700/60"
                  )}
                >
                  <Database className={cn("w-3.5 h-3.5 shrink-0", activeView === 'tables' ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-gray-500")} />
                  <span className="flex-1">Database Tables</span>
                </button>
                <button
                  onClick={() => setActiveView('mutations')}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] transition-colors text-left",
                    activeView === 'mutations'
                      ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold"
                      : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700/60"
                  )}
                >
                  <Dna className={cn("w-3.5 h-3.5 shrink-0", activeView === 'mutations' ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-gray-500")} />
                  <span className="flex-1">Mutation Explorer</span>
                </button>
              </div>

              {activeView === 'tables' ? (
                <>
                  <div className="p-3 border-b border-slate-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/80">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex-1">
                        Tables <span className="text-slate-400 dark:text-gray-500 font-normal normal-case">({tables.length})</span>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
                      <input
                        type="text"
                        placeholder="Filter tables..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-7 py-1.5 text-[12px] border border-slate-300 dark:border-gray-600 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 outline-none placeholder:text-slate-400 dark:placeholder:text-gray-500"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-1">
                    {filteredTables.map((table) => {
                      const isActive = activeTable === table.name;
                      return (
                        <button
                          key={table.name}
                          onClick={() => setActiveTable(table.name)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] transition-colors text-left",
                            isActive
                              ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                              : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700/60 hover:text-slate-900 dark:hover:text-gray-200"
                          )}
                          title={`${table.name} — ${table.rowCount.toLocaleString()} rows`}
                        >
                          <Database className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-gray-500"
                          )} />
                          <span className="truncate flex-1 font-mono">{table.name}</span>
                          <span className={cn(
                            "text-[10px] font-medium tabular-nums shrink-0",
                            isActive ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-gray-500"
                          )}>
                            {table.rowCount > 0 ? formatCount(table.rowCount) : ''}
                          </span>
                        </button>
                      );
                    })}
                    {filteredTables.length === 0 && (
                      <div className="text-center p-4 text-[12px] text-slate-500 dark:text-gray-400">
                        {tables.length === 0 ? 'No tables in database.' : 'No tables match filter.'}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/60 text-[10.5px] text-slate-500 dark:text-gray-400 flex justify-between">
                    <span>{tables.length} tables</span>
                    <span className="tabular-nums">{totalRows > 0 ? `${formatCount(totalRows)} rows` : ''}</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 text-[12px] text-slate-500 dark:text-gray-400 leading-relaxed">
                  <div className="font-semibold text-slate-700 dark:text-gray-200 mb-1">Mutation Explorer</div>
                  <p className="text-[11.5px]">Three tabs inside:</p>
                  <ul className="list-disc list-inside space-y-1 mt-1 text-[11.5px]">
                    <li><span className="font-medium">Sample Selection</span> — pick samples to compare.</li>
                    <li><span className="font-medium">Comparative View</span> — side-by-side mutation calls, including copy-number rows when present.</li>
                    <li><span className="font-medium">Barcode Charts</span> — per (library · replicate) stacked bars from <span className="font-mono">verAB_barcodes</span>.</li>
                  </ul>
                  <p className="text-[11px] mt-3 text-slate-400 dark:text-gray-500">
                    Future: dedicated copy-number viewer with read-coverage trace + breseq junctions (per Natasha 2026-06-05).
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center pt-2 gap-2">
              <button
                onClick={() => setCollapsed(false)}
                className="p-1.5 rounded text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-700"
                title="Expand sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveView('tables')}
                className={cn("p-1.5 rounded", activeView === 'tables' ? "text-blue-600 bg-blue-50 dark:bg-blue-900/40" : "text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-700")}
                title="Database Tables"
              >
                <Database className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveView('mutations')}
                className={cn("p-1.5 rounded", activeView === 'mutations' ? "text-blue-600 bg-blue-50 dark:bg-blue-900/40" : "text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-700")}
                title="Mutation Explorer"
              >
                <Dna className="w-4 h-4" />
              </button>
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 p-3 flex flex-col overflow-hidden bg-slate-50 dark:bg-gray-900 relative">
          {/*
            Always mount MutationExplorer so its dataset (~4.5 MB) preloads in
            the background as soon as the app boots — by the time the user
            clicks into the explorer, the data is already there. Keeping it
            mounted also preserves selection/filter/tab state across view
            switches; only a full page reload re-fetches.
          */}
          <div className={cn("flex-1 min-h-0", activeView === 'mutations' ? "block" : "hidden")}>
            <MutationExplorer />
          </div>
          <div className={cn("flex-1 min-h-0", activeView === 'tables' ? "block" : "hidden")}>
            {activeTable ? (
              <DataTable tableName={activeTable} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 shadow-sm text-sm gap-2">
                <Database className="w-10 h-10 text-slate-300 dark:text-gray-600" />
                <p>
                  {tables.length === 0
                    ? 'No tables found. Check the database connection.'
                    : 'Select a table from the sidebar to view data.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
