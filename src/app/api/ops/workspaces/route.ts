import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError } from '@/lib/ops/guards';
import { createWorkspace, listWorkspaces } from '@/lib/ops/repo';

export const GET = handleOps(async (req: Request) => {
  const session = await requireSession(req);
  const workspaces = await listWorkspaces(session.userId);
  return opsOk({ workspaces });
});

export const POST = handleOps(async (req: Request) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    throw new OpsHttpError(400, 'invalid', 'Workspace name must be between 1 and 120 characters');
  }

  const existing = await listWorkspaces(session.userId);
  if (existing.some((w) => w.name === name)) {
    throw new OpsHttpError(409, 'duplicate', 'A workspace with this name already exists');
  }

  const workspace = await createWorkspace(session.userId, name);
  return opsOk({ workspace }, 201);
});
