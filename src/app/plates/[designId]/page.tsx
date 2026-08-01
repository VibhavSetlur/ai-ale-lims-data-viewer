import ViewerPage from '@/components/ViewerPage';
import { decodeRouteSegment } from '@/lib/routes';

// No design repository/ID model exists; `designId` is only ever a local URL
// label rendered by PlateDesignWorkspace, never a server record lookup. The
// static export pre-renders a single truthful shell path; server mode
// continues accepting any segment (dynamicParams defaults to true).
export function generateStaticParams() {
  return [{ designId: 'local' }];
}

export default async function PlateDesignPage({
  params,
}: {
  params: Promise<{ designId: string }>;
}) {
  const { designId } = await params;
  return <ViewerPage view={{ kind: 'plate', designId: decodeRouteSegment(designId) }} />;
}
