import { randomBytes } from "crypto";
import type { Identity, SessionRepository } from "./contracts";
const TTL = 8 * 60 * 60 * 1000;
const sessions = new Map<string, { identity: Identity; expiresAt: number }>();
export class MemorySessionRepository implements SessionRepository { async create(identity: Identity) { const id = randomBytes(32).toString("base64url"); sessions.set(id, { identity, expiresAt: Date.now() + TTL }); return id; } async find(id: string) { const session = sessions.get(id); if (!session || session.expiresAt <= Date.now()) { sessions.delete(id); return null; } return session.identity; } async delete(id: string) { sessions.delete(id); } }
