"use client";

import Link from "next/link";
import DataTable from "@/components/research/DataTable";

export default function DataTableView({
  tableName,
}: Readonly<{ tableName: string }>) {
  return (
    <div className="lims-scope" style={{ padding: "var(--space-4, 16px)" }}>
      <div style={{ marginBottom: "var(--space-3, 12px)" }}>
        <Link
          href="/tables"
          className="nav-link"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          &#8592; All tables
        </Link>
      </div>
      <DataTable key={tableName} tableName={tableName} />
    </div>
  );
}
