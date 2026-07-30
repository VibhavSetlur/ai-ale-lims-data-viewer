"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Button, Dialog, Field } from "@/components/design-system/Primitives";

/**
 * Library variant (verA / verB barcode) explorer.
 *
 * The v1 library-variants endpoint returns SEMANTIC_INVALID for this snapshot,
 * so we read the raw verAB_barcodes table through catalog/rows and derive
 * per-sample variant abundance. This restores the interactive analysis the
 * legacy static viewer offered: stacked composition bars, relative or raw
 * counts, top-N selection, per-variant isolation, and a variant metadata popup.
 */

const TABLE = "verAB_barcodes";
const PAGE_LIMIT = 1000;
const MAX_PAGES = 40;

type RawRow = Record<string, unknown>;

interface VariantRow {
  candidate: string;
  verA: string;
  verB: string;
  library: string | null;
  total: number; // total count across shown samples
  presence: number; // number of samples it appears in
  perSample: Map<string, number>;
}

interface SampleCol {
  key: string;
  short: string;
  total: number;
}

interface Experiment {
  key: string;
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function shortSample(key: string): string {
  const parts = key.split(".");
  const t = parts.find((p) => /^T\d+/i.test(p));
  const tail = parts.slice(-2).join(".");
  return t ? `${tail} ${t}` : tail;
}

export function LibraryVariantExplorer({ title }: { title: string }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentKey, setExperimentKey] = useState<string>("");
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // view controls
  const [metric, setMetric] = useState<"relative" | "count">("relative");
  const [topN, setTopN] = useState<number>(20);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [detail, setDetail] = useState<VariantRow | null>(null);

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
          setError(result.error.message || "Failed to load library variant data.");
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
      if (loadReqId.current === reqId) setError("Failed to load library variant data.");
    } finally {
      if (loadReqId.current === reqId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() sets state after an async fetch; intentional, guarded by a req-id.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (snapshotId && experimentKey) void load(snapshotId, experimentKey);
  }, [snapshotId, experimentKey, load]);

  // derive samples + variant rows
  const { samples, variants } = useMemo(() => {
    const sampleTotals = new Map<string, number>();
    const variantMap = new Map<string, VariantRow>();
    for (const row of rawRows) {
      if (num(row.deleted) === 1) continue;
      const sample = str(row.Seqsample);
      const candidate = str(row.Candidate) ?? `${str(row.verA) ?? "?"}-${str(row.verB) ?? "?"}`;
      const count = num(row.Count);
      if (!sample || count <= 0) continue;
      sampleTotals.set(sample, (sampleTotals.get(sample) ?? 0) + count);
      let v = variantMap.get(candidate);
      if (!v) {
        v = {
          candidate,
          verA: str(row.verA) ?? "?",
          verB: str(row.verB) ?? "?",
          library: str(row.Transformation_library),
          total: 0,
          presence: 0,
          perSample: new Map(),
        };
        variantMap.set(candidate, v);
      }
      v.total += count;
      v.perSample.set(sample, (v.perSample.get(sample) ?? 0) + count);
    }
    for (const v of variantMap.values()) v.presence = v.perSample.size;
    const samples: SampleCol[] = [...sampleTotals.entries()]
      .map(([key, total]) => ({ key, short: shortSample(key), total }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const variants = [...variantMap.values()].sort((a, b) => b.total - a.total);
    return { samples, variants };
  }, [rawRows]);

  const shownVariants = useMemo(() => variants.slice(0, topN), [variants, topN]);

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
          <span className="growth-control-label">Value</span>
          <select
            className="select-input"
            value={metric}
            onChange={(e) => setMetric(e.target.value as "relative" | "count")}
          >
            <option value="relative">Relative abundance</option>
            <option value="count">Raw count</option>
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Show</span>
          <select
            className="select-input"
            value={String(topN)}
            onChange={(e) => setTopN(Number(e.target.value))}
          >
            <option value="10">Top 10</option>
            <option value="20">Top 20</option>
            <option value="50">Top 50</option>
            <option value="100">Top 100</option>
          </select>
        </label>
        <div className="growth-meta">
          {loading
            ? "Loading variant data..."
            : `${variants.length} variants across ${samples.length} samples${truncated ? " (truncated)" : ""}`}
        </div>
      </div>

      {error ? (
        <div className="notice notice-warning" role="status">
          <span>{error}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => snapshotId && experimentKey && load(snapshotId, experimentKey)}
          >
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="growth-skeleton" aria-hidden="true" />
      ) : samples.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No library variants</p>
          <p className="empty-state-body">
            This experiment has no verA / verB barcode records in the snapshot.
          </p>
        </div>
      ) : (
        <LibraryVariantChart
          title={title}
          samples={samples}
          variants={shownVariants}
          metric={metric}
          isolated={isolated}
          onIsolate={(c) => setIsolated((prev) => (prev === c ? null : c))}
          onDetail={setDetail}
        />
      )}

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.candidate : ""}
        description="Library variant metadata"
      >
        {detail ? <VariantDetail variant={detail} samples={samples} /> : null}
      </Dialog>
    </div>
  );
}

