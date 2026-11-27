import fs from 'node:fs';
import path from 'node:path';
const [archive, output, base = 'http://127.0.0.1:46582'] = process.argv.slice(2);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw Error('Expected localhost backend');
const read = name => JSON.parse(fs.readFileSync(path.join(archive, name), 'utf8'));
const inputs = read('reviewed-inputs.json');
const ledger = {};
for (const name of ['original', 'second']) {
  const building = read(name + '.architecture.json');
  const response = await fetch(new URL('/api/v1/structural/analyze', base), { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ building, reviewedInputs: inputs, regenerate: true }) });
  if (!response.ok) throw Error(await response.text());
  const { snapshot } = await response.json();
  const digest = snapshot.system.sourceArchitecturalSha256;
  if (digest !== read(name + '.summary.json').architectureSha256) throw Error('Architecture digest mismatch');
  const records = snapshot.loadTakeoff.loadSourceAudit.filter(r => r.category === 'SLAB_PANEL');
  ledger[name] = { architectureSha256: digest, structuralRevision: snapshot.system.structuralRevision,
    unresolvedSlabPaths: records.filter(r => r.transferMethod === 'UNRESOLVED_SLAB_SUPPORT').length,
    slabUnassignedKn: snapshot.loadTakeoff.unassignedGravityKnByCase,
    floors: building.floors.map(floor => {
      const sources = records.filter(r => r.slabGeometry?.floorId === floor.id);
      const sum = (k, field) => sources.reduce((a, r) => a + (r.gravityTransfer?.[field]?.[k] ?? 0), 0);
      return { floorId: floor.id, reviewedDeckAreaM2: null, geometryBasis: 'LEGACY_NO_RECTANGULAR_DECK_REVIEW',
        slabSourceCount: sources.length, unresolved: sources.filter(r => r.transferMethod === 'UNRESOLVED_SLAB_SUPPORT').length,
        slabLoadsKn: Object.fromEntries(['DL','SDL','LL'].map(k => [k, { expected: sum(k,'forceByCaseKn'),
          applied: sum(k,'assignedForceByCaseKn'), unassigned: sum(k,'forceByCaseKn') - sum(k,'assignedForceByCaseKn') }])),
        transferMethods: [...new Set(sources.map(r => r.transferMethod))] };
    }) };
}
fs.writeFileSync(output, JSON.stringify(ledger, null, 2) + '\n');
