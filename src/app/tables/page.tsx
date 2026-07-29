import Link from "next/link";
import { PageHeader, InlineNotice } from "@/components/design-system/Primitives";
import { mockTables } from "@/lib/research/mock-service";
export default function TablesPage() { return <section><PageHeader eyebrow="DATABASE TABLES" title="Browse allowed tables"><p className="lede">Search and data access are represented here without connecting to a database.</p></PageHeader><InlineNotice>Read-only placeholder. Scientific records are not loaded.</InlineNotice><ul className="table-list">{mockTables.map((table) => <li key={table.name}><h2><Link href={`/tables/${table.name}`}>{table.name}</Link></h2><p>{table.description}</p><span>{table.rows} placeholder rows</span></li>)}</ul></section>; }
