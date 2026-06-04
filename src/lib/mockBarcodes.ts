// Mock barcode-count data shaped exactly like the SeqCenter 2026-05-26 figure
// set (QUO1022807 exp2). Each entry mirrors one of Natasha's stacked-bar
// charts: per (well, strain, library, replicate), counts of each VarA-VarB
// candidate observed at each transfer. The viewer labels these clearly as
// MOCK so researchers know not to trust the numbers.
//
// Replace this with real rows from the LIMS Mutations table once Natasha
// adds the construct/library column discussed in the 2026-06-03 meeting —
// the API in /api/barcode-counts will prefer real data automatically.

export interface MockBarcodeChart {
  well: string;
  strain: string;
  library: string;
  replicate: number;
  experiment: string;
  transfers: number[];
  // Per-candidate counts, indexed in same order as transfers.
  candidates: Record<string, number[]>;
}

// Helper: deterministic distribution of `total` across `n` candidates,
// front-loaded so the first candidates dominate (matches stacked-bar look).
function dist(total: number, n: number, dominantWeight = 0.5): number[] {
  if (n === 0 || total === 0) return Array(n).fill(0);
  const out: number[] = [];
  let remaining = total;
  let dominant = Math.round(total * dominantWeight);
  if (dominant >= total) dominant = Math.max(1, total - (n - 1));
  out.push(dominant);
  remaining -= dominant;
  for (let i = 1; i < n; i++) {
    const share = i === n - 1 ? remaining : Math.max(0, Math.round(remaining / (n - i + 1)));
    out.push(share);
    remaining -= share;
  }
  return out;
}

// Build a candidate -> [counts per transfer] map given per-transfer totals
// and an ordered candidate list. Dominant candidate rotates so different
// transfers can have different winners (matches the qualitative "consolidation
// over transfer time" we see in the real data).
function buildCandidates(
  cands: string[],
  totalsPerTransfer: number[],
  dominantIdxPerTransfer?: number[]
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const c of cands) out[c] = Array(totalsPerTransfer.length).fill(0);
  totalsPerTransfer.forEach((total, ti) => {
    const dominantIdx = dominantIdxPerTransfer?.[ti] ?? 0;
    const order = [...cands];
    if (dominantIdx > 0 && dominantIdx < order.length) {
      const [dom] = order.splice(dominantIdx, 1);
      order.unshift(dom);
    }
    const counts = dist(total, order.length);
    order.forEach((c, ci) => { out[c][ti] = counts[ci]; });
  });
  return out;
}

