"use client";

import { useMemo, useState } from "react";
import { Button, Dialog, Field, NumberInput, Select, Toolbar } from "@/components/design-system/Primitives";

export type MutationRow = {
  gene: string;
  position: number;
  type: string;
  values: Record<string, number>;
};

type SortMode = "frequency" | "gene" | "position" | "prevalence";

const MUT_TYPE_COLORS: Record<string, string> = {
  SNP: "var(--series-1)",
  DEL: "var(--series-2)",
  INS: "var(--series-3)",
  SUB: "var(--series-4)",
  MOB: "var(--series-5)",
  AMP: "var(--series-6)",
};

function typeColor(type: string): string {
  return MUT_TYPE_COLORS[type?.toUpperCase()] ?? "var(--color-ink-tertiary)";
}

/** Map a frequency 0..1 to a sage intensity background. */
function freqColor(freq: number | undefined): string {
  if (freq === undefined || freq === null || Number.isNaN(freq)) return "transparent";
  const clamped = Math.max(0, Math.min(1, freq));
  // interpolate lightness in the sage hue; higher freq = deeper
  const alpha = 0.12 + clamped * 0.85;
  return `color-mix(in srgb, var(--color-accent) ${Math.round(alpha * 100)}%, transparent)`;
}

function isMutationRow(row: Record<string, unknown>): row is MutationRow {
  return (
    typeof row.gene === "string" &&
    typeof row.position === "number" &&
    typeof row.type === "string" &&
    typeof row.values === "object" &&
    row.values !== null
  );
}

