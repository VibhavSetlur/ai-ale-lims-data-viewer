/**
 * Bounded, auditable tool surface for the ops assistant.
 *
 * Hard security rules for this module:
 * - No process spawning, no network fetch, no filesystem access, no dynamic
 *   module loading, no code-string evaluation, no CommonJS module loading.
 * - Every SQL string is a literal in this file, parameterized with ? placeholders.
 *   No table name, column name, ORDER BY target, or LIMIT value is ever built from
 *   model input. Limits are clamped in TypeScript and bound as parameters.
 * - Every argument is type checked before use. A wrong type returns
 *   { ok: false, error } and never throws.
 * - No tool run() may throw. Internal errors are caught and mapped to a short
 *   error code, never a stack trace, SQL text, or raw driver message.
 */

import { runQuery } from '../../db';
import { listWorkspaces, listDesigns, getDesign, createProposal } from '../repo';
import { validateDesign } from '../../plateDesign';
import type { PlateDesign } from '../../plateDesign';

export type ToolContext = { userId: string };

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

export const MAX_TOOL_CALLS_PER_TURN = 8;
export const MAX_TOOL_RESULT_CHARS = 8000;

/** Clamp an unknown value to an integer between 1 and max, falling back when not a finite number. */
export function clampLimit(raw: unknown, max: number, fallback: number): number {
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  if (floored < 1) return 1;
  return Math.min(floored, max);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** Wrap a tool body so any internal error becomes a safe, opaque error code. */
function safeRun(
  errorCode: string,
  fn: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
): ToolSpec['run'] {
  return async (args, ctx) => {
    try {
      return await fn(args, ctx);
    } catch {
      return { ok: false, error: errorCode };
    }
  };
}

// Scientific SQL literals. Table and column names copied verbatim from
// src/app/api/mutations/route.ts (MUTATIONS_SQL and buildAllExperimentsSql).
// Every value is bound with ?; there is no string interpolation of SQL structure.
const LIST_EXPERIMENTS_SQL =
  'SELECT DISTINCT "Experiment" AS name FROM Mutations ' +
  'WHERE deleted = 0 AND "Experiment" IS NOT NULL AND "Experiment" != \'\' ' +
  'ORDER BY "Experiment" LIMIT 100';

const EXPERIMENT_SUMMARY_SQL =
  'SELECT COUNT(*) AS mutationCount, COUNT(DISTINCT "Seq_sample") AS sampleCount ' +
  'FROM Mutations WHERE deleted = 0 AND "Experiment" = ?';

const SEARCH_MUTATIONS_BASE_SQL =
  'SELECT "Seq_sample" AS seqSample, "Experiment" AS experiment, "gene_name" AS gene, ' +
  '"gene_product" AS geneProduct, "type" AS type, "frequency" AS frequency ' +
  'FROM Mutations WHERE deleted = 0 AND "Experiment" = ?';

const SEARCH_MUTATIONS_GENE_CLAUSE = ' AND "gene_name" LIKE ?';
const SEARCH_MUTATIONS_ORDER_LIMIT = ' ORDER BY "gene_name" LIMIT ?';

type ExperimentNameRow = { name: string };
type ExperimentSummaryRow = { mutationCount: number; sampleCount: number };
type MutationSearchRow = {
  seqSample: string | null;
  experiment: string | null;
  gene: string | null;
  geneProduct: string | null;
  type: string | null;
  frequency: number | null;
};

async function runListExperiments(): Promise<ToolResult> {
  const rows = await runQuery<ExperimentNameRow>(LIST_EXPERIMENTS_SQL);
  const experiments = rows.map((row) => ({ id: row.name, name: row.name }));
  return { ok: true, data: { experiments } };
}

async function runGetExperimentSummary(args: Record<string, unknown>): Promise<ToolResult> {
  const experimentId = args.experimentId;
  if (!isNonEmptyString(experimentId)) {
    return { ok: false, error: 'invalid_experimentId' };
  }
  const rows = await runQuery<ExperimentSummaryRow>(EXPERIMENT_SUMMARY_SQL, [experimentId]);
  const summary = rows[0] ?? { mutationCount: 0, sampleCount: 0 };
  return {
    ok: true,
    data: {
      experimentId,
      mutationCount: Number(summary.mutationCount) || 0,
      sampleCount: Number(summary.sampleCount) || 0,
    },
  };
}

async function runSearchMutations(args: Record<string, unknown>): Promise<ToolResult> {
  const experimentId = args.experimentId;
  if (!isNonEmptyString(experimentId)) {
    return { ok: false, error: 'invalid_experimentId' };
  }
  const gene = args.gene;
  if (!isOptionalString(gene)) {
    return { ok: false, error: 'invalid_gene' };
  }
  const limit = clampLimit(args.limit, 50, 20);

  const params: (string | number | null)[] = [experimentId];
  let sql = SEARCH_MUTATIONS_BASE_SQL;
  if (isNonEmptyString(gene)) {
    sql += SEARCH_MUTATIONS_GENE_CLAUSE;
    params.push('%' + gene + '%');
  }
  sql += SEARCH_MUTATIONS_ORDER_LIMIT;
  params.push(limit);

  const rows = await runQuery<MutationSearchRow>(sql, params);
  return { ok: true, data: { mutations: rows } };
}

async function runListWorkspaces(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const workspaces = await listWorkspaces(ctx.userId);
  return { ok: true, data: { workspaces } };
}

async function runListDesigns(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const workspaceId = args.workspaceId;
  if (!isNonEmptyString(workspaceId)) {
    return { ok: false, error: 'invalid_workspaceId' };
  }
  const q = args.q;
  if (q !== undefined && q !== null && typeof q !== 'string') {
    return { ok: false, error: 'invalid_q' };
  }
  const limit = clampLimit(args.limit, 20, 20);
  const designs = await listDesigns(workspaceId, ctx.userId, {
    q: (q as string | null | undefined) ?? null,
    limit,
  });
  return { ok: true, data: { designs } };
}

async function runGetDesign(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const designId = args.designId;
  if (!isNonEmptyString(designId)) {
    return { ok: false, error: 'invalid_designId' };
  }
  const design = await getDesign(designId, ctx.userId);
  if (!design) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: true, data: { design } };
}

