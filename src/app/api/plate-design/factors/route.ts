import { NextResponse } from 'next/server';
import { runQuery } from '@/lib/db';
import type { PlateDesignSuggestionsResponse } from '@/lib/plateDesign';

type FactorRow = { experiment: string | null; media: string | null; strain: string | null; transformingDNA: string | null; sampleName: string | null };

// Keep the suggestion projection aligned with Mutation Explorer's deriveDonorDna.
const donorDna = (sampleName: string | null, transformingDNA: string | null) => {
  if (transformingDNA?.trim()) return transformingDNA.trim();
  const parts = sampleName?.split('.') ?? [];
  return parts.length >= 3 ? parts.slice(1, -1).filter(Boolean).join('+') : '';
};
// Mutation Explorer values are trimmed, then Python QA sorts their casefolded
// strings lexically. Do not locale-sort punctuation such as '.' and '_'.
const normalize = (value: string | null) => value?.trim() ?? '';
const values = (items: (string | null)[]) => [...new Set(items.map(normalize).filter(Boolean))].sort((a, b) => {
  const left = a.toLowerCase(), right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
});

/** Read-only suggestions from the mutation/barcode-derived sequencing population. */
export async function GET() {
  try {
    const rows = await runQuery<FactorRow>(`
      SELECT DISTINCT
        COALESCE(m.experiment, ss."Experiment") AS experiment,
        s."Condition" AS media,
        s."Strain_name" AS strain,
        s."Transforming_DNA" AS transformingDNA,
        ss."Sample_Name" AS sampleName
      FROM (
        SELECT "Seq_sample" AS seq_sample, MIN("Experiment") AS experiment
        FROM Mutations WHERE deleted = 0 GROUP BY "Seq_sample"
        UNION
        SELECT v."Seqsample", NULL
        FROM verAB_barcodes v WHERE v.deleted = 0 AND COALESCE(v."Count", 0) > 0
      ) m
      LEFT JOIN (
        -- Match the default mutation sample projection exactly: a re-sequenced
        -- sequencing sample may have several live Seq_samples rows, and its
        -- canonical WGS row determines the displayed donor DNA suggestion.
        SELECT "Sequencing_sample", "Experiment", "Sample_Name"
        FROM (
          SELECT
            sq."Sequencing_sample",
            sq."Experiment",
            sq."Sample_Name",
            ROW_NUMBER() OVER (
              PARTITION BY sq."Sequencing_sample"
              ORDER BY CASE WHEN so."Type" LIKE 'WGS%' THEN 0 ELSE 1 END, sq."Seqorder"
            ) AS rn
          FROM Seq_samples sq
          LEFT JOIN Seq_orders so
            ON so."Poplar_Seqorder_Name" = sq."Seqorder" AND so.deleted = 0
          WHERE sq.deleted = 0
        )
        WHERE rn = 1
      ) ss ON ss."Sequencing_sample" = m.seq_sample
      LEFT JOIN Samples s ON s."Name" = ss."Sample_Name" AND s.deleted = 0
    `);
    const experiment = values(rows.map(row => row.experiment));
    const response: PlateDesignSuggestionsResponse = {
      experiments: experiment,
      factors: { experiment, media: values(rows.map(row => row.media)), strain: values(rows.map(row => row.strain)), transformingDNA: values(rows.map(row => donorDna(row.sampleName, row.transformingDNA))) },
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load plate design suggestions.' }, { status: 500 });
  }
}
