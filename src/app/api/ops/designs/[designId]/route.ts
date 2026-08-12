import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { normalizeDesignName } from '@/lib/ops/designInput';
import { OpsHttpError, assertOwned } from '@/lib/ops/guards';
import { deleteDesign, getDesign, renameDesign, updateDesignPayload } from '@/lib/ops/repo';
import { MAX_BODY_BYTES } from '@/app/api/ops/workspaces/[workspaceId]/designs/route';

export const GET = handleOps(async (req: Request, ctx: { params: Promise<{ designId: string }> }) => {
  const session = await requireSession(req);
  const { designId } = await ctx.params;
  const design = assertOwned(await getDesign(designId, session.userId), session.userId);
  return opsOk({ design });
});

export const PATCH = handleOps(async (req: Request, ctx: { params: Promise<{ designId: string }> }) => {
  assertSameOrigin(req);
  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'too_large', 'Design payload exceeds the 2MB limit');
  }

  const session = await requireSession(req);
  const { designId } = await ctx.params;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new OpsHttpError(413, 'too_large', 'Design payload exceeds the 2MB limit');
  }
  const body = JSON.parse(raw || '{}');
  const hasName = body?.name !== undefined;
  const hasDesign = body?.design !== undefined;
  if (!hasName && !hasDesign) {
    throw new OpsHttpError(400, 'invalid', 'At least one of name or design is required');
  }

  let summary = undefined;
  if (hasName) {
    const name = normalizeDesignName(body.name);
    summary = await renameDesign(designId, session.userId, name);
  }
  if (hasDesign) {
    if (!body.design || typeof body.design !== 'object') {
      throw new OpsHttpError(400, 'invalid', 'A design payload is required');
    }
    try {
      summary = await updateDesignPayload(designId, session.userId, body.design);
    } catch (error) {
      if (error instanceof OpsHttpError) throw error;
      throw new OpsHttpError(400, 'invalid', 'Invalid or unsupported plate design JSON.');
    }
  }

  return opsOk({ design: summary });
});

export const DELETE = handleOps(async (req: Request, ctx: { params: Promise<{ designId: string }> }) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const { designId } = await ctx.params;
  const deleted = await deleteDesign(designId, session.userId);
  if (!deleted) {
    throw new OpsHttpError(404, 'not_found', 'Resource not found');
  }
  return new Response(null, { status: 204 });
});
