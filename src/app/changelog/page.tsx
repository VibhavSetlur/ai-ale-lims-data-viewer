import {
  PageHeader,
  ProvenanceBadge,
} from "@/components/design-system/Primitives";
import { mockProvenance } from "@/lib/research/mock-service";
import { viewerVersion } from "@/lib/support/support-content";

export default function ChangelogPage() {
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
          Viewer 2 provides the research shell, catalog, mutation routes, local
          plate workspace, and support surface. This is a code release
          identifier, not a scientific data version.
        </p>
      </section>
      <section className="support-card panel">
        <h2>Scientific snapshot revision</h2>
        <ProvenanceBadge
          label={`${mockProvenance.label} · ${mockProvenance.snapshotId}`}
        />
        <dl className="metadata-list">
          <div>
            <dt>Source system</dt>
            <dd>{mockProvenance.sourceSystem}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>
              {new Date(mockProvenance.receivedAt).toLocaleDateString("en-CA", {
                timeZone: "UTC",
              })}
            </dd>
          </div>
          <div>
            <dt>Schema version</dt>
            <dd>{mockProvenance.schemaVersion}</dd>
          </div>
        </dl>
        <p>
          Snapshot metadata identifies the immutable scientific data revision. A
          future snapshot revision may change without changing the Viewer 2 code
          release.
        </p>
      </section>
    </section>
  );
}
