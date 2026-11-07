from pathlib import Path
import json
r=Path(__file__).resolve().parents[1]
def edit(file,a,b):
 p=r/file;s=p.read_text(encoding='utf8');assert a in s,file;p.write_text(s.replace(a,b),encoding='utf8')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts',"getApartmentRulesProfile('generic')","getApartmentRulesProfile('generic_indian')")
edit('tests/apartment-geometry-closure.test.ts',"getApartmentRulesProfile('generic')","getApartmentRulesProfile('generic_indian')")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','tolerance (<= 250mm)','numerical tolerance (<= 1mm)')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','toleranceMm = 250','toleranceMm = 1')
edit('packages/planning-engine/src/interpretation/extraction-parser.ts','connectsRooms: [adjacentRoomId],',"connectsRooms: Array.isArray(record.connectsRooms) ? record.connectsRooms.filter((v): v is string => typeof v==='string') : [adjacentRoomId],")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','doorType: d.type, swingDirection: d.swingDirection,','doorType: d.type, swingDirection: d.swingDirection,\n          connects: d.connectsRooms.length===2 ? [d.connectsRooms[0]!,d.connectsRooms[1]!] as const : undefined,')
# Mock image fixture previously omitted ALL access openings. Supply actual schematic
# openings as observed evidence, retaining both source room ids through parsing.
edit('packages/backend/src/__tests__/fixtures/apartment-interpretation.ts','    doors: [],', '''    doors: schematic.doors.map(d=>{
      const sid=(id:string)=>schematic.units.flatMap(u=>[...u.rooms,...u.balconies].map(room=>({id:room.id,mapped:`${u.flatId}__${room.id}`}))).find(r=>r.id===id)?.mapped??id;
      return {id:d.id,type:d.doorType,swingDirection:d.swing,adjacentRoomId:sid(d.connects[0]),connectsRooms:d.connects.map(sid),...box(d.bounds)};
    }),''')
edit('packages/backend/src/__tests__/fixtures/apartment-interpretation.ts',"lobbies: [{ id: 'lobby',", "lobbies: [{ id: 'core_lobby',")
edit('packages/ai-orchestration/src/apartment/unit-topology-solver.ts','W-6,publicH','W-6.3,publicH')
edit('packages/ai-orchestration/src/apartment/unit-topology-solver.ts','W-1.5,foyerH,1.5,publicH','W-1.8,foyerH,1.8,publicH')
# The historical script wrote fixed success metrics. Keep entrypoint, run real
# offline fixtures instead; provider acceptance is a separate, unclaimed gate.
(r/'scripts/generate-golden-phase-artifacts.ts').write_text('''/** Architectural artifacts are produced by the actual planner/validator/exporter. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const runner=path.resolve('node_modules/vitest/vitest.mjs');
const result=spawnSync(process.execPath,[runner,'run','tests/apartment-geometry-closure.test.ts'],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
''',encoding='utf8')
# Sync workspace dependencies without reinstalling existing node_modules.
p=r/'pnpm-lock.yaml';s=p.read_text(encoding='utf8')
for pkg in ['frontend','ai-orchestration']:
 needle=f'  packages/{pkg}:\n    dependencies:';assert needle in s
 s=s.replace(needle,needle+"\n      '@ai-floor-planner/constraint-engine':\n        specifier: workspace:*\n        version: link:../constraint-engine")
p.write_text(s,encoding='utf8')
edit('packages/frontend/src/components/modals/ExportModal.tsx','                <label className="export-field">\n                  <span>Revision</span>', '''                <label className="export-field">
                  <span>Scale mode</span>
                  <select aria-label="PDF scale mode" value={settings.scaleMode ?? 'EXACT'} onChange={event=>updateSetting('scaleMode',event.target.value as 'EXACT'|'FIT_TO_PAGE')}>
                    <option value="EXACT">Exact architectural scale</option>
                    <option value="FIT_TO_PAGE">Fit to page (not to scale)</option>
                  </select>
                </label>
                <label className="export-field">
                  <span>Revision</span>''')
