import { NextResponse } from 'next/server';
import { getDbType, getTableSchema, runQuery } from '@/lib/db';

export interface LibraryVariant {
  variantId: string;
  gene?: string;
  library?: string;
  position?: string | number;
  label: string;
  aiGenerated: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

export interface LibraryVariantMeasurement {
  sampleId: string;
  seqsample: string;
  variantId: string;
  abundance: number;
  count: number;
  transfer?: number;
}

export interface LibraryVariantDataset {
  variants: LibraryVariant[];
  measurements: LibraryVariantMeasurement[];
  warnings: string[];
  source: {
    driver: 'sqlite' | 'mysql';
    barcodeTable: 'verAB_barcodes';
    metadataTable?: 'Library_candidates';
    countColumn: 'Count';
    abundance: 'per-sample count fraction';
  };
}

interface VerABVariantRow {
  Seqsample: string;
  Sample_Name: string | null;
  Transformation_library: string | null;
  verA: string | null;
  verB: string | null;
  Candidate: string;
  Count: number;
}

type MetadataRow = Record<string, string | number | boolean | null>;

const SYSTEM_METADATA_COLUMNS = new Set(['deleted', 'last_synced', 'row_hash', 'Sequence']);

function quoteIdent(name: string): string {
  return getDbType() === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    if (getDbType() === 'sqlite') {
      const rows = await runQuery<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [name],
      );
      return rows.length > 0;
    }
    const rows = await runQuery<{ c: number }>(
      'SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [name],
    );
    return Number(rows[0]?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
  }
  return false;
}

