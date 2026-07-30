"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import type { MeData } from "@/lib/api-client";
import { Button } from "@/components/design-system/Primitives";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; me: MeData }
  | { kind: "error"; message: string };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("next") || "/";

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [orcid, setOrcid] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiClient.me();
    if (result.ok) {
      setPhase({ kind: "ready", me: result.data });
    } else {
      setPhase({ kind: "error", message: "Session service is unavailable." });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const result = await apiClient.fakeLogin({
      orcid: orcid.trim(),
      displayName: displayName.trim() || "Researcher",
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(redirectTo);
      router.refresh();
    } else {
      setFormError(result.error.message || "Sign in failed. Try again.");
    }
  };

  const handleContinueAnon = () => {
    router.push(redirectTo);
  };

  const handleSignOut = async () => {
    await apiClient.logout();
    void load();
  };

  return (
    <div className="login-page">
      <div className="login-card panel">
        <div className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            &AElig;
          </span>
          <div className="login-brand-text">
            <span className="login-brand-name">AI-ALE</span>
            <span className="login-brand-sub">Research viewer</span>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">
          This is a read-only research viewer. Signing in is optional and stays
          on this device. It only labels your session for local notes and does
          not unlock private data.
        </p>

        {phase.kind === "loading" && <p className="muted">Checking session...</p>}

        {phase.kind === "error" && (
          <div className="login-notice login-notice-error" role="alert">
            {phase.message}
          </div>
        )}

        {phase.kind === "ready" &&
          phase.me.session.status === "authenticated" &&
          phase.me.session.identity && (
            <div className="login-signed-in">
              <p className="login-signed-in-name">
                Signed in as {phase.me.session.identity.displayName}
              </p>
              <div className="login-actions">
                <Button variant="primary" onClick={handleContinueAnon}>
                  Continue
                </Button>
                <Button variant="ghost" onClick={() => void handleSignOut()}>
                  Sign out
                </Button>
              </div>
            </div>
          )}

        {phase.kind === "ready" &&
          phase.me.session.status !== "authenticated" &&
          (phase.me.capabilities.fakeSignInAvailable ? (
            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field">
                <span className="login-field-label">Display name</span>
                <input
                  className="login-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </label>
              <label className="login-field">
                <span className="login-field-label">
                  ORCID <span className="muted">(required to sign in)</span>
                </span>
                <input
                  className="login-input"
                  type="text"
                  value={orcid}
                  onChange={(e) => setOrcid(e.target.value)}
                  placeholder="0000-0000-0000-0000"
                  inputMode="numeric"
                  required
                  aria-required="true"
                />
              </label>

              {formError && (
                <div className="login-notice login-notice-error" role="alert">
                  {formError}
                </div>
              )}

              <div className="login-actions">
                <Button type="submit" variant="primary" loading={submitting}>
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleContinueAnon}
                >
                  Continue without signing in
                </Button>
              </div>
            </form>
          ) : (
            <div className="login-signed-in">
              <p className="muted">
                Sign in is disabled on this deployment. You can browse
                everything anonymously.
              </p>
              <div className="login-actions">
                <Button variant="primary" onClick={handleContinueAnon}>
                  Continue to viewer
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-page">
          <div className="login-card panel">
            <p className="muted">Loading sign in...</p>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
