import { NextResponse } from 'next/server';
import { runQuery } from '@/lib/db';

export async function GET() {
  try {
    const rows = await runQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM verAB_barcodes'
    );
    return NextResponse.json({ stats: { hasBarcodes: (rows[0]?.n ?? 0) > 0 } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table/i.test(msg) || /not found/i.test(msg)) {
      return NextResponse.json({ stats: { hasBarcodes: false } });
    }
    return NextResponse.json({ stats: { hasBarcodes: false } });
  }
}
