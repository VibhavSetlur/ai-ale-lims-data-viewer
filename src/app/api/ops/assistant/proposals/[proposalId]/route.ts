import { handleOps, opsOk, requireSession } from '@/lib/ops/api';
import { assertSameOrigin } from '@/lib/ops/csrf';
import { OpsHttpError } from '@/lib/ops/guards';
import { getPendingProposal, resolveProposal, saveDesign, updateDesignPayload } from '@/lib/ops/repo';
import type { PlateDesign } from '@/lib/plateDesign';

export const GET = handleOps(
  async (req: Request, ctx: { params: Promise<{ proposalId: string }> }) => {
    const session = await requireSession(req);
    const { proposalId } = await ctx.params;
    const proposal = await getPendingProposal(proposalId, session.userId);
    if (!proposal) {
      throw new OpsHttpError(404, 'not_found', 'Resource not found');
    }
    return opsOk({
      proposal: {
        id: proposal.id,
        kind: proposal.kind,
        workspaceId: proposal.workspace_id,
        targetDesignId: proposal.target_design_id,
        designName: proposal.design_name,
        summary: proposal.summary,
        payload: proposal.payload,
        expiresAt: proposal.expires_at,
      },
    });
  },
);

export const POST = handleOps(
  async (req: Request, ctx: { params: Promise<{ proposalId: string }> }) => {
    assertSameOrigin(req);
    const session = await requireSession(req);
    const { proposalId } = await ctx.params;

    const proposal = await getPendingProposal(proposalId, session.userId);
    if (!proposal) {
      throw new OpsHttpError(404, 'not_found', 'Resource not found');
    }

    const payload = proposal.payload as PlateDesign;
    const design =
      proposal.kind === 'update_design' && proposal.target_design_id
        ? await updateDesignPayload(proposal.target_design_id, session.userId, payload)
        : await saveDesign({
            workspaceId: proposal.workspace_id,
            ownerUserId: session.userId,
            name: proposal.design_name,
            design: payload,
          });

    const resolved = await resolveProposal(proposalId, session.userId, 'applied');
    if (!resolved) {
      throw new OpsHttpError(409, 'already_resolved', 'This proposal has already been resolved.');
    }

    return opsOk({ design });
  },
);

export const DELETE = handleOps(
  async (req: Request, ctx: { params: Promise<{ proposalId: string }> }) => {
    assertSameOrigin(req);
    const session = await requireSession(req);
    const { proposalId } = await ctx.params;
    const resolved = await resolveProposal(proposalId, session.userId, 'rejected');
    if (!resolved) {
      throw new OpsHttpError(404, 'not_found', 'Resource not found');
    }
    return new Response(null, { status: 204 });
  },
);
