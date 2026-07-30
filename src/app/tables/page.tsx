import { CatalogTableList } from "@/components/catalog/CatalogBrowser";

export const metadata = {
  title: "Database Tables | AI-ALE Research Viewer",
  description: "Browse and explore the raw LIMS database tables.",
};

export default function TablesPage() {
  return <CatalogTableList />;
}