function isPlausibleDesignShape(value: unknown): value is PlateDesign {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.runName) &&
    Array.isArray(candidate.conditions) &&
    Array.isArray(candidate.plates) &&
    typeof candidate.nextAssignmentOrder === 'number'
  );
}

async function runProposeDesignChange(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const workspaceId = args.workspaceId;
  if (!isNonEmptyString(workspaceId)) {
    return { ok: false, error: 'invalid_workspaceId' };
  }
  const name = args.name;
  if (!isNonEmptyString(name)) {
    return { ok: false, error: 'invalid_name' };
  }
  const targetDesignId = args.targetDesignId;
  if (!isOptionalString(targetDesignId)) {
    return { ok: false, error: 'invalid_targetDesignId' };
  }
  const design = args.design;
  if (!isPlausibleDesignShape(design)) {
    return { ok: false, error: 'invalid_design' };
  }

  const issues = validateDesign(design);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    const messages = errors.map((issue) => issue.message).join('; ');
    const trimmed = messages.length > 500 ? messages.slice(0, 500) + '...' : messages;
    return { ok: false, error: 'invalid_design: ' + trimmed };
  }

  const kind: 'create_design' | 'update_design' = isNonEmptyString(targetDesignId)
    ? 'update_design'
    : 'create_design';
  const plateCount = design.plates.length;
  const conditionCount = design.conditions.length;
  const assignedWellCount = design.plates.reduce((total, plate) => {
    const wells = plate.wells ? Object.keys(plate.wells).length : 0;
    return total + wells;
  }, 0);

  const action = kind === 'update_design' ? 'replace' : 'create';
  const targetPhrase = isNonEmptyString(targetDesignId)
    ? 'targeting existing design ' + targetDesignId
    : 'as a new design';
  const summary =
    'Proposal to ' +
    action +
    ' design "' +
    name +
    '" ' +
    targetPhrase +
    '. It defines ' +
    plateCount +
    ' plate(s), ' +
    conditionCount +
    ' condition(s), and ' +
    assignedWellCount +
    ' assigned well(s). This ' +
    (kind === 'update_design' ? 'replaces the targeted design' : 'creates a brand new design') +
    ' and does not apply automatically.';

  const result = await createProposal({
    ownerUserId: ctx.userId,
    conversationId: null,
    workspaceId,
    targetDesignId: isNonEmptyString(targetDesignId) ? targetDesignId : null,
    kind,
    designName: name,
    summary,
    payload: design,
  });

  return { ok: true, data: { proposalId: result.id, summary: result.summary } };
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'list_experiments',
    description: 'List available experiment names from the scientific database, at most 100.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: safeRun('list_experiments_failed', async () => runListExperiments()),
  },
  {
    name: 'get_experiment_summary',
    description: 'Get mutation and sample counts for one experiment.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'The experiment name to summarize.' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    run: safeRun('get_experiment_summary_failed', async (args) => runGetExperimentSummary(args)),
  },
  {
    name: 'search_mutations',
    description: 'Search mutations for one experiment, optionally filtered by gene name. Limit is clamped to 50.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'The experiment name to search within.' },
        gene: { type: 'string', description: 'Optional gene name substring filter.' },
        limit: { type: 'number', description: 'Maximum rows to return, clamped to 50.' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    run: safeRun('search_mutations_failed', async (args) => runSearchMutations(args)),
  },
  {
    name: 'list_workspaces',
    description: 'List workspaces owned by the current user.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: safeRun('list_workspaces_failed', async (args, ctx) => runListWorkspaces(args, ctx)),
  },
  {
    name: 'list_designs',
    description: 'List plate designs in a workspace owned by the current user. Limit is clamped to 20.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace to list designs from.' },
        q: { type: 'string', description: 'Optional search text to filter design names.' },
        limit: { type: 'number', description: 'Maximum rows to return, clamped to 20.' },
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
    run: safeRun('list_designs_failed', async (args, ctx) => runListDesigns(args, ctx)),
  },
  {
    name: 'get_design',
    description: 'Get one plate design owned by the current user.',
    parameters: {
      type: 'object',
      properties: {
        designId: { type: 'string', description: 'The design id to fetch.' },
      },
      required: ['designId'],
      additionalProperties: false,
    },
    run: safeRun('get_design_failed', async (args, ctx) => runGetDesign(args, ctx)),
  },
  {
    name: 'propose_design_change',
    description:
      'Validate a plate design and record a proposal describing what would change. Never writes the design itself.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace the proposal belongs to.' },
        targetDesignId: { type: 'string', description: 'Optional existing design id this proposal would replace.' },
        name: { type: 'string', description: 'The name of the proposed design.' },
        design: { type: 'object', description: 'The full plate design payload to validate and propose.' },
      },
      required: ['workspaceId', 'name', 'design'],
      additionalProperties: false,
    },
    run: safeRun('propose_design_change_failed', async (args, ctx) => runProposeDesignChange(args, ctx)),
  },
];

export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export function serializeToolResult(result: ToolResult): string {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) {
    return json;
  }
  const marker = '...[truncated]';
  return json.slice(0, Math.max(0, MAX_TOOL_RESULT_CHARS - marker.length)) + marker;
}
