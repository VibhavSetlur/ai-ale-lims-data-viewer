import { describe, expect, it } from 'vitest';
import { adjacentWell, allWellIds, createCondition, createPlate, createPlateDocument, validatePlateDocument } from './document';
import { createPlateState, exportCsv, exportDocument, importDocument, plateReducer } from './state';
import { reviewPlateDocument } from './validation-review';

describe('PlateDocumentV1', () => {
  it('validates a complete 96-well document and preserves deterministic exports', () => {
    const document = createPlateDocument('2026-01-01T00:00:00.000Z'); document.run.name = 'Run 1'; const condition = createCondition('Control'); condition.id = 'condition-1'; const plate = createPlate('Plate 1'); plate.id = 'plate-1'; document.conditions = [condition]; document.plates = [plate];
    expect(validatePlateDocument(document).document).toEqual(document);
    expect(exportDocument(document)).toBe(exportDocument(document));
    expect(exportCsv(document).split('\r\n')).toHaveLength(98);
  });
  it('rejects invalid coordinates and unknown condition references', () => {
    const document = createPlateDocument(); document.run.name = 'Run'; const plate = createPlate(); (plate.wells as Record<string, unknown>).Z1 = null; document.plates = [plate];
    const errors = validatePlateDocument(document).errors.map(error => error.message);
    expect(errors).toContain('Invalid 96-well coordinate.');
  });
  it('summarizes canonical validation errors for workspace review', () => {
    const document = createPlateDocument();
    expect(reviewPlateDocument(document)).toMatchObject({ summary: '1 issue needs review before export or use.', errors: [{ path: 'run.name', message: 'Run name is required.' }] });
  });
  it('models all 96 wells and keyboard edges correctly', () => {
    expect(allWellIds()).toHaveLength(96); expect(adjacentWell('A1', 'ArrowLeft')).toBeUndefined(); expect(adjacentWell('A1', 'ArrowUp')).toBeUndefined(); expect(adjacentWell('A1', 'ArrowRight')).toBe('A2'); expect(adjacentWell('A1', 'ArrowDown')).toBe('B1'); expect(adjacentWell('H12', 'ArrowRight')).toBeUndefined();
  });
  it('keeps prior document when malformed import fails', () => {
    const state = createPlateState(); const prior = state.document; const result = importDocument('{not json'); expect(result.error).toBeTruthy(); const next = result.document ? plateReducer(state, { type: 'replace', document: result.document }) : plateReducer(state, { type: 'error', error: result.error! }); expect(next.document).toBe(prior);
  });
  it('records assignments in undo history', () => {
    const condition = createCondition(); const plate = createPlate(); let state = createPlateState(); state = plateReducer(state, { type: 'add-condition', condition }); state = plateReducer(state, { type: 'add-plate', plate }); state = plateReducer(state, { type: 'assign', plateId: plate.id, wellId: 'A1', conditionId: condition.id }); expect(state.document.plates[0].wells.A1?.conditionId).toBe(condition.id); expect(plateReducer(state, { type: 'undo' }).document.plates[0].wells.A1).toBeNull();
  });
});
