"use client";

import type { AnalysisFigure, AnalysisFigureKind } from "./analysis-exports";

const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

/**
 * Reusable, accessible analysis chart. Replaces the crude inline SVG bars.
 * Renders horizontal bars for count/abundance/copy-number analyses and a
 * line-plus-marker plot for growth endpoints, using the colorblind-aware
 * series palette. The chart is a text-equivalent-backed <svg role="img">;
 * the full data always remains in the accompanying result table.
 */
export function AnalysisChart({
  figure,
  kind,
}: Readonly<{ figure: AnalysisFigure; kind: AnalysisFigureKind }>) {
  const bars = figure.bars;
  if (!bars.length) {
    return (
      <figure className="analysis-figure">
        <p className="muted">
          The active result has no chartable values. The table below carries the
          complete result.
        </p>
      </figure>
    );
  }

  const maximum = Math.max(1, ...bars.map((bar) => bar.value));
  const niceMax = niceCeil(maximum);
  const titleId = "analysis-figure-title";
  const descId = "analysis-figure-description";

  const chart =
    kind === "growth" ? (
      <GrowthPlot bars={bars} niceMax={niceMax} />
    ) : (
      <BarPlot bars={bars} niceMax={niceMax} />
    );

  return (
    <figure className="analysis-figure">
      <svg
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox="0 0 720 360"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{figure.title}</title>
        <desc id={descId}>{figure.description}</desc>
        {chart}
      </svg>
      <figcaption>
        {figure.description} Up to 12 rows are charted; the table below contains
        the complete active result.
      </figcaption>
    </figure>
  );
}

function BarPlot({
  bars,
  niceMax,
}: Readonly<{ bars: { label: string; value: number }[]; niceMax: number }>) {
  const left = 210;
  const right = 700;
  const top = 24;
  const rowHeight = Math.min(26, (330 - top) / bars.length);
  const barHeight = Math.max(8, rowHeight - 8);
  const trackWidth = right - left;
  const ticks = axisTicks(niceMax, 4);

  return (
    <>
      {ticks.map((tick) => {
        const x = left + (tick / niceMax) * trackWidth;
        return (
          <g key={`grid-${tick}`}>
            <line
              x1={x}
              x2={x}
              y1={top - 6}
              y2={top + bars.length * rowHeight}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={top + bars.length * rowHeight + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-ink-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {formatValue(tick)}
            </text>
          </g>
        );
      })}
      {bars.map((bar, index) => {
        const y = top + index * rowHeight;
        const width = Math.max(2, (bar.value / niceMax) * trackWidth);
        const fill = SERIES[index % SERIES.length];
        return (
          <g key={`${bar.label}-${index}`}>
            <text
              x={left - 12}
              y={y + barHeight / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--color-ink-secondary)"
              fontFamily="var(--font-mono)"
            >
              {truncate(bar.label, 26)}
            </text>
            <rect
              x={left}
              y={y}
              width={width}
              height={barHeight}
              rx={3}
              fill={fill}
            />
            <text
              x={left + width + 8}
              y={y + barHeight / 2}
              dominantBaseline="central"
              fontSize={11}
              fill="var(--color-ink)"
              fontFamily="var(--font-mono)"
            >
              {formatValue(bar.value)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function GrowthPlot({
  bars,
  niceMax,
}: Readonly<{ bars: { label: string; value: number }[]; niceMax: number }>) {
  const left = 64;
  const right = 700;
  const top = 24;
  const bottom = 300;
  const width = right - left;
  const height = bottom - top;
  const step = bars.length > 1 ? width / (bars.length - 1) : 0;
  const ticks = axisTicks(niceMax, 4);

  const points = bars.map((bar, index) => ({
    x: left + index * step,
    y: bottom - (bar.value / niceMax) * height,
    bar,
    index,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <>
      {ticks.map((tick) => {
        const y = bottom - (tick / niceMax) * height;
        return (
          <g key={`grid-${tick}`}>
            <line
              x1={left}
              x2={right}
              y1={y}
              y2={y}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={left - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--color-ink-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {formatValue(tick)}
            </text>
          </g>
        );
      })}
      <path
        d={path}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point) => (
        <g key={`${point.bar.label}-${point.index}`}>
          <circle
            cx={point.x}
            cy={point.y}
            r={4}
            fill="var(--color-surface)"
            stroke="var(--series-1)"
            strokeWidth={2}
          />
          {bars.length <= 8 && (
            <text
              x={point.x}
              y={bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-ink-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {truncate(point.bar.label, 12)}
            </text>
          )}
        </g>
      ))}
    </>
  );
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function axisTicks(max: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) =>
    Number(((max / count) * index).toPrecision(3)),
  );
}

function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
