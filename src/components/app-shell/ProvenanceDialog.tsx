"use client";

import type { SnapshotProvenance } from "@/shared/contracts/provenance";
import type { StatusData } from "@/lib/api-client";
import { Button } from "@/components/design-system/Primitives";
import { Dialog } from "@/components/design-system/Primitives";

type ProvenanceDialogProps = {
  open: boolean;
  onClose: () => void;
  status: StatusData | null;
};

export function ProvenanceDialog({
  open,
  onClose,
  status,
}: Readonly<ProvenanceDialogProps>) {
  const provenance: SnapshotProvenance | null = status?.provenance ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Data provenance"
      description="Scientific snapshot and environment details for this viewer session."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="provenance-detail">
        {!provenance ? (
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-ink-secondary)",
            }}
          >
            Provenance information is not available for this snapshot.
          </p>
        ) : (
          <>
            <section>
              <h3
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--color-ink-secondary)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Snapshot
              </h3>
              <dl className="provenance-kv">
                <dt>ID</dt>
                <dd>{provenance.snapshotId}</dd>
                <dt>Label</dt>
                <dd>{provenance.label}</dd>
                <dt>Source system</dt>
                <dd>{provenance.sourceSystem}</dd>
                {provenance.sourceRevision && (
                  <>
                    <dt>Source revision</dt>
                    <dd>{provenance.sourceRevision}</dd>
                  </>
                )}
                <dt>Schema version</dt>
                <dd>{provenance.schemaVersion}</dd>
                <dt>Schema fingerprint</dt>
                <dd>{provenance.schemaFingerprint}</dd>
                {provenance.sourceSha256 && (
                  <>
                    <dt>Source SHA-256</dt>
                    <dd>{provenance.sourceSha256}</dd>
                  </>
                )}
                {provenance.sourceUpdatedAt && (
                  <>
                    <dt>Source updated</dt>
                    <dd>{new Date(provenance.sourceUpdatedAt).toLocaleString()}</dd>
                  </>
                )}
                <dt>Received at</dt>
                <dd>{new Date(provenance.receivedAt).toLocaleString()}</dd>
                {provenance.materializedAt && (
                  <>
                    <dt>Materialized at</dt>
                    <dd>{new Date(provenance.materializedAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
            </section>

            {status?.profile && (
              <section>
                <h3
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-semibold)",
                    color: "var(--color-ink-secondary)",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  Environment
                </h3>
                <dl className="provenance-kv">
                  <dt>Mode</dt>
                  <dd>{status.profile.mode}</dd>
                  {status.profile.channel && (
                    <>
                      <dt>Channel</dt>
                      <dd>{status.profile.channel}</dd>
                    </>
                  )}
                  {status.profile.version && (
                    <>
                      <dt>Viewer version</dt>
                      <dd>{status.profile.version}</dd>
                    </>
                  )}
                  {status.profile.branch && (
                    <>
                      <dt>Branch</dt>
                      <dd>{status.profile.branch}</dd>
                    </>
                  )}
                  {status.profile.commit && (
                    <>
                      <dt>Commit</dt>
                      <dd>{status.profile.commit}</dd>
                    </>
                  )}
                </dl>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
