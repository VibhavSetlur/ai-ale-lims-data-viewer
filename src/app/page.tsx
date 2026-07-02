import Dashboard from '@/components/Dashboard';
import { getBuildInfo } from '@/lib/buildInfo';

// In the STATIC build there is no server/DB at render time, so we skip the
// server-side table fetch entirely and let the client hydrate from the pre-baked
// artifacts. In SERVER mode we keep the original SSR fast-path (initial table
// list rendered on the server). The flag is set by scripts/build-static.sh.
const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === '1';

async function getInitialTables(): Promise<string[]> {
  if (IS_STATIC) return [];
  try {
    // Imported lazily so the static build never pulls the server-only DB module
    // (better-sqlite3 + fs) into its trace.
    const { getTables } = await import('@/lib/db');
    return await getTables();
  } catch (error) {
    console.error('Failed to get tables from DB:', error);
    return [];
  }
}

export default async function Home() {
  const tables = await getInitialTables();
  // Counts are populated by the client after mount (via the data source) — keeps
  // initial render fast on large DBs.
  const buildInfo = getBuildInfo();
  return (
    <main className="h-screen w-full flex flex-col overflow-hidden">
      <Dashboard initialTables={tables} buildInfo={buildInfo} />
    </main>
  );
}