export const MOCK_BARCODES: MockBarcodeChart[] = [
  {
    well: 'B3', strain: 'ACN3788', library: 'concX_largeLib_EcorI', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3],
    candidates: buildCandidates(['A78-B3', 'A83-B151'], [40], [1]),
  },
  {
    well: 'B8', strain: 'ACN3788', library: 'concX_largeLib_PCR_DpnI_cleanup', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A145-B151', 'A153-B151', 'A153-B168', 'A155-B151'],
      [13, 245],
      [1, 1],
    ),
  },
  {
    well: 'D8', strain: 'ACN3788', library: 'concX_largeLib_PCR_DpnI_cleanup', replicate: 3,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(['A78-B117'], [1, 24]),
  },
  {
    well: 'B4', strain: 'ACN3788', library: 'concX_largeLib_SpeI', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A138-B79','A143-B84','A152-B110','A152-B151','A153-B30','A153-B6','A176-B120',
       'A186-B78','A186-B79','A196-B117','A196-B122','A196-B123','A196-B150','A196-B151',
       'A196-B171','A196-B2','A196-B27','A196-B30','A196-B59','A196-B8','A196-B87',
       'A20-B126','A20-B60','A63-B117','A63-B145','A63-B147','A63-B151','A63-B75',
       'A78-B103','A78-B137','A78-B150','A78-B151','A78-B171','A78-B70','A78-B77','A78-B84',
       'A79-B77','A81-B132','A81-B137','A81-B140','A81-B171','A81-B18','A81-B27','A81-B3',
       'A81-B40','A81-B51','A81-B75','A81-B8','A81-B84','A83-B50','A90-B120','A90-B151',
       'A90-B155','A90-B59','A96-B47','A96-B79','A96-B87'],
      [190, 117, 191, 199],
      [0, 0, 13, 13], // A196-B150 (idx 12/13) dominates later transfers
    ),
  },
  {
    well: 'C4', strain: 'ACN3788', library: 'concX_largeLib_SpeI', replicate: 2,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A113-B174','A143-B123','A143-B6','A153-B101','A153-B151','A153-B27','A153-B30','A153-B84',
       'A169-B27','A176-B154','A193-B11','A196-B11','A196-B123','A196-B132','A196-B139','A196-B15',
       'A196-B18','A196-B6','A20-B66','A20-B71','A38-B128','A78-B101','A78-B137','A78-B26',
       'A78-B75','A78-B84','A81-B100','A81-B127','A81-B132','A81-B174','A81-B40','A81-B41',
       'A81-B66','A81-B75','A83-B101','A83-B103','A83-B137','A83-B151','A83-B84','A84-B174',
       'A89-B174','A89-B27','A90-B103','A90-B154','A90-B3','A90-B70','A90-B75','A96-B140',
       'A96-B87','A97-B174'],
      [135, 205, 228, 240],
      [0, 0, 29, 29],
    ),
  },
  {
    well: 'D4', strain: 'ACN3788', library: 'concX_largeLib_SpeI', replicate: 3,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A20-B151','A28-B151','A32-B151','A63-B18','A78-B26','A81-B151','A82-B108','A83-B151','A90-B108','A96-B77'],
      [210, 260, 220, 270],
      [0, 0, 0, 0],
    ),
  },
  {
    well: 'E4', strain: 'ACN3788', library: 'concX_largeLib_SpeI', replicate: 4,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A143-B6','A153-B151','A153-B30','A159-B49','A176-B151','A196-B119','A196-B145','A196-B151',
       'A196-B34','A20-B103','A20-B151','A20-B70','A20-B84','A63-B151','A63-B79','A78-B171','A78-B2',
       'A78-B26','A78-B3','A78-B42','A78-B51','A81-B120','A81-B143','A81-B151','A81-B156','A81-B174',
       'A81-B177','A81-B30','A81-B51','A81-B65','A81-B75','A81-B84','A83-B120','A83-B151','A83-B40',
       'A90-B171','A90-B75','A96-B132','A97-B155'],
      [140, 210, 180, 215],
      [0, 0, 1, 23],
    ),
  },
  {
    well: 'F4', strain: 'ACN3788', library: 'concX_largeLib_SpeI', replicate: 5,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A153-B171','A153-B30','A153-B77','A176-B34','A185-B30','A186-B151','A186-B74','A186-B75',
       'A196-B117','A196-B2','A196-B6','A66-B30','A78-B2','A78-B30','A78-B59','A78-B75','A78-B77',
       'A78-B79','A81-B145','A81-B171','A81-B30','A81-B42','A81-B59','A81-B65','A83-B151','A83-B26',
       'A83-B42','A90-B120','A90-B150','A90-B61','A90-B99','A96-B84'],
      [175, 185, 145, 230],
      [0, 0, 31, 31],
    ),
  },
  {
    well: 'B5', strain: 'ACN3788', library: 'concX_largeLib_SpeI_cleanup', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A143-B117','A143-B151','A152-B102','A153-B127','A153-B26','A153-B77','A159-B128','A16-B154',
       'A160-B27','A176-B120','A176-B27','A186-B126','A186-B2','A186-B78','A186-B79','A20-B144',
       'A20-B157','A20-B165','A20-B75','A63-B171','A65-B161','A78-B117','A78-B122','A78-B158',
       'A78-B18','A78-B30','A78-B79','A81-B103','A81-B123','A81-B140','A81-B177','A81-B26','A81-B47',
       'A81-B51','A83-B101','A83-B40','A83-B50','A90-B123','A90-B136','A90-B70','A91-B101'],
      [120, 240, 210, 185],
      [0, 21, 21, 26],
    ),
  },
  {
    well: 'C5', strain: 'ACN3788', library: 'concX_largeLib_SpeI_cleanup', replicate: 2,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A106-B87','A159-B133','A162-B137','A63-B2','A78-B159','A78-B26','A78-B3','A81-B103','A81-B140',
       'A81-B3','A81-B47','A81-B87','A83-B30','A90-B136','A90-B6','A90-B87'],
      [62, 175],
    ),
  },
  {
    well: 'D5', strain: 'ACN3788', library: 'concX_largeLib_SpeI_cleanup', replicate: 3,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A143-B84','A153-B30','A176-B30','A186-B165','A78-B117','A81-B140','A81-B30','A81-B38',
       'A81-B41','A81-B6','A83-B50','A90-B102','A90-B123','A90-B3','A90-B47','A90-B59','A90-B75','A97-B6'],
      [155, 175, 215, 150],
      [0, 9, 9, 12], // A81-B6 / A90-B123 dominant later
    ),
  },
  {
    well: 'E5', strain: 'ACN3788', library: 'concX_largeLib_SpeI_cleanup', replicate: 4,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A143-B30','A153-B168','A153-B30','A162-B171','A63-B151','A78-B165','A78-B26','A78-B3',
       'A81-B3','A81-B30','A81-B75','A81-B84','A83-B138','A90-B41'],
      [90, 170],
      [0, 0],
    ),
  },
  {
    well: 'F5', strain: 'ACN3788', library: 'concX_largeLib_SpeI_cleanup', replicate: 5,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A195-B117','A63-B155','A78-B103','A78-B159','A81-B144','A81-B15','A81-B30','A81-B79',
       'A90-B155','A90-B157','A96-B57'],
      [125, 175],
      [6, 6],
    ),
  },
  {
    well: 'G10', strain: 'ACN3788', library: 'concX_pBAC2264_BglI', replicate: 2,
    experiment: 'TFMN4.exp2',
    transfers: [13],
    candidates: buildCandidates(
      ['A152-B32','A176-B30','A176-B6','A196-B12','A196-B132','A196-B4'],
      [167],
      [2],
    ),
  },
  {
    well: 'B10', strain: 'ACN3788', library: 'concX_smallLib_PCR_DpnI_cleanup', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(['A78-B155', 'A78-B3'], [28, 195]),
  },
  {
    well: 'C10', strain: 'ACN3788', library: 'concX_smallLib_PCR_DpnI_cleanup', replicate: 2,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(['A145-B30', 'A81-B18', 'A81-B30'], [160, 196], [2, 2]),
  },
  {
    well: 'D10', strain: 'ACN3788', library: 'concX_smallLib_PCR_DpnI_cleanup', replicate: 3,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A152-B154','A153-B137','A153-B55','A153-B77','A16-B161','A162-B137','A176-B177','A185-B26',
       'A196-B168','A20-B95','A63-B40','A78-B3','A78-B47','A81-B101','A81-B165','A81-B51','A81-B61',
       'A83-B104','A83-B151','A83-B70','A90-B150','A90-B2','A96-B26','A96-B3','A96-B87'],
      [100, 220, 125, 188],
      [0, 10, 16, 15],
    ),
  },
  {
    well: 'E10', strain: 'ACN3788', library: 'concX_smallLib_PCR_DpnI_cleanup', replicate: 4,
    experiment: 'TFMN4.exp2',
    transfers: [3],
    candidates: buildCandidates(['A159-B49', 'A78-B117', 'A81-B101'], [15]),
  },
  {
    well: 'B9', strain: 'ACN3788', library: 'concY_largeLib_PCR_DpnI_cleanup', replicate: 1,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A153-B130','A153-B145','A176-B117','A186-B144','A20-B2','A20-B3','A63-B150','A63-B171',
       'A78-B145','A78-B81'],
      [22, 190],
      [0, 8],
    ),
  },
  {
    well: 'C9', strain: 'ACN3788', library: 'concY_largeLib_PCR_DpnI_cleanup', replicate: 2,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A143-B13','A143-B137','A152-B47','A153-B26','A16-B117','A16-B140','A16-B145','A176-B103',
       'A176-B138','A186-B117','A186-B145','A186-B62','A186-B63','A186-B70','A186-B84','A196-B119',
       'A196-B15','A196-B151','A196-B38','A196-B40','A196-B46','A196-B52','A196-B84','A20-B126',
       'A20-B13','A20-B6','A20-B84','A63-B103','A63-B117','A63-B75','A63-B79','A78-B101','A78-B130',
       'A78-B75','A81-B130','A81-B145','A81-B2','A81-B84','A81-B87','A83-B40','A90-B155','A90-B18',
       'A90-B26','A90-B3','A90-B38','A90-B52','A90-B59','A96-B79'],
      [130, 195, 220, 215],
      [0, 0, 0, 3],
    ),
  },
  {
    well: 'D9', strain: 'ACN3788', library: 'concY_largeLib_PCR_DpnI_cleanup', replicate: 3,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A12-B60','A143-B117','A15-B117','A152-B151','A152-B27','A153-B6','A159-B69','A16-B117',
       'A16-B137','A16-B154','A16-B3','A16-B4','A16-B65','A16-B79','A176-B18','A176-B59','A186-B13',
       'A186-B147','A186-B26','A186-B3','A196-B123','A196-B136','A196-B15','A196-B152','A196-B164',
       'A196-B171','A196-B2','A196-B27','A196-B4','A196-B51','A196-B52','A196-B55','A196-B75',
       'A196-B79','A196-B87','A196-B93','A20-B101','A20-B34','A20-B69','A20-B71','A21-B6','A63-B122',
       'A63-B147','A63-B6','A63-B75','A78-B137','A78-B159','A78-B3','A78-B40','A78-B47','A81-B11',
       'A81-B117','A81-B132','A81-B137','A81-B165','A81-B174','A81-B6','A81-B91','A83-B134',
       'A83-B137','A83-B138','A83-B50','A83-B6','A83-B84','A90-B117','A90-B18','A90-B6','A96-B12',
       'A96-B132','A96-B26','A96-B27','A96-B75','A96-B87'],
      [160, 185, 210, 160],
      [0, 0, 0, 13],
    ),
  },
  {
    well: 'E9', strain: 'ACN3788', library: 'concY_largeLib_PCR_DpnI_cleanup', replicate: 4,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4, 6, 13],
    candidates: buildCandidates(
      ['A143-B130','A152-B15','A152-B151','A152-B154','A152-B171','A152-B2','A152-B32','A152-B9',
       'A153-B101','A153-B117','A153-B165','A153-B6','A16-B101','A16-B117','A16-B12','A16-B51',
       'A16-B75','A176-B101','A176-B103','A176-B30','A176-B6','A186-B137','A196-B103','A196-B117',
       'A196-B136','A196-B147','A196-B150','A196-B165','A196-B171','A196-B174','A196-B4','A196-B52',
       'A196-B6','A196-B65','A196-B70','A196-B75','A196-B79','A196-B85','A196-B9','A196-B98',
       'A63-B117','A63-B18','A63-B2','A63-B26','A78-B101','A78-B117','A78-B143','A78-B144',
       'A78-B155','A78-B18','A78-B70','A81-B117','A81-B12','A81-B18','A81-B30','A81-B42','A81-B70',
       'A81-B87','A83-B101','A83-B130','A83-B18','A90-B11','A90-B123','A96-B101','A96-B6','A96-B75','A96-B79'],
      [150, 265, 175, 245],
      [0, 4, 4, 4],
    ),
  },
  {
    well: 'F9', strain: 'ACN3788', library: 'concY_largeLib_PCR_DpnI_cleanup', replicate: 5,
    experiment: 'TFMN4.exp2',
    transfers: [3, 4],
    candidates: buildCandidates(
      ['A145-B40','A153-B40','A153-B8','A155-B40','A176-B8','A25-B40','A81-B26'],
      [40, 138],
      [3, 3],
    ),
  },
  {
    well: 'G8', strain: 'ACN3788', library: 'concY_smallLib_PCR_DpnI_cleanup', replicate: 4,
    experiment: 'TFMN4.exp2',
    transfers: [3],
    candidates: { 'A63-B102': [4] },
  },
];

// Stable color per unique VarA and per unique VarB so the optional split-bar
// rendering (Nidhi's ask) keeps colors consistent across samples.
export function parseCandidate(label: string): { a: string; b: string } | null {
  const m = label.match(/^(A\d+)-(B\d+)$/);
  if (!m) return null;
  return { a: m[1], b: m[2] };
}
