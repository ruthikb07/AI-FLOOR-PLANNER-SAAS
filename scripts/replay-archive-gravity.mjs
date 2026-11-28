import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleLoadedAnalyticalFrameModel } from '../packages/structural-engine/src/loads/indian-load-assembler.ts';

const docs = fileURLToPath(new URL('../docs/structural/', import.meta.url));
const [archive, output] = process.argv.slice(2);
if (!archive || !output) throw new Error('Supply the frozen archive directory and output JSON path.');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await readFile(path.join(docs,'6a-evidence/deck-replay.json')));
const bytes = await readFile(path.join(archive,'reviewed-inputs.json'));
const inputs = JSON.parse(bytes);
const report = { scope:'Gravity load-source replay on archived physical systems. Geotechnical design and lateral analysis excluded.',
  inputFileSha256:digest(bytes), buildings:{} };
for (const [name, manifest] of Object.entries(baseline)) {
  const data = {};
  for (const [kind, hash] of Object.entries(manifest.fileSha256)) {
    const file = await readFile(path.join(archive,name+'.'+kind+'.json'));
    if (digest(file) !== hash) throw new Error('Archive changed: '+name+' '+kind);
    data[kind] = JSON.parse(file);
  }
  const {system} = data.snapshot;
  if (system.sourceArchitecturalSha256 !== manifest.architecturalDigest) throw new Error('Architectural identity mismatch');
  const {loadTakeoff} = await assembleLoadedAnalyticalFrameModel(system,{
    ...inputs,geotechnical:null,seismic:{...inputs.seismic,enabled:false},wind:{...inputs.wind,enabled:false},
  });
  const sources = loadTakeoff.loadSourceAudit;
  report.buildings[name] = { architectureSha256:manifest.architecturalDigest,structuralRevision:system.structuralRevision,
    archivedUnassignedKn:manifest.historicalUnassignedKn,currentUnassignedKn:loadTakeoff.unassignedGravityKnByCase,
    unresolvedStairCount:sources.filter(s=>s.transferMethod==='UNRESOLVED_STAIR_BEARING').length,
    unresolvedSlabCount:sources.filter(s=>s.transferMethod==='UNRESOLVED_SLAB_SUPPORT').length,
    appliedCoupledPressures:null,coupledSupportReactions:null,
    sources:sources.map(({sourceId,category,transferMethod,receivingElementIds,totalVerticalForceKn,gravityTransfer}) =>
      ({sourceId,category,transferMethod,receivingElementIds,totalVerticalForceKn,gravityTransfer})) };
}
await writeFile(output,JSON.stringify(report,null,2)+'\n');
