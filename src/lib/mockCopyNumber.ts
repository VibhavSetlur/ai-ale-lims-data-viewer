// Mock DGA copy-number matrix used by the heat-map view. Modeled after the
// TFMN1 bioRxiv heat-map figure Nidhi referenced in the 2026-06-03 meeting:
// rows = samples (strain × replicate × transfer), columns = alleles, value =
// copy count (with `null` for not-sequenced cells). The API in
// /api/copy-number will prefer real data and only fall back to this.

export interface MockCopyNumberSample {
  id: string;            // sample identifier (e.g. TFMN3.DGOA.1.T6)
  experiment: string;
  strain: string;
  condition: string;
  replicate: number;
  transfer: number;
  // copy number per allele; null = not sequenced for this sample
  copies: Record<string, number | null>;
  // optional: whether the construct integrated into the chromosome
  integrated: boolean | null;
}

// Allele list matches Nidhi's TFMN3/TFMN4 DGOA study (five mutation combinations).
export const MOCK_ALLELES = [
  'dgoA_wt',
  'dgoA_A153T',
  'dgoA_R211H',
  'dgoA_K77R',
  'dgoA_F38L',
];

function row(
  experiment: string, strain: string, replicate: number, transfer: number,
  copies: (number | null)[],
  condition = 'Methoxybenzoate 4 mM + Kan',
  integrated: boolean | null = true,
): MockCopyNumberSample {
  const obj: Record<string, number | null> = {};
  MOCK_ALLELES.forEach((a, i) => { obj[a] = copies[i] ?? null; });
  return {
    id: `${experiment}.${strain}.r${replicate}.T${transfer}`,
    experiment, strain, condition, replicate, transfer,
    copies: obj, integrated,
  };
}

// Pattern: copies tend to rise then plateau or selectively expand a single allele
// over transfers — same shape Nidhi described qualitatively.
export const MOCK_COPY_NUMBER: MockCopyNumberSample[] = [
  // TFMN3 replicate 1
  row('TFMN3', 'ACN3787', 1, 0,  [1, 1, 1, 1, 1]),
  row('TFMN3', 'ACN3787', 1, 3,  [1, 2, 1, 1, 1]),
  row('TFMN3', 'ACN3787', 1, 6,  [1, 4, 1, 1, 2]),
  row('TFMN3', 'ACN3787', 1, 13, [1, 8, 1, 1, 2]),
  // TFMN3 replicate 2
  row('TFMN3', 'ACN3787', 2, 0,  [1, 1, 1, 1, 1]),
  row('TFMN3', 'ACN3787', 2, 3,  [1, 1, 2, 1, 1]),
  row('TFMN3', 'ACN3787', 2, 6,  [1, 1, 4, 2, 1]),
  row('TFMN3', 'ACN3787', 2, 13, [1, 1, 7, 3, 1]),
  // TFMN3 replicate 3 — not sequenced past T6
  row('TFMN3', 'ACN3787', 3, 0,  [1, 1, 1, 1, 1]),
  row('TFMN3', 'ACN3787', 3, 3,  [1, 1, 1, 2, 1]),
  row('TFMN3', 'ACN3787', 3, 6,  [1, 1, 1, 3, 1]),
  row('TFMN3', 'ACN3787', 3, 13, [null, null, null, null, null]),
  // TFMN3 replicate 4 — construct never integrated
  row('TFMN3', 'ACN3787', 4, 0,  [1, 0, 0, 0, 0], 'Methoxybenzoate 4 mM + Kan', false),
  row('TFMN3', 'ACN3787', 4, 3,  [1, 0, 0, 0, 0], 'Methoxybenzoate 4 mM + Kan', false),
  // TFMN4 replicate 1
  row('TFMN4', 'ACN3788', 1, 0,  [1, 1, 1, 1, 1]),
  row('TFMN4', 'ACN3788', 1, 3,  [1, 2, 1, 1, 1]),
  row('TFMN4', 'ACN3788', 1, 6,  [1, 5, 1, 1, 2]),
  row('TFMN4', 'ACN3788', 1, 13, [1, 12, 1, 1, 3]),
  // TFMN4 replicate 2
  row('TFMN4', 'ACN3788', 2, 0,  [1, 1, 1, 1, 1]),
  row('TFMN4', 'ACN3788', 2, 3,  [1, 1, 1, 2, 1]),
  row('TFMN4', 'ACN3788', 2, 6,  [1, 1, 2, 4, 1]),
  row('TFMN4', 'ACN3788', 2, 13, [1, 1, 3, 9, 2]),
  // TFMN4 replicate 3 — high copy outlier (matches Paul's high-DGA isolate work)
  row('TFMN4', 'ACN3788', 3, 0,  [1, 1, 1, 1, 1]),
  row('TFMN4', 'ACN3788', 3, 3,  [1, 3, 1, 1, 1]),
  row('TFMN4', 'ACN3788', 3, 6,  [1, 9, 1, 1, 2]),
  row('TFMN4', 'ACN3788', 3, 13, [1, 18, 1, 1, 4]),
];