export function MutationHeatmap({
  rows: rawRows,
  title,
}: Readonly<{ rows: Record<string, unknown>[]; title: string }>) {
  const rows = useMemo(() => rawRows.filter(isMutationRow), [rawRows]);

  const sampleKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.values)) set.add(key);
    }
    return [...set].sort();
  }, [rows]);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(row.type);
    return [...set].sort();
  }, [rows]);

  const [minFreq, setMinFreq] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("prevalence");
  const [detail, setDetail] = useState<MutationRow | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const prevalence = (row: MutationRow) =>
    Object.values(row.values).filter((v) => v >= (minFreq || 0)).length;

  const maxFreq = (row: MutationRow) =>
    Object.values(row.values).reduce((m, v) => Math.max(m, v ?? 0), 0);

  const filteredRows = useMemo(() => {
    let out = rows;
    if (typeFilter) out = out.filter((r) => r.type === typeFilter);
    if (minFreq > 0) {
      out = out.filter((r) => Object.values(r.values).some((v) => v >= minFreq));
    }
    if (hideEmpty) {
      out = out.filter((r) => Object.values(r.values).some((v) => (v ?? 0) > 0));
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      switch (sortMode) {
        case "gene":
          return a.gene.localeCompare(b.gene) || a.position - b.position;
        case "position":
          return a.position - b.position;
        case "frequency":
          return maxFreq(b) - maxFreq(a);
        case "prevalence":
        default:
          return prevalence(b) - prevalence(a) || maxFreq(b) - maxFreq(a);
      }
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, typeFilter, minFreq, hideEmpty, sortMode]);

  const visibleSamples = useMemo(() => {
    if (!hideEmpty) return sampleKeys;
    return sampleKeys.filter((s) =>
      filteredRows.some((r) => (r.values[s] ?? 0) > 0),
    );
  }, [sampleKeys, filteredRows, hideEmpty]);

  if (!rows.length) {
    return (
      <figure className="analysis-figure">
        <p className="muted">No mutation rows to visualize.</p>
      </figure>
    );
  }

  return (
    <div className="heatmap-wrap">
      <Toolbar className="heatmap-controls">
        <Field label="Minimum frequency" htmlFor="heatmap-minfreq" hint="Hide low-frequency calls">
          <NumberInput
            id="heatmap-minfreq"
            value={minFreq}
            min={0}
            max={1}
            step={0.05}
            onChange={(e) => setMinFreq(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Mutation type" htmlFor="heatmap-type">
          <Select id="heatmap-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {allTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort rows by" htmlFor="heatmap-sort">
          <Select
            id="heatmap-sort"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="prevalence">Prevalence</option>
            <option value="frequency">Peak frequency</option>
            <option value="gene">Gene</option>
            <option value="position">Position</option>
          </Select>
        </Field>
        <label className="heatmap-toggle">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          Hide empty rows and columns
        </label>
      </Toolbar>

      <div className="heatmap-legend" aria-hidden="true">
        <span className="heatmap-legend-label">Frequency</span>
        <span className="heatmap-legend-scale">
          <span style={{ background: freqColor(0.1) }} />
          <span style={{ background: freqColor(0.3) }} />
          <span style={{ background: freqColor(0.5) }} />
          <span style={{ background: freqColor(0.7) }} />
          <span style={{ background: freqColor(0.95) }} />
        </span>
        <span className="heatmap-legend-ends">
          <small>low</small>
          <small>high</small>
        </span>
        <span className="heatmap-legend-types">
          {allTypes.map((t) => (
            <span key={t} className="heatmap-type-chip">
              <span
                className="heatmap-type-swatch"
                style={{ background: typeColor(t) }}
              />
              {t}
            </span>
          ))}
        </span>
      </div>

      <div className="heatmap-scroll" role="region" aria-label={`${title} heatmap`}>
        <table className="heatmap-table">
          <caption className="sr-only">
            Mutation frequency heatmap: {filteredRows.length} mutations across{" "}
            {visibleSamples.length} samples. Click a row to open mutation detail.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="heatmap-corner">
                Mutation
              </th>
              {visibleSamples.map((s) => (
                <th key={s} scope="col" className="heatmap-sample-head">
                  <span title={s}>{shortSample(s)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const rowId = `${row.gene}:${row.position}:${row.type}`;
              return (
                <tr key={rowId}>
                  <th scope="row" className="heatmap-row-head">
                    <button
                      type="button"
                      className="heatmap-row-btn"
                      onClick={() => setDetail(row)}
                      title={`${row.gene} ${row.position} ${row.type} (click for detail)`}
                    >
                      <span
                        className="heatmap-type-swatch"
                        style={{ background: typeColor(row.type) }}
                        aria-hidden="true"
                      />
                      <span className="heatmap-gene">{row.gene}</span>
                      <span className="heatmap-pos">{row.position}</span>
                    </button>
                  </th>
                  {visibleSamples.map((s) => {
                    const freq = row.values[s];
                    const cellId = `${rowId}@${s}`;
                    const has = freq !== undefined && freq > 0;
                    return (
                      <td
                        key={s}
                        className={`heatmap-cell${has ? " heatmap-cell-has" : ""}`}
                        style={{ background: freqColor(freq) }}
                        onMouseEnter={() => setHoverCell(cellId)}
                        onMouseLeave={() => setHoverCell((c) => (c === cellId ? null : c))}
                        title={has ? `${row.gene} ${row.position} | ${s} | ${(freq * 100).toFixed(1)}%` : ""}
                      >
                        {hoverCell === cellId && has && (
                          <span className="heatmap-tip" role="tooltip">
                            {row.gene} {row.position}
                            <br />
                            {s}
                            <br />
                            {(freq * 100).toFixed(1)}%
                          </span>
                        )}
                        <span className="sr-only">
                          {has ? `${(freq * 100).toFixed(1)} percent` : "absent"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted heatmap-count">
        Showing {filteredRows.length} of {rows.length} mutations across{" "}
        {visibleSamples.length} of {sampleKeys.length} samples.
      </p>

      {detail && (
        <Dialog
          open={true}
          title={`${detail.gene} · ${detail.position}`}
          onClose={() => setDetail(null)}
        >
          <MutationDetail row={detail} sampleKeys={sampleKeys} />
        </Dialog>
      )}
    </div>
  );
}

function shortSample(s: string): string {
  // TFMN1.fba.1.T11.P -> T11 when a transfer token exists, else last segment
  const m = s.match(/\.T(\d+)\b/i);
  if (m) return `T${m[1]}`;
  const parts = s.split(".");
  return parts[parts.length - 1] || s;
}

function MutationDetail({
  row,
  sampleKeys,
}: Readonly<{ row: MutationRow; sampleKeys: string[] }>) {
  const present = sampleKeys
    .map((s) => ({ sample: s, freq: row.values[s] }))
    .filter((x) => x.freq !== undefined && x.freq > 0)
    .sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0));

  const maxFreq = present.reduce((m, x) => Math.max(m, x.freq ?? 0), 0);

  return (
    <div className="mutation-detail">
      <dl className="mutation-detail-meta">
        <div>
          <dt>Gene</dt>
          <dd>{row.gene}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd className="mono">{row.position}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>
            <span
              className="heatmap-type-swatch"
              style={{ background: typeColor(row.type) }}
              aria-hidden="true"
            />
            {row.type}
          </dd>
        </div>
        <div>
          <dt>Samples with call</dt>
          <dd>
            {present.length} of {sampleKeys.length}
          </dd>
        </div>
      </dl>

      <h4 className="mutation-detail-subtitle">Frequency across transfers</h4>
      <div className="mutation-lollipop">
        {present.length === 0 ? (
          <p className="muted">No positive frequencies for this mutation.</p>
        ) : (
          <ul className="mutation-freq-bars">
            {present.map(({ sample, freq }) => (
              <li key={sample}>
                <span className="mutation-freq-label" title={sample}>
                  {shortSample(sample)}
                </span>
                <span className="mutation-freq-track">
                  <span
                    className="mutation-freq-fill"
                    style={{
                      width: `${((freq ?? 0) / (maxFreq || 1)) * 100}%`,
                      background: typeColor(row.type),
                    }}
                  />
                </span>
                <span className="mutation-freq-val mono">
                  {((freq ?? 0) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
