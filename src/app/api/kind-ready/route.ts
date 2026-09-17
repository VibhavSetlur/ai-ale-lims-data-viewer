import { NextResponse } from 'next/server';

// KIND readiness must remain independent of the database-backed health probe.
export function GET() {
  return NextResponse.json({ status: 'ready' });
}
