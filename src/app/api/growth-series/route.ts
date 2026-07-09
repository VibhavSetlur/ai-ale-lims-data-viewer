import { NextResponse, type NextRequest } from 'next/server';
import { runQuery, getDbType } from '@/lib/db';

// OD-vs-transfer growth SERIES, keyed by ALE lineage (sample_name). This is a
// distinct dataset from /api/mutations: it reads Robotic_OD directly so it can
// surface every lineage, including the ~24 of 55 OD lineages that have no
// sequenced sample (and therefore cannot be reconstructed from the baked
// mutations payload). One line per replicate, faceted by genotype in the UI.
//
// Per (sample_name, transfer) we plot the ENDPOINT OD: the reading at the max
// timepoint (tie-break: max reading index), excluding the pre-inoculation
// 'contam' check. We also carry the MAX OD over the same partition so the UI can
// toggle endpoint vs max without a refetch. Default aggregation = endpoint.

export interface GrowthSeriesPoint {
  transfer: number;
  od: number;      // endpoint OD for this (lineage, transfer)
  maxOd: number;   // max OD across all readings of this (lineage, transfer)
}

export interface GrowthSeriesLineage {
  lineageId: string;        // Robotic_OD.sample_name, e.g. "TFMN1.fba.1"
  experiment: string;       // Robotic_OD.experiment
  genotypeLabel: string;    // Transforming_DNA verbatim; NULL -> "No DNA"
  replicate?: string;       // numeric suffix of sample_name, e.g. "1".."5"
  condition?: string;       // Robotic_OD.Condition, if present
  strain?: string;          // Robotic_OD.strain, if present
  points: GrowthSeriesPoint[];
}

export interface GrowthSeriesDataset {
  aggregation: 'endpoint';
  transferRange: { min: number; max: number };
  lineages: GrowthSeriesLineage[];
  warnings: string[];
  source?: { driver: 'sqlite' | 'mysql'; table: 'Robotic_OD'; rowsScanned: number };
}

const NO_DNA_LABEL = 'No DNA';

// Numeric-suffix replicate, matching deriveReplicate in the mutations route.
function deriveReplicate(sampleName: string | null): string | undefined {
  if (!sampleName) return undefined;
  const m = sampleName.match(/\.(\d+)$/);
  return m ? m[1] : undefined;
}

// Endpoint / max OD per (sample_name, transfer). A window-function CTE keeps the
// aggregation in SQLite (3.45 supports window fns; MySQL 8 does too). The
// reading-index rank orders 'T0'..'Tn' / bare integers numerically; the leading
// (timepoint IS NULL) term pushes rows with no numeric timepoint to the end so a
// real endpoint reading always wins when present.
const GROWTH_SERIES_SQL_BASE = `
  WITH ranked AS (
    SELECT
      "sample_name"      AS sample_name,
      "transfer"         AS transfer,
      "experiment"       AS experiment,
      "Transforming_DNA" AS transforming_dna,
      "Condition"        AS condition,
      "strain"           AS strain,
      "od"               AS od,
      ROW_NUMBER() OVER (
        PARTITION BY "sample_name", "transfer"
        ORDER BY
          ("timepoint" IS NULL),
          "timepoint" DESC,
          CASE
            WHEN "reading" GLOB 'T[0-9]*' THEN CAST(substr("reading", 2) AS INTEGER)
            WHEN "reading" GLOB '[0-9]*'  THEN CAST("reading" AS INTEGER)
            ELSE -1
          END DESC
      ) AS rn,
      MAX("od") OVER (PARTITION BY "sample_name", "transfer") AS max_od
    FROM Robotic_OD
    WHERE deleted = 0
      AND "sample_name" IS NOT NULL
      AND "sample_name" != ''
      AND "transfer" IS NOT NULL
      AND "od" IS NOT NULL
      AND ("Blank" IS NULL OR "Blank" = 0)
      AND LOWER(COALESCE("reading", '')) != 'contam'
`;

const GROWTH_SERIES_SQL_TAIL = `
  )
  SELECT sample_name, transfer, experiment, transforming_dna, condition, strain,
         od AS endpoint_od, max_od
  FROM ranked
  WHERE rn = 1
  ORDER BY sample_name ASC, transfer ASC
`;

