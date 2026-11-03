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
const hasTable = async (name: string) => (await runQuery<{ present: number }>("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [name])).length > 0;

/** Read-only suggestions from the sequencing population plus registered sample and experiment populations. */
export async function GET() {
  try {
    const sequencingRows = await runQuery<FactorRow>(`
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
    const hasRoboticAleSamples = await hasTable('Robotic_ALE_samples');
    const registrationRows = await runQuery<FactorRow>(`
      SELECT s."Experiment" AS experiment, s."Condition" AS media, s."Strain_name" AS strain,
             s."Transforming_DNA" AS transformingDNA, s."Name" AS sampleName
      FROM Samples s WHERE s.deleted = 0
      ${hasRoboticAleSamples ? `UNION
      SELECT r."Experiment", r."Condition", r."Strain_name", r."Transforming_DNA", r."Name"
      FROM Robotic_ALE_samples r WHERE r.deleted = 0` : ''}
    `);
    const experimentRows = await hasTable('Experiments')
      ? await runQuery<Pick<FactorRow, 'experiment'>>('SELECT "Name" AS experiment FROM Experiments WHERE deleted = 0')
      : [];
    const seqSampleExperimentRows = await hasTable('Seq_samples')
      ? await runQuery<Pick<FactorRow, 'experiment'>>('SELECT DISTINCT "Experiment" AS experiment FROM Seq_samples WHERE deleted = 0')
      : [];
    const strainRows = await hasTable('Strains')
      ? await runQuery<Pick<FactorRow, 'strain'>>('SELECT "Name" AS strain FROM Strains WHERE deleted = 0')
      : [];
    const mediaRows = await hasTable('Conditions')
      ? await runQuery<Pick<FactorRow, 'media'>>('SELECT "Name" AS media FROM Conditions WHERE deleted = 0')
      : [];
    const transformingDnaRows = await hasTable('DNA_constructs')
      ? await runQuery<Pick<FactorRow, 'transformingDNA'>>('SELECT "Name" AS transformingDNA FROM DNA_constructs WHERE deleted = 0')
      : [];
    const rows = [...sequencingRows, ...registrationRows];
    const experiment = values([...rows.map(row => row.experiment), ...experimentRows.map(row => row.experiment), ...seqSampleExperimentRows.map(row => row.experiment)]);
    const response: PlateDesignSuggestionsResponse = {
      experiments: experiment,
      factors: {
        experiment,
        media: values([...rows.map(row => row.media), ...mediaRows.map(row => row.media)]),
        strain: values([...rows.map(row => row.strain), ...strainRows.map(row => row.strain)]),
        transformingDNA: values([...rows.map(row => donorDna(row.sampleName, row.transformingDNA)), ...transformingDnaRows.map(row => row.transformingDNA)]),
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load plate design suggestions.' }, { status: 500 });
  }
}
