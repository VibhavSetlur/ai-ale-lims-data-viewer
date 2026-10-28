import { NextResponse } from 'next/server';
import { getDbType, getTableSchema, runQuery } from '@/lib/db';

const q = (name: string) => getDbType() === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
async function tableExists(name: string) {
  try {
    const sql = getDbType() === 'sqlite'
      ? "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?"
      : 'SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
    return Number((await runQuery<{ n: number }>(sql, [name]))[0]?.n ?? 0) > 0;
  } catch { return false; }
}

export async function GET() {
  try {
    if (!await tableExists('dgoA_lib_variants') || !await tableExists('dgoA_alleles')) {
      return NextResponse.json({ variants: [], measurements: [], warnings: ['dgoA allele measurement tables are unavailable in this snapshot.'], source: { available: false } });
    }
    const [measurementSchema, alleleSchema] = await Promise.all([getTableSchema('dgoA_lib_variants'), getTableSchema('dgoA_alleles')]);
    const measurementColumns = new Set(measurementSchema.map(column => column.name));
    const alleleColumns = new Set(alleleSchema.map(column => column.name));
    const measurementNeed = ['Seqsample', 'Seqorder', 'Transformation_library', 'Count', 'DNAseq'];
    const alleleNeed = ['Allele_DNA_index', 'Allele_AA_index', 'DNAseq'];
    if (!measurementNeed.every(column => measurementColumns.has(column)) || !alleleNeed.every(column => alleleColumns.has(column))) {
      return NextResponse.json({ variants: [], measurements: [], warnings: ['dgoA tables do not have the required measurement identity or sequence keys.'], source: { available: false } });
    }
    const alleleLabel = alleleColumns.has('Allele_number') ? q('Allele_number') : q('Allele_DNA_index');
    const aaLabel = alleleColumns.has('AA_changes') ? q('AA_changes') : q('Allele_AA_index');
    const rows = await runQuery<Record<string, unknown>>(`
      SELECT v.${q('Seqsample')} AS sampleId,
             a.${q('Allele_DNA_index')} AS dnaId,
             a.${q('Allele_AA_index')} AS aaId,
             a.${alleleLabel} AS dnaLabel,
             a.${aaLabel} AS aaLabel,
             a.${q('DNAseq')} AS dnaSequence,
             a.${q('AAseq')} AS aaSequence,
             SUM(v.${q('Count')}) AS count
      FROM ${q('dgoA_lib_variants')} v
      JOIN ${q('dgoA_alleles')} a ON a.${q('DNAseq')} = v.${q('DNAseq')} AND COALESCE(a.${q('deleted')}, 0) = 0
      WHERE COALESCE(v.${q('deleted')}, 0) = 0 AND COALESCE(v.${q('Count')}, 0) > 0
      GROUP BY v.${q('Seqsample')}, v.${q('Seqorder')}, v.${q('Transformation_library')},
               a.${q('Allele_DNA_index')}, a.${q('Allele_AA_index')}, a.${alleleLabel}, a.${aaLabel}, a.${q('DNAseq')}, a.${q('AAseq')}`);
    const variantsById = new Map<string, { id: string; dnaId: string; aaId: string; dnaLabel: string; aaLabel: string; dnaSequence?: string; aaSequence?: string }>();
    const measurements = rows.map(row => {
      const dnaId = String(row.dnaId); const aaId = String(row.aaId ?? dnaId);
      variantsById.set(dnaId, { id: dnaId, dnaId, aaId, dnaLabel: String(row.dnaLabel ?? dnaId), aaLabel: String(row.aaLabel || aaId), dnaSequence: typeof row.dnaSequence === 'string' ? row.dnaSequence : undefined, aaSequence: typeof row.aaSequence === 'string' ? row.aaSequence : undefined });
      return { sampleId: String(row.sampleId), alleleDnaIndex: dnaId, alleleAaIndex: aaId, count: Number(row.count) };
    });
    return NextResponse.json({ variants: [...variantsById.values()], measurements, warnings: [], source: { available: true, identity: 'Seqsample + Seqorder + Transformation_library' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
