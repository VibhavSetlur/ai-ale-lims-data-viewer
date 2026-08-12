import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError, assertOwned } from '@/lib/ops/guards';
import { deleteConversation, getConversation, listMessages } from '@/lib/ops/repo';

export const GET = handleOps(
  async (req: Request, ctx: { params: Promise<{ conversationId: string }> }) => {
    const session = await requireSession(req);
    const { conversationId } = await ctx.params;
    const conversation = assertOwned(await getConversation(conversationId, session.userId), session.userId);
    const messages = await listMessages(conversationId, session.userId);
    return opsOk({ conversation, messages });
  },
);

export const DELETE = handleOps(
  async (req: Request, ctx: { params: Promise<{ conversationId: string }> }) => {
    assertSameOrigin(req);
    const session = await requireSession(req);
    const { conversationId } = await ctx.params;
    const deleted = await deleteConversation(conversationId, session.userId);
    if (!deleted) {
      throw new OpsHttpError(404, 'not_found', 'Resource not found');
    }
    return new Response(null, { status: 204 });
  },
);
