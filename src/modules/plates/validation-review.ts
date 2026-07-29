import { validatePlateDocument } from './document';
import type { PlateDocumentV1, ValidationError } from './types';

export type PlateValidationReview = {
  errors: ValidationError[];
  summary: string;
};

/** Builds the editor review panel from the canonical document validator. */
export function reviewPlateDocument(document: PlateDocumentV1): PlateValidationReview {
  const { errors } = validatePlateDocument(document);
  return {
    errors,
    summary: errors.length ? `${errors.length} issue${errors.length === 1 ? ' needs' : 's need'} review before export or use.` : 'Ready for review. No validation issues found.',
  };
}
