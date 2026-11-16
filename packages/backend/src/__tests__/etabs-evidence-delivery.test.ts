import { it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { loadVerifiedFixtureEvidence, generateNativeFixtureEvidencePdf } from '../services/etabs-evidence-report';
import { createResidentialStructuralReviewTemplate } from '../services/structural-review';

it.skipIf(process.env.RH_ETABS_REPORT_TEST!=='1')('publishes numerical PDFs only from hash-valid native fixture evidence and creates an unapproved residential review template',async()=>{
  const root=path.resolve('../..');
  const output=path.join(root,'output/pdf/etabs-verification-20261112');await mkdir(output,{recursive:true});
  const runs=['run-9f4e9c41-1a35-4edb-a841-fd74db07946e','run-6c14ecbb-08de-4e77-8cb9-d71726c39fa6'];
  const artifacts=[];
  for(const run of runs) {
    const directory=path.resolve('output/etabs/loaded-native-1794392551685',run);
    const verified=await loadVerifiedFixtureEvidence(directory);
    const bytes=await generateNativeFixtureEvidencePdf(directory);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const filename=verified.manifest.projectId+'-native-evidence.pdf';
    await writeFile(path.join(output,filename),bytes);
    await writeFile(path.join(output,verified.manifest.projectId+'-results.json'),JSON.stringify(verified.manifest,null,2));
    artifacts.push({filename,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,sourceDirectory:directory,...verified.hashes});
  }
  const building=JSON.parse(await readFile(path.join(root,'test-artifacts/p1/canonical-building.json'),'utf8'));
  const template=createResidentialStructuralReviewTemplate(building);
  expect(template.status).toBe('ENGINEERING_INPUTS_REQUIRED');expect(template.structuralProject).toBeNull();
  await writeFile(path.join(output,'residential-structural-review-template.json'),JSON.stringify(template,null,2));
  await writeFile(path.join(output,'required-engineering-inputs.md'),'# Required engineering inputs\n\nStatus: ENGINEERING_INPUTS_REQUIRED\n\n'+template.missingInputChecklist.map(x=>'- [ ] '+x).join('\n')+'\n');
  await writeFile(path.join(output,'manifest.json'),JSON.stringify({scope:'SOFTWARE VERIFICATION - NOT FOR CONSTRUCTION',artifacts},null,2));
  // Historical mismatch remains untouched and is rejected, never re-hashed into approval.
  await expect(loadVerifiedFixtureEvidence(path.resolve('output/etabs/loaded-native-1794390777179/run-5a9e0854-d532-4014-9854-8effae37bf1b'))).rejects.toThrow(/checksum mismatch/);
  console.info('Verified evidence deliverables:',output);
},60000);