function parseTransfer(seqsample: string): number | undefined {
  const match = seqsample.match(/\.T(\d+)(?=\.|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseCandidate(candidate: string): { verA?: string; verB?: string } {
  const match = candidate.match(/^(A\d+)-(B\d+)$/i);
  return match ? { verA: match[1].toUpperCase(), verB: match[2].toUpperCase() } : {};
}

function metadataKey(library: string | null | undefined, alias: string | null | undefined): string | null {
  if (!alias) return null;
  return `${library ?? ''}|${alias}`;
}

function compactMetadata(row: MetadataRow): MetadataRow {
  const out: MetadataRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_METADATA_COLUMNS.has(key)) continue;
    if (value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

async function loadMetadata(warnings: string[]): Promise<Map<string, MetadataRow>> {
  const metadata = new Map<string, MetadataRow>();
  if (!(await tableExists('Library_candidates'))) {
    warnings.push('Library_candidates table is unavailable; variants are shown without candidate metadata.');
    return metadata;
  }

  const schema = await getTableSchema('Library_candidates');
  const columns = new Set(schema.map(col => col.name));
  const aliasColumn = columns.has('Feature_alias') ? 'Feature_alias' : null;
  const libraryColumn = columns.has('Library') ? 'Library' : null;
  const aiColumn = columns.has('AI-generated') ? 'AI-generated' : (columns.has('AI_generated') ? 'AI_generated' : null);
  if (!aliasColumn) {
    warnings.push('Library_candidates has no Feature_alias column; variants are shown without candidate metadata.');
    return metadata;
  }
  if (!aiColumn) warnings.push('Library_candidates has no AI-generated or AI_generated column; AI status defaults to false.');

  const selectedColumns = schema.map(col => col.name).filter(name => name !== 'Sequence');
  const sql = `SELECT ${selectedColumns.map(quoteIdent).join(', ')} FROM ${quoteIdent('Library_candidates')} WHERE ${columns.has('deleted') ? `${quoteIdent('deleted')} = 0` : '1 = 1'}`;
  const rows = await runQuery<MetadataRow>(sql);
  for (const row of rows) {
    const key = metadataKey(libraryColumn ? String(row[libraryColumn] ?? '') : '', String(row[aliasColumn] ?? ''));
    if (!key) continue;
    metadata.set(key, {
      ...row,
      aiGenerated: aiColumn ? normalizeBool(row[aiColumn]) : false,
    });
  }
  return metadata;
}

export async function GET() {
  const warnings: string[] = [];
  try {
    if (!(await tableExists('verAB_barcodes'))) {
      warnings.push('verAB_barcodes table is unavailable; no library variant measurements can be shown.');
      return NextResponse.json<LibraryVariantDataset>({
        variants: [],
        measurements: [],
        warnings,
        source: {
          driver: getDbType(),
          barcodeTable: 'verAB_barcodes',
          countColumn: 'Count',
          abundance: 'per-sample count fraction',
        },
      });
    }

    const rows = await runQuery<VerABVariantRow>(
      `SELECT vb.${quoteIdent('Seqsample')} AS Seqsample,
              ss.${quoteIdent('Sample_Name')} AS Sample_Name,
              vb.${quoteIdent('Transformation_library')} AS Transformation_library,
              vb.${quoteIdent('verA')} AS verA,
              vb.${quoteIdent('verB')} AS verB,
              vb.${quoteIdent('Candidate')} AS Candidate,
              vb.${quoteIdent('Count')} AS Count
       FROM ${quoteIdent('verAB_barcodes')} vb
       LEFT JOIN ${quoteIdent('Seq_samples')} ss
         ON ss.${quoteIdent('Sequencing_sample')} = vb.${quoteIdent('Seqsample')}
        AND COALESCE(ss.${quoteIdent('deleted')}, 0) = 0
       WHERE COALESCE(vb.${quoteIdent('deleted')}, 0) = 0
         AND vb.${quoteIdent('Count')} > 0`,
    );

    const metadata = await loadMetadata(warnings);
    const totalsBySeqsample = new Map<string, number>();
    for (const row of rows) {
      totalsBySeqsample.set(row.Seqsample, (totalsBySeqsample.get(row.Seqsample) ?? 0) + Number(row.Count || 0));
    }

    const variants = new Map<string, LibraryVariant>();
    const measurements: LibraryVariantMeasurement[] = [];
    for (const row of rows) {
      const count = Number(row.Count || 0);
      const total = totalsBySeqsample.get(row.Seqsample) ?? 0;
      if (!row.Candidate || count <= 0 || total <= 0) continue;
      const sampleId = row.Seqsample;
      const library = row.Transformation_library ?? undefined;
      const { verA, verB } = parseCandidate(row.Candidate);
      const aMeta = metadata.get(metadataKey(row.Transformation_library, row.verA || verA) ?? '');
      const bMeta = metadata.get(metadataKey(row.Transformation_library, row.verB || verB) ?? '');
      const aiGenerated = normalizeBool(aMeta?.aiGenerated) || normalizeBool(bMeta?.aiGenerated);
      if (!variants.has(row.Candidate)) {
        variants.set(row.Candidate, {
          variantId: row.Candidate,
          gene: [aMeta?.Feature_name, bMeta?.Feature_name].filter(Boolean).join(' + ') || undefined,
          library,
          position: [row.verA || verA, row.verB || verB].filter(Boolean).join(' / ') || undefined,
          label: row.Candidate,
          aiGenerated,
          metadata: {
            Candidate: row.Candidate,
            Library: row.Transformation_library,
            verA: row.verA || verA || null,
            verB: row.verB || verB || null,
            verA_name: (aMeta?.Feature_name ?? null) as string | null,
            verB_name: (bMeta?.Feature_name ?? null) as string | null,
            verA_type: (aMeta?.Feature_type ?? null) as string | null,
            verB_type: (bMeta?.Feature_type ?? null) as string | null,
            'AI-generated': aiGenerated,
            verA_metadata: aMeta ? JSON.stringify(compactMetadata(aMeta)) : null,
            verB_metadata: bMeta ? JSON.stringify(compactMetadata(bMeta)) : null,
          },
        });
      } else if (aiGenerated) {
        variants.get(row.Candidate)!.aiGenerated = true;
        variants.get(row.Candidate)!.metadata['AI-generated'] = true;
      }
      measurements.push({
        sampleId,
        seqsample: row.Seqsample,
        variantId: row.Candidate,
        abundance: count / total,
        count,
        transfer: parseTransfer(row.Seqsample),
      });
    }

    return NextResponse.json<LibraryVariantDataset>({
      variants: Array.from(variants.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
      measurements,
      warnings,
      source: {
        driver: getDbType(),
        barcodeTable: 'verAB_barcodes',
        metadataTable: metadata.size > 0 ? 'Library_candidates' : undefined,
        countColumn: 'Count',
        abundance: 'per-sample count fraction',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
