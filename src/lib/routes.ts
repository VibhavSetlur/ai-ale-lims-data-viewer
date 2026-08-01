// Route contracts for the App Router reorganization.
//
// Dashboard is the shared client shell. Every page under src/app/* passes a
// typed RouteView into ViewerPage (server) -> Dashboard (client) so the URL
// stays authoritative for navigation instead of local component state.

export type MutationRouteTab = 'samples' | 'compare' | 'growth' | 'libraryVariants' | 'copynumber';

export type RouteView =
  | { kind: 'home' }
  | { kind: 'tables' }
  | { kind: 'table'; tableName: string }
  | { kind: 'mutations'; tab: MutationRouteTab }
  | { kind: 'plates' }
  | { kind: 'plate'; designId: string }
  | { kind: 'workspaces' }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'issues' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'help' };

const MUTATION_TAB_TO_PATH: Record<MutationRouteTab, string> = {
  samples: '/mutations/compare/samples',
  compare: '/mutations/compare/mutations',
  growth: '/mutations/compare/growth',
  libraryVariants: '/mutations/compare/library-variants',
  copynumber: '/mutations/compare/copy-number',
};

const PATH_TO_MUTATION_TAB: Record<string, MutationRouteTab> = {
  samples: 'samples',
  mutations: 'compare',
  growth: 'growth',
  'library-variants': 'libraryVariants',
  'copy-number': 'copynumber',
};

export function mutationTabPath(tab: MutationRouteTab): string {
  return MUTATION_TAB_TO_PATH[tab];
}

export function mutationSegmentToTab(segment: string): MutationRouteTab | undefined {
  return PATH_TO_MUTATION_TAB[segment];
}

export const TABLES_PATH = '/tables';
export const PLATES_PATH = '/plates';
export const WORKSPACES_PATH = '/workspaces';
export const ISSUES_PATH = '/issues';
export const HELP_PATH = '/help';

export function tablePath(name: string): string {
  return `${TABLES_PATH}/${encodeURIComponent(name)}`;
}

export function platePath(designId: string): string {
  return `${PLATES_PATH}/${encodeURIComponent(designId)}`;
}

export function workspacePath(workspaceId: string): string {
  return `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`;
}

export function issuePath(issueId: string): string {
  return `${ISSUES_PATH}/${encodeURIComponent(issueId)}`;
}

// Dynamic App Router segments already arrive decoded in most cases, but a
// segment can itself contain a literal '%' or a malformed escape sequence.
// Decode exactly once and fall back to the raw value instead of throwing, so
// a malformed or empty identifier never crashes a route page.
export function decodeRouteSegment(raw: string): string {
  if (!raw) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
