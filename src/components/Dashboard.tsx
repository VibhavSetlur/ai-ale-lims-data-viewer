'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import DataTable from './DataTable';
import MutationExplorer from './MutationExplorer';
import { fetchData, IS_STATIC, BASE_PATH } from '../lib/dataSource';
import {
  Database, Search, Sun, Moon, Table2, Dna,
  Server, HardDrive, RefreshCw, AlertCircle,
  ChevronLeft, ChevronRight, X, Clock,
  BookOpen, Compass, PlayCircle,
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import HelpCenter from './HelpCenter';
import Tutorial, { type TourStep } from './Tutorial';
import GuideAssistant, { type GuideAction } from './GuideAssistant';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  // In the public static build the raw table browser is unavailable, so default
  // to the Mutation Explorer (the curated public view).
  const [activeView, setActiveView] = useState<ActiveView>(IS_STATIC ? 'mutations' : 'tables');
  const [mirrorInfo, setMirrorInfo] = useState<MirrorInfo | null>(null);
  const [showMirror, setShowMirror] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Help system: Guide (how-do-I + prompt builder), full Help center, and the
  // interactive click-through Tutorial. All live at the Dashboard level so they
  // can navigate across both workspaces.
  const [showHelp, setShowHelp] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [tourFlow, setTourFlow] = useState<TourStep[] | null>(null);
  const [hasBarcodes, setHasBarcodes] = useState(false);

  // Detect whether the active snapshot exposes the Barcode tab, so the Guide can
  // hide barcode help when there is no barcode data (e.g. the TFMN1 snapshot).
  useEffect(() => {
    let cancelled = false;
    fetchData('/api/mutations')
      .then(r => r.json())
      .then(j => { if (!cancelled) setHasBarcodes(Boolean(j?.stats?.hasBarcodes)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Drive cross-component navigation: switch the workspace here, then broadcast
  // a tab change that MutationExplorer listens for. A small delay lets the view
  // mount before the tab event arrives.
  const navigate = (a: GuideAction) => {
    if (a.kind === 'navigate') {
      if (a.view) setActiveView(a.view);
      if (a.tab) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('aiale:navigate', { detail: { tab: a.tab } })), 80);
      }
    } else if (a.kind === 'tutorial') {
      startTour(a.flow);
    }
  };

  // Interactive tour flows. Each step spotlights a live element by its data-tour
  // attribute (the highlighted area stays clickable so the user can try it), can
  // run a setup before it shows, and carries structured what-it-is / what-to-look
  // -for / try-it content so a first-time user gets a complete understanding.
  function startTour(flow: string) {
    setShowHelp(false);
    setShowGuide(false);
    const go = (view: ActiveView, tab?: string) => {
      setActiveView(view);
      if (tab) setTimeout(() => window.dispatchEvent(new CustomEvent('aiale:navigate', { detail: { tab } })), 60);
    };

    // ---- the complete A-to-Z walkthrough (meeting-ready) ----
    const fullTour: TourStep[] = [
      {
        title: 'Welcome to the AI-ALE LIMS viewer',
        body: 'This is a read-only window onto the adaptive-laboratory-evolution data for Acinetobacter baylyi ADP1 (strain ACN2586) evolving on pyruvate. In the next few minutes you will see exactly where everything is and how to use it. The highlighted area in each step is live, so you can click and try things as we go.',
        look: 'A left sidebar (navigation + help), a top bar (database status), and a main panel that changes with what you pick.',
      },
      {
        target: 'nav-mutations',
        title: 'Two workspaces live in the left sidebar',
        body: 'Database Tables shows the raw LIMS tables. Mutation Explorer is the curated science: samples, mutations, copy number, growth, and barcodes. We will spend the tour in Mutation Explorer.',
        tryIt: 'Click "Mutation Explorer" to open it (we just opened it for you).',
        before: () => setActiveView('mutations'),
      },
      {
        target: 'experiment-controls',
        title: 'Scope the data: Experiment and Registry',
        body: 'Experiment narrows everything to one genotype background (e.g. fba, tpiA, or a pairwise combination) for faster, focused analysis. Registry picks which breseq variant-calling run you are viewing when more than one exists.',
        look: 'A dropdown of experiments with sample counts. "all" loads every experiment together.',
        tryIt: 'Open the Experiment dropdown to see the available backgrounds.',
        before: () => go('mutations', 'samples'),
      },
      {
        target: 'stats-strip',
        title: 'The dataset at a glance',
        body: 'This thin strip always shows what the current dataset contains: how many samples, mutations, OD growth curves, and copy-number regions. It is the fastest way to confirm the data loaded and what is available.',
        look: 'Counts for samples, mutations, OD curves, and CN regions. If a count is 0, that view will be empty for this selection.',
        before: () => go('mutations', 'samples'),
      },
      {
        target: 'tab-samples',
        title: 'Step 1 — Sample Selection',
        body: 'This is where every analysis starts. You filter the lineages you care about and tick them; everything downstream (Comparative, Copy Number, Barcode) then acts on exactly that selection.',
        look: 'A filterable table of samples. Each row has metadata chips and a small OD600 growth sparkline on the right.',
        tryIt: 'Tick a few sample checkboxes, then watch the count badge on the Comparative View tab go up.',
        before: () => go('mutations', 'samples'),
      },
      {
        target: 'tab-samples',
        title: 'Filters cross-narrow each other',
        body: 'The experiment / strain / condition / donor DNA / replicate / transfer filters are faceted: picking one factor hides the now-impossible options in the others, so you cannot build an empty combination by accident.',
        look: 'As you pick a value in one filter, the choices in the other filters shrink to what is still possible.',
        tryIt: 'Pick a strain or condition and notice the other filters update.',
        before: () => go('mutations', 'samples'),
      },
      {
        target: 'tab-samples',
        title: 'Growth curves start here',
        body: 'Every sample row has an OD600 sparkline. Click it to open the full growth-curve popup with a log/linear toggle, a peer-overlay sidebar, and descriptive metrics (max OD, growth rate mu, doubling time, lag, AUC). Those metrics are honest point-to-point estimates, never model fits, and the popup says so if a numeric series is missing.',
        tryIt: 'Click a sparkline in a sample row to open the growth popup, then click "How is each value computed?" inside it.',
        before: () => go('mutations', 'samples'),
      },
      {
        target: 'tab-compare',
        title: 'Step 2 — Comparative View (the heatmap)',
        body: 'Your selected samples become columns; mutations and copy-number regions become rows; each cell is colored by its value. This is the figure most people put in a paper.',
        look: 'A grid of colored cells. Click it to open the view if it has not opened yet.',
        before: () => go('mutations', 'compare'),
      },
      {
        target: 'compare-controls',
        title: 'Comparative controls + the color rule',
        body: 'Filter mutations by text, restrict to frequency-only or copy-number-only, and focus on a mutation class (missense, nonsense, indel, deletion). The key rule: frequency cells use a FIXED 0%-100% color scale, while copy-number rows use a row-local min/max scale. That difference is intentional.',
        look: 'A filter box, a metric dropdown, mutation-class pills, and Export figure + CSV buttons.',
        tryIt: 'Switch the metric dropdown to "copy number" to isolate the CN rows.',
        before: () => go('mutations', 'compare'),
      },
      {
        target: 'tab-compare',
        title: 'Provided vs spontaneous mutations',
        body: 'A mutation supplied as donor DNA is drawn with an amber outline over its frequency color. An amber outline with no fill and a 0% marker means it was provided but never observed (e.g. pgi/sohB that did not integrate). No outline means it arose spontaneously, like the secondary fba alleles. Click a mutation name for a genome-context popup.',
        look: 'Amber outlines on donor-DNA mutation cells; plain cells are spontaneous.',
        before: () => go('mutations', 'compare'),
      },
      {
        target: 'tab-copynumber',
        title: 'Step 3 — Copy Number (the headline result)',
        body: 'dgoA* copy-number amplification is the convergent, genotype-independent signal that correlates with improved growth in this study. This tab plots it per lineage across transfers.',
        look: 'One line per lineage; Y is copy number, X is transfer. A dashed CN = 1x line marks the pre-evolution baseline.',
        tryIt: 'Click the Copy Number tab to open it; look for lines climbing above 1x toward 2-3x.',
        before: () => go('mutations', 'copynumber'),
      },
      {
        target: 'tab-copynumber',
        title: 'Tame many lines: isolate and search',
        body: 'With dozens of lineages the chart can look busy. Click a legend entry to isolate one trajectory (the rest are removed, not just dimmed). Use the legend search to jump to a background, toggle Log/Linear Y, and hover for a tooltip that snaps to the nearest point.',
        tryIt: 'Click one lineage in the legend to isolate its trajectory, then click it again to bring the others back.',
        before: () => go('mutations', 'copynumber'),
      },
      ...(hasBarcodes ? [
        {
          target: 'tab-barcodes',
          title: 'Step 4 — Barcode Charts (VerA / VerB)',
          body: 'These charts show how the population is composed of VerA/VerB barcode combinations across transfers. A label A#-B# is one VerA subunit paired with one VerB subunit. VerB is required for VerA activity and the pairing governs substrate specificity, so following which combinations rise and fall is following the evolution of substrate specificity.',
          look: 'Stacked bars per transfer; the same A-B combination always has the same color so you can track it by eye.',
          tryIt: 'Click the Barcode Charts tab to open it.',
          before: () => go('mutations', 'barcodes'),
        } as TourStep,
        {
          target: 'barcode-toolbar',
          title: 'Barcode controls: color, split, chart type',
          body: 'Color by A-B, VerA, or VerB to ask different questions. Split A|B shows the same reads three ways (full combo, VerA-grouped, VerB-grouped). The info (i) button explains the biology on the spot. In Focus you can switch chart type: Rows (most readable), Bars, Lines (trajectory over time), or Heatmap.',
          look: 'A row of toggles: color mode, Split A|B, an info button, and (in Focus) the chart-type selector.',
          tryIt: 'Click the info (i) button to read the VerA/VerB explanation, then try the VerA color mode.',
          before: () => go('mutations', 'barcodes'),
        } as TourStep,
        {
          target: 'barcode-sidebar',
          title: 'The Candidates sidebar drives everything',
          body: 'Hover a candidate to highlight it across all charts; click to select it (the chart set filters to charts that contain it and emphasizes it everywhere). Group by VerA or VerB and click a group header to act on a whole subunit at once. The always-visible info pills open a cross-chart detail popup.',
          look: 'A searchable, groupable list of candidates with read counts and info pills.',
          tryIt: 'Click a candidate to filter the charts to just the ones containing it.',
          before: () => go('mutations', 'barcodes'),
        } as TourStep,
        {
          target: 'tab-barcodes',
          title: 'Compare conditions honestly',
          body: 'Add charts to Compare for a side-by-side view with a shared Y-axis (so equal bar heights mean equal reads) and a shared legend that syncs selection and hover across every panel. When you color by VerA/VerB, the shared legend groups by subunit so selection stays consistent with the sidebar.',
          look: 'A common-Y badge and a shared "Shared candidates / subunits" legend above the compared charts.',
          before: () => go('mutations', 'barcodes'),
        } as TourStep,
      ] : []),
      {
        title: 'Exporting figures and data',
        body: 'Every visualization has an Export figure button (top of its toolbar) with PNG (slides/email), SVG (editable vector for manuscripts), HTML (fixed-size labels), and Print/Save PDF. Use the separate CSV button whenever you will make a quantitative claim. Always record the snapshot date and your filters in the caption.',
        look: 'An "Export figure" button and a "CSV" button on each chart toolbar.',
      },
      {
        target: 'help-guide',
        title: 'You are set — and help is always here',
        body: 'The Guide answers "how do I..." and walks you straight to the right view (and can build a prompt for your own AI assistant). The Interactive tutorial re-runs this walkthrough. Help opens the full searchable documentation, including a glossary and troubleshooting. Click Finish and explore freely.',
        look: 'The Help & Learning section at the bottom of the left sidebar: Guide, Interactive tutorial, Help & guide.',
        before: () => setActiveView('mutations'),
      },
    ];

    // ---- focused per-view flows (also launchable from the Guide's "Show me") ----
    const flows: Record<string, TourStep[]> = {
      full: fullTour,
      samples: [
        { target: 'tab-samples', title: 'Sample Selection', body: 'Where you pick which lineages flow into every other view. Open it to begin.', before: () => go('mutations', 'samples') },
        { target: 'experiment-controls', title: 'Scope first', body: 'Use Experiment to focus on one genotype background before filtering, which keeps the table small and fast.', tryIt: 'Open the Experiment dropdown.', before: () => go('mutations', 'samples') },
        { target: 'tab-samples', title: 'Filter, then select', body: 'The filters cross-narrow so impossible combinations disappear. Tick the rows you want.', tryIt: 'Pick a condition, then tick a couple of samples.', before: () => go('mutations', 'samples') },
        { target: 'tab-compare', title: 'Carry the selection forward', body: 'Every other tab acts on exactly your selection; the badge shows the count.', before: () => go('mutations', 'samples') },
      ],
      comparative: [
        { target: 'tab-compare', title: 'Comparative View', body: 'A heatmap of mutation frequency + copy-number rows across your selected samples.', before: () => go('mutations', 'compare') },
        { target: 'compare-controls', title: 'Controls + the color rule', body: 'Frequency cells use a fixed 0-100% scale; copy-number rows use a row-local scale. Filter by class or metric here.', tryIt: 'Switch the metric dropdown to "copy number".', before: () => go('mutations', 'compare') },
        { target: 'tab-compare', title: 'Provided vs spontaneous', body: 'Amber outline = donor DNA; outline + 0% = provided but unobserved; no outline = spontaneous. Click a mutation name for genome context.', before: () => go('mutations', 'compare') },
        { target: 'compare-controls', title: 'Export', body: 'Export figure (PNG/SVG/HTML/Print) for the heatmap; CSV for the values.', before: () => go('mutations', 'compare') },
      ],
      copynumber: [
        { target: 'tab-copynumber', title: 'Copy Number = the main result', body: 'dgoA* amplification is the convergent adaptive signal. Each line is a lineage over transfers.', before: () => go('mutations', 'copynumber') },
        { target: 'tab-copynumber', title: 'Read the trajectories', body: 'Look for lines rising above the CN = 1x baseline toward 2-3x (outliers go higher). Hover for a snapping tooltip.', before: () => go('mutations', 'copynumber') },
        { target: 'tab-copynumber', title: 'Isolate one lineage', body: 'Click a legend entry to isolate a single trajectory; search the legend to jump to a background; toggle Log/Linear Y.', tryIt: 'Click a lineage in the legend to isolate it.', before: () => go('mutations', 'copynumber') },
      ],
      growth: [
        { target: 'tab-samples', title: 'Find a growth curve', body: 'Every sample row (and Comparative column) has an OD600 sparkline. Click one to open the full growth popup.', tryIt: 'Click a sparkline in a sample row.', before: () => go('mutations', 'samples') },
        { target: 'tab-samples', title: 'Honest, derived metrics', body: 'Max OD/K, mu, doubling, lag, AUC are descriptive point-to-point estimates (click "How is each value computed?"), never model fits. Missing series are reported as not found.', before: () => go('mutations', 'samples') },
      ],
      barcodes: hasBarcodes ? [
        { target: 'tab-barcodes', title: 'Barcode Charts (VerA/VerB)', body: 'Each A#-B# is one VerA + one VerB subunit, stable color. VerB modulates VerA so the pairing governs substrate specificity.', before: () => go('mutations', 'barcodes') },
        { target: 'barcode-toolbar', title: 'Color, split, chart type', body: 'Color by A-B/VerA/VerB; Split A|B shows the same reads three ways; the info button explains the biology; Focus has Rows/Bars/Lines/Heatmap.', tryIt: 'Click the info (i) button.', before: () => go('mutations', 'barcodes') },
        { target: 'barcode-sidebar', title: 'Select to filter', body: 'Click a candidate (or a VerA/VerB group header) to filter charts to those containing it and emphasize it everywhere.', tryIt: 'Click a candidate row.', before: () => go('mutations', 'barcodes') },
        { target: 'tab-barcodes', title: 'Compare honestly', body: 'Add charts to Compare for a shared-Y, shared-legend side-by-side that syncs selection across panels.', before: () => go('mutations', 'barcodes') },
      ] : fullTour,
    };
    setTourFlow(flows[flow] || fullTour);
  }

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
    refreshTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMirror = async () => {
    try {
      const r = await fetchData('/api/mirror-info');
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
                <button onClick={() => setActiveView('tables')} data-active={activeView === 'tables'} data-tour="nav-tables" className="lims-nav mb-0.5">
                  <Database className="w-4 h-4 shrink-0" />
                  <span className="flex-1">Database Tables</span>
                </button>
                <button onClick={() => setActiveView('mutations')} data-active={activeView === 'mutations'} data-tour="nav-mutations" className="lims-nav">
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
                    <div className="flex gap-2">
                      <span className="lims-pill lims-pill-grow shrink-0 mt-0.5">BC</span>
                      <span><span className="font-medium text-[var(--text)]">Barcode Charts</span> — stacked bars from <span className="lims-id">verAB_barcodes</span>.</span>
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
                <button onClick={() => startTour('full')} className="lims-nav mb-0.5" title="Interactive click-through tour of every view">
                  <PlayCircle className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Interactive tutorial</span>
                </button>
                <button onClick={() => setShowHelp(true)} className="lims-nav" title="Full searchable documentation">
                  <BookOpen className="w-4 h-4 shrink-0 text-[var(--accent-600)]" />
                  <span className="flex-1 text-left">Help &amp; guide</span>
                </button>
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
              <div className="mt-auto flex flex-col items-center gap-1 pb-2">
                <button onClick={() => setShowGuide(true)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Guide"><Compass className="w-4 h-4" /></button>
                <button onClick={() => startTour('full')} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Interactive tutorial"><PlayCircle className="w-4 h-4" /></button>
                <button onClick={() => setShowHelp(true)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-3)]" title="Help"><BookOpen className="w-4 h-4" /></button>
              </div>
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

      {showHelp && (
        <HelpCenter
          onClose={() => setShowHelp(false)}
          onStartTutorial={() => { setShowHelp(false); startTour('full'); }}
          onGuide={() => { setShowHelp(false); setShowGuide(true); }}
          guideUrl={`${BASE_PATH}/help/researcher-guide.md`}
        />
      )}
      {showGuide && (
        <GuideAssistant
          ctx={{ view: activeView === 'mutations' ? 'Mutation Explorer' : 'Database Tables', hasBarcodes }}
          onClose={() => setShowGuide(false)}
          onAction={navigate}
        />
      )}
      {tourFlow && tourFlow.length > 0 && (
        <Tutorial steps={tourFlow} onClose={() => setTourFlow(null)} title="AI-ALE viewer tour" />
      )}
    </div>
  );
}
