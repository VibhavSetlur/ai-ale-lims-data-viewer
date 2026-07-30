"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import type { MeData, Session } from "@/lib/api-client";
import { Button } from "@/components/design-system/Primitives";

type State =
  | { phase: "loading" }
  | { phase: "loaded"; meData: MeData }
  | { phase: "error" };

export function AccountControl() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [showForm, setShowForm] = useState(false);
  const [orcid, setOrcid] = useState("");
  const [displayName, setDisplayName] = useState("");

  const loadMe = useCallback(async () => {
    const result = await apiClient.me();
    if (result.ok) {
      setState({ phase: "loaded", meData: result.data });
    } else {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMe();
  }, [loadMe]);

  const handleSignOut = async () => {
    await apiClient.logout();
    void loadMe();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await apiClient.fakeLogin({ orcid, displayName });
    if (result.ok) {
      setShowForm(false);
      void loadMe();
    }
  };

  if (state.phase === "loading") {
    return (
      <span className="account-control-name" aria-live="polite">
        Loading...
      </span>
    );
  }

  if (state.phase === "error") {
    return <span className="account-control-name">Unavailable</span>;
  }

  const { meData } = state;
  const session: Session = meData.session;

  if (session.status === "authenticated" && session.identity) {
    return (
      <div className="account-control">
        <span className="account-control-name">{session.identity.displayName}</span>
        <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  if (!meData.capabilities.fakeSignInAvailable) {
    return (
      <span className="account-control-name" aria-label="Session status: anonymous">
        Anonymous
      </span>
    );
  }

  return (
    <div className="account-control">
      {showForm ? (
        <form
          onSubmit={(e) => void handleSignIn(e)}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
        >
          <input
            type="text"
            className="text-input"
            placeholder="ORCID-shaped ID"
            value={orcid}
            onChange={(e) => setOrcid(e.target.value)}
            required
            style={{ minHeight: "32px", width: "140px" }}
          />
          <input
            type="text"
            className="text-input"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            style={{ minHeight: "32px", width: "120px" }}
          />
          <Button variant="secondary" size="sm" type="submit">
            Sign in
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setShowForm(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="account-control-name">Anonymous</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowForm(true)}
            title="Local test sign-in only. Not connected to ORCID."
          >
            Sign in (dev)
          </Button>
        </>
      )}
    </div>
  );
}