function LibraryVariantChart({
  title,
  samples,
  variants,
  metric,
  isolated,
  onIsolate,
  onDetail,
}: Readonly<{
  title: string;
  samples: SampleCol[];
  variants: VariantRow[];
  metric: "relative" | "count";
  isolated: string | null;
  onIsolate: (candidate: string) => void;
  onDetail: (variant: VariantRow) => void;
}>) {
  const colW = 34;
  const gap = 8;
  const chartH = 320;
  const padLeft = 54;
  const padBottom = 96;
  const width = padLeft + samples.length * (colW + gap) + 16;
  const height = chartH + padBottom + 20;

  const maxCount = useMemo(() => {
    let m = 0;
    for (const s of samples) if (s.total > m) m = s.total;
    return m || 1;
  }, [samples]);

  const yTicks =
    metric === "relative"
      ? [0, 0.25, 0.5, 0.75, 1]
      : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxCount));

  return (
    <figure className="growth-figure">
      <svg
        className="growth-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}: stacked variant composition across ${samples.length} samples`}
      >
        {yTicks.map((t) => {
          const frac = metric === "relative" ? (t as number) : (t as number) / maxCount;
          const y = 20 + chartH - frac * chartH;
          return (
            <g key={t}>
              <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={padLeft - 8} y={y + 3} textAnchor="end" className="growth-axis-label">
                {metric === "relative" ? `${Math.round((t as number) * 100)}%` : t}
              </text>
            </g>
          );
        })}
        {samples.map((sample, si) => {
          const x = padLeft + si * (colW + gap);
          const denom = metric === "relative" ? sample.total || 1 : maxCount;
          let acc = 0;
          return (
            <g key={sample.key}>
              {variants.map((v, vi) => {
                const count = v.perSample.get(sample.key) ?? 0;
                if (count <= 0) return null;
                const frac = count / denom;
                const segH = frac * chartH;
                const y = 20 + chartH - acc - segH;
                acc += segH;
                const dim = isolated && isolated !== v.candidate;
                return (
                  <rect
                    key={v.candidate}
                    x={x}
                    y={y}
                    width={colW}
                    height={Math.max(0.5, segH)}
                    fill={colorFor(vi)}
                    opacity={dim ? 0.15 : 1}
                    stroke="var(--color-surface)"
                    strokeWidth={0.5}
                  >
                    <title>{`${v.candidate} in ${sample.short}: ${count} (${Math.round((count / (sample.total || 1)) * 100)}%)`}</title>
                  </rect>
                );
              })}
              <text
                x={x + colW / 2}
                y={20 + chartH + 12}
                textAnchor="end"
                transform={`rotate(-60 ${x + colW / 2} ${20 + chartH + 12})`}
                className="growth-axis-label"
              >
                {sample.short}
              </text>
            </g>
          );
        })}
        <text x={14} y={20 + chartH / 2} transform={`rotate(-90 14 ${20 + chartH / 2})`} textAnchor="middle" className="growth-axis-title">
          {metric === "relative" ? "Relative abundance" : "Read count"}
        </text>
      </svg>

      <div className="growth-legend">
        {variants.map((v, vi) => (
          <span key={v.candidate} className="library-legend-group">
            <button
              type="button"
              className={`growth-legend-item${isolated === v.candidate ? " is-active" : ""}`}
              aria-pressed={isolated ? isolated === v.candidate : true}
              onClick={() => onIsolate(v.candidate)}
            >
              <span className="growth-legend-swatch" style={{ background: colorFor(vi) }} />
              <span className="growth-legend-label">{v.candidate}</span>
            </button>
            <button
              type="button"
              className="chip-button"
              onClick={() => onDetail(v)}
              aria-label={`Metadata for ${v.candidate}`}
            >
              info
            </button>
          </span>
        ))}
      </div>
    </figure>
  );
}

function VariantDetail({
  variant,
  samples,
}: Readonly<{ variant: VariantRow; samples: SampleCol[] }>) {
  const top = useMemo(() => {
    return [...variant.perSample.entries()]
      .map(([key, count]) => {
        const col = samples.find((s) => s.key === key);
        const total = col?.total ?? 0;
        return { key, short: col?.short ?? key, count, frac: total ? count / total : 0 };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 24);
  }, [variant, samples]);

  const maxCount = top.reduce((m, s) => Math.max(m, s.count), 1);

  return (
    <div className="mutation-detail">
      <dl className="mutation-detail-meta">
        <div>
          <dt>verA</dt>
          <dd className="mono">{variant.verA}</dd>
        </div>
        <div>
          <dt>verB</dt>
          <dd className="mono">{variant.verB}</dd>
        </div>
        <div>
          <dt>Library</dt>
          <dd>{variant.library ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Total reads</dt>
          <dd className="mono">{variant.total.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Samples present</dt>
          <dd className="mono">{variant.presence}</dd>
        </div>
      </dl>
      <h4 className="mutation-detail-subtitle">Abundance by sample</h4>
      <ul className="mutation-freq-bars">
        {top.map((s) => (
          <li key={s.key}>
            <span className="mutation-freq-label mono">{s.short}</span>
            <span className="mutation-freq-track">
              <span
                className="mutation-freq-fill"
                style={{ width: `${(s.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="mutation-freq-val mono">
              {s.count} ({Math.round(s.frac * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
