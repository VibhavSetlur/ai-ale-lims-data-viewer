// Operational data-access layer. Server-only (see mysql.ts for the note on
// why `import 'server-only'` is not used). Every owned read takes an
// explicit `ownerUserId` and carries `WHERE ... AND owner_user_id = ?` in
// SQL; callers additionally pass the row through `assertOwned` from
// guards.ts. Both layers are deliberate, not redundant: the SQL clause
// prevents cross-tenant reads even if a caller forgets the guard, and the
// guard gives a clean 404/403 distinction instead of an empty result.
import { randomUUID } from 'crypto';
import type { PlateDesign } from '../plateDesign';
import { parseDesignJson } from '../plateDesign';
import { OpsHttpError } from './guards';
import { OpsNotConfigured, OpsUnavailable, opsExec, opsPool, opsQuery } from './mysql';

export type SessionRow = {
  id: string;
  user_id: string;
  orcid: string | null;
  email: string | null;
  display_name: string | null;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
};

export type DesignSummaryRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  version: number;
  updated_at: Date;
};

export type DesignRow = DesignSummaryRow & {
  schema_version: number;
  payload: PlateDesign;
  created_at: Date;
};

export async function upsertUserByOrcid(orcid: string, displayName: string | null): Promise<{ id: string }> {
  const existing = await opsQuery<{ id: string }>('SELECT id FROM ops_user WHERE orcid = ?', [orcid]);
  if (existing[0]) {
    await opsExec('UPDATE ops_user SET last_login_at = NOW(3), display_name = COALESCE(?, display_name) WHERE id = ?', [
      displayName,
      existing[0].id,
    ]);
    return { id: existing[0].id };
  }
  const id = randomUUID();
  await opsExec(
    'INSERT INTO ops_user (id, orcid, display_name, created_at, last_login_at) VALUES (?, ?, ?, NOW(3), NOW(3))',
    [id, orcid, displayName],
  );
  return { id };
}

export type LocalUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  password_hash: string | null;
  failed_login_count: number;
  locked_until: Date | null;
};

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MINUTES = 15;

export async function findUserByEmail(email: string): Promise<LocalUserRow | undefined> {
  const rows = await opsQuery<LocalUserRow>(
    'SELECT id, email, display_name, password_hash, failed_login_count, locked_until FROM ops_user WHERE email = ?',
    [email],
  );
  return rows[0];
}

// Direct-query (not opsExec) so a MySQL duplicate-key error on the email
// unique index can be distinguished from a generic connectivity failure.
// This is defense-in-depth: the register route already pre-checks via
// findUserByEmail, but this catches the race between the check and insert.
export async function createLocalUser(args: {
  email: string;
  passwordHash: string;
  displayName: string | null;
}): Promise<{ id: string }> {
  const { email, passwordHash, displayName } = args;
  const id = randomUUID();
  try {
    await opsPool().query(
      `INSERT INTO ops_user (id, orcid, email, password_hash, display_name, created_at, failed_login_count)
       VALUES (?, NULL, ?, ?, ?, NOW(3), 0)`,
      [id, email, passwordHash, displayName],
    );
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    const mysqlError = error as { errno?: number; code?: string };
    if (mysqlError.errno === 1062 || mysqlError.code === 'ER_DUP_ENTRY') {
      throw new OpsHttpError(409, 'registration_failed', 'That email cannot be registered. Try signing in instead.');
    }
    throw new OpsUnavailable();
  }
  return { id };
}

export async function recordLoginSuccess(userId: string): Promise<void> {
  await opsExec(
    'UPDATE ops_user SET last_login_at = NOW(3), failed_login_count = 0, locked_until = NULL WHERE id = ?',
    [userId],
  );
}

export async function recordLoginFailure(userId: string): Promise<void> {
  await opsExec(
    `UPDATE ops_user
     SET failed_login_count = failed_login_count + 1,
         locked_until = CASE
           WHEN failed_login_count + 1 >= ${LOCKOUT_THRESHOLD} THEN DATE_ADD(NOW(3), INTERVAL ${LOCKOUT_MINUTES} MINUTE)
           ELSE locked_until
         END
     WHERE id = ?`,
    [userId],
  );
}

