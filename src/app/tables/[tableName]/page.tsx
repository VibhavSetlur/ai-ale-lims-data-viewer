import ViewerPage from '@/components/ViewerPage';
import { decodeRouteSegment } from '@/lib/routes';
import { getStaticTableNames } from '@/lib/staticTableParams';

// Static export needs a truthful, non-invented set of paths: use the actual
// baked table catalog when it exists. Server mode still accepts any table
// name at request time (dynamicParams defaults to true).
export function generateStaticParams() {
  return getStaticTableNames().map(tableName => ({ tableName }));
}

export default async function TableNamePage({
  params,
}: {
  params: Promise<{ tableName: string }>;
}) {
  const { tableName } = await params;
  return <ViewerPage view={{ kind: 'table', tableName: decodeRouteSegment(tableName) }} />;
}
