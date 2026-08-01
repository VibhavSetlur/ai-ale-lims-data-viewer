import ViewerPage from '@/components/ViewerPage';
import { decodeRouteSegment } from '@/lib/routes';

// No shared/per-ID workspace backend exists. `workspaceId` only labels an
// unavailable detail shell (see RoutePlaceholder via Dashboard); it never
// fetches or invents a record. The static export pre-renders one truthful
// shell path; server mode continues accepting any segment.
export function generateStaticParams() {
  return [{ workspaceId: 'example' }];
}

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <ViewerPage view={{ kind: 'workspace', workspaceId: decodeRouteSegment(workspaceId) }} />;
}
