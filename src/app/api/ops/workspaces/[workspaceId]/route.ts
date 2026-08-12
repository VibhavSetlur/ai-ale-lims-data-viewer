import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertOwned } from '@/lib/ops/guards';
import { getWorkspace } from '@/lib/ops/repo';

export const GET = handleOps(async (req: Request, ctx: { params: Promise<{ workspaceId: string }> }) => {
  const session = await requireSession(req);
  const { workspaceId } = await ctx.params;
  const workspace = assertOwned(await getWorkspace(workspaceId, session.userId), session.userId);
  return opsOk({ workspace });
});
