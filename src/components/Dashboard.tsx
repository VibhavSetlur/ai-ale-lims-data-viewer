'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { fetchData, IS_STATIC, BASE_PATH } from '../lib/dataSource';
import { DEPLOYMENT_CHANNELS, type BuildInfo } from '../lib/buildInfo';
import { releaseNotes } from '../lib/releaseNotes';
import {
  Database, Search, Sun, Moon, Table2, Dna,
  Server, HardDrive, RefreshCw, AlertCircle,
  ChevronLeft, ChevronRight, X, Clock, GitBranch,
  BookOpen, Compass, ScrollText, Bug, ExternalLink, Grid3X3,
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import HelpCenter from './HelpCenter';
import GuideAssistant, { type GuideAction } from './GuideAssistant';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ISSUES_NEW_URL = 'https://github.com/VibhavSetlur/ai-ale-lims-data-viewer/issues/new/choose';

interface TableInfo {
  name: string;
  rowCount: number;
}

// Legacy / superseded tables. These are older mirrors that are strict subsets of
// (or have been replaced by) a canonical table, and are a common source of
// "I picked the wrong table and the data looked off" confusion. We keep them
// reachable but push them to the bottom of the list and tag them so the
// canonical table is the obvious choice.
//   Seqsamples   -> superseded by Seq_samples (strict subset, missing newer orders)
//   Seqorders    -> superseded by Seq_orders
//   dgoA_alleles_old -> superseded by dgoA_alleles_new
const LEGACY_TABLES = new Set<string>(['Seqsamples', 'Seqorders', 'dgoA_alleles_old']);
const isLegacyTable = (name: string) => LEGACY_TABLES.has(name);

interface DashboardProps {
  initialTables: string[];
  buildInfo: BuildInfo;
}

type DbType = 'sqlite' | 'mysql';

const ACTIVE_TABLE_KEY = 'lims:activeTable';
const SIDEBAR_COLLAPSED_KEY = 'lims:sidebarCollapsed';
const ACTIVE_VIEW_KEY = 'lims:activeView';

type ActiveView = 'tables' | 'mutations' | 'plateDesign';

const MutationExplorer = dynamic(() => import('./MutationExplorer'), { ssr: false, loading: () => <div className="p-4 text-sm text-[var(--text-soft)]">Loading Mutation Explorer…</div> });
const PlateDesignWorkspace = dynamic(() => import('./PlateDesignWorkspace'), { ssr: false, loading: () => <div className="p-4 text-sm text-[var(--text-soft)]">Loading Plate Design…</div> });
const DataTable = dynamic(() => import('./DataTable'), { ssr: false, loading: () => <div className="p-4 text-sm text-[var(--text-soft)]">Loading table browser…</div> });

interface MirrorInfo {
  driver: 'sqlite' | 'mysql';
  path?: string;
  snapshot_at?: string;
  mtime?: string;
  table_counts: Record<string, number>;
}

interface ManifestInfo {
  generatedAt?: string;
  source?: string;
  files?: Record<string, { file?: string; gz?: string; bytes?: number; gzBytes?: number; hash?: string }>;
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

export default function Dashboard({ initialTables, buildInfo }: DashboardProps) {
  const [activeTable, setActiveTable] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial browser theme hydration.
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
  const [, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // In the public static build the raw table browser is unavailable, so default
  // to the Mutation Explorer (the curated public view).
  const [activeView, setActiveView] = useState<ActiveView>(IS_STATIC ? 'mutations' : 'tables');
  const [mirrorInfo, setMirrorInfo] = useState<MirrorInfo | null>(null);
  const [showMirror, setShowMirror] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [showVersionInfo, setShowVersionInfo] = useState(false);
  const versionRef = useRef<HTMLDivElement>(null);
  const [showChangesPanel, setShowChangesPanel] = useState(false);
  const changesRef = useRef<HTMLDivElement>(null);
  const [manifestInfo, setManifestInfo] = useState<ManifestInfo | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const channelInfo = DEPLOYMENT_CHANNELS[buildInfo.channel];
  const displayChannel = channelInfo.label;
  const manifestUrl = useMemo(() => `${BASE_PATH}/data/manifest.json`, []);

  // Help system: Guide (how-do-I + prompt builder), full Help center, and the
  // Changelog. All live at the Dashboard level so they can navigate across both
  // workspaces and report provenance consistently.
  const [showHelp, setShowHelp] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  // Drive cross-component navigation: switch the workspace here, then broadcast
  // a tab change that MutationExplorer listens for. A small delay lets the view
  // mount before the tab event arrives.
  const navigate = (a: GuideAction) => {
    if (a.view) setActiveView(a.view);
    if (a.tab) {
      setTimeout(() => window.dispatchEvent(new CustomEvent('aiale:navigate', { detail: { tab: a.tab } })), 80);
    }
  };

  // Restore persisted UI state
  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser-local sidebar state.
      if (c === '1') setCollapsed(true);
      const v = localStorage.getItem(ACTIVE_VIEW_KEY);
      const oldTab = localStorage.getItem('lims:mutation:tab');
       if (oldTab === 'plateDesign') { localStorage.setItem('lims:mutation:tab', 'samples'); setActiveView('plateDesign'); }
       else if (v === 'mutations' || v === 'tables' || v === 'plateDesign') setActiveView(v);
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
    if (tables.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clears an invalid table selection after its source changes.
      setActiveTable(''); return; }
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
        fetchData('/api/config'),
        fetchData('/api/tables?withCounts=1'),
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts the initial external data request.
    refreshTables();

  }, []);

  const refreshMirror = async () => {
    try {
      const r = await fetchData('/api/mirror-info');
      if (!r.ok) return;
      const j: MirrorInfo = await r.json();
      setMirrorInfo(j);
    } catch {}
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts external mirror metadata refresh.
    refreshMirror();
  }, [dbType]);

  useEffect(() => {
    if (!showMirror) return;
    const handler = (e: MouseEvent) => {
      if (mirrorRef.current && !mirrorRef.current.contains(e.target as Node)) setShowMirror(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMirror]);

  useEffect(() => {
    if (!showVersionInfo) return;
    const handler = (e: MouseEvent) => {
      if (versionRef.current && !versionRef.current.contains(e.target as Node)) setShowVersionInfo(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVersionInfo]);

  useEffect(() => {
    if (!showChangesPanel) return;
    const handler = (e: MouseEvent) => {
      if (changesRef.current && !changesRef.current.contains(e.target as Node)) setShowChangesPanel(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChangesPanel]);

  useEffect(() => {
    if (!showChangesPanel || !IS_STATIC) return;
    let cancelled = false;
    fetch(manifestUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Manifest request failed: ${res.status}`);
        return res.json();
      })
      .then((json: ManifestInfo) => {
        if (!cancelled) {
          setManifestInfo(json);
          setManifestError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManifestError(true);
          setManifestInfo(null);
        }
      });
    return () => { cancelled = true; };
  }, [manifestUrl, showChangesPanel]);

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
    const base = q ? tables.filter(t => t.name.toLowerCase().includes(q)) : tables;
    // Canonical tables first, legacy/superseded ones grouped at the bottom.
    return [...base].sort((a, b) => {
      const al = isLegacyTable(a.name) ? 1 : 0;
      const bl = isLegacyTable(b.name) ? 1 : 0;
      if (al !== bl) return al - bl;
      return 0;
    });
  }, [tables, searchQuery]);

  const totalRows = useMemo(() => tables.reduce((acc, t) => acc + (t.rowCount || 0), 0), [tables]);
  const manifestFiles = manifestInfo?.files ?? {};
  const dataVersion = mirrorInfo?.snapshot_at || mirrorInfo?.mtime;

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
              <div className="relative" ref={versionRef}>
                <button
                  onClick={() => setShowVersionInfo(s => !s)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors"
                  title={`${channelInfo.label} ${buildInfo.version}`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-700)]">{displayChannel}</span>
                  <span className="text-[11px] font-semibold text-[var(--text)] tabular-nums">v{buildInfo.version}</span>
                </button>
                {showVersionInfo && (
                  <div className="absolute left-0 top-full mt-1 w-[22rem] bg-[var(--surface)] rounded-lg border border-[var(--border)] z-50 p-3 text-[11.5px] text-[var(--text)]" style={{ boxShadow: 'var(--shadow-md)' }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h3 className="text-xs font-semibold text-[var(--text)]">Viewer version</h3>
                        <p className="text-[10.5px] text-[var(--text-soft)] mt-0.5">Deployment branch and data snapshot are tracked separately.</p>
                      </div>
                      <span className="lims-id text-[11px] tabular-nums">v{buildInfo.version}</span>
                    </div>
                    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 lims-id">
                      <span className="text-[var(--text-soft)]">Channel</span><span>{channelInfo.label}</span>
                      <span className="text-[var(--text-soft)]">Branch</span><span>{buildInfo.branch}</span>
                      <span className="text-[var(--text-soft)]">Commit</span><span>{buildInfo.commit.slice(0, 12)}</span>
                      <span className="text-[var(--text-soft)]">Mode</span><span>{buildInfo.mode}</span>
                      {buildInfo.basePath && <><span className="text-[var(--text-soft)]">Base path</span><span>{buildInfo.basePath}</span></>}
                      <span className="text-[var(--text-soft)]">Database</span><span>{channelInfo.database}</span>
                      <span className="text-[var(--text-soft)]">Barcodes</span><span>{channelInfo.barcodePolicy}</span>
                    </div>
                    <div className="mt-3 pt-2 border-t border-[var(--border)] space-y-1">
                      {(['dev', 'public', 'server'] as const).map(channel => (
                        <div key={channel} className={cn('flex items-start gap-2 rounded px-1.5 py-1', channel === buildInfo.channel ? 'bg-[var(--accent-50)]' : '')}>
                          <GitBranch className="w-3.5 h-3.5 mt-0.5 text-[var(--text-faint)] shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--text)]">{DEPLOYMENT_CHANNELS[channel].label}</div>
                            <div className="text-[10.5px] text-[var(--text-soft)] truncate">{DEPLOYMENT_CHANNELS[channel].branch} · {DEPLOYMENT_CHANNELS[channel].database}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                <button onClick={() => setActiveView('tables')} data-active={activeView === 'tables'} data-tour="nav-tables" className="lims-nav mb-0.5">
                  <Database className="w-4 h-4 shrink-0" />
                  <span className="flex-1">Database Tables</span>
                </button>
                <button onClick={() => setActiveView('mutations')} data-active={activeView === 'mutations'} data-tour="nav-mutations" className="lims-nav"><Dna className="w-4 h-4 shrink-0" /><span className="flex-1">Mutation Explorer</span></button>
                <button onClick={() => setActiveView('plateDesign')} data-active={activeView === 'plateDesign'} className="lims-nav"><Grid3X3 className="w-4 h-4 shrink-0" /><span className="flex-1">Plate Design</span></button>
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
                      const legacy = isLegacyTable(table.name);
                      return (
                        <button key={table.name} onClick={() => setActiveTable(table.name)}
                          data-active={isActive} className="lims-nav !py-1.5"
                          title={legacy
                            ? `${table.name} — ${table.rowCount.toLocaleString()} rows (legacy / superseded table)`
                            : `${table.name} — ${table.rowCount.toLocaleString()} rows`}>
                          <Table2 className={clsx('w-3.5 h-3.5 shrink-0', legacy ? 'opacity-30' : 'opacity-60')} />
                          <span className={clsx('truncate flex-1 lims-id', legacy && 'text-[var(--text-faint)]')}>{table.name}</span>
                          {legacy && (
                            <span className="text-[8px] font-semibold uppercase tracking-wide px-1 py-px rounded bg-[var(--border)] text-[var(--text-faint)] shrink-0">legacy</span>
                          )}
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

                  </div>
                </div>
              )}

              {/* Help & Learning — always at the bottom of the expanded sidebar */}
              <div className="mt-auto p-2 border-t border-[var(--border)]">
                <div className="lims-label mb-1.5 px-1">Help &amp; Learning</div>
                <button onClick={() => setShowGuide(true)} data-tour="help-guide" className="lims-nav mb-0.5" title="Guided how-do-I answers that walk you to the right view">
                  <Compass className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Guide</span>
                </button>
                <button onClick={() => setShowChangesPanel(true)} className="lims-nav mb-0.5" title="Viewer changelog and data snapshot details">
                  <ScrollText className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Changelog</span>
                </button>
                <button onClick={() => setShowHelp(true)} className="lims-nav" title="Full searchable documentation">
                  <BookOpen className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Help</span>
                </button>
                <a href={ISSUES_NEW_URL} target="_blank" rel="noopener noreferrer" className="lims-nav mt-0.5" title="Report a bug or request a feature on GitHub">
                  <Bug className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Report an issue</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                </a>
              </div>
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
              <button onClick={() => setActiveView('plateDesign')} className={cn("p-1.5 rounded-md", activeView === 'plateDesign' ? "text-[var(--accent-700)] bg-[var(--accent-50)]" : "text-[var(--text-faint)] hover:bg-[var(--surface-3)]")} title="Plate Design"><Grid3X3 className="w-4 h-4" /></button>
              <div className="mt-auto flex flex-col items-center gap-1 pb-2">
                <button onClick={() => setShowGuide(true)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Guide"><Compass className="w-4 h-4" /></button>
                <button onClick={() => setShowChangesPanel(true)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Changelog"><ScrollText className="w-4 h-4" /></button>
                <button onClick={() => setShowHelp(true)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Help"><BookOpen className="w-4 h-4" /></button>
                <a href={ISSUES_NEW_URL} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Report an issue"><Bug className="w-4 h-4" /></a>
              </div>
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 p-3 flex flex-col overflow-hidden bg-[var(--surface-2)] relative">
          <div className="flex-1 min-h-0">
            {activeView === 'mutations' ? <MutationExplorer /> : activeView === 'plateDesign' ? <PlateDesignWorkspace /> : activeTable ? (
              <DataTable key={activeTable} tableName={activeTable} />
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

      {showChangesPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Changelog">
          <div ref={changesRef} className="w-full max-w-5xl max-h-[90vh] bg-[var(--surface)] rounded-xl border border-[var(--border)] text-[12px] text-[var(--text)] flex flex-col overflow-hidden" style={{ boxShadow: 'var(--shadow-md)' }}>
            <div className="px-4 sm:px-5 py-3 border-b border-[var(--border)] flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-[var(--accent-600)] shrink-0" />
                  <h2 className="text-[16px] font-semibold text-[var(--text)]">Changelog</h2>
                </div>
                <p className="text-[11px] text-[var(--text-soft)] mt-1">Viewer releases and data snapshot provenance are tracked separately.</p>
              </div>
              <button onClick={() => setShowChangesPanel(false)} className="p-1 rounded hover:bg-[var(--surface-3)]" title="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="lims-label mb-1">Viewer version</div>
                  <div className="text-2xl font-semibold tabular-nums text-[var(--text)]">v{buildInfo.version}</div>
                  <div className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 lims-id text-[11.5px]">
                    <span className="text-[var(--text-soft)]">Channel</span><span>{channelInfo.label} <span className="text-[var(--text-faint)]">({buildInfo.channel})</span></span>
                    <span className="text-[var(--text-soft)]">Branch</span><span>{buildInfo.branch}</span>
                    <span className="text-[var(--text-soft)]">Commit</span><span>{buildInfo.commit.slice(0, 12)}</span>
                    <span className="text-[var(--text-soft)]">Mode</span><span>{buildInfo.mode}</span>
                    {buildInfo.basePath && <><span className="text-[var(--text-soft)]">Base path</span><span className="break-all">{buildInfo.basePath}</span></>}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="lims-label mb-1">Data version</div>
                  <div className="text-2xl font-semibold tabular-nums text-[var(--text)]">{dataVersion ? formatSnapshot(dataVersion) : 'not loaded'}</div>
                  <div className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 lims-id text-[11.5px]">
                    <span className="text-[var(--text-soft)]">Expected DB</span><span>{channelInfo.database}</span>
                    <span className="text-[var(--text-soft)]">Snapshot</span><span>{mirrorInfo?.snapshot_at ? formatSnapshot(mirrorInfo.snapshot_at) : 'not available'}</span>
                    <span className="text-[var(--text-soft)]">File mtime</span><span>{mirrorInfo?.mtime ? formatSnapshot(mirrorInfo.mtime) : 'not available'}</span>
                    <span className="text-[var(--text-soft)]">Barcodes</span><span>{channelInfo.barcodePolicy}</span>
                  </div>
                </div>
              </section>

              <section>
                <div className="lims-label mb-2">Static data manifest</div>
                {IS_STATIC ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                    {manifestError && <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">Data manifest unavailable</div>}
                    {manifestInfo ? (
                      <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 lims-id text-[11.5px]">
                        <span className="text-[var(--text-soft)]">Generated</span><span>{manifestInfo.generatedAt || 'not recorded'}</span>
                        <span className="text-[var(--text-soft)]">Source</span><span className="break-all">{manifestInfo.source || 'not recorded'}</span>
                        <span className="text-[var(--text-soft)]">Files</span><span>{Object.keys(manifestFiles).length}</span>
                        <span className="text-[var(--text-soft)]">mutations__all</span><span className="break-all">{manifestFiles.mutations__all?.gz || manifestFiles.mutations__all?.file || 'not present'}</span>
                        <span className="text-[var(--text-soft)]">barcode-counts</span><span className="break-all">{manifestFiles['barcode-counts']?.gz || manifestFiles['barcode-counts']?.file || 'not present'}</span>
                      </div>
                    ) : !manifestError ? (
                      <div className="text-[11px] text-[var(--text-soft)]">Loading static manifest...</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11.5px] text-[var(--text-soft)]">Server mode serves live runtime data from the API and active database. A baked static manifest does not apply.</div>
                )}
              </section>

              <section>
                <div className="lims-label mb-2">Viewer release notes</div>
                <div className="space-y-2">
                  {releaseNotes.map((note: { version: string; date: string; summary: string }) => (
                    <div key={`${note.version}-${note.date}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="font-semibold text-[var(--text)]">v{note.version}</div>
                        <div className="text-[11px] text-[var(--text-faint)] tabular-nums">{note.date}</div>
                      </div>
                      <p className="text-[12px] leading-relaxed text-[var(--text-soft)]">{note.summary}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <HelpCenter
          onClose={() => setShowHelp(false)}
          onGuide={() => { setShowHelp(false); setShowGuide(true); }}
          guideUrl={`${BASE_PATH}/help/researcher-guide.md`}
        />
      )}
      {showGuide && (
        <GuideAssistant
          ctx={{ view: activeView === 'mutations' ? 'Mutation Explorer' : activeView === 'plateDesign' ? 'Plate Design' : 'Database Tables' }}
          onClose={() => setShowGuide(false)}
          onAction={navigate}
        />
      )}
    </div>
  );
}
