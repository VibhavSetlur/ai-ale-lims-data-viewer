import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { readAssistantConfig } from '@/lib/ops/config';
import { MAX_CONVERSATIONS } from '@/lib/ops/repo';

async function checkProxyReachable(proxyUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${proxyUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const GET = handleOps(async (req: Request) => {
  await requireSession(req);
  const cfg = readAssistantConfig();
  if (!cfg) {
    return opsOk({
      enabled: false,
      proxyReachable: false,
      defaultModel: null,
      maxConversations: MAX_CONVERSATIONS,
      keyRequired: true,
    });
  }

  const proxyReachable = await checkProxyReachable(cfg.proxyUrl);
  return opsOk({
    enabled: true,
    proxyReachable,
    defaultModel: cfg.defaultModel,
    maxConversations: cfg.maxConversations,
    keyRequired: true,
  });
});
