import ViewerPage from '@/components/ViewerPage';
import { decodeRouteSegment } from '@/lib/routes';

// Issue tracking lives on GitHub, not in this viewer. `issueId` only names an
// unavailable detail shell that links out when the ID is safely
// representable (see RoutePlaceholder via Dashboard); it never fetches or
// invents issue data. The static export pre-renders one truthful shell path.
export function generateStaticParams() {
  return [{ issueId: '1' }];
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  return <ViewerPage view={{ kind: 'issue', issueId: decodeRouteSegment(issueId) }} />;
}