export async function createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  const id = randomUUID();
  await opsExec(
    'INSERT INTO ops_session (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, NOW(3), ?, NULL)',
    [id, userId, tokenHash, expiresAt],
  );
}

export async function findSessionByHash(tokenHash: string): Promise<SessionRow | undefined> {
  const rows = await opsQuery<SessionRow>(
    `SELECT s.id, s.user_id, u.orcid, u.email, u.display_name, s.token_hash, s.created_at, s.expires_at, s.revoked_at
     FROM ops_session s JOIN ops_user u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash],
  );
  return rows[0];
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await opsExec('UPDATE ops_session SET revoked_at = NOW(3) WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
}

export async function putAuthState(
  stateHash: string,
  redirectTo: string,
  expiresAt: Date,
  codeVerifier: string,
): Promise<void> {
  await opsExec(
    'INSERT INTO ops_auth_state (state_hash, created_at, expires_at, redirect_to, code_verifier) VALUES (?, NOW(3), ?, ?, ?)',
    [stateHash, expiresAt, redirectTo, codeVerifier],
  );
}

export async function consumeAuthState(
  stateHash: string,
  now: Date,
): Promise<{ redirect_to: string; code_verifier: string } | undefined> {
  const rows = await opsQuery<{ redirect_to: string; expires_at: Date; code_verifier: string | null }>(
    'SELECT redirect_to, expires_at, code_verifier FROM ops_auth_state WHERE state_hash = ?',
    [stateHash],
  );
  // Single-use: delete regardless of outcome so a state value can never be
  // replayed, then judge expiry from the row read before the delete.
  await opsExec('DELETE FROM ops_auth_state WHERE state_hash = ?', [stateHash]);
  const row = rows[0];
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return undefined;
  return { redirect_to: row.redirect_to, code_verifier: row.code_verifier ?? '' };
}

export async function listWorkspaces(ownerUserId: string): Promise<WorkspaceRow[]> {
  return opsQuery<WorkspaceRow>(
    'SELECT id, owner_user_id, name, created_at, updated_at FROM ops_workspace WHERE owner_user_id = ? ORDER BY updated_at DESC',
    [ownerUserId],
  );
}

export async function createWorkspace(ownerUserId: string, name: string): Promise<WorkspaceRow> {
  const id = randomUUID();
  await opsExec(
    'INSERT INTO ops_workspace (id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, NOW(3), NOW(3))',
    [id, ownerUserId, name],
  );
  return { id, owner_user_id: ownerUserId, name, created_at: new Date(), updated_at: new Date() };
}

export async function getWorkspace(id: string, ownerUserId: string): Promise<WorkspaceRow | undefined> {
  const rows = await opsQuery<WorkspaceRow>(
    'SELECT id, owner_user_id, name, created_at, updated_at FROM ops_workspace WHERE id = ? AND owner_user_id = ?',
    [id, ownerUserId],
  );
  return rows[0];
}

export async function listDesigns(
  workspaceId: string,
  ownerUserId: string,
  opts?: { q?: string | null; limit?: number },
): Promise<DesignSummaryRow[]> {
  const q = opts?.q ?? null;
  const requestedLimit = opts?.limit;
  const limit =
    requestedLimit !== undefined && Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 500)
      : 200;

  let sql = `SELECT id, workspace_id, owner_user_id, name, version, updated_at
     FROM ops_plate_design WHERE workspace_id = ? AND owner_user_id = ?`;
  const params: unknown[] = [workspaceId, ownerUserId];
  if (q) {
    sql += ` AND name LIKE CONCAT('%', ?, '%') ESCAPE '\\\\'`;
    params.push(q);
  }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  return opsQuery<DesignSummaryRow>(sql, params);
}

// Direct-query (not opsExec/opsQuery) so a MySQL duplicate-key error on the
// (workspace_id, name) unique index can be distinguished from a generic
// connectivity failure and surfaced as 409 duplicate_name instead of a
// blanket 503. Ownership is scoped in SQL first: a missing-or-unowned design
// is indistinguishable and reported as 404, never 403 (see file header).
export async function renameDesign(designId: string, ownerUserId: string, name: string): Promise<DesignSummaryRow> {
  const existingRows = await opsQuery<DesignSummaryRow>(
    `SELECT id, workspace_id, owner_user_id, name, version, updated_at
     FROM ops_plate_design WHERE id = ? AND owner_user_id = ?`,
    [designId, ownerUserId],
  );
  const existing = existingRows[0];
  if (!existing) throw new OpsHttpError(404, 'not_found', 'Resource not found');

  try {
    await opsPool().query('UPDATE ops_plate_design SET name = ?, updated_at = NOW(3) WHERE id = ? AND owner_user_id = ?', [
      name,
      designId,
      ownerUserId,
    ]);
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    const mysqlError = error as { errno?: number; code?: string };
    if (mysqlError.errno === 1062 || mysqlError.code === 'ER_DUP_ENTRY') {
      throw new OpsHttpError(409, 'duplicate_name', 'A design with this name already exists');
    }
    throw new OpsUnavailable();
  }

  return { ...existing, name, updated_at: new Date() };
}

export async function updateDesignPayload(
  designId: string,
  ownerUserId: string,
  design: PlateDesign,
): Promise<DesignSummaryRow> {
  // Round-trip validate before persisting anything, matching saveDesign.
  const validated = parseDesignJson(JSON.stringify(design));
  const payload = JSON.stringify(validated);

  const existingRows = await opsQuery<DesignSummaryRow>(
    `SELECT id, workspace_id, owner_user_id, name, version, updated_at
     FROM ops_plate_design WHERE id = ? AND owner_user_id = ?`,
    [designId, ownerUserId],
  );
  const existing = existingRows[0];
  if (!existing) throw new OpsHttpError(404, 'not_found', 'Resource not found');

  const nextVersion = existing.version + 1;
  await opsExec(
    'UPDATE ops_plate_design SET payload = ?, schema_version = ?, version = ?, updated_at = NOW(3) WHERE id = ? AND owner_user_id = ?',
    [payload, validated.schemaVersion, nextVersion, designId, ownerUserId],
  );

  return { ...existing, version: nextVersion, updated_at: new Date() };
}

// Direct-query (not opsExec) so affectedRows is available to distinguish a
// successful delete from a missing-or-unowned id, without a separate
// pre-check round trip.
export async function deleteDesign(designId: string, ownerUserId: string): Promise<boolean> {
  try {
    const [result] = await opsPool().query('DELETE FROM ops_plate_design WHERE id = ? AND owner_user_id = ?', [
      designId,
      ownerUserId,
    ]);
    return (result as { affectedRows: number }).affectedRows > 0;
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
}

export async function saveDesign(args: {
  workspaceId: string;
  ownerUserId: string;
  name: string;
  design: PlateDesign;
}): Promise<DesignSummaryRow> {
  const { workspaceId, ownerUserId, name, design } = args;
  // Round-trip validate: reject anything that is not a well-formed
  // PlateDesign before it is ever persisted.
  const validated = parseDesignJson(JSON.stringify(design));
  const payload = JSON.stringify(validated);

  const existing = await opsQuery<{ id: string; version: number }>(
    'SELECT id, version FROM ops_plate_design WHERE workspace_id = ? AND name = ? AND owner_user_id = ?',
    [workspaceId, name, ownerUserId],
  );

  if (existing[0]) {
    const nextVersion = existing[0].version + 1;
    let affectedRows = 0;
    try {
      const [result] = await opsPool().query(
        'UPDATE ops_plate_design SET payload = ?, schema_version = ?, version = ?, updated_at = NOW(3) WHERE id = ? AND owner_user_id = ?',
        [payload, validated.schemaVersion, nextVersion, existing[0].id, ownerUserId],
      );
      affectedRows = (result as { affectedRows: number }).affectedRows;
    } catch (error) {
      if (error instanceof OpsNotConfigured) throw error;
      throw new OpsUnavailable();
    }
    if (affectedRows === 0) throw new OpsHttpError(404, 'not_found', 'Resource not found');
    return {
      id: existing[0].id,
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      name,
      version: nextVersion,
      updated_at: new Date(),
    };
  }

  const id = randomUUID();
  await opsExec(
    `INSERT INTO ops_plate_design
      (id, workspace_id, owner_user_id, name, schema_version, version, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NOW(3), NOW(3))`,
    [id, workspaceId, ownerUserId, name, validated.schemaVersion, payload],
  );
  return { id, workspace_id: workspaceId, owner_user_id: ownerUserId, name, version: 1, updated_at: new Date() };
}

export async function getDesign(id: string, ownerUserId: string): Promise<DesignRow | undefined> {
  const rows = await opsQuery<DesignRow & { payload: string }>(
    `SELECT id, workspace_id, owner_user_id, name, schema_version, version, payload, created_at, updated_at
     FROM ops_plate_design WHERE id = ? AND owner_user_id = ?`,
    [id, ownerUserId],
  );
  const row = rows[0];
  if (!row) return undefined;
  // The `payload` column is MySQL JSON, so mysql2 hands back an already
  // parsed object. Older rows written as text still arrive as a string, so
  // parse only in that case.
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return { ...row, payload };
}

export type ConversationRow = {
  id: string;
  owner_user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: Date;
};

export type ProposalRow = {
  id: string;
  owner_user_id: string;
  conversation_id: string | null;
  workspace_id: string;
  target_design_id: string | null;
  kind: string;
  design_name: string;
  summary: string;
  payload: unknown;
  status: string;
  created_at: Date;
  expires_at: Date;
  resolved_at: Date | null;
};

export const MAX_CONVERSATIONS = 5;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const DEFAULT_PROPOSAL_TTL_MINUTES = 30;

export class ConversationLimitError extends Error {
  constructor(message = 'Conversation limit reached') {
    super(message);
    this.name = 'ConversationLimitError';
  }
}

export async function listConversations(ownerUserId: string): Promise<ConversationRow[]> {
  return opsQuery<ConversationRow>(
    'SELECT id, owner_user_id, title, created_at, updated_at FROM ops_conversation WHERE owner_user_id = ? ORDER BY updated_at DESC',
    [ownerUserId],
  );
}

// Direct connection + transaction (not opsExec/opsQuery) so the count check
// and insert happen atomically: `FOR UPDATE` locks the owner's existing rows
// for the duration of the transaction, so two concurrent requests can never
// both observe count < MAX_CONVERSATIONS and both insert past the cap.
export async function createConversation(ownerUserId: string, title: string): Promise<ConversationRow> {
  let conn;
  try {
    conn = await opsPool().getConnection();
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id FROM ops_conversation WHERE owner_user_id = ? FOR UPDATE', [
      ownerUserId,
    ]);
    if ((rows as unknown[]).length >= MAX_CONVERSATIONS) {
      await conn.rollback();
      throw new ConversationLimitError();
    }
    const id = randomUUID();
    await conn.query(
      'INSERT INTO ops_conversation (id, owner_user_id, title, created_at, updated_at) VALUES (?, ?, ?, NOW(3), NOW(3))',
      [id, ownerUserId, title],
    );
    await conn.commit();
    return { id, owner_user_id: ownerUserId, title, created_at: new Date(), updated_at: new Date() };
  } catch (error) {
    if (error instanceof ConversationLimitError) throw error;
    try {
      await conn.rollback();
    } catch {
      // Connection may already be unusable; the outer error is what matters.
    }
    throw new OpsUnavailable();
  } finally {
    conn.release();
  }
}

export async function getConversation(id: string, ownerUserId: string): Promise<ConversationRow | undefined> {
  const rows = await opsQuery<ConversationRow>(
    'SELECT id, owner_user_id, title, created_at, updated_at FROM ops_conversation WHERE id = ? AND owner_user_id = ?',
    [id, ownerUserId],
  );
  return rows[0];
}

export async function listMessages(conversationId: string, ownerUserId: string): Promise<MessageRow[]> {
  const rows = await opsQuery<MessageRow>(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
     FROM ops_conversation_message m
     JOIN ops_conversation c ON c.id = m.conversation_id
     WHERE m.conversation_id = ? AND c.owner_user_id = ?
     ORDER BY m.created_at ASC`,
    [conversationId, ownerUserId],
  );
  return rows;
}

