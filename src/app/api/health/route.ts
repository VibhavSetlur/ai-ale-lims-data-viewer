import { NextResponse } from "next/server";
import { readiness } from "../v1/health/route-helpers";

export async function GET() {
  try {
    const health = await readiness();
    return NextResponse.json({
      status: "ok",
      db: { driver: health.scientificBackend, ok: true },
    });
  } catch {
    return NextResponse.json({
      status: "unavailable",
      db: { ok: false },
    }, { status: 503 });
  }
}
