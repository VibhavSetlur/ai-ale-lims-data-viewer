import { PLATE_COLUMNS, PLATE_ROWS, type PlateCondition, type PlateDocumentV1, type ValidationError, type WellId } from './types';

const MAX_TEXT = 160;
const MAX_CONDITIONS = 24;
const MAX_PLATES = 24;
const id = () => globalThis.crypto?.randomUUID?.() ?? `plate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
export const allWellIds = (): WellId[] => PLATE_ROWS.flatMap(row => PLATE_COLUMNS.map(column => `${row}${column}` as WellId));
export const isWellId = (value: string): value is WellId => /^[A-H](?:[1-9]|1[0-2])$/.test(value);
/** Returns the adjacent well within the 8 by 12 grid, or undefined at an edge. */
export const adjacentWell = (well: WellId, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): WellId | undefined => {
  const index = allWellIds().indexOf(well);
  const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -12 : 12;
  const column = index % 12;
  if ((key === 'ArrowLeft' && column === 0) || (key === 'ArrowRight' && column === 11) || index + delta < 0 || index + delta >= 96) return undefined;
  return allWellIds()[index + delta];
};
export const createPlateDocument = (now = new Date().toISOString()): PlateDocumentV1 => ({ schemaVersion: 1, id: id(), name: 'Untitled plate design', run: { name: '' }, conditions: [], plates: [], updatedAt: now });
export const createPlate = (label = 'Plate 1') => ({ id: id(), label, wells: Object.fromEntries(allWellIds().map(well => [well, null])) as Record<WellId, null> });
export const createCondition = (name = 'Condition 1'): PlateCondition => ({ id: id(), name, color: '#2563eb' });
const textValid = (value: unknown, required = true) => typeof value === 'string' && (!required || clean(value).length > 0) && clean(value).length <= MAX_TEXT && !/[\x00-\x1f\x7f]/.test(value);

/** Returns a defensive, canonical document or every validation error. */
export function validatePlateDocument(value: unknown): { document?: PlateDocumentV1; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!value || typeof value !== 'object') return { errors: [{ path: '$', message: 'Document must be an object.' }] };
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1) errors.push({ path: 'schemaVersion', message: 'Only schema version 1 is supported.' });
  for (const field of ['id', 'name', 'updatedAt']) if (!textValid(source[field])) errors.push({ path: field, message: 'Required text is missing or too long.' });
  const run = source.run as Record<string, unknown> | undefined;
  if (!run || typeof run !== 'object' || !textValid(run.name)) errors.push({ path: 'run.name', message: 'Run name is required.' });
  if (run?.notes !== undefined && !textValid(run.notes, false)) errors.push({ path: 'run.notes', message: 'Notes are too long.' });
  if (!Array.isArray(source.conditions) || source.conditions.length > MAX_CONDITIONS) errors.push({ path: 'conditions', message: `Conditions must contain at most ${MAX_CONDITIONS} entries.` });
  if (!Array.isArray(source.plates) || source.plates.length > MAX_PLATES) errors.push({ path: 'plates', message: `Plates must contain at most ${MAX_PLATES} entries.` });
  if (errors.length) return { errors };
  const conditionIds = new Set<string>();
  const conditions: PlateCondition[] = [];
  for (const [index, raw] of (source.conditions as unknown[]).entries()) {
    const condition = raw as Record<string, unknown>;
    if (!condition || typeof condition !== 'object' || !textValid(condition.id) || !textValid(condition.name) || !textValid(condition.color)) { errors.push({ path: `conditions.${index}`, message: 'Condition needs an id, name, and color.' }); continue; }
    const conditionId = condition.id as string;
    if (conditionIds.has(conditionId)) errors.push({ path: `conditions.${index}.id`, message: 'Condition IDs must be unique.' });
    conditionIds.add(conditionId); conditions.push({ id: clean(conditionId), name: clean(condition.name as string), color: clean(condition.color as string), ...(typeof condition.notes === 'string' && clean(condition.notes) ? { notes: clean(condition.notes) } : {}) });
  }
  const plateIds = new Set<string>(), labels = new Set<string>();
  const plates: PlateDocumentV1['plates'] = [];
  for (const [index, raw] of (source.plates as unknown[]).entries()) {
    const plate = raw as Record<string, unknown>;
    if (!plate || typeof plate !== 'object' || !textValid(plate.id) || !textValid(plate.label) || !plate.wells || typeof plate.wells !== 'object') { errors.push({ path: `plates.${index}`, message: 'Plate needs an id, label, and wells.' }); continue; }
    const normalizedLabel = clean(plate.label as string).toLowerCase();
    if (plateIds.has(plate.id as string) || labels.has(normalizedLabel)) errors.push({ path: `plates.${index}`, message: 'Plate IDs and labels must be unique.' });
    plateIds.add(plate.id as string); labels.add(normalizedLabel);
    const rawWells = plate.wells as Record<string, unknown>; const wells = {} as Record<WellId, PlateDocumentV1['plates'][number]['wells'][WellId]>;
    for (const well of allWellIds()) { const assignment = rawWells[well]; if (assignment === null) { wells[well] = null; continue; } const item = assignment as Record<string, unknown>; if (!item || typeof item !== 'object' || !textValid(item.conditionId) || !textValid(item.assignedAt)) { errors.push({ path: `plates.${index}.wells.${well}`, message: 'Well assignment is invalid.' }); wells[well] = null; } else if (!conditionIds.has(item.conditionId as string)) { errors.push({ path: `plates.${index}.wells.${well}`, message: 'Well references an unknown condition.' }); wells[well] = null; } else wells[well] = { conditionId: clean(item.conditionId as string), assignedAt: clean(item.assignedAt as string) }; }
    for (const well of Object.keys(rawWells)) if (!isWellId(well)) errors.push({ path: `plates.${index}.wells.${well}`, message: 'Invalid 96-well coordinate.' });
    plates.push({ id: clean(plate.id as string), label: clean(plate.label as string), wells });
  }
  if (errors.length) return { errors };
  return { document: { schemaVersion: 1, id: clean(source.id as string), name: clean(source.name as string), run: { name: clean(run!.name as string), ...(typeof run!.notes === 'string' && clean(run!.notes) ? { notes: clean(run!.notes) } : {}) }, conditions, plates, updatedAt: clean(source.updatedAt as string) }, errors };
}
