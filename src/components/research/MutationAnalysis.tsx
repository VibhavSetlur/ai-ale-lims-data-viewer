"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  InlineNotice,
  Metric,
  PageHeader,
  Panel,
  ProvenanceBadge,
  SectionHeader,
  Toolbar,
} from "@/components/design-system/Primitives";
import { staticApi } from "@/lib/static-data";
import {
  activeResultCsv,
  analysisFigureSvg,
  downloadHref,
} from "./analysis-exports";
import {
  loadCohortSelection,
  saveCohortSelection,
  validateCohortSelection,
} from "./cohort-selection";

const SNAPSHOT_ID = "dev-full-20260726-a86df340";
type Cohort = {
  experiments: { key: string }[];
  registries: { key: string }[];
  samples: { key: string }[];
  warnings: string[];
  capabilities: { hasBarcodes: boolean };
  provenance: { snapshotId: string };
};
type Result = {
  rows: Record<string, unknown>[];
  summary: { resultCount: number; sampleCount: number };
  warnings: string[];
  provenance: { snapshotId: string };
};
type Kind =
  "cohort" | "compare" | "growth" | "library-variants" | "copy-number";

export function MutationAnalysis({
  kind,
  title,
}: Readonly<{ kind: Kind; title: string }>) {
  const [cohort, setCohort] = useState<Cohort>();
  const [experimentKey, setExperimentKey] = useState("");
  const [registryKey, setRegistryKey] = useState("");
  const [sampleKeys, setSampleKeys] = useState<string[]>([]);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const hydrated = useRef(false);
  useEffect(() => {
    staticApi<Cohort>(
      `/api/v1/mutations/cohort?snapshotId=${SNAPSHOT_ID}${experimentKey ? `&experimentKey=${encodeURIComponent(experimentKey)}` : ""}${registryKey ? `&registryKey=${encodeURIComponent(registryKey)}` : ""}`,
    )
      .then((data) => {
        setCohort(data);
        if (!hydrated.current) {
          hydrated.current = true;
          const stored = loadCohortSelection(
            window.localStorage,
            data.provenance.snapshotId,
          );
          if (!stored.ok) setError(stored.message);
          const selection = validateCohortSelection(
            stored.ok ? stored.value : undefined,
            data,
          );
          if (selection) {
            setExperimentKey(selection.experimentKey);
            setRegistryKey(selection.registryKey ?? "");
            setSampleKeys(selection.sampleKeys);
          }
        } else
          setSampleKeys((current) =>
            current.filter((key) =>
              data.samples.some((sample) => sample.key === key),
            ),
          );
      })
      .catch((cause: Error) => setError(cause.message));
  }, [experimentKey, registryKey]);
  useEffect(() => {
    if (!experimentKey || !cohort) return;
    saveCohortSelection(window.localStorage, {
      schemaVersion: 1,
      snapshotId: cohort.provenance.snapshotId,
      experimentKey,
      ...(registryKey ? { registryKey } : {}),
      sampleKeys,
    });
  }, [cohort, experimentKey, registryKey, sampleKeys]);
  const endpoint = kind === "compare" ? "compare" : kind;
  const available =
    kind !== "library-variants" || cohort?.capabilities.hasBarcodes;
  async function run() {
    if (!experimentKey)
      return setError("Select an experiment before running an analysis.");
    if (!sampleKeys.length) return setError("Select at least one sample.");
    setError("");
    setRunning(true);
    try {
      setResult(
        await staticApi<Result>(`/api/v1/mutations/${endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            snapshotId: SNAPSHOT_ID,
            experimentKey,
            registryKey: registryKey || undefined,
            sampleKeys,
          }),
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Analysis is unavailable.",
      );
    } finally {
      setRunning(false);
    }
  }
  const csv = useMemo(
    () => (result ? activeResultCsv(result.rows) : ""),
    [result],
  );
  const svg = useMemo(
    () => (result ? analysisFigureSvg(title, result.summary) : ""),
    [result, title],
  );
  const selection = (
    <Selectors
      cohort={cohort}
      experimentKey={experimentKey}
      registryKey={registryKey}
      setExperimentKey={setExperimentKey}
      setRegistryKey={setRegistryKey}
      sampleKeys={sampleKeys}
      setSampleKeys={setSampleKeys}
    />
  );
  if (kind === "cohort")
    return (
      <section className="research-workspace">
        <PageHeader eyebrow="RESEARCH" title={title}>
          {cohort && <ProvenanceBadge label={cohort.provenance.snapshotId} />}
          <p className="lede">
            Build a retained sample cohort, then move to an analysis when it is
            ready.
          </p>
        </PageHeader>
        {error && <InlineNotice tone="warning">{error}</InlineNotice>}
        <Panel className="cohort-panel">
          <SectionHeader eyebrow="STEP 1" title="Define your cohort">
            <Metric
              label="Selected samples"
              value={sampleKeys.length}
              detail="Stored locally for this snapshot"
            />
          </SectionHeader>
          {selection}
        </Panel>
        <InlineNotice>
          Select a comparison from Research to analyze these {sampleKeys.length}{" "}
          selected samples.
        </InlineNotice>
      </section>
    );
  return (
    <section className="research-workspace">
      <PageHeader eyebrow="RESEARCH" title={title}>
        {cohort && <ProvenanceBadge label={cohort.provenance.snapshotId} />}
        <p className="lede">
          Use the retained cohort below, then run a bounded read-only analysis.
        </p>
      </PageHeader>
      {!available && (
        <InlineNotice tone="warning">
          Library variants is unavailable because this snapshot has no barcode
          records. Return to the cohort builder.
        </InlineNotice>
      )}
      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
      <Panel className="cohort-panel">
        <SectionHeader eyebrow="COHORT" title="Analysis inputs">
          <Metric
            label="Selected samples"
            value={sampleKeys.length}
            detail={
              experimentKey
                ? `Experiment: ${experimentKey}`
                : "Choose an experiment"
            }
          />
        </SectionHeader>
        {selection}
      </Panel>
      <Toolbar className="analysis-actions">
        <Button disabled={!available || running} onClick={run}>
          {running ? "Running analysis…" : "Run analysis"}
        </Button>
        <span className="muted" role="status" aria-live="polite">
          {running
            ? "Loading the active analysis result."
            : "Results remain scoped to this cohort."}
        </span>
      </Toolbar>
      {result && (
        <section
          className="analysis-results"
          aria-labelledby="analysis-results-title"
        >
          <SectionHeader eyebrow="RESULT" title="Analysis output">
            <Metric
              label="Results"
              value={result.summary.resultCount}
              detail={`${result.summary.sampleCount} selected samples`}
            />
          </SectionHeader>
          <div className="analysis-metrics">
            <Metric label="Results" value={result.summary.resultCount} />
            <Metric
              label="Selected samples"
              value={result.summary.sampleCount}
            />
          </div>
          <figure className="analysis-figure">
            <svg
              aria-labelledby="analysis-figure-title analysis-figure-description"
              role="img"
              viewBox="0 0 540 210"
            >
              <title id="analysis-figure-title">{title}</title>
              <desc id="analysis-figure-description">
                A bar chart of results and selected samples.
              </desc>
              {[
                { label: "Results", value: result.summary.resultCount },
                {
                  label: "Selected samples",
                  value: result.summary.sampleCount,
                },
              ].map((item, index) => (
                <g key={item.label}>
                  <text x="20" y={90 + index * 55}>
                    {item.label}: {item.value}
                  </text>
                  <rect
                    x="190"
                    y={70 + index * 55}
                    width={Math.round(
                      (item.value /
                        Math.max(
                          1,
                          result.summary.resultCount,
                          result.summary.sampleCount,
                        )) *
                        300,
                    )}
                    height="28"
                  />
                </g>
              ))}
            </svg>
            <figcaption>
              Analysis summary figure. The active result table provides the
              underlying values.
            </figcaption>
          </figure>
          <h3>Figure notes</h3>
          <ul>
            <li>Bars show result and selected-sample counts.</li>
            <li>
              Values appear in the active result table and are not inferred from
              the figure.
            </li>
          </ul>
          {result.warnings.map((warning) => (
            <InlineNotice key={warning} tone="warning">
              {warning}
            </InlineNotice>
          ))}
          <Toolbar>
            <a
              className="button button-secondary"
              href={downloadHref("text/csv", csv)}
            >
              Download active CSV
            </a>
            <a
              className="button button-secondary"
              href={downloadHref("image/svg+xml", svg)}
            >
              Download figure SVG
            </a>
          </Toolbar>
          <div className="table-overflow">
            <table>
              <caption>Active analysis result</caption>
              <thead>
                <tr>
                  {Object.keys(result.rows[0] ?? {}).map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {Object.entries(row).map(([key, value]) => (
                      <td key={key}>{String(value ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

function Selectors({
  cohort,
  experimentKey,
  registryKey,
  setExperimentKey,
  setRegistryKey,
  sampleKeys,
  setSampleKeys,
}: Readonly<{
  cohort?: Cohort;
  experimentKey: string;
  registryKey: string;
  setExperimentKey: (value: string) => void;
  setRegistryKey: (value: string) => void;
  sampleKeys: string[];
  setSampleKeys: (value: string[]) => void;
}>) {
  const selectAll = () =>
    setSampleKeys(cohort?.samples.map((sample) => sample.key) ?? []);
  return (
    <fieldset className="cohort-selectors" disabled={!cohort}>
      <legend>Cohort selection</legend>
      <div className="cohort-fields">
        <label>
          Experiment{" "}
          <select
            value={experimentKey}
            onChange={(event) => setExperimentKey(event.target.value)}
          >
            <option value="">Select an experiment</option>
            {cohort?.experiments.map(({ key }) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <label>
          Registry{" "}
          <select
            value={registryKey}
            onChange={(event) => setRegistryKey(event.target.value)}
          >
            <option value="">All registries</option>
            {cohort?.registries.map(({ key }) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
      </div>
      <Toolbar className="cohort-helpers">
        <Button
          type="button"
          variant="secondary"
          onClick={selectAll}
          disabled={!cohort?.samples.length}
        >
          Select all visible
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => setSampleKeys([])}
          disabled={!sampleKeys.length}
        >
          Clear selection
        </Button>
        <span className="muted" aria-live="polite">
          {sampleKeys.length} of {cohort?.samples.length ?? 0} samples selected
        </span>
      </Toolbar>
      <div className="sample-list" aria-label="Samples">
        {cohort?.samples.map(({ key }) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={sampleKeys.includes(key)}
              onChange={(event) =>
                setSampleKeys(
                  event.target.checked
                    ? [...sampleKeys, key]
                    : sampleKeys.filter((sample) => sample !== key),
                )
              }
            />
            {key}
          </label>
        ))}
      </div>
      {cohort?.warnings.map((warning) => (
        <InlineNotice key={warning} tone="warning">
          {warning}
        </InlineNotice>
      ))}
    </fieldset>
  );
}
