'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import DataTable from './DataTable';
import MutationExplorer from './MutationExplorer';
import {
  Database, Search, Sun, Moon, Table2, Dna,
  Server, HardDrive, RefreshCw, AlertCircle,
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
      <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between shrink-0 z-20" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--accent-600)] flex items-center justify-center text-white font-bold text-[13px] tracking-tight" style={{ boxShadow: 'var(--shadow-sm)' }}>Æ</div>
            <div className="leading-none">
              <h1 className="text-[13px] font-semibold text-[var(--text)] tracking-tight">AI-ALE LIMS</h1>
              <p className="text-[10px] text-[var(--text-faint)] font-medium mt-0.5">Adaptive Laboratory Evolution</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* System status cluster — quiet, right-aligned metadata */}
          <div className="hidden md:flex items-center gap-1.5 mr-1">
            <div className="relative" ref={dbSwitcherRef}>
              <button
                onClick={() => setShowDbSwitcher(!showDbSwitcher)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--surface-3)] transition-colors"
                title={dbType === 'sqlite' ? dbPath : `${mysqlHost}:${mysqlPort}/${mysqlDatabase}`}
              >
                {dbType === 'mysql'
                  ? <Server className={cn("w-3.5 h-3.5", dbConnected ? "text-[var(--accent-600)]" : "text-red-400")} />
                  : <HardDrive className={cn("w-3.5 h-3.5", dbConnected ? "text-[var(--accent-600)]" : "text-red-400")} />}
                <span className="text-[11px] font-medium text-[var(--text-soft)]">{dbType === 'mysql' ? 'MySQL' : 'SQLite'}</span>
                <span className={cn("w-1.5 h-1.5 rounded-full", dbConnected ? "bg-[var(--data-grow)]" : "bg-red-500")} />
              </button>

            {showDbSwitcher && (
              <div className="absolute right-0 top-full mt-1 w-96 bg-[var(--surface)] rounded-lg border border-[var(--border)] z-50 p-3" style={{ boxShadow: 'var(--shadow-md)' }}>
                <h3 className="text-xs font-semibold text-[var(--text)] mb-2">Database Connection</h3>
                <div className="text-[11px] text-[var(--text-soft)] mb-3 break-all">
                  {dbType === 'sqlite'
                    ? <>Current: <span className="lims-id">{dbPath || '(not set)'}</span></>
                    : <>Current: <span className="lims-id">{mysqlHost}:{mysqlPort}/{mysqlDatabase}</span></>}
                </div>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => switchDatabase('sqlite')}
                    className={cn("flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium border transition-colors",
                      dbType === 'sqlite' && dbConnected
                        ? "bg-[var(--accent-50)] border-[var(--accent-300)] text-[var(--accent-700)]"
                        : "bg-[var(--surface)] border-[var(--border-strong)] text-[var(--text-soft)] hover:bg-[var(--surface-3)]")}>
                    <HardDrive className="w-3.5 h-3.5" /> SQLite
                  </button>
                  <button onClick={() => switchDatabase('mysql')}
                    className={cn("flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium border transition-colors",
                      dbType === 'mysql' && dbConnected
                        ? "bg-[var(--accent-50)] border-[var(--accent-300)] text-[var(--accent-700)]"
                        : "bg-[var(--surface)] border-[var(--border-strong)] text-[var(--text-soft)] hover:bg-[var(--surface-3)]")}>
                    <Server className="w-3.5 h-3.5" /> MySQL
                  </button>
                </div>
                {dbType === 'mysql' && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input value={mysqlHost} onChange={e => setMysqlHost(e.target.value)} placeholder="Host" className="lims-input col-span-1" />
                    <input value={mysqlPort} onChange={e => setMysqlPort(e.target.value)} placeholder="Port" className="lims-input col-span-1" />
                    <input value={mysqlUser} onChange={e => setMysqlUser(e.target.value)} placeholder="User" className="lims-input col-span-1" />
                    <input type="password" value={mysqlPassword} onChange={e => setMysqlPassword(e.target.value)} placeholder="Password" className="lims-input col-span-1" />
                    <input value={mysqlDatabase} onChange={e => setMysqlDatabase(e.target.value)} placeholder="Database" className="lims-input col-span-2" />
                    <button onClick={() => switchDatabase('mysql')} className="lims-btn lims-btn-primary col-span-2 mt-1 justify-center">Connect MySQL</button>
                  </div>
                )}
                {switchError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /><span className="break-all">{switchError}</span>
                  </div>
                )}
              </div>
            )}
            </div>

            {/* Mirror snapshot badge */}
            <div className="relative" ref={mirrorRef}>
              <button onClick={() => setShowMirror(s => !s)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--surface-3)] transition-colors text-[11px]"
                title={mirrorInfo?.path || 'LIMS mirror snapshot'}>
                <Clock className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                <span className="font-medium text-[var(--text-soft)] tabular-nums">{mirrorInfo?.snapshot_at ? formatSnapshot(mirrorInfo.snapshot_at) : 'no snapshot'}</span>
              </button>
              {showMirror && mirrorInfo && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-[var(--surface)] rounded-lg border border-[var(--border)] z-50 p-3 text-[11.5px] text-[var(--text)]" style={{ boxShadow: 'var(--shadow-md)' }}>
                  <h3 className="text-xs font-semibold text-[var(--text)] mb-2">LIMS Mirror Snapshot</h3>
                  <div className="space-y-1">
                    <div><span className="text-[var(--text-soft)]">Driver:</span> <span className="lims-id">{mirrorInfo.driver}</span></div>
                    <div className="break-all"><span className="text-[var(--text-soft)]">Source:</span> <span className="lims-id">{mirrorInfo.path}</span></div>
                    <div><span className="text-[var(--text-soft)]">Latest sync:</span> <span className="lims-id tabular-nums">{mirrorInfo.snapshot_at ? formatSnapshot(mirrorInfo.snapshot_at) : '—'}</span></div>
                    {mirrorInfo.mtime && <div><span className="text-[var(--text-soft)]">File mtime:</span> <span className="lims-id tabular-nums">{formatSnapshot(mirrorInfo.mtime)}</span></div>}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--border)]">
                    <div className="lims-label mb-1">Row counts</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 lims-id tabular-nums">
                      {Object.entries(mirrorInfo.table_counts).map(([t, n]) => (
                        <div key={t} className="flex justify-between"><span className="truncate text-[var(--text-soft)]">{t}</span><span className="text-[var(--text-faint)]">{n.toLocaleString()}</span></div>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-[10.5px] text-[var(--text-soft)] leading-snug">
                    Read-only snapshot of the live LIMS mirror. Visualizations reflect the source DB at the timestamp above.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="h-5 w-px bg-[var(--border)] mx-0.5" />

          <button onClick={refreshTables} className="lims-btn lims-btn-ghost p-1.5" title="Refresh tables">
            <RefreshCw className={cn("w-4 h-4", tablesLoading && "animate-spin")} />
          </button>
          <button onClick={toggleTheme} className="lims-btn lims-btn-ghost p-1.5"
            title={mounted ? (dark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}>
            {mounted ? (dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />) : <div className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={cn(
          "bg-[var(--surface)] border-r border-[var(--border)] flex flex-col shrink-0 z-10 transition-all duration-200",
          collapsed ? "w-10" : "w-64"
        )}>
          {!collapsed ? (
            <>
              {/* Top-level view switcher */}
              <div className="p-2 border-b border-[var(--border)]">
                <div className="flex items-center gap-1.5 mb-1.5 px-1">
                  <div className="lims-label flex-1">Workspace</div>
                  <button onClick={() => setCollapsed(true)} className="lims-btn lims-btn-ghost p-1" title="Collapse sidebar">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button onClick={() => setActiveView('tables')} data-active={activeView === 'tables'} className="lims-nav mb-0.5">
                  <Database className="w-4 h-4 shrink-0" />
                  <span className="flex-1">Database Tables</span>
                </button>
                <button onClick={() => setActiveView('mutations')} data-active={activeView === 'mutations'} className="lims-nav">
                  <Dna className="w-4 h-4 shrink-0" />
                  <span className="flex-1">Mutation Explorer</span>
                </button>
              </div>

              {activeView === 'tables' ? (
                <>
                  <div className="p-2.5 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="lims-label flex-1">Tables <span className="text-[var(--text-faint)] font-normal normal-case tracking-normal">· {tables.length}</span></div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] z-10" />
                      <input type="text" placeholder="Filter tables..." value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)} className="lims-input pl-8 pr-7" />
                      {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text)]">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-1">
                    {filteredTables.map((table) => {
                      const isActive = activeTable === table.name;
                      return (
                        <button key={table.name} onClick={() => setActiveTable(table.name)}
                          data-active={isActive} className="lims-nav !py-1.5"
                          title={`${table.name} — ${table.rowCount.toLocaleString()} rows`}>
                          <Table2 className="w-3.5 h-3.5 shrink-0 opacity-60" />
                          <span className="truncate flex-1 lims-id">{table.name}</span>
                          <span className="text-[10px] font-medium tabular-nums shrink-0 text-[var(--text-faint)]">
                            {table.rowCount > 0 ? formatCount(table.rowCount) : ''}
                          </span>
                        </button>
                      );
                    })}
                    {filteredTables.length === 0 && (
                      <div className="text-center p-4 text-[12px] text-[var(--text-soft)]">
                        {tables.length === 0 ? 'No tables in database.' : 'No tables match filter.'}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-[var(--border)] text-[10.5px] text-[var(--text-faint)] flex justify-between">
                    <span className="tabular-nums">{tables.length} tables</span>
                    <span className="tabular-nums">{totalRows > 0 ? `${formatCount(totalRows)} rows` : ''}</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 overflow-y-auto p-2.5">
                  <div className="lims-label mb-2 px-1">Sections</div>
                  <div className="space-y-2 text-[11.5px] text-[var(--text-soft)] leading-relaxed px-1">
                    <div className="flex gap-2">
                      <span className="lims-pill lims-pill-mut shrink-0 mt-0.5">SEL</span>
                      <span><span className="font-medium text-[var(--text)]">Sample Selection</span> — filter and pick samples to compare.</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="lims-pill lims-pill-cn shrink-0 mt-0.5">CMP</span>
                      <span><span className="font-medium text-[var(--text)]">Comparative View</span> — side-by-side mutation calls and copy-number rows.</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="lims-pill lims-pill-grow shrink-0 mt-0.5">BC</span>
                      <span><span className="font-medium text-[var(--text)]">Barcode Charts</span> — stacked bars from <span className="lims-id">verAB_barcodes</span>.</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center pt-2 gap-1">
              <button onClick={() => setCollapsed(false)} className="lims-btn lims-btn-ghost p-1.5" title="Expand sidebar">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => setActiveView('tables')}
                className={cn("p-1.5 rounded-md", activeView === 'tables' ? "text-[var(--accent-700)] bg-[var(--accent-50)]" : "text-[var(--text-faint)] hover:bg-[var(--surface-3)]")}
                title="Database Tables">
                <Database className="w-4 h-4" />
              </button>
              <button onClick={() => setActiveView('mutations')}
                className={cn("p-1.5 rounded-md", activeView === 'mutations' ? "text-[var(--accent-700)] bg-[var(--accent-50)]" : "text-[var(--text-faint)] hover:bg-[var(--surface-3)]")}
                title="Mutation Explorer">
                <Dna className="w-4 h-4" />
              </button>
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 p-3 flex flex-col overflow-hidden bg-[var(--surface-2)] relative">
          {/*
            Always mount MutationExplorer so its dataset preloads in the
            background as soon as the app boots; keeps selection/filter/tab
            state across view switches.
          */}
          <div className={cn("flex-1 min-h-0", activeView === 'mutations' ? "block" : "hidden")}>
            <MutationExplorer />
          </div>
          <div className={cn("flex-1 min-h-0", activeView === 'tables' ? "block" : "hidden")}>
            {activeTable ? (
              <DataTable tableName={activeTable} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full bg-[var(--surface)] rounded-lg border border-[var(--border)] text-[var(--text-soft)] text-sm gap-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <Database className="w-10 h-10 text-[var(--ink-300)]" />
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
