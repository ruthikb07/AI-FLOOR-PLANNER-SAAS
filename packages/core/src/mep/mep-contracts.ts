import type { Point, Polygon } from '../types/geometry';
/** All lengths mm. Fixture elevation is its body's bottom above finished floor level. */
export type ElectricalFixtureType='SWITCHBOARD_PRIMARY'|'SWITCHBOARD_SECONDARY'|'SOCKET_16A_POWER'|'SOCKET_6A'|'DISTRIBUTION_BOARD'|'CEILING_LIGHT'|'CEILING_FAN';
export type PlumbingFixtureType='WC_DRAIN'|'KITCHEN_SINK_DRAIN'|'KITCHEN_SINK_SUPPLY'|'WASHBASIN_DRAIN'|'WASHBASIN_SUPPLY';
export type FireSafetyFixtureType='PENDENT_SPRINKLER'|'SMOKE_DETECTOR'|'ABC_6KG_EXTINGUISHER'|'LANDING_VALVE';
export type PipeService='SOIL'|'WASTE'|'VENT'|'RAINWATER'|'WET_RISER';
export interface MepFixture {
  readonly id:string; readonly floorId:string; readonly roomId:string; readonly unitId?:string;
  readonly position:Point; readonly elevationAfflMm:number; readonly rotationRad:number;
  readonly widthMm:number; readonly depthMm:number; readonly heightMm:number;
  readonly hostWallId?:string; readonly mounting:'WALL'|'CEILING'|'CONNECTION';
  readonly provenance:'ASSERTED_FROM_BRIEF'|'VISUALIZATION_DEFAULT';
}
export interface ElectricalFixture extends MepFixture { readonly kind:'ELECTRICAL'; readonly type:ElectricalFixtureType }
export interface PlumbingFixture extends MepFixture { readonly kind:'PLUMBING'; readonly type:PlumbingFixtureType }
export interface FireSafetyFixture extends MepFixture { readonly kind:'FIRE'; readonly type:FireSafetyFixtureType }
export type CanonicalMepFixture=ElectricalFixture|PlumbingFixture|FireSafetyFixture;
/** Registered existing service space; never an invented room or a reserved lift shaft. */
export interface MepShaft {
  readonly id:string; readonly type:'OTS_SHAFT'|'PLUMBING_CHASE'|'FIRE_RISER';
  readonly enclosureWallThicknessMm:100;
  readonly floors:readonly {readonly floorId:string;readonly boundary:Polygon;readonly sourceRoomId?:string}[];
}
export interface ServiceShaftStack {
  readonly id:string; readonly shaftId:string; readonly service:PipeService;
  readonly floorIds:readonly string[]; readonly position:Point; readonly outerDiameterMm:number;
  readonly bottomMm:number; readonly topMm:number; readonly provenance:'ASSERTED_FROM_BRIEF';
}
export interface MepPlacementIssue {
  readonly code:string; readonly floorId?:string; readonly roomId?:string; readonly entityId?:string; readonly message:string;
}
export interface CanonicalMepSystems {
  readonly sourceRevision:number; readonly sourceArchitectureHash:string; readonly status:'PROPOSED_REQUIRES_REVIEW';
  readonly fixtures:readonly CanonicalMepFixture[]; readonly shafts:readonly MepShaft[];
  readonly stacks:readonly ServiceShaftStack[]; readonly issues:readonly MepPlacementIssue[];
  readonly hydraulicDesign:'NOT_VERIFIED'; readonly electricalDesign:'NOT_VERIFIED'; readonly fireCoverage:'NOT_VERIFIED';
}
export const MEP_PIPE_DIAMETERS:Readonly<Record<PipeService,number>>={SOIL:110,WASTE:75,VENT:50,RAINWATER:110,WET_RISER:100};
export const MEP_CAD_LAYERS={
  'E-POWR-PANL':1,'E-SWCH-WALL':2,'E-LITE-CLNG':3,'P-PIPE-SOIL':30,'P-PIPE-WAST':140,
  'P-PIPE-VENT':8,'P-PIPE-RAIN':150,'F-SPRN-HEAD':1,'F-SMOK-DETC':4,'F-EXTG-WVAL':1,
} as const;
export type MepCadLayer=keyof typeof MEP_CAD_LAYERS;
export function mepFixtureLayer(f:CanonicalMepFixture):MepCadLayer {
  if(f.kind==='ELECTRICAL')return f.type==='DISTRIBUTION_BOARD'?'E-POWR-PANL':['CEILING_LIGHT','CEILING_FAN'].includes(f.type)?'E-LITE-CLNG':'E-SWCH-WALL';
  if(f.kind==='FIRE')return f.type==='PENDENT_SPRINKLER'?'F-SPRN-HEAD':f.type==='SMOKE_DETECTOR'?'F-SMOK-DETC':'F-EXTG-WVAL';
  return f.type==='WC_DRAIN'?'P-PIPE-SOIL':'P-PIPE-WAST';
}
export function mepPipeLayer(service:PipeService):MepCadLayer {
  return ({SOIL:'P-PIPE-SOIL',WASTE:'P-PIPE-WAST',VENT:'P-PIPE-VENT',RAINWATER:'P-PIPE-RAIN',WET_RISER:'F-EXTG-WVAL'} as const)[service];
}
/** Supplied brief palette; this is not certification of pipe identification standards. */
export const MEP_MATERIALS={
  MAT_Fire_Red:{color:'#CC1100',roughness:0.25,metalness:0},
  MAT_Pipe_Soil:{color:'#B85D19',roughness:0.35,metalness:0},
  MAT_Pipe_Waste:{color:'#326699',roughness:0.35,metalness:0},
  MAT_Pipe_Vent:{color:'#555555',roughness:0.40,metalness:0},
  MAT_Pipe_Rain:{color:'#204C99',roughness:0.35,metalness:0},
  MAT_Electrical_Plate:{color:'#F0EFEA',roughness:0.20,metalness:0},
  MAT_Chrome_Sprinkler:{color:'#C6CCD1',roughness:0.10,metalness:1},
  MAT_Copper_Terminal:{color:'#B87333',roughness:0.30,metalness:1},
  MAT_Black_Nozzle:{color:'#181818',roughness:0.45,metalness:0},
} as const;
