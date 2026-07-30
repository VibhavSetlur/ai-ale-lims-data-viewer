export const legacyRouteMigrationMarker = "ai-ale-route-migration-v1";
const legacyRoutes: Readonly<Record<string, string>> = {
  tables: "/tables",
  mutations: "/mutations/cohort",
  plates: "/plates",
};

export function routeForLegacyTab(value: string | null): string {
  return value === null ? "/mutations/cohort" : (legacyRoutes[value] ?? "/mutations/cohort");
}
