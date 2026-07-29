import PlateWorkspace from "@/modules/plates/PlateWorkspace";
export default async function PlatePage({ params }: Readonly<{ params: Promise<{ designId: string }> }>) { const { designId } = await params; return <PlateWorkspace designId={designId} />; }
