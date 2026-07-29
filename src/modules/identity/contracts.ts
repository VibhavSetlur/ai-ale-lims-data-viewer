export type IdentityMode = "disabled" | "fake";
export type Identity = { provider: "orcid"; subject: string; displayName: string };
export type SessionView = { status: "anonymous" } | { status: "authenticated"; identity: Identity; authentication: "local-test" };
export interface IdentityProvider { authenticate(input: unknown): Promise<Identity>; }
export interface SessionRepository { create(identity: Identity): Promise<string>; find(id: string): Promise<Identity | null>; delete(id: string): Promise<void>; }
