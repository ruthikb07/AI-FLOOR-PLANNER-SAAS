from pathlib import Path
root=Path(__file__).resolve().parents[1]
def edit(path,old,new):
 p=root/path; s=p.read_text(encoding='utf-8'); assert old in s, path; p.write_text(s.replace(old,new),encoding='utf-8')
edit('packages/ai-orchestration/src/apartment/program-registry.ts','// Default fallback to 3BHK if unrecognized\n    return PROGRAM_3BHK;',"throw new Error(`UNSUPPORTED_UNIT_TYPE: ${unitType}`);")
edit('packages/ai-orchestration/src/apartment/contract.ts','buildableWidthM: payload.site.buildableWidthM,','setbacksM: payload.site.setbacksM,\n      buildableWidthM: payload.site.buildableWidthM,')
# The assembled allocation translates both units and core. Previously the schematic
# drew the original core, causing production collisions despite envelope checks.
edit('packages/ai-orchestration/src/apartment/schematic.ts','const coreConfig = coreConfigs[0]!;','const initialCoreConfig = coreConfigs[0]!;')
edit('packages/ai-orchestration/src/apartment/schematic.ts','    coreConfig,\n    topologyFamily,','    coreConfig: initialCoreConfig,\n    topologyFamily,')
edit('packages/ai-orchestration/src/apartment/schematic.ts','  const unitTopologies = allocation.envelopes.map(env => solveUnitTopology(env));','  const coreConfig = allocation.core;\n  const unitTopologies = allocation.envelopes.map(env => solveUnitTopology(env));')
edit('packages/ai-orchestration/src/apartment/schematic.ts',"fromRoomId, d.toRoomId", "fromRoomId, d.toRoomId") if False else None
edit('packages/ai-orchestration/src/apartment/schematic.ts',"connects: [d.fromRoomId, d.toRoomId] as const,","connects: [d.fromRoomId === 'common_lobby' ? 'core_lobby' : d.fromRoomId, d.toRoomId] as const,")
edit('packages/ai-orchestration/src/apartment/schematic.ts',"entranceDoorId: `${u.unitId.toLowerCase()}_entrance`,","entranceDoorId: u.doors.find(d => d.kind === 'flat_entrance')?.id ?? null,")
# Use actual door centre in the canonical adapter, not the opening rectangle's corner.
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','const position = { x: Math.round(opening.rect.x), y: Math.round(opening.rect.y) };','const position = { x: Math.round(opening.rect.x + opening.rect.width / 2), y: Math.round(opening.rect.y + opening.rect.height / 2) };')
# Stair doors belong to their actual lobby-facing edge (not a guessed east/west edge).
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','const lobbyW = Math.max(3.6, Math.min(5.4, 2.4 * Math.max(1, liftCount)));','const lobbyW = Math.max(4.8, 0.6 + 2.1 * Math.max(1, liftCount), 2.4 * Math.max(1, stairCount));')
# Place stairs alongside lifts facing a shared lobby extension, keeping all core
# rooms disjoint and providing a real boundary for staircase doors.
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','y: coreA_lobby.y - liftD - stairD,','y: coreA_lobby.y - stairD,')
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','x: coreA_lobby.x + i * stairW,','x: coreA_lobby.x + lobbyW + i * stairW,')
# Extend the arrival lobby behind the stairs. Rectangular lobby still shares their
# entire south face. Avoid competing lift/stair polygons.
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','width: lobbyW,\n    height: lobbyD,','width: lobbyW + actualStairs * stairW,\n    height: lobbyD,')
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','const coreA_totalH = liftD + stairD;','const coreA_totalH = Math.max(liftD, stairD);')
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','width: Math.max(lobbyW, actualStairs * stairW),','width: lobbyW + actualStairs * stairW,')
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','const shaftsArea = 1.4;','const shaftsArea = coreA_shafts.reduce((sum, s) => sum + s.bounds.width * s.bounds.height, 0);')
edit('packages/ai-orchestration/src/apartment/core-optimizer.ts','const lobbyArea = Number((lobbyW * lobbyD).toFixed(2));','const lobbyArea = Number((coreA_lobby.width * lobbyD).toFixed(2));')
edit('packages/ai-orchestration/src/apartment/schematic.ts',"center: { x: s.bounds.x < lobbyBounds.x ? lobbyBounds.x : lobbyBounds.x + lobbyBounds.width, y: s.bounds.y + s.bounds.height / 2 },\n      wallAxis: 'y' as const,\n      bounds: doorBounds({ x: s.bounds.x < lobbyBounds.x ? lobbyBounds.x : lobbyBounds.x + lobbyBounds.width, y: s.bounds.y + s.bounds.height / 2 }, 1.2, 'y'),","center: { x: s.bounds.x + s.bounds.width / 2, y: lobbyBounds.y },\n      wallAxis: 'x' as const,\n      bounds: doorBounds({ x: s.bounds.x + s.bounds.width / 2, y: lobbyBounds.y }, 1.2, 'x'),")
