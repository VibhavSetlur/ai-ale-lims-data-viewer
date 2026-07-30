"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Button, Dialog } from "@/components/design-system/Primitives";

/**
 * Copy number trajectory explorer.
 *
 * Reads the raw Copy_numbers table through catalog/rows and derives per region
 * copy number across transfers for each sample. Each line is one region tracked
 * over transfers, so drift toward duplication or loss is visible against a
 * reference line at copy number 1. This mirrors the growth and library variant
 * explorers: self fetching, log or linear scaling, legend isolation, nearest
 * point tooltips, and a per series metadata popup.
 */

const TABLE = "Copy_numbers";
const PAGE_LIMIT = 1000;
const MAX_PAGES = 40;
const LOG_MIN = 0.01;

type RawRow = Record<string, unknown>;

interface CnPoint {
  transfer: number;
  cn: number;
}

interface CnSeries {
  key: string; // sample base without transfer + region
  base: string; // sample base without transfer
  region: string;
  registry: string | null;
  refgenome: string | null;
  sample: string; // representative full Seqsample
  points: CnPoint[];
}

interface Experiment {
  key: string;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length && text !== "None" ? text : null;
}

const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

function colorFor(index: number): string {
  return SERIES[index % SERIES.length];
}

// Extract the transfer number from a ".T<NN>." fragment, else 0.
function transferOf(sample: string): number {
  const match = /\.T(\d+)\b/i.exec(sample);
  return match ? Number(match[1]) : 0;
}

// Sample base without the ".T<NN>" transfer fragment.
function baseOf(sample: string): string {
  return sample.replace(/\.T\d+\b/i, "");
}

function shortBase(base: string): string {
  const parts = base.split(".");
  return parts.slice(-2).join(".");
}

