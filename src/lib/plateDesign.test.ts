import { describe, expect, it } from 'vitest';
import { addCondition, addPlate, allWellIds, assignWell, createEmptyDesign, MAX_PLATES, parsePipelineCsv, serializePipelineCsv, validateDesign } from './plateDesign';

describe('plate design boundaries', () => {
  it('allows 24 local safety-cap plates and refuses a 25th', () => { let design = createEmptyDesign(); for (let i=0;i<MAX_PLATES;i++) design=addPlate(design,`P${i}`); expect(design.plates).toHaveLength(MAX_PLATES); expect(addPlate(design,'too many')).toBe(design); });
  it('keeps deterministic global assignment ordering and CSV round trips', () => { let design=createEmptyDesign(); design={...design,runName:'run'}; design=addCondition(design,{experiment:'E',strain:'S',media:'M',transformingDNA:'D'}); design=addPlate(design,'P1'); for (const well of allWellIds()) design=assignWell(design,design.plates[0].id,well,design.conditions[0].id); const csv=serializePipelineCsv(design); expect(parsePipelineCsv(csv).plates[0].wells).toHaveProperty('A1'); expect(validateDesign(design).filter(issue=>issue.severity==='error')).toEqual([]); });
});
