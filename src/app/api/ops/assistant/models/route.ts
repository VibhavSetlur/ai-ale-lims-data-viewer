// This route proxies only the public model list from the local model proxy.
// It never reads, requires, or forwards the user Argo key.
import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { readAssistantConfig } from '@/lib/ops/config';

async function fetchModels(proxyUrl: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${proxyUrl}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const rows = Array.isArray(body?.data) ? body.data : null;
    if (!rows) return null;
    return rows.map((r: { id?: unknown }) => r?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return null;
  }
}

export const GET = handleOps(async (req: Request) => {
  await requireSession(req);
  const cfg = readAssistantConfig();
  if (!cfg) return opsOk({ models: [], defaultModel: null, reachable: false });
  const models = await fetchModels(cfg.proxyUrl);
  if (!models) return opsOk({ models: [], defaultModel: cfg.defaultModel, reachable: false });
  return opsOk({ models, defaultModel: cfg.defaultModel, reachable: true });
});
