import type { Building } from '../types/building';
import { canonicalBuildingHash } from '../models/canonical-revision';
export function architectureHash(building:Building):string {
  const {mep:_mep,version:_version,updatedAt:_updatedAt,...architecture}=building;
  return canonicalBuildingHash(architecture as Building);
}
/** Structural runtime schema guard; geometric validation remains in geometry-engine. */
export function mepSchemaErrors(building:unknown):string[] {
  const b=building as Building;
  if(!b||b.mep===undefined)return [];
  const m=b.mep,e:string[]=[];
  if(!m||!Array.isArray(m.fixtures)||!Array.isArray(m.shafts)||!Array.isArray(m.stacks)||!Array.isArray(m.issues))return ['MEP arrays are required'];
  if(m.status!=='PROPOSED_REQUIRES_REVIEW'||m.hydraulicDesign!=='NOT_VERIFIED'||m.electricalDesign!=='NOT_VERIFIED'||m.fireCoverage!=='NOT_VERIFIED')e.push('MEP professional status must remain unverified');
  if(!Number.isInteger(m.sourceRevision)||typeof m.sourceArchitectureHash!=='string')e.push('MEP source revision/hash required');
  const ids=new Set<string>(),floorIds=new Set(b.floors?.map(f=>f.id));
  const claim=(id:string)=>{if(!id||ids.has(id))e.push('Missing or duplicate MEP id');ids.add(id);};
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
  const positive=(n:unknown)=>finite(n)&&(n as number)>0;
  const types:Record<string,readonly string[]>={
    ELECTRICAL:['SWITCHBOARD_PRIMARY','SWITCHBOARD_SECONDARY','SOCKET_16A_POWER','SOCKET_6A','DISTRIBUTION_BOARD','CEILING_LIGHT','CEILING_FAN'],
    PLUMBING:['WC_DRAIN','KITCHEN_SINK_DRAIN','KITCHEN_SINK_SUPPLY','WASHBASIN_DRAIN','WASHBASIN_SUPPLY'],
    FIRE:['PENDENT_SPRINKLER','SMOKE_DETECTOR','ABC_6KG_EXTINGUISHER','LANDING_VALVE'],
  };
  for(const f of m.fixtures){
    if(!f||typeof f!=='object'){e.push('Invalid MEP fixture');continue;}claim(f.id);
    if(!floorIds.has(f.floorId)||!types[f.kind]?.includes(f.type)||!['WALL','CEILING','CONNECTION'].includes(f.mounting)
      ||![f.position?.x,f.position?.y,f.rotationRad,f.elevationAfflMm].every(finite)||f.elevationAfflMm<0
      ||![f.widthMm,f.depthMm,f.heightMm].every(positive)||!['ASSERTED_FROM_BRIEF','VISUALIZATION_DEFAULT'].includes(f.provenance))e.push('Invalid MEP fixture '+f.id);
    const floor=b.floors?.find(x=>x.id===f.floorId);
    if(!floor?.rooms.some(r=>r.id===f.roomId)||(f.hostWallId&&!floor.walls.some(w=>w.id===f.hostWallId)))e.push('Unknown MEP host '+f.id);
  }
  for(const s of m.shafts){
    if(!s||!Array.isArray(s.floors)){e.push('Invalid shaft');continue;}claim(s.id);
    if(!['OTS_SHAFT','PLUMBING_CHASE','FIRE_RISER'].includes(s.type)||s.enclosureWallThicknessMm!==100)e.push('Invalid shaft classification');
    for(const f of s.floors)if(!f||!floorIds.has(f.floorId)||!Array.isArray(f.boundary?.points)||f.boundary.points.length<3||!f.boundary.points.every((p:{x?:unknown;y?:unknown})=>p&&finite(p.x)&&finite(p.y)))e.push('Invalid shaft polygon');
  }
  for(const s of m.stacks){
    if(!s){e.push('Invalid stack');continue;}claim(s.id);
    if(!m.shafts.some(h=>h?.id===s.shaftId)||!Array.isArray(s.floorIds)||!s.floorIds.length||!s.floorIds.every((id:string)=>floorIds.has(id))
      ||!['SOIL','WASTE','VENT','RAINWATER','WET_RISER'].includes(s.service)||!positive(s.outerDiameterMm)
      ||![s.position?.x,s.position?.y,s.bottomMm,s.topMm].every(finite)||s.topMm<=s.bottomMm)e.push('Invalid MEP stack '+s.id);
  }
  return e;
}
