/**
 * Test fixture (recovery Phase 4): a structurally faithful Gemini apartment
 * interpretation payload in the normalized 0–1000 frame, derived from a
 * deterministic schematic. Mutators let tests produce explicit mismatches.
 * Used only by mocked tests; the live path uses real Gemini output.
 */
import {
  APARTMENT_INTERPRETATION_FRAME,
  COMMON_AREA_FLAT_ID,
  generateDeterministicApartmentSchematic,
  getApartmentRulesProfile,
  type ApartmentLayoutStrategy,
  type DeterministicApartmentSchematic,
  type Rect2D,
} from '@ai-floor-planner/ai-orchestration';
import type { GenerationOrchestratorInput } from '../../services/generation-orchestrator.js';

/** Re-derive the schematic exactly as GenerationOrchestrator.run() does (optionally for one concept strategy). */
export function schematicForInput(input: GenerationOrchestratorInput, strategy?: ApartmentLayoutStrategy): {
  schematic: DeterministicApartmentSchematic;
  plotWidthM: number;
  plotDepthM: number;
} {
  const cfg = input.apartmentConfig!;
  const toM = (v: number) => (v < 150 ? v : v / 1000);
  const setbackM = (v: number) => (v < 100 ? v : v / 1000);
  const plotWidthM = toM(input.site.plotWidth);
  const plotDepthM = toM(input.site.plotDepth);
  const sb = input.site.setbacks;
  const rulesProfile = getApartmentRulesProfile(cfg.jurisdiction || 'pune_pmc', {
    floorCount: cfg.floorCount,
    buildingHeightM: (cfg.floorCount || 4) * 3.1,
    tenementsPerFloor: cfg.flatsPerFloor,
  });
  const schematic = generateDeterministicApartmentSchematic({
    siteWidthM: plotWidthM,
    siteDepthM: plotDepthM,
    setbacksM: sb ? { front: setbackM(sb.front), rear: setbackM(sb.rear), left: setbackM(sb.left), right: setbackM(sb.right) } : undefined,
    flatsPerFloor: cfg.flatsPerFloor,
    unitMix: cfg.unitMix,
    commonCoreConfig: cfg.commonCore,
    floorType: cfg.floorStrategy,
    rulesProfile,
    ...(strategy ? { strategy } : {}),
  });
  return { schematic, plotWidthM, plotDepthM };
}

export interface InterpretationPayload {
  boundary: { points: { x: number; y: number }[] };
  rooms: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number; flatId: string }>;
  doors: unknown[];
  windows: unknown[];
  stairs: Array<{ id: string; name: string; x: number; y: number; width: number; height: number; flatId: string }>;
  parking: unknown[];
  flats: Array<{ id: string; label: string; unitType: string; x: number; y: number; width: number; height: number }>;
  lifts: Array<{ id: string; name: string; x: number; y: number; width: number; height: number; flatId: string }>;
  lobbies: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>;
  corridors: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>;
  shafts: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>;
}

/** Faithful interpretation of the schematic in Gemini's normalized 0–1000 frame. */
export function interpretationFromSchematic(
  schematic: DeterministicApartmentSchematic,
  plotWidthM: number,
  plotDepthM: number,
): InterpretationPayload {
  const fx = APARTMENT_INTERPRETATION_FRAME.width / plotWidthM;
  const fy = APARTMENT_INTERPRETATION_FRAME.height / plotDepthM;
  const box = (r: Rect2D) => ({ x: r.x * fx, y: r.y * fy, width: r.width * fx, height: r.height * fy });
  const fp = schematic.buildingFootprint;
  return {
    boundary: {
      points: [
        { x: fp.x * fx, y: fp.y * fy },
        { x: (fp.x + fp.width) * fx, y: fp.y * fy },
        { x: (fp.x + fp.width) * fx, y: (fp.y + fp.height) * fy },
        { x: fp.x * fx, y: (fp.y + fp.height) * fy },
      ],
    },
    rooms: schematic.units.flatMap(u =>
      [...u.rooms, ...u.balconies].map(r => ({ id: `${u.flatId}__${r.id}`, name: r.name, type: r.type, flatId: u.flatId, ...box(r.bounds) })),
    ),
    doors: schematic.doors.map(d=>{
      const sid=(id:string)=>schematic.units.flatMap(u=>[...u.rooms,...u.balconies].map(room=>({id:room.id,mapped:`${u.flatId}__${room.id}`}))).find(r=>r.id===id)?.mapped??id;
      return {id:d.id,type:d.doorType,swingDirection:d.swing,adjacentRoomId:sid(d.connects[0]),connectsRooms:d.connects.map(sid),...box(d.bounds)};
    }),
    windows: [],
    stairs: schematic.core.stairs.map(s => ({ id: s.id, name: s.label, flatId: COMMON_AREA_FLAT_ID, ...box(s.bounds) })),
    parking: [],
    flats: schematic.units.map(u => ({ id: u.flatId, label: u.flatLabel, unitType: u.unitType, ...box(u.bounds) })),
    lifts: schematic.core.lifts.map(l => ({ id: l.id, name: l.label, flatId: COMMON_AREA_FLAT_ID, ...box(l.bounds) })),
    lobbies: [{ id: 'core_lobby', name: schematic.core.lobby.label, ...box(schematic.core.lobby.bounds) }],
    corridors: schematic.core.corridors.map((c, i) => ({ id: `corridor_${i+1}`, name: c.label, ...box(c.bounds) })),
    shafts: schematic.core.serviceShafts.map((s, i) => ({ id: `shaft_${i}`, name: s.label, ...box(s.bounds) })),
  };
}
