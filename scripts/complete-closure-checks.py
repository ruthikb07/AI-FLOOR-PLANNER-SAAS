from pathlib import Path

root=Path(__file__).resolve().parents[1]
def edit(name,old,new):
 p=root/name
 s=p.read_text(encoding='utf-8')
 assert old in s,name
 p.write_text(s.replace(old,new),encoding='utf-8')

edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '  const core = input.coreConfig;\n  const lobby = core.lobbyBounds;', '''  // A single loaded arrival corridor needs less depth than the central lobby.
  // 2.4 m is a provisional planning choice, not a verified access/fire standard.
  const core = input.topologyFamily === 'SIDE_CORE' ? {
    ...input.coreConfig,
    lobbyBounds: {...input.coreConfig.lobbyBounds, height: 2.4},
    bounds: {...input.coreConfig.bounds, height: input.coreConfig.bounds.height - 2.4},
  } : input.coreConfig;
  const lobby = core.lobbyBounds;''')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '''    input.units ?? [
      { unitId: 'FLAT_01', unitType: '3BHK', targetCarpetAreaSqFt: input.targetCarpetSqFtPerUnit ?? 1100 },
      { unitId: 'FLAT_02', unitType: '3BHK', targetCarpetAreaSqFt: input.targetCarpetSqFtPerUnit ?? 1100 },
      { unitId: 'FLAT_03', unitType: '3BHK', targetCarpetAreaSqFt: input.targetCarpetSqFtPerUnit ?? 1100 },
    ];''', '''    input.units ?? [];
  if (!units.length) throw new Error('MISSING_REQUIRED_PROJECT_INPUT: unit schedule');''')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '    unitW = Math.max(minimum, unitW);\n    unitH = Math.max(minimum, unitH);', '''    const strategyGrowth = strategy === 'daylight' ? 0.3 : strategy === 'privacy' ? 0.2 : strategy === 'circulation' ? 0.1 : 0;
    unitW = Math.max(minimum + strategyGrowth, unitW);
    unitH = Math.max(minimum, unitH);''')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', "    topologyFamily: 'THREE_WING_CORE',\n  });", """    topologyFamily: 'THREE_WING_CORE',
    units: input.units ?? input.contract?.flats ?? [1,2,3].map(i => ({
      unitId: `FLAT_0${i}`, unitType: '3BHK', targetBedrooms: 3, targetBathrooms: 3,
      targetCarpetAreaSqFt: input.targetCarpetSqFtPerUnit ?? 1100,
      targetCarpetAreaSqM: (input.targetCarpetSqFtPerUnit ?? 1100) * 0.092903,
      mandatoryRooms: getUnitProgram('3BHK').mandatoryRooms,
    })),
  });""")
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', 'calculateUnitAreaRequirement, type ResidentialUnitType', 'calculateUnitAreaRequirement, getUnitProgram, type ResidentialUnitType')
edit('packages/ai-orchestration/src/apartment/schematic.ts', '    unitMix,\n    commonCoreConfig', '    commonCoreConfig')
edit('packages/ai-orchestration/src/apartment/schematic.ts', "  if(!Number.isFinite(siteWidthM)", "  const unitMix = options.unitMix.map(u => ({...u,unitType:u.unitType.toUpperCase()}));\n  if(!Number.isFinite(siteWidthM)")
edit('packages/planning-engine/src/diagnostics/design-evaluator.ts', "import { evaluateInstanceGraph }", "import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';\nimport { evaluateInstanceGraph }")
edit('packages/planning-engine/src/diagnostics/design-evaluator.ts', '  const allRooms = building.floors.flatMap(floor => floor.rooms);', '''  if (building.floors.some(f => f.apartmentUnits?.length)) {
    const closure = validateApartmentClosure(building);
    geometryHealthy = closure.hardErrors === 0;
    warnings.push(...closure.issues);
  }
  const allRooms = building.floors.flatMap(floor => floor.rooms);''')
