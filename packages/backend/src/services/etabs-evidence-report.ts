import path from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { parseStructuralProjectForExport, type ETABSNativeFixtureEvidence, type ETABSResponse } from '@ai-floor-planner/core';
import { ExportError } from './export-selection.js';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** Host-only: directory comes from trusted run storage, never from an HTTP body. */
export async function loadVerifiedFixtureEvidence(directory:string) {
  const fail=(message:string):never=>{throw new ExportError('NATIVE_EVIDENCE_INVALID',message,409);};
  for(let entry=path.resolve(directory);;entry=path.dirname(entry)) {
    if((await lstat(entry)).isSymbolicLink())fail('Linked evidence directories are forbidden');
    if(path.dirname(entry)===entry)break;
  }
  async function read(name:string) {const file=path.join(directory,name);if((await lstat(file)).isSymbolicLink())fail('Linked evidence files are forbidden');return readFile(file);}
  const [manifestBytes,sourceBytes,nativeBytes,modelBytes]=await Promise.all([read('analysis.json'),read('structural-project.json'),read('native-evidence.json'),read('model.edb')]);
  const manifest=JSON.parse(manifestBytes.toString()) as ETABSNativeFixtureEvidence;
  const project=parseStructuralProjectForExport(JSON.parse(sourceBytes.toString()),{allowVerificationFixtures:true});
  const native=JSON.parse(nativeBytes.toString()) as ETABSResponse[];
  if(project.exportReview?.status!=='API_VERIFICATION_FIXTURE'||manifest.schemaVersion!==1||manifest.projectId!==project.id
    ||manifest.sourceArchitecturalRevisionId!==project.sourceArchitecturalRevisionId||path.basename(directory)!=='run-'+manifest.runId
    ||manifest.status!=='NATIVE_ANALYSIS_VERIFIED'||manifest.scope!=='SOFTWARE VERIFICATION - NOT FOR CONSTRUCTION'
    ||manifest.designStatus!=='NOT_VERIFIED'||manifest.engineeringApproval!=='NOT_PROVIDED'||manifest.units!=='N_mm_C'
    ||manifest.structuralRevisionSha256!==hash(JSON.stringify(project))||manifest.edbSha256!==hash(modelBytes))fail('Run identity, scope or source/EDB checksum mismatch');
  if(!Array.isArray(native)||!native.length||native.some(r=>!r.ok||!r.apiCalls?.length||r.apiCalls.some(c=>c.code!==0)))fail('Native API evidence contains failed or unverified calls');
  if(!native.some(r=>r.apiCalls?.some(c=>c.api==='Analyze.RunAnalysis'))||!native.some(r=>r.apiCalls?.some(c=>c.api==='File.Save')))fail('Native analysis and save evidence required');
  const actualResults=native.flatMap(r=>r.ok&&r.data.result?[r.data.result]:[]);
  if(manifest.results.length!==project.loadCases.length+project.loadCombinations.length||actualResults.length!==manifest.results.length)fail('Missing native result selections');
  for(const selection of manifest.results) {
    const result=selection.result;
    if(!actualResults.some(r=>JSON.stringify(r)===JSON.stringify(result))||result.sourceArchitecturalRevisionId!==project.sourceArchitecturalRevisionId
      ||result.applicationVersion!==manifest.applicationVersion||result.verification!=='NATIVE_API'||result.units!=='N_mm_C'
      ||!result.frameForces.length||!result.supportReactions.length||result.jointDisplacements?.length!==project.nodes.length)fail('Results differ from captured native responses');
    if(selection.forceResidualN.length!==3||selection.momentResidualNmm.length!==3
      ||selection.forceResidualN.some(v=>!Number.isFinite(v)||Math.abs(v)>0.1)||selection.momentResidualNmm.some(v=>!Number.isFinite(v)||Math.abs(v)>100))fail('Equilibrium verification failed');
  }
  return {manifest,project,hashes:{analysisSha256:hash(manifestBytes),nativeEvidenceSha256:hash(nativeBytes),sourceSha256:hash(sourceBytes),edbSha256:hash(modelBytes)}};
}

export async function generateNativeFixtureEvidencePdf(directory:string):Promise<Uint8Array> {
  const {manifest:m,project:p,hashes}=await loadVerifiedFixtureEvidence(directory);
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page=pdf.addPage([595.28,841.89]), y=780, pageNumber=0;
  const newPage=()=>{pageNumber++;page.drawText('RH PLANNER | NATIVE ETABS SOFTWARE VERIFICATION',{x:40,y:812,size:10,font:bold,color:rgb(0.08,0.2,0.35)});
    page.drawText('SOFTWARE VERIFICATION - NOT FOR CONSTRUCTION',{x:40,y:26,size:9,font:bold,color:rgb(0.65,0.12,0.12)});
    page.drawText(String(pageNumber),{x:540,y:26,size:9,font});};newPage();
  function line(text:string,heading=false) {
    const clean=text.replace(/[^\x20-\x7E]/g,' '), words=clean.split(' ');let current='';
    const draw=(value:string)=>{if(y<62){page=pdf.addPage([595.28,841.89]);y=780;newPage();}page.drawText(value,{x:40,y,size:heading?13:10,font:heading?bold:font});y-=heading?23:16;};
    for(const word of words){const next=current?current+' '+word:word;if(font.widthOfTextAtSize(next,heading?13:10)>510&&current){draw(current);current=word;}else current=next;}draw(current);
  }
  line('Native analysis evidence',true);
  line('Project: '+m.projectId+' | ETABS '+m.applicationVersion);line('Run: '+m.runId);line('Source revision: '+m.sourceArchitecturalRevisionId);
  line('Executed: '+m.timestamp+' | Units: N, mm, C; rotations: rad');
  line('Analysis: NATIVE_ANALYSIS_VERIFIED | Design: NOT_VERIFIED');line('Engineering approval: NOT_PROVIDED');
  line('Geometry: '+(p.levels.length-1)+' storeys; '+p.columns.length+' columns; '+p.beams.length+' beams; '+p.slabs.length+' slabs.');
  line('Integrity',true);line('EDB SHA-256:');line(hashes.edbSha256);line('Analysis JSON SHA-256:');line(hashes.analysisSha256);line('Native API evidence SHA-256:');line(hashes.nativeEvidenceSha256);
  line('Retrieved results',true);
  for(const s of m.results) {
    const maxDisplacement=Math.max(...s.result.jointDisplacements!.flatMap(d=>d.translationMm.map(Math.abs)));
    line(s.sourceId+': '+s.result.frameForces.length+' frame rows, '+s.result.supportReactions.length+' reactions, '+s.result.jointDisplacements!.length+' displacements.');
    line('Maximum absolute translation component: '+maxDisplacement.toPrecision(6)+' mm. Force residual: '+Math.max(...s.forceResidualN.map(Math.abs)).toExponential(3)+' N; moment residual: '+Math.max(...s.momentResidualNmm.map(Math.abs)).toExponential(3)+' N mm.');
  }
  line('Scope and limitations',true);for(const limitation of m.limitations)line(limitation+'.');
  line('No residential safety conclusion, reinforcement schedule, foundation sizing or applicable-code certification is provided. The source contains illustrative fixture inputs only.');
  line('All individual forces, reactions and displacements remain available in analysis.json and the captured native responses.');
  return pdf.save();
}
