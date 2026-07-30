"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/design-system/Primitives";

/**
 * Growth curve explorer.
 *
 * The v1 growth endpoint returns no scoped records for these sample keys, so we
 * read the raw Robotic_OD table through catalog/rows and derive OD-over-time
 * curves per sample and transfer. This restores the interactive growth analysis
 * the legacy static viewer offered: multi-panel or overlay line charts, log and
 * linear scaling, legend isolation, and nearest-point tooltips.
 */

const TABLE = "Robotic_OD";
const PAGE_LIMIT = 1000;
const MAX_PAGES = 60; // hard ceiling so a huge experiment never runs away

type RawRow = Record<string, unknown>;

interface Point {
  hours: number;
  od: number;
  reading: string;
}

interface Curve {
  key: string; // sample_name + transfer
  sample: string;
  transfer: number;
  strain: string | null;
  condition: string | null;
  points: Point[];
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

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function GrowthExplorer({ title }: { title: string }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentKey, setExperimentKey] = useState<string>("");
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // view controls
  const [layout, setLayout] = useState<"overlay" | "panels">("overlay");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [transferFilter, setTransferFilter] = useState<string>("all");
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hover, setHover] = useState<{ curve: Curve; point: Point } | null>(null);

  const loadReqId = useRef(0);

  // resolve snapshot + experiment list
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

  // load raw OD rows for the selected experiment
  const load = useCallback(
    async (id: string, exp: string) => {
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
              filters: [{ column: "experiment", operator: "eq", value: exp }],
            },
            sort: [{ column: "transfer", direction: "asc" }],
          });
          if (loadReqId.current !== reqId) return; // superseded
          if (!result.ok) {
            setError(result.error.message || "Failed to load growth data.");
            setLoading(false);
            return;
          }
          const data = result.data as { rows: RawRow[]; nextCursor: string | null };
          collected.push(...data.rows);
          if (!data.nextCursor) {
            cursor = undefined;
            break;
          }
          cursor = data.nextCursor;
          if (page === MAX_PAGES - 1) setTruncated(true);
        }
        if (loadReqId.current !== reqId) return;
        setRawRows(collected);
      } catch {
        if (loadReqId.current === reqId) setError("Failed to load growth data.");
      } finally {
        if (loadReqId.current === reqId) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // load() sets state after an async fetch; intentional, guarded by a req-id.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (snapshotId && experimentKey) void load(snapshotId, experimentKey);
  }, [snapshotId, experimentKey, load]);

  // derive curves
  const curves = useMemo<Curve[]>(() => {
    const byKey = new Map<string, Curve>();
    for (const row of rawRows) {
      if (str(row.measurement_type) !== "OD") continue;
      const reading = str(row.reading);
      if (!reading || reading.toLowerCase() === "contam") continue;
      if (num(row.Blank) === 1) continue;
      const sample = str(row.sample_name);
      if (!sample) continue;
      const od = num(row.od);
      if (od === null) continue;
      const transfer = num(row.transfer) ?? 0;
      // elapsed hours: timepoint when present, else reading index Tn
      let hours = num(row.timepoint);
      if (hours === null) {
        const match = /T(\d+)/i.exec(reading);
        hours = match ? Number(match[1]) : 0;
      }
      const key = `${sample}__T${transfer}`;
      let curve = byKey.get(key);
      if (!curve) {
        curve = {
          key,
          sample,
          transfer,
          strain: str(row.strain),
          condition: str(row.Condition),
          points: [],
        };
        byKey.set(key, curve);
      }
      curve.points.push({ hours, od, reading });
    }
    const list = [...byKey.values()];
    for (const curve of list) curve.points.sort((a, b) => a.hours - b.hours);
    list.sort((a, b) => (a.sample === b.sample ? a.transfer - b.transfer : a.sample.localeCompare(b.sample)));
    return list;
  }, [rawRows]);

  const transfers = useMemo(() => {
    return [...new Set(curves.map((c) => c.transfer))].sort((a, b) => a - b);
  }, [curves]);

  const visible = useMemo(() => {
    let list = curves;
    if (transferFilter !== "all") list = list.filter((c) => String(c.transfer) === transferFilter);
    return list;
  }, [curves, transferFilter]);

  const colorFor = useCallback(
    (curve: Curve) => {
      const samples = [...new Set(visible.map((c) => c.sample))];
      const index = samples.indexOf(curve.sample);
      return SERIES[index % SERIES.length];
    },
    [visible],
  );

  if (error) {
    return (
      <div className="growth-explorer">
        <div className="notice notice-warning" role="alert">
          {error}
          <div style={{ marginTop: "var(--space-3)" }}>
            <Button variant="secondary" size="sm" onClick={() => snapshotId && experimentKey && load(snapshotId, experimentKey)}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="growth-explorer">
      <div className="growth-toolbar">
        <label className="growth-control">
          <span className="growth-control-label">Experiment</span>
          <select className="select-input" value={experimentKey} onChange={(e) => setExperimentKey(e.target.value)}>
            {experiments.map((exp) => (
              <option key={exp.key} value={exp.key}>
                {exp.key}
              </option>
            ))}
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Layout</span>
          <select className="select-input" value={layout} onChange={(e) => setLayout(e.target.value as "overlay" | "panels")}>
            <option value="overlay">Overlay</option>
            <option value="panels">Small multiples</option>
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Y scale</span>
          <select className="select-input" value={scale} onChange={(e) => setScale(e.target.value as "linear" | "log")}>
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </label>
        <label className="growth-control">
          <span className="growth-control-label">Transfer</span>
          <select className="select-input" value={transferFilter} onChange={(e) => setTransferFilter(e.target.value)}>
            <option value="all">All transfers</option>
            {transfers.map((t) => (
              <option key={t} value={String(t)}>
                Transfer {t}
              </option>
            ))}
          </select>
        </label>
        <span className="growth-meta muted">
          {loading ? "Loading OD readings..." : `${visible.length} curves, ${visible.reduce((sum, c) => sum + c.points.length, 0)} points`}
        </span>
      </div>

      {truncated ? (
        <div className="notice notice-warning" role="status">
          Showing the first {MAX_PAGES * PAGE_LIMIT} readings for this experiment. Narrow by transfer to see the rest.
        </div>
      ) : null}

      {loading && !visible.length ? (
        <div className="growth-skeleton" aria-hidden="true" />
      ) : !visible.length ? (
        <div className="empty-state">
          <div className="empty-state-title">No growth readings</div>
          <p className="empty-state-body">This experiment has no usable OD curves in the current snapshot.</p>
        </div>
      ) : layout === "overlay" ? (
        <GrowthPanel
          title={title}
          curves={visible}
          scale={scale}
          colorFor={colorFor}
          isolated={isolated}
          onIsolate={setIsolated}
          hover={hover}
          onHover={setHover}
          legend
        />
      ) : (
        <div className="growth-panels">
          {[...new Set(visible.map((c) => c.sample))].map((sample) => (
            <GrowthPanel
              key={sample}
              title={sample}
              curves={visible.filter((c) => c.sample === sample)}
              scale={scale}
              colorFor={colorFor}
              isolated={null}
              onIsolate={() => {}}
              hover={hover}
              onHover={setHover}
              legend={false}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GrowthPanel({
  title,
  curves,
  scale,
  colorFor,
  isolated,
  onIsolate,
  hover,
  onHover,
  legend,
  compact,
}: {
  title: string;
  curves: Curve[];
  scale: "linear" | "log";
  colorFor: (curve: Curve) => string;
  isolated: string | null;
  onIsolate: (key: string | null) => void;
  hover: { curve: Curve; point: Point } | null;
  onHover: (value: { curve: Curve; point: Point } | null) => void;
  legend: boolean;
  compact?: boolean;
}) {
  const width = compact ? 360 : 720;
  const height = compact ? 220 : 360;
  const pad = { top: 16, right: 16, bottom: 40, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const allPoints = curves.flatMap((c) => c.points);
  const maxHours = Math.max(1, ...allPoints.map((p) => p.hours));
  const maxOd = Math.max(0.1, ...allPoints.map((p) => p.od));

  const logMin = 0.001;
  const yMaxLinear = niceCeil(maxOd);

  const xScale = (hours: number) => pad.left + (hours / maxHours) * plotW;
  const yScale = (od: number) => {
    if (scale === "log") {
      const v = Math.max(od, logMin);
      const t = (Math.log10(v) - Math.log10(logMin)) / (Math.log10(yMaxLinear) - Math.log10(logMin));
      return pad.top + (1 - t) * plotH;
    }
    return pad.top + (1 - od / yMaxLinear) * plotH;
  };

  const yTicks = scale === "log" ? [0.001, 0.01, 0.1, 1].filter((v) => v <= yMaxLinear) : [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMaxLinear);
  const xTicks = Array.from({ length: 5 }, (_, i) => (maxHours / 4) * i);

  const titleId = `growth-${title.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <figure className="growth-figure">
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${width} ${height}`}
        className="growth-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{`Growth curves for ${title}: OD versus time`}</title>
        {/* gridlines + y ticks */}
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={pad.left} y1={yScale(tick)} x2={width - pad.right} y2={yScale(tick)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={pad.left - 8} y={yScale(tick) + 3} textAnchor="end" className="growth-axis-label">
              {tick < 0.01 ? tick.toFixed(3) : tick.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x${tick}`} x={xScale(tick)} y={height - pad.bottom + 16} textAnchor="middle" className="growth-axis-label">
            {tick.toFixed(1)}
          </text>
        ))}
        <text x={pad.left + plotW / 2} y={height - 6} textAnchor="middle" className="growth-axis-title">
          Time (hours)
        </text>
        <text x={14} y={pad.top + plotH / 2} textAnchor="middle" className="growth-axis-title" transform={`rotate(-90 14 ${pad.top + plotH / 2})`}>
          OD{scale === "log" ? " (log)" : ""}
        </text>
        {/* curves */}
        {curves.map((curve) => {
          const dimmed = isolated !== null && isolated !== curve.key;
          const path = curve.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.hours).toFixed(1)},${yScale(p.od).toFixed(1)}`).join(" ");
          return (
            <g key={curve.key} opacity={dimmed ? 0.12 : 1}>
              <path d={path} fill="none" stroke={colorFor(curve)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {curve.points.map((p, i) => (
                <circle
                  key={i}
                  cx={xScale(p.hours)}
                  cy={yScale(p.od)}
                  r={hover && hover.curve.key === curve.key && hover.point === p ? 5 : 3}
                  fill={colorFor(curve)}
                  onMouseEnter={() => onHover({ curve, point: p })}
                  onMouseLeave={() => onHover(null)}
                />
              ))}
            </g>
          );
        })}
        {hover ? (
          <g transform={`translate(${xScale(hover.point.hours) + 8}, ${yScale(hover.point.od) - 8})`}>
            <rect x={0} y={-28} width={150} height={34} rx={6} fill="var(--color-ink)" opacity={0.92} />
            <text x={8} y={-14} className="growth-tip-text">
              {hover.curve.sample} T{hover.curve.transfer}
            </text>
            <text x={8} y={0} className="growth-tip-text">
              {hover.point.hours.toFixed(2)} h, OD {hover.point.od.toFixed(3)}
            </text>
          </g>
        ) : null}
      </svg>
      {legend ? (
        <div className="growth-legend">
          {curves.map((curve) => (
            <button
              key={curve.key}
              type="button"
              className={`growth-legend-item${isolated === curve.key ? " is-active" : ""}`}
              onClick={() => onIsolate(isolated === curve.key ? null : curve.key)}
              aria-pressed={isolated === curve.key}
            >
              <span className="growth-legend-swatch" style={{ background: colorFor(curve) }} />
              <span className="growth-legend-label">
                {curve.sample} T{curve.transfer}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <figcaption className="growth-caption muted">{title}</figcaption>
      )}
    </figure>
  );
}
