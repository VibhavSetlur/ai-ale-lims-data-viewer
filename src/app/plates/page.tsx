import Link from "next/link";
import { ResearchPage } from "@/components/research/ResearchPage";
export default function PlatesPage() { return <><ResearchPage title="Plate design" description="Design work remains browser-local until optional persistence is available." complex /><p><Link href="/plates/example-design">Open example local design</Link></p></>; }
