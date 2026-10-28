import { NextResponse } from 'next/server';
import { getDbType, getTableSchema, runQuery } from '@/lib/db';
const q=(s:string)=>getDbType()==='mysql'?`\`${s.replace(/`/g,'``')}\``:`"${s.replace(/"/g,'""')}"`;
async function exists(t:string) { try { return (await runQuery<{n:number}>(getDbType()==='sqlite'?"SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?":'SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]))[0]?.n>0; } catch{return false;} }
export async function GET() {
 try {
  if (!await exists('dgoA_lib_variants') || !await exists('dgoA_alleles')) return NextResponse.json({variants:[],measurements:[],warnings:['dgoA allele measurement tables are unavailable in this snapshot.'], source:{available:false}});
  const [ms, as] = await Promise.all([getTableSchema('dgoA_lib_variants'),getTableSchema('dgoA_alleles')]); const mc=new Set(ms.map(x=>x.name)), ac=new Set(as.map(x=>x.name));
  const need=['Seqsample','Seqorder','Transformation_library','Count','Allele_DNA_index'];
  if (!need.every(x=>mc.has(x)) || !['Allele_DNA_index','Allele_AA_index'].every(x=>ac.has(x))) return NextResponse.json({variants:[],measurements:[],warnings:['dgoA tables do not have the required measurement identity or allele keys.'],source:{available:false}});
  const dna=mc.has('Allele_DNA_index')?'Allele_DNA_index':'Allele_number';
  const rows=await runQuery<Record<string,unknown>>(`SELECT v.${q('Seqsample')} sampleId, v.${q(dna)} dnaId, SUM(v.${q('Count')}) count FROM ${q('dgoA_lib_variants')} v WHERE COALESCE(v.${q('deleted')},0)=0 AND COALESCE(v.${q('Count')},0)>0 GROUP BY v.${q('Seqsample')},v.${q('Seqorder')},v.${q('Transformation_library')},v.${q(dna)}`);
  const alleles=await runQuery<Record<string,unknown>>(`SELECT ${['Allele_DNA_index','Allele_AA_index','Allele_number','DNAseq','AAseq','AA_changes'].filter(x=>ac.has(x)).map(q).join(',')} FROM ${q('dgoA_alleles')} WHERE COALESCE(${q('deleted')},0)=0`);
  const variants=alleles.map(a=>({id:String(a.Allele_DNA_index),dnaId:String(a.Allele_DNA_index),aaId:String(a.Allele_AA_index ?? a.Allele_DNA_index),dnaLabel:String(a.Allele_number ?? a.Allele_DNA_index),aaLabel:String(a.AA_changes || a.Allele_AA_index || a.Allele_DNA_index),dnaSequence:a.DNAseq || undefined,aaSequence:a.AAseq || undefined}));
  const byDna=new Map(variants.map(v=>[v.dnaId,v])); const measurements=rows.flatMap(r=>{const v=byDna.get(String(r.dnaId)); return v?[{sampleId:String(r.sampleId),alleleDnaIndex:v.dnaId,alleleAaIndex:v.aaId,count:Number(r.count)}]:[]});
  return NextResponse.json({variants,measurements,warnings:[],source:{available:true,identity:'Seqsample + Seqorder + Transformation_library'}});
 } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:500}); }
}
