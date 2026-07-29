import { createPlateDocument, validatePlateDocument } from './document';
import type { PlateDocumentV1, PlateState, Snapshot, WellId } from './types';
export const STORAGE_KEY = 'viewer2.plate-design.v1';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const touch = (document: PlateDocumentV1): PlateDocumentV1 => ({ ...document, updatedAt: new Date().toISOString() });
const commit = (state: PlateState, document: PlateDocumentV1): PlateState => ({ ...state, document: touch(document), past: [...state.past, state.document].slice(-50), future: [], error: undefined });
export const createPlateState = (): PlateState => ({ document: createPlateDocument(), snapshots: [], past: [], future: [] });
export type PlateAction =
  | { type: 'replace'; document: PlateDocumentV1; notice?: string }
  | { type: 'assign'; plateId: string; wellId: WellId; conditionId?: string }
  | { type: 'add-condition'; condition: PlateDocumentV1['conditions'][number] }
  | { type: 'remove-condition'; id: string }
  | { type: 'add-plate'; plate: PlateDocumentV1['plates'][number] }
  | { type: 'clear-plate'; plateId: string }
  | { type: 'duplicate-plate'; plateId: string; plate: PlateDocumentV1['plates'][number] }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'discard' } | { type: 'undo' } | { type: 'redo' } | { type: 'error'; error: string };
export function plateReducer(state: PlateState, action: PlateAction): PlateState {
  if (action.type === 'error') return { ...state, error: action.error, notice: undefined };
  if (action.type === 'undo') { const previous = state.past.at(-1); return previous ? { ...state, document: previous, past: state.past.slice(0, -1), future: [state.document, ...state.future], notice: 'Undid last change.', error: undefined } : state; }
  if (action.type === 'redo') { const next = state.future[0]; return next ? { ...state, document: next, past: [...state.past, state.document], future: state.future.slice(1), notice: 'Redid change.', error: undefined } : state; }
  if (action.type === 'discard') return { ...state, document: createPlateDocument(), past: [], future: [], notice: 'Discarded local draft.', error: undefined };
  if (action.type === 'replace') return { ...state, document: clone(action.document), past: [], future: [], notice: action.notice, error: undefined };
  if (action.type === 'snapshot') return { ...state, snapshots: [action.snapshot, ...state.snapshots].slice(0, 20), notice: 'Saved browser-local snapshot.', error: undefined };
  const document = state.document;
  if (action.type === 'add-condition') return commit(state, { ...document, conditions: [...document.conditions, action.condition] });
  if (action.type === 'remove-condition') return commit(state, { ...document, conditions: document.conditions.filter(condition => condition.id !== action.id), plates: document.plates.map(plate => ({ ...plate, wells: Object.fromEntries(Object.entries(plate.wells).map(([well, assignment]) => [well, assignment?.conditionId === action.id ? null : assignment])) as typeof plate.wells })) });
  if (action.type === 'add-plate') return commit(state, { ...document, plates: [...document.plates, action.plate] });
  const plate = document.plates.find(item => item.id === action.plateId); if (!plate) return state;
  if (action.type === 'assign') return commit(state, { ...document, plates: document.plates.map(item => item.id === plate.id ? { ...item, wells: { ...item.wells, [action.wellId]: action.conditionId ? { conditionId: action.conditionId, assignedAt: new Date().toISOString() } : null } } : item) });
  if (action.type === 'clear-plate') return commit(state, { ...document, plates: document.plates.map(item => item.id === plate.id ? { ...item, wells: Object.fromEntries(Object.keys(item.wells).map(well => [well, null])) as typeof item.wells } : item) });
  return commit(state, { ...document, plates: [...document.plates, { ...action.plate, wells: Object.fromEntries(Object.entries(action.plate.wells).map(([well, assignment]) => [well, assignment ? { ...assignment, assignedAt: new Date().toISOString() } : null])) as typeof action.plate.wells }] });
}
export function importDocument(text: string): { document?: PlateDocumentV1; error?: string } { try { const parsed: unknown = JSON.parse(text); const result = validatePlateDocument(parsed); return result.document ? { document: result.document } : { error: result.errors.map(error => `${error.path}: ${error.message}`).join(' ') }; } catch { return { error: 'Import must be valid JSON.' }; } }
export const exportDocument = (document: PlateDocumentV1) => `${JSON.stringify(document, null, 2)}\n`;
export function exportCsv(document: PlateDocumentV1): string { const quote = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; const conditions = new Map(document.conditions.map(condition => [condition.id, condition])); const rows = document.plates.flatMap(plate => Object.entries(plate.wells).map(([well, assignment]) => [plate.label, well, assignment ? conditions.get(assignment.conditionId)?.name ?? '' : '', assignment?.conditionId ?? ''].map(quote).join(','))); return `Plate,Well,Condition,Condition ID\r\n${rows.join('\r\n')}\r\n`; }
export function loadLocalState(storage: Storage): PlateState { try { const raw = storage.getItem(STORAGE_KEY); if (!raw) return createPlateState(); const candidate = JSON.parse(raw) as { document?: unknown; snapshots?: Snapshot[] }; const result = validatePlateDocument(candidate.document); return result.document ? { document: result.document, snapshots: Array.isArray(candidate.snapshots) ? candidate.snapshots.filter(snapshot => validatePlateDocument(snapshot.document).document) : [], past: [], future: [] } : createPlateState(); } catch { return createPlateState(); } }
export const persistLocalState = (storage: Storage, state: PlateState) => storage.setItem(STORAGE_KEY, JSON.stringify({ document: state.document, snapshots: state.snapshots }));
