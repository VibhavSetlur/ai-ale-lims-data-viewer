import { AppError } from "@/shared/errors/AppError";
import { parseConfig } from "@/server/config";
import { FakeProvider } from "./fake-provider";
import { MemorySessionRepository } from "./memory-session-repository";
import type { IdentityMode, SessionRepository, SessionView } from "./contracts";
const anonymous = (): SessionView => ({ status: "anonymous" });
export class IdentityService {
  public constructor(private readonly mode: IdentityMode, private readonly sessions: SessionRepository = new MemorySessionRepository(), private readonly fake = new FakeProvider()) {}
  public capabilities() { return { fakeSignInAvailable: this.mode === "fake", persistence: this.mode === "fake" ? "memory" as const : "none" as const }; }
  public async me(sessionId?: string): Promise<SessionView> { if (this.mode === "disabled" || !sessionId) return anonymous(); const identity = await this.sessions.find(sessionId); return identity ? { status: "authenticated", identity, authentication: "local-test" } : anonymous(); }
  public async login(input: unknown) { if (this.mode === "disabled") throw new AppError("NOT_FOUND", "Not found."); const identity = await this.fake.authenticate(input); return { sessionId: await this.sessions.create(identity), session: { status: "authenticated", identity, authentication: "local-test" } as SessionView }; }
  public async logout(sessionId?: string) { if (sessionId) await this.sessions.delete(sessionId); return anonymous(); }
}
const configuredMode = (): IdentityMode => parseConfig(process.env).identityMode;
const sessions = new MemorySessionRepository();
export const identityService = () => new IdentityService(configuredMode(), sessions);
