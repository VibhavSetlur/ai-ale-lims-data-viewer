import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { normalizeSearch } from '@/lib/ops/designInput';
import { OpsHttpError, assertOwned } from '@/lib/ops/guards';
import { getWorkspace, listDesigns, saveDesign } from '@/lib/ops/repo';

export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

export const GET = handleOps(async (req: Request, ctx: { params: Promise<{ workspaceId: string }> }) => {
  const session = await requireSession(req);
  const { workspaceId } = await ctx.params;
  assertOwned(await getWorkspace(workspaceId, session.userId), session.userId);
  const q = normalizeSearch(new URL(req.url).searchParams.get('q'));
  const designs = await listDesigns(workspaceId, session.userId, { q });
  return opsOk({ designs });
});

export const POST = handleOps(async (req: Request, ctx: { params: Promise<{ workspaceId: string }> }) => {
  assertSameOrigin(req);
  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'too_large', 'Design payload exceeds the 2MB limit');
  }

  const session = await requireSession(req);
  const { workspaceId } = await ctx.params;
  assertOwned(await getWorkspace(workspaceId, session.userId), session.userId);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'too_large', 'Design payload exceeds the 2MB limit');
  }
  const body = JSON.parse(raw || '{}');
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    throw new OpsHttpError(400, 'invalid', 'Design name must be between 1 and 120 characters');
  }
  if (!body?.design || typeof body.design !== 'object') {
    throw new OpsHttpError(400, 'invalid', 'A design payload is required');
  }

  let saved;
  try {
    saved = await saveDesign({ workspaceId, ownerUserId: session.userId, name, design: body.design });
  } catch (error) {
    if (error instanceof OpsHttpError) throw error;
    throw new OpsHttpError(400, 'invalid', 'Invalid or unsupported plate design JSON.');
  }
  return opsOk({ design: saved }, 201);
});