// Owner ownership is checked before any write, so a foreign conversation id
// silently writes nothing rather than surfacing 403 or corrupting another
// owner's conversation. Also bumps the parent's updated_at and trims the
// conversation to its most recent MAX_MESSAGES_PER_CONVERSATION rows.
export async function appendMessage(args: {
  conversationId: string;
  ownerUserId: string;
  role: string;
  content: string;
}): Promise<void> {
  const { conversationId, ownerUserId, role, content } = args;
  const owned = await getConversation(conversationId, ownerUserId);
  if (!owned) return;

  const id = randomUUID();
  await opsExec(
    'INSERT INTO ops_conversation_message (id, conversation_id, owner_user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, NOW(3))',
    [id, conversationId, ownerUserId, role, content],
  );
  await opsExec('UPDATE ops_conversation SET updated_at = NOW(3) WHERE id = ? AND owner_user_id = ?', [
    conversationId,
    ownerUserId,
  ]);
  await opsExec(
    `DELETE FROM ops_conversation_message WHERE conversation_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM ops_conversation_message WHERE conversation_id = ?
         ORDER BY created_at DESC LIMIT ${MAX_MESSAGES_PER_CONVERSATION}
       ) AS keep
     )`,
    [conversationId, conversationId],
  );
}

// FOREIGN KEY ... ON DELETE CASCADE on ops_conversation_message removes the
// conversation's messages when the row above is deleted.
export async function deleteConversation(id: string, ownerUserId: string): Promise<boolean> {
  try {
    const [result] = await opsPool().query('DELETE FROM ops_conversation WHERE id = ? AND owner_user_id = ?', [
      id,
      ownerUserId,
    ]);
    return (result as { affectedRows: number }).affectedRows > 0;
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
}

export async function createProposal(args: {
  ownerUserId: string;
  conversationId: string | null;
  workspaceId: string;
  targetDesignId: string | null;
  kind: 'create_design' | 'update_design';
  designName: string;
  summary: string;
  payload: unknown;
  ttlMinutes?: number;
}): Promise<{ id: string; summary: string }> {
  const {
    ownerUserId,
    conversationId,
    workspaceId,
    targetDesignId,
    kind,
    designName,
    summary,
    payload,
    ttlMinutes = DEFAULT_PROPOSAL_TTL_MINUTES,
  } = args;
  const id = randomUUID();
  await opsExec(
    `INSERT INTO ops_assistant_proposal
      (id, owner_user_id, conversation_id, workspace_id, target_design_id, kind, design_name, summary, payload, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(3), DATE_ADD(NOW(3), INTERVAL ? MINUTE))`,
    [id, ownerUserId, conversationId, workspaceId, targetDesignId, kind, designName, summary, JSON.stringify(payload), ttlMinutes],
  );
  return { id, summary };
}

export async function getPendingProposal(id: string, ownerUserId: string): Promise<ProposalRow | undefined> {
  const rows = await opsQuery<ProposalRow>(
    `SELECT id, owner_user_id, conversation_id, workspace_id, target_design_id, kind, design_name, summary, payload, status, created_at, expires_at, resolved_at
     FROM ops_assistant_proposal
     WHERE id = ? AND owner_user_id = ? AND status = 'pending' AND expires_at > NOW(3)`,
    [id, ownerUserId],
  );
  const row = rows[0];
  if (!row) return undefined;
  // mysql2 may return a JSON column already parsed or as a raw string
  // depending on driver version; handle both.
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return { ...row, payload };
}

// The `status = 'pending'` guard in the WHERE clause is what makes a double
// apply impossible: the first resolve flips status away from pending, so a
// second concurrent or repeated call matches zero rows and returns false.
export async function resolveProposal(
  id: string,
  ownerUserId: string,
  status: 'applied' | 'rejected',
): Promise<boolean> {
  try {
    const [result] = await opsPool().query(
      `UPDATE ops_assistant_proposal SET status = ?, resolved_at = NOW(3)
       WHERE id = ? AND owner_user_id = ? AND status = 'pending'`,
      [status, id, ownerUserId],
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  } catch (error) {
    if (error instanceof OpsNotConfigured) throw error;
    throw new OpsUnavailable();
  }
}
