"use client";

/**
 * Live snapshot metric strip for the home page. Reads /api/v1/status once
 * on mount and shows a calm summary of the active scientific snapshot.
 *
 * Navigation never depends on this load: the strip degrades to a quiet
 * placeholder on error and the workflow cards remain fully usable.
 */

import { useEffect, useState } from "react";
import { Metric } from "@/components/design-system/Primitives";
import { staticApi } from "@/lib/static-data";
import type { SnapshotProvenance } from "@/shared/contracts/provenance";

interface StatusResponse {
  provenance: SnapshotProvenance;
  capabilities?: {
    hasBarcodes?: boolean;
  };
}

export function HomeSnapshotStrip() {
  const [status, setStatus] = useState<StatusResponse>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    staticApi<StatusResponse>("/api/v1/status")
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="home-snapshot home-snapshot-muted" role="note">
        <p className="muted">
          Snapshot summary is unavailable right now. All workflows below remain
          usable.
        </p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="home-snapshot home-snapshot-muted" aria-hidden="true">
        <p className="muted">Loading active snapshot…</p>
      </div>
    );
  }

  const { provenance, capabilities } = status;
  const received = new Date(provenance.receivedAt).toLocaleDateString("en-CA", {
    timeZone: "UTC",
  });

  return (
    <div className="home-snapshot" aria-label="Active snapshot summary">
      <Metric label="Active snapshot" value={provenance.label} />
      <Metric label="Source" value={provenance.sourceSystem} />
      <Metric label="Received" value={received} />
      <Metric
        label="Barcodes"
        value={capabilities?.hasBarcodes ? "Available" : "Not in snapshot"}
      />
    </div>
  );
}