export function CopyNumberExplorer({ title }: { title: string }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentKey, setExperimentKey] = useState<string>("");
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // view controls
  const [region, setRegion] = useState<string>("all");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hover, setHover] = useState<{ series: CnSeries; point: CnPoint } | null>(null);
  const [detail, setDetail] = useState<CnSeries | null>(null);

  const loadReqId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await apiClient.current();
      if (cancelled) return;
      if (!current.ok) {
        setError("Could not resolve the current snapshot.");
        return;
      }
      const id = current.data.snapshotId;
      setSnapshotId(id);
      const cohort = await apiClient.cohort({ snapshotId: id });
      if (cancelled) return;
      if (cohort.ok) {
        const data = cohort.data as { experiments?: { key: string }[] };
        const exps = (data.experiments ?? []).map((e) => ({ key: e.key }));
        setExperiments(exps);
        if (exps.length) setExperimentKey((prev) => prev || exps[0].key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (id: string, exp: string) => {
    const reqId = ++loadReqId.current;
    setLoading(true);
    setError(null);
    setTruncated(false);
    setRawRows([]);
    const collected: RawRow[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await apiClient.rows({
          snapshotId: id,
          table: TABLE,
          limit: PAGE_LIMIT,
          cursor,
          where: {
            combinator: "and",
            filters: [{ column: "Seqsample", operator: "startsWith", value: `${exp}.` }],
          },
        });
        if (loadReqId.current !== reqId) return;
        if (!result.ok) {
          setError(result.error.message || "Failed to load copy number data.");
          setLoading(false);
          return;
        }
        const data = result.data as { rows: RawRow[]; nextCursor: string | null };
        collected.push(...data.rows);
        if (!data.nextCursor) break;
        cursor = data.nextCursor;
        if (page === MAX_PAGES - 1) setTruncated(true);
      }
      if (loadReqId.current !== reqId) return;
      setRawRows(collected);
    } catch {
      if (loadReqId.current === reqId) setError("Failed to load copy number data.");
    } finally {
      if (loadReqId.current === reqId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (snapshotId && experimentKey) {
      // load sets loading state as part of the paged fetch it drives; this
      // effect exists only to start that fetch when inputs change.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load(snapshotId, experimentKey);
    }
  }, [snapshotId, experimentKey, load]);

  // derive series keyed by (sample base) + region
  const series = useMemo<CnSeries[]>(() => {
    const byKey = new Map<string, CnSeries>();
    for (const row of rawRows) {
      if (num(row.deleted) === 1) continue;
      const sample = str(row.Seqsample);
      const regionName = str(row.Region_name);
      const cn = num(row.Region_CN);
      if (!sample || !regionName || cn === null) continue;
      const base = baseOf(sample);
      const transfer = transferOf(sample);
      const key = `${base}__${regionName}`;
      let s = byKey.get(key);
      if (!s) {
        s = {
          key,
          base,
          region: regionName,
          registry: str(row.Breseq_registry_ID),
          refgenome: str(row.Refgenome),
          sample,
          points: [],
        };
        byKey.set(key, s);
      }
      s.points.push({ transfer, cn });
    }
    const list = [...byKey.values()];
    for (const s of list) s.points.sort((a, b) => a.transfer - b.transfer);
    list.sort((a, b) =>
      a.region === b.region ? a.base.localeCompare(b.base) : a.region.localeCompare(b.region),
    );
    return list;
  }, [rawRows]);

  const regions = useMemo(() => {
    return [...new Set(series.map((s) => s.region))].sort((a, b) => a.localeCompare(b));
  }, [series]);

  const visible = useMemo(() => {
    if (region === "all") return series;
    return series.filter((s) => s.region === region);
  }, [series, region]);

  const totalPoints = useMemo(
    () => visible.reduce((sum, s) => sum + s.points.length, 0),
    [visible],
  );

  return (
    <div className="growth-explorer">
      <div className="growth-toolbar">
        <label className="growth-control">
          <span className="growth-control-label">Experiment</span>
          <select
            className="select-input"
            value={experimentKey}
            onChange={(e) => setExperimentKey(e.target.value)}
          >
            {experiments.map((exp) => (
              <option key={exp.key} value={exp.key}>
                {exp.key}
              </option>
            ))}
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Region</span>
          <select
            className="select-input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="all">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Y scale</span>
          <select
            className="select-input"
            value={scale}
            onChange={(e) => setScale(e.target.value as "linear" | "log")}
          >
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </label>
        <span className="growth-meta muted">
          {loading
            ? "Loading copy number data..."
            : `${visible.length} series, ${totalPoints} points${truncated ? " (truncated)" : ""}`}
        </span>
      </div>

      {error ? (
        <div className="notice notice-warning" role="alert">
          {error}
          <div style={{ marginTop: "var(--space-3)" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => snapshotId && experimentKey && load(snapshotId, experimentKey)}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : loading && !visible.length ? (
        <div className="growth-skeleton" aria-hidden="true" />
      ) : !visible.length ? (
        <div className="empty-state">
          <div className="empty-state-title">No copy number records</div>
          <p className="empty-state-body">
            This experiment has no copy number regions in the current snapshot.
          </p>
        </div>
      ) : (
        <CopyNumberChart
          title={title}
          series={visible}
          scale={scale}
          isolated={isolated}
          onIsolate={(key) => setIsolated((prev) => (prev === key ? null : key))}
          hover={hover}
          onHover={setHover}
          onDetail={setDetail}
        />
      )}

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.region} in ${shortBase(detail.base)}` : ""}
        description="Copy number metadata"
      >
        {detail ? <CopyNumberDetail series={detail} /> : null}
      </Dialog>
    </div>
  );
}

function CopyNumberChart({
  title,
  series,
  scale,
  isolated,
  onIsolate,
  hover,
  onHover,
  onDetail,
}: Readonly<{
  title: string;
  series: CnSeries[];
  scale: "linear" | "log";
  isolated: string | null;
  onIsolate: (key: string) => void;
  hover: { series: CnSeries; point: CnPoint } | null;
  onHover: (value: { series: CnSeries; point: CnPoint } | null) => void;
  onDetail: (series: CnSeries) => void;
}>) {
  const width = 720;
  const height = 360;
  const pad = { top: 16, right: 16, bottom: 40, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const allPoints = series.flatMap((s) => s.points);
  const maxTransfer = Math.max(1, ...allPoints.map((p) => p.transfer));
  const maxCn = Math.max(1, ...allPoints.map((p) => p.cn));

  const xScale = (transfer: number) =>
    pad.left + (maxTransfer ? transfer / maxTransfer : 0) * plotW;
  const yScale = (cn: number) => {
    if (scale === "log") {
      const v = Math.max(cn, LOG_MIN);
      const t =
        (Math.log10(v) - Math.log10(LOG_MIN)) /
        (Math.log10(maxCn) - Math.log10(LOG_MIN) || 1);
      return pad.top + (1 - t) * plotH;
    }
    return pad.top + (1 - cn / maxCn) * plotH;
  };

  const yTicks =
    scale === "log"
      ? [0.01, 0.1, 1, 10].filter((v) => v <= maxCn)
      : [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxCn);
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxTransfer / 4) * i));

  const titleId = `copy-number-${title.replace(/[^a-z0-9]/gi, "-")}`;
  const descId = `${titleId}-desc`;
  const refY = yScale(1);

  return (
    <figure className="growth-figure">
      <svg
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={`0 0 ${width} ${height}`}
        className="growth-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{`Copy number trajectories for ${title}`}</title>
        <desc id={descId}>
          Copy number per region across transfers, with a reference line at copy number 1.
        </desc>
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={pad.left}
              y1={yScale(tick)}
              x2={width - pad.right}
              y2={yScale(tick)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text x={pad.left - 8} y={yScale(tick) + 3} textAnchor="end" className="growth-axis-label">
              {tick < 0.1 ? tick.toFixed(2) : tick.toFixed(1)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={`x${tick}`}
            x={xScale(tick)}
            y={height - pad.bottom + 16}
            textAnchor="middle"
            className="growth-axis-label"
          >
            {tick}
          </text>
        ))}
        {/* reference line at copy number 1 */}
        {refY >= pad.top && refY <= pad.top + plotH ? (
          <g>
            <line
              x1={pad.left}
              y1={refY}
              x2={width - pad.right}
              y2={refY}
              stroke="var(--color-ink-tertiary)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={width - pad.right} y={refY - 4} textAnchor="end" className="cn-reference-label">
              CN 1
            </text>
          </g>
        ) : null}
        <text
          x={pad.left + plotW / 2}
          y={height - 6}
          textAnchor="middle"
          className="growth-axis-title"
        >
          Transfer
        </text>
        <text
          x={14}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          className="growth-axis-title"
          transform={`rotate(-90 14 ${pad.top + plotH / 2})`}
        >
          {scale === "log" ? "Copy number (log)" : "Copy number"}
        </text>
        {/* series */}
        {series.map((s, si) => {
          const dimmed = isolated !== null && isolated !== s.key;
          const path = s.points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${xScale(p.transfer).toFixed(1)},${yScale(p.cn).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g key={s.key} opacity={dimmed ? 0.12 : 1}>
              <path
                d={path}
                fill="none"
                stroke={colorFor(si)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.points.map((p, i) => (
                <circle
                  key={i}
                  cx={xScale(p.transfer)}
                  cy={yScale(p.cn)}
                  r={hover && hover.series.key === s.key && hover.point === p ? 5 : 3}
                  fill={colorFor(si)}
                  onMouseEnter={() => onHover({ series: s, point: p })}
                  onMouseLeave={() => onHover(null)}
                />
              ))}
            </g>
          );
        })}
        {hover ? (
          <g
            transform={`translate(${xScale(hover.point.transfer) + 8}, ${yScale(hover.point.cn) - 8})`}
          >
            <rect x={0} y={-28} width={170} height={34} rx={6} fill="var(--color-ink)" opacity={0.92} />
            <text x={8} y={-14} className="growth-tip-text">
              {hover.series.region} {shortBase(hover.series.base)}
            </text>
            <text x={8} y={0} className="growth-tip-text">
              T{hover.point.transfer}, CN {hover.point.cn.toFixed(2)}
            </text>
          </g>
        ) : null}
      </svg>

      <div className="growth-legend">
        {series.map((s, si) => (
          <span key={s.key} className="library-legend-group">
            <button
              type="button"
              className={`growth-legend-item${isolated === s.key ? " is-active" : ""}`}
              aria-pressed={isolated ? isolated === s.key : true}
              onClick={() => onIsolate(s.key)}
            >
              <span className="growth-legend-swatch" style={{ background: colorFor(si) }} />
              <span className="growth-legend-label">
                {s.region} {shortBase(s.base)}
              </span>
            </button>
            <button
              type="button"
              className="chip-button"
              onClick={() => onDetail(s)}
              aria-label={`Metadata for ${s.region} in ${shortBase(s.base)}`}
            >
              info
            </button>
          </span>
        ))}
      </div>
    </figure>
  );
}

function CopyNumberDetail({ series }: Readonly<{ series: CnSeries }>) {
  const cns = series.points.map((p) => p.cn);
  const minCn = cns.length ? Math.min(...cns) : 0;
  const maxCn = cns.length ? Math.max(...cns) : 0;
  const latest = series.points.length ? series.points[series.points.length - 1].cn : 0;
  const barMax = Math.max(maxCn, 1);

  return (
    <div className="mutation-detail">
      <dl className="mutation-detail-meta">
        <div>
          <dt>Region</dt>
          <dd className="mono">{series.region}</dd>
        </div>
        <div>
          <dt>Sample</dt>
          <dd className="mono">{shortBase(series.base)}</dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd className="mono">{series.registry ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Reference genome</dt>
          <dd className="mono">{series.refgenome ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Min CN</dt>
          <dd className="mono">{minCn.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Max CN</dt>
          <dd className="mono">{maxCn.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Latest CN</dt>
          <dd className="mono">{latest.toFixed(2)}</dd>
        </div>
      </dl>
      <h4 className="mutation-detail-subtitle">Copy number by transfer</h4>
      <ul className="mutation-freq-bars">
        {series.points.map((p, i) => (
          <li key={`${p.transfer}-${i}`}>
            <span className="mutation-freq-label mono">T{p.transfer}</span>
            <span className="mutation-freq-track">
              <span
                className="mutation-freq-fill"
                style={{ width: `${(p.cn / barMax) * 100}%` }}
              />
            </span>
            <span className="mutation-freq-val mono">{p.cn.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
