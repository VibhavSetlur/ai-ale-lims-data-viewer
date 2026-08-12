import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError } from '@/lib/ops/guards';
import { ConversationLimitError, createConversation, listConversations } from '@/lib/ops/repo';

const MAX_TITLE_CHARS = 200;
const DEFAULT_TITLE = 'New conversation';

export const GET = handleOps(async (req: Request) => {
  const session = await requireSession(req);
  const conversations = await listConversations(session.userId);
  return opsOk({ conversations });
});

export const POST = handleOps(async (req: Request) => {
  assertSameOrigin(req);
  const session = await requireSession(req);

  const raw = await req.text();
  const body = raw ? JSON.parse(raw) : {};
  let title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (title.length === 0) {
    title = DEFAULT_TITLE;
  } else if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS);
  }

  try {
    const conversation = await createConversation(session.userId, title);
    return opsOk({ conversation }, 201);
  } catch (error) {
    if (error instanceof ConversationLimitError) {
      throw new OpsHttpError(
        409,
        'conversation_limit',
        'You already have 5 conversations. Delete one to start another.',
      );
    }
    throw error;
  }
});
