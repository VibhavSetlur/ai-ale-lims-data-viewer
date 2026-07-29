import Link from "next/link";
import { InlineNotice, PageHeader, ProvenanceBadge } from "@/components/design-system/Primitives";
import { mockCapabilities, mockProvenance } from "@/lib/research/mock-service";

export function ResearchPage({ title, description, complex = false }: Readonly<{ title: string; description: string; complex?: boolean }>) {
 return <section><PageHeader eyebrow="RESEARCH" title={title}><p className="lede">{description}</p><ProvenanceBadge label={mockProvenance.snapshotId} /></PageHeader>
  <InlineNotice>This route is a read-only placeholder. Scientific records are not loaded.</InlineNotice>
  {complex && <div className="mobile-summary"><h2>Read-only summary</h2><p>This preview does not provide comparison or editing controls. No changes can be saved.</p><Link href="/help">Resume or export guidance</Link></div>}
  {!mockCapabilities.hasBarcodes && title === "Library variants" && <InlineNotice tone="warning">{mockCapabilities.capabilities.barcodes.reason}</InlineNotice>}
 </section>;
}
