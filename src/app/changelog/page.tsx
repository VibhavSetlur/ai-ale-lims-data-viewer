"use client";

import { useEffect, useState } from "react";
import {
  InlineNotice,
  PageHeader,
  ProvenanceBadge,
} from "@/components/design-system/Primitives";
import { staticApi } from "@/lib/static-data";
import { viewerVersion } from "@/lib/support/support-content";
import type { SnapshotProvenance } from "@/shared/contracts/provenance";

/**
 * Viewer code releases. Newest first. Code releases are tracked separately
 * from scientific data revisions so the version never implies a data refresh.
 */
const releases: { version: string; date: string; changes: string[] }[] = [
  {
    version: "2.0.0",
    date: "2026-07",
    changes: [
      "Rebuilt research workspace: calm sage/copper surface, strong typographic hierarchy, borders over shadows.",
      "Distinct mutation, growth, library-variant, and copy-number analysis routes with per-analysis charts and tables.",
      "Colorblind-aware analysis charts (bars and growth line plots) backed by a text-equivalent result table.",
      "Cursor-paginated catalog browser with filters, facets, column picker, record drawer, and scoped CSV export.",
      "Browser-local 96-well plate designer with keyboard grid navigation, undo/redo, snapshots, and all-or-nothing import.",
      "Capability gating surfaces honest unavailable reasons for analyses missing in the active snapshot.",
    ],
  },
];

export default function ChangelogPage() {
  const [provenance, setProvenance] = useState<SnapshotProvenance>();
  const [error, setError] = useState("");

  useEffect(() => {
    staticApi<{ provenance: SnapshotProvenance }>("/api/v1/status")
      .then((status) => setProvenance(status.provenance))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  return (
    <section>
      <PageHeader eyebrow="SUPPORT" title="Changelog">
        <p className="lede">
          Viewer code releases and scientific data revisions are tracked
          separately so that the displayed version never implies a data refresh.
        </p>
      </PageHeader>

      <section className="support-card panel">
        <h2>Viewer code release: {viewerVersion}</h2>
        <p>
          This is a code release identifier, not a scientific data version. The
          research shell, catalog, mutation routes, local plate workspace, and
          support surfaces are provided by this release.
        </p>
        {releases.map((release) => (
          <div key={release.version} style={{ marginTop: "var(--space-3)" }}>
            <h3
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-ink-secondary)",
              }}
            >
              {release.version} · {release.date}
            </h3>
            <ul className="guide-changes">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="support-card panel">
        <h2>Scientific snapshot revision</h2>
        {error && <InlineNotice tone="warning">{error}</InlineNotice>}
        {!provenance && !error && <p className="muted">Loading snapshot…</p>}
        {provenance && (
          <>
            <ProvenanceBadge
              label={`${provenance.label} · ${provenance.snapshotId}`}
            />
            <dl className="metadata-list">
              <div>
                <dt>Source system</dt>
                <dd>{provenance.sourceSystem}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>
                  {new Date(provenance.receivedAt).toLocaleDateString("en-CA", {
                    timeZone: "UTC",
                  })}
                </dd>
              </div>
              <div>
                <dt>Schema version</dt>
                <dd>{provenance.schemaVersion}</dd>
              </div>
              <div>
                <dt>Source SHA-256</dt>
                <dd>{provenance.sourceSha256.slice(0, 12)}…</dd>
              </div>
            </dl>
          </>
        )}
        <p>
          Snapshot metadata identifies the immutable scientific data revision. A
          future snapshot revision may change without changing the Viewer 2 code
          release.
        </p>
      </section>
    </section>
  );
}
