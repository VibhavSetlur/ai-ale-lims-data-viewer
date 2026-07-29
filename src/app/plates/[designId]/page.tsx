import { ResearchPage } from "@/components/research/ResearchPage";
export default async function PlatePage({ params }: Readonly<{ params: Promise<{ designId: string }> }>) { const { designId } = await params; return <ResearchPage title={`Plate design: ${designId}`} description="This browser-local design cannot write to LIMS or persist changes." complex />; }