interface GrowthSeriesRow {
  sample_name: string;
  transfer: number;
  experiment: string | null;
  transforming_dna: string | null;
  condition: string | null;
  strain: string | null;
  endpoint_od: number;
  max_od: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const experimentFilter = url.searchParams.get('experiment')?.trim() || null;

  const warnings: string[] = [];

  try {
    const sql = experimentFilter
      ? `${GROWTH_SERIES_SQL_BASE}      AND "experiment" = ?\n${GROWTH_SERIES_SQL_TAIL}`
      : `${GROWTH_SERIES_SQL_BASE}\n${GROWTH_SERIES_SQL_TAIL}`;
    const params: (string | number | null)[] = experimentFilter ? [experimentFilter] : [];

    const rows = await runQuery<GrowthSeriesRow>(sql, params);

    if (rows.length === 0) {
      return NextResponse.json<GrowthSeriesDataset>({
        aggregation: 'endpoint',
        transferRange: { min: 0, max: 0 },
        lineages: [],
        warnings: [
          experimentFilter
            ? `No Robotic_OD growth data found for experiment "${experimentFilter}".`
            : 'No Robotic_OD growth data found.',
        ],
        source: { driver: getDbType(), table: 'Robotic_OD', rowsScanned: 0 },
      });
    }

    // Group rows into lineages. Rows arrive ordered by (sample_name, transfer),
    // so we can build points in order without a resort per lineage.
    const byLineage = new Map<string, GrowthSeriesLineage>();
    let tMin = Infinity;
    let tMax = -Infinity;

    for (const r of rows) {
      const transfer = Number(r.transfer);
      const od = Number(r.endpoint_od);
      const maxOd = Number(r.max_od);
      if (!Number.isFinite(transfer) || !Number.isFinite(od)) continue;

      if (transfer < tMin) tMin = transfer;
      if (transfer > tMax) tMax = transfer;

      let lineage = byLineage.get(r.sample_name);
      if (!lineage) {
        lineage = {
          lineageId: r.sample_name,
          experiment: (r.experiment ?? '').trim(),
          genotypeLabel:
            r.transforming_dna && r.transforming_dna.trim()
              ? r.transforming_dna.trim()
              : NO_DNA_LABEL,
          replicate: deriveReplicate(r.sample_name),
          condition: r.condition && r.condition.trim() ? r.condition.trim() : undefined,
          strain: r.strain && r.strain.trim() ? r.strain.trim() : undefined,
          points: [],
        };
        byLineage.set(r.sample_name, lineage);
      }
      lineage.points.push({
        transfer,
        od,
        maxOd: Number.isFinite(maxOd) ? maxOd : od,
      });
    }

    const lineages = Array.from(byLineage.values());
    // Sort lineages by genotypeLabel, then numeric replicate, then id.
    lineages.sort((a, b) => {
      if (a.genotypeLabel !== b.genotypeLabel) {
        return a.genotypeLabel.localeCompare(b.genotypeLabel);
      }
      const ra = a.replicate ? parseInt(a.replicate, 10) : Number.MAX_SAFE_INTEGER;
      const rb = b.replicate ? parseInt(b.replicate, 10) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.lineageId.localeCompare(b.lineageId);
    });

    return NextResponse.json<GrowthSeriesDataset>({
      aggregation: 'endpoint',
      transferRange: {
        min: Number.isFinite(tMin) ? tMin : 0,
        max: Number.isFinite(tMax) ? tMax : 0,
      },
      lineages,
      warnings,
      source: { driver: getDbType(), table: 'Robotic_OD', rowsScanned: rows.length },
    });
  } catch (err) {
    // Never 500 on a data-shape problem: return an empty dataset with a warning
    // so the UI can render its friendly empty state.
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json<GrowthSeriesDataset>({
      aggregation: 'endpoint',
      transferRange: { min: 0, max: 0 },
      lineages: [],
      warnings: [`Failed to load growth series: ${msg}`],
      source: { driver: getDbType(), table: 'Robotic_OD', rowsScanned: 0 },
    });
  }
}
