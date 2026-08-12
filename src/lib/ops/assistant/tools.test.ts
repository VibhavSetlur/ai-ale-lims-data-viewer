import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const runQueryMock = vi.fn();
const listWorkspacesMock = vi.fn();
const listDesignsMock = vi.fn();
const getDesignMock = vi.fn();
const createProposalMock = vi.fn();
const validateDesignMock = vi.fn();

vi.mock('../../db', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

vi.mock('../repo', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  listDesigns: (...args: unknown[]) => listDesignsMock(...args),
  getDesign: (...args: unknown[]) => getDesignMock(...args),
  createProposal: (...args: unknown[]) => createProposalMock(...args),
}));

vi.mock('../../plateDesign', () => ({
  validateDesign: (...args: unknown[]) => validateDesignMock(...args),
}));

const EXPECTED_TOOL_NAMES = [
  'list_experiments',
  'get_experiment_summary',
  'search_mutations',
  'list_workspaces',
  'list_designs',
  'get_design',
  'propose_design_change',
];

describe('tools', () => {
  beforeEach(() => {
    runQueryMock.mockReset();
    listWorkspacesMock.mockReset();
    listDesignsMock.mockReset();
    getDesignMock.mockReset();
    createProposalMock.mockReset();
    validateDesignMock.mockReset();
  });

  it('exposes exactly the seven allowlisted tools', async () => {
    const { TOOLS } = await import('./tools');
    const names = TOOLS.map((tool) => tool.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('findTool returns undefined for unknown or dangerous names', async () => {
    const { findTool } = await import('./tools');
    expect(findTool('exec')).toBeUndefined();
    expect(findTool('shell')).toBeUndefined();
    expect(findTool('sql')).toBeUndefined();
  });

  it('findTool resolves each real tool by name', async () => {
    const { findTool } = await import('./tools');
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(findTool(name)?.name).toBe(name);
    }
  });

  describe('clampLimit', () => {
    it('clamps values above the max down to the max', async () => {
      const { clampLimit } = await import('./tools');
      expect(clampLimit(9999, 50, 20)).toBe(50);
      expect(clampLimit(9999, 20, 20)).toBe(20);
    });

    it('clamps non-positive values up to a sane minimum', async () => {
      const { clampLimit } = await import('./tools');
      expect(clampLimit(-5, 50, 20)).toBe(1);
      expect(clampLimit(0, 50, 20)).toBe(1);
    });

    it('falls back for non-numeric input', async () => {
      const { clampLimit } = await import('./tools');
      expect(clampLimit('not a number', 50, 20)).toBe(20);
      expect(clampLimit(undefined, 50, 20)).toBe(20);
      expect(clampLimit(NaN, 50, 20)).toBe(20);
    });

    it('accepts numeric strings within range', async () => {
      const { clampLimit } = await import('./tools');
      expect(clampLimit('10', 50, 20)).toBe(10);
    });
  });

  it('search_mutations clamps limit to 50 via clampLimit semantics', async () => {
    runQueryMock.mockResolvedValueOnce([]);
    const { findTool } = await import('./tools');
    const tool = findTool('search_mutations')!;
    const result = await tool.run({ experimentId: 'exp1', limit: 9999 }, { userId: 'u1' });
    expect(result.ok).toBe(true);
    const call = runQueryMock.mock.calls[0];
    const params = call[1] as unknown[];
    expect(params[params.length - 1]).toBe(50);
  });

  it('search_mutations rejects a non-string experimentId without throwing', async () => {
    const { findTool } = await import('./tools');
    const tool = findTool('search_mutations')!;
    const result = await tool.run({ experimentId: 123 }, { userId: 'u1' });
    expect(result.ok).toBe(false);
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('get_experiment_summary rejects a non-string experimentId without throwing', async () => {
    const { findTool } = await import('./tools');
    const tool = findTool('get_experiment_summary')!;
    const result = await tool.run({ experimentId: { nested: true } }, { userId: 'u1' });
    expect(result.ok).toBe(false);
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('get_experiment_summary returns counts from runQuery', async () => {
    runQueryMock.mockResolvedValueOnce([{ mutationCount: 12, sampleCount: 4 }]);
    const { findTool } = await import('./tools');
    const tool = findTool('get_experiment_summary')!;
    const result = await tool.run({ experimentId: 'exp1' }, { userId: 'u1' });
    expect(result).toEqual({
      ok: true,
      data: { experimentId: 'exp1', mutationCount: 12, sampleCount: 4 },
    });
  });

  it('list_experiments caps at 100 rows via the literal SQL LIMIT', async () => {
    runQueryMock.mockResolvedValueOnce([{ name: 'expA' }, { name: 'expB' }]);
    const { findTool } = await import('./tools');
    const tool = findTool('list_experiments')!;
    const result = await tool.run({}, { userId: 'u1' });
    expect(result.ok).toBe(true);
    expect(runQueryMock).toHaveBeenCalledTimes(1);
    const sql = runQueryMock.mock.calls[0][0] as string;
    expect(sql).toContain('LIMIT 100');
  });

  it('list_workspaces delegates to the owner-scoped repo function', async () => {
    listWorkspacesMock.mockResolvedValueOnce([{ id: 'w1' }]);
    const { findTool } = await import('./tools');
    const tool = findTool('list_workspaces')!;
    const result = await tool.run({}, { userId: 'user-1' });
    expect(listWorkspacesMock).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ ok: true, data: { workspaces: [{ id: 'w1' }] } });
  });

  it('list_designs clamps limit to 20 before calling the repo', async () => {
    listDesignsMock.mockResolvedValueOnce([]);
    const { findTool } = await import('./tools');
    const tool = findTool('list_designs')!;
    await tool.run({ workspaceId: 'ws1', limit: 9999 }, { userId: 'user-1' });
    expect(listDesignsMock).toHaveBeenCalledWith('ws1', 'user-1', { q: null, limit: 20 });
  });

  it('list_designs rejects a missing workspaceId without throwing', async () => {
    const { findTool } = await import('./tools');
    const tool = findTool('list_designs')!;
    const result = await tool.run({}, { userId: 'user-1' });
    expect(result.ok).toBe(false);
    expect(listDesignsMock).not.toHaveBeenCalled();
  });

  it('get_design returns not_found when the repo returns nothing', async () => {
    getDesignMock.mockResolvedValueOnce(undefined);
    const { findTool } = await import('./tools');
    const tool = findTool('get_design')!;
    const result = await tool.run({ designId: 'd1' }, { userId: 'user-1' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('propose_design_change returns ok:false when validation reports an error', async () => {
    validateDesignMock.mockReturnValueOnce([
      { severity: 'error', code: 'bad', message: 'runName is required', step: 1 },
    ]);
    const { findTool } = await import('./tools');
    const tool = findTool('propose_design_change')!;
    const result = await tool.run(
      {
        workspaceId: 'ws1',
        name: 'My Design',
        design: { runName: '', conditions: [], plates: [], nextAssignmentOrder: 1 },
      },
      { userId: 'user-1' }
    );
    expect(result.ok).toBe(false);
    expect(createProposalMock).not.toHaveBeenCalled();
  });

  it('propose_design_change creates a proposal and returns a plain-language summary', async () => {
    validateDesignMock.mockReturnValueOnce([]);
    createProposalMock.mockResolvedValueOnce({ id: 'prop-1', summary: 'echoed summary' });
    const { findTool } = await import('./tools');
    const tool = findTool('propose_design_change')!;
    const design = {
      runName: 'Run A',
      conditions: [{ id: 'c1' }, { id: 'c2' }],
      plates: [{ id: 'p1', name: 'Plate 1', wells: { A1: { conditionId: 'c1', assignmentOrder: 1 } } }],
      nextAssignmentOrder: 2,
    };
    const result = await tool.run(
      { workspaceId: 'ws1', targetDesignId: 'design-existing', name: 'My Design', design },
      { userId: 'user-1' }
    );
    expect(createProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        workspaceId: 'ws1',
        targetDesignId: 'design-existing',
        kind: 'update_design',
        designName: 'My Design',
        payload: design,
      })
    );
    expect(result).toEqual({ ok: true, data: { proposalId: 'prop-1', summary: 'echoed summary' } });
  });

  it('propose_design_change uses create_design kind when there is no target', async () => {
    validateDesignMock.mockReturnValueOnce([]);
    createProposalMock.mockResolvedValueOnce({ id: 'prop-2', summary: 'echoed summary 2' });
    const { findTool } = await import('./tools');
    const tool = findTool('propose_design_change')!;
    const design = {
      runName: 'Run B',
      conditions: [],
      plates: [],
      nextAssignmentOrder: 1,
    };
    await tool.run({ workspaceId: 'ws1', name: 'New Design', design }, { userId: 'user-1' });
    expect(createProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'create_design', targetDesignId: null })
    );
  });

  it('does not throw when an underlying data call rejects', async () => {
    runQueryMock.mockRejectedValueOnce(new Error('boom'));
    const { findTool } = await import('./tools');
    const tool = findTool('list_experiments')!;
    const result = await tool.run({}, { userId: 'user-1' });
    expect(result.ok).toBe(false);
  });

  describe('serializeToolResult', () => {
    it('returns compact JSON for small payloads', async () => {
      const { serializeToolResult } = await import('./tools');
      const serialized = serializeToolResult({ ok: true, data: { a: 1 } });
      expect(serialized).toBe(JSON.stringify({ ok: true, data: { a: 1 } }));
    });

    it('truncates oversized payloads with a visible marker', async () => {
      const { serializeToolResult, MAX_TOOL_RESULT_CHARS } = await import('./tools');
      const bigData = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, gene: 'gene_' + i })) };
      const serialized = serializeToolResult({ ok: true, data: bigData });
      expect(serialized.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
      expect(serialized.endsWith('...[truncated]')).toBe(true);
    });
  });

  it('exports MAX_TOOL_CALLS_PER_TURN as 8', async () => {
    const { MAX_TOOL_CALLS_PER_TURN } = await import('./tools');
    expect(MAX_TOOL_CALLS_PER_TURN).toBe(8);
  });

  it('exports MAX_TOOL_RESULT_CHARS as 8000', async () => {
    const { MAX_TOOL_RESULT_CHARS } = await import('./tools');
    expect(MAX_TOOL_RESULT_CHARS).toBe(8000);
  });

  it('static self-check: source contains no dangerous primitives or SQL interpolation', () => {
    const sourcePath = path.join(__dirname, 'tools.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('eval(');
    expect(source).not.toContain('require(');
    // Detect a backtick template literal that both contains SELECT and uses ${...} interpolation.
    const templateLiteralPattern = /`[^`]*SELECT[^`]*\$\{[^`]*`/i;
    expect(templateLiteralPattern.test(source)).toBe(false);
  });
});
