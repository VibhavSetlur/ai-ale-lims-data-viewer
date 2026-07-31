import DataTableView from "./DataTableView";

type Props = Readonly<{ params: Promise<{ tableName: string }> }>;

export async function generateMetadata({ params }: Props) {
  const { tableName } = await params;
  return {
    title: `${decodeURIComponent(tableName)} | Database Tables | AI-ALE Research Viewer`,
  };
}

export default async function TablePage({ params }: Props) {
  const { tableName } = await params;
  return <DataTableView tableName={decodeURIComponent(tableName)} />;
}
