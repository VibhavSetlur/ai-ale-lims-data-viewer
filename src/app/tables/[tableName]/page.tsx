import { CatalogTable } from "@/components/catalog/CatalogBrowser";

export default async function TablePage({ params }: Readonly<{ params: Promise<{ tableName: string }> }>) {
  const { tableName } = await params;
  return <CatalogTable table={tableName} />;
}
