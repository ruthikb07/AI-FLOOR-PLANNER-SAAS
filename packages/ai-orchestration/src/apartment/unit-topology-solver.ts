/**
 * Unit-Level Topology & Furnishability Solver (§14, §15, §23).
 *
 * Implements:
 * - Deterministic room topology inside each apartment envelope for 1BHK, 2BHK, 3BHK, 4BHK.
 * - Explicit parentUnitId on EVERY room (no orphan rooms).
 * - Meaningful exterior facade exposure for living, bedrooms, and kitchen.
 * - Architectural furnishability verification (bed, wardrobe, seating, dining table, kitchen counter aisle).
 * - Avoids critical layout anti-patterns (no kitchen through bedroom, no bedroom through bedroom).
 */

import { type ApartmentEnvelope, type EnvelopeRect } from './envelope-solver.js';
import { type ResidentialUnitType } from './program-registry.js';

export interface SolvedUnitRoom {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentUnitId: string;
  readonly bounds: EnvelopeRect;
  readonly areaSqM: number;
  readonly zone: 'PUBLIC' | 'SERVICE' | 'PRIVATE' | 'OUTDOOR';
  readonly onFacade: boolean;
  readonly hasBalcony?: boolean;
  readonly isEnsuite?: boolean;
  readonly ensuiteOf?: string;
  readonly hostRoomId?: string;
  readonly furnishabilityStatus: 'PASS' | 'WARNING';
  readonly furnishabilityNotes: readonly string[];
}

export interface SolvedUnitDoor {
  readonly id: string;
  readonly parentUnitId: string;
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly kind: 'flat_entrance' | 'internal' | 'balcony';
  readonly doorType: 'single' | 'double' | 'sliding' | 'open_passage';
  readonly widthM: number;
  readonly center: { x: number; y: number };
  readonly wallAxis: 'x' | 'y';
}

export interface SolvedUnitTopology {
  readonly unitId: string;
  readonly label: string;
  readonly unitType: ResidentialUnitType | string;
  readonly boundary: EnvelopeRect;
  readonly rooms: readonly SolvedUnitRoom[];
  readonly doors: readonly SolvedUnitDoor[];
  readonly entrancePoint: { x: number; y: number };
  readonly actualCarpetAreaSqM: number;
  readonly actualBuiltUpAreaSqM: number;
  readonly bedroomsCount: number;
  readonly bathroomsCount: number;
  readonly furnishabilityPassed: boolean;
  readonly hardErrors: readonly string[];
}

/**
 * Checks furniture fit for an individual room.
 */
export function checkRoomFurnishability(
  type: string,
  width: number,
  height: number,
  area: number,
): { status: 'PASS' | 'WARNING'; notes: string[] } {
  const notes: string[] = [];
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  if (minDim > 0 && maxDim / minDim > 2.8) {
    notes.push(`Room aspect ratio (${(maxDim / minDim).toFixed(1)}:1) is elongated.`);
  }

  if (type === 'master_bedroom' || type === 'bedroom') {
    if (minDim < 2.8) {
      notes.push(`Bedroom narrow (${minDim.toFixed(2)}m < 2.8m); bed and wardrobe placement will be constrained.`);
    }
    if (area < 9.5) {
      notes.push(`Bedroom area (${area.toFixed(1)}m² < 9.5m²) is tight for standard double bed layout.`);
    }
  } else if (type === 'living_dining') {
    if (minDim < 3.0) {
      notes.push(`Living/Dining width (${minDim.toFixed(2)}m < 3.0m) restricts seating cluster depth.`);
    }
    if (area < 18.0) {
      notes.push(`Combined living/dining area (${area.toFixed(1)}m² < 18.0m²) is below standard.`);
    }
  } else if (type === 'kitchen') {
    if (minDim < 1.8) {
      notes.push(`Kitchen aisle narrow (${minDim.toFixed(2)}m < 1.8m); parallel counters not possible.`);
    }
    if (area < 5.5) {
      notes.push(`Kitchen area (${area.toFixed(1)}m² < 5.5m²) is compact.`);
    }
  } else if (type === 'master_toilet' || type === 'common_toilet' || type === 'attached_toilet') {
    if (minDim < 1.2) {
      notes.push(`Bathroom width (${minDim.toFixed(2)}m < 1.2m) is below comfortable fixture clearance.`);
    }
  }

  return {
    status: notes.length === 0 ? 'PASS' : 'WARNING',
    notes,
  };
}

/**
 * Generalized solver for unit topology across 1BHK, 2BHK, 3BHK, 4BHK envelopes.
 */
export function solveUnitTopology(envelope: ApartmentEnvelope): SolvedUnitTopology {
  const {unitId, boundary, unitType} = envelope;
  const match = /^([1234])BHK$/i.exec(unitType.toUpperCase());
  if (!match) throw new Error(`UNSUPPORTED_UNIT_TYPE: ${unitType}`);
  const bedroomsCount = Number(match[1]);
  const bathroomsCount = bedroomsCount;
  const side = envelope.entranceEdge.side;
  const vertical = side === 'east' || side === 'west';
  const W = vertical ? boundary.height : boundary.width;
  const D = vertical ? boundary.width : boundary.height;
  // Local v points inward from the entrance face. Transform the whole graph,
  // including the physical doors, so side changes do not change ownership.
  const mirror = !envelope.exteriorFacades.includes(vertical?'north':'east');
  const point = (inputU:number,v:number) => {const u=mirror?W-inputU:inputU;return side==='south' ? {x:boundary.x+u,y:boundary.y+v} : side==='north' ? {x:boundary.x+u,y:boundary.y+D-v} : side==='west' ? {x:boundary.x+v,y:boundary.y+u} : {x:boundary.x+D-v,y:boundary.y+u};};
  const rooms:SolvedUnitRoom[]=[];
  const doors:SolvedUnitDoor[]=[];
  const hardErrors:string[]=[];
  const add = (suffix:string,name:string,type:string,u:number,v:number,w:number,h:number,zone:SolvedUnitRoom['zone'],extra:Partial<SolvedUnitRoom>={}) => {
    const a=point(u,v), b=point(u+w,v+h);
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);
    const furnish=checkRoomFurnishability(type,width,height,width*height);
    const onFacade = (u===0&&envelope.exteriorFacades.includes(vertical?'south':'west')) || (u+w===W&&envelope.exteriorFacades.includes(vertical?'north':'east')) || v+h===D;
    const room:SolvedUnitRoom={id:`${unitId}_${suffix}`,name,type,parentUnitId:unitId,bounds:{x,y,width,height},areaSqM:width*height,zone,onFacade,furnishabilityStatus:furnish.status,furnishabilityNotes:furnish.notes,...extra};
    if(w<=0||h<=0) hardErrors.push(`ROOM_GEOMETRY_INVALID: ${room.id}`);
    rooms.push(room);return room;
  };
  const connect=(a:SolvedUnitRoom,b:SolvedUnitRoom,kind:SolvedUnitDoor['kind']='internal',widthM=0.8) => {
    const A=a.bounds,B=b.bounds; let center:{x:number;y:number}|undefined;let wallAxis:'x'|'y'='x';
    const loX=Math.max(A.x,B.x),hiX=Math.min(A.x+A.width,B.x+B.width);
    const loY=Math.max(A.y,B.y),hiY=Math.min(A.y+A.height,B.y+B.height);
    if(Math.abs(A.y+A.height-B.y)<1e-6||Math.abs(B.y+B.height-A.y)<1e-6) {if(hiX-loX>=widthM+0.2) center={x:(loX+hiX)/2,y:Math.max(A.y,B.y)};}
    else if(Math.abs(A.x+A.width-B.x)<1e-6||Math.abs(B.x+B.width-A.x)<1e-6) {wallAxis='y';if(hiY-loY>=widthM+0.2) center={x:Math.max(A.x,B.x),y:(loY+hiY)/2};}
    if(!center) {hardErrors.push(`REQUIRED_ACCESS_OPENING_MISSING: ${a.id} -> ${b.id}`);return;}
    doors.push({id:`${unitId}_door_${doors.length+1}`,parentUnitId:unitId,fromRoomId:a.id,toRoomId:b.id,kind,doorType:kind==='balcony'?'sliding':'single',widthM,center,wallAxis});
  };
  const foyerH=1.8, publicH=3.3, passageH=1.2, privateStart=foyerH+publicH+passageH;
  const foyer=add('foyer','Entrance Foyer','foyer',0,0,W,foyerH,'PUBLIC');
  const commonBath=add('common_bath','Common Toilet','common_toilet',0,foyerH,1.5,publicH,'SERVICE');
  const kitchen=add('kitchen','Kitchen','kitchen',1.5,foyerH,3,2.1,'SERVICE');
  const utility=add('utility','Utility','utility',1.5,foyerH+2.1,3,1.2,'SERVICE');
  const hasBalconyFacade=envelope.exteriorFacades.includes(vertical?'north':'east')||envelope.exteriorFacades.includes(vertical?'south':'west');
  const living=add('living_dining','Living and Dining','living_dining',4.5,foyerH,W-(hasBalconyFacade?6.3:4.5),publicH,'PUBLIC');
  // One deliberate exterior recess, sized before room placement; never leftover.
  const balcony=hasBalconyFacade?add('living_balcony','Living Balcony','balcony',W-1.8,foyerH,1.8,publicH,'OUTDOOR',{hostRoomId:living.id,hasBalcony:true}):undefined;
  const passage=add('private_passage','Private Passage','passage',0,foyerH+publicH,W,passageH,'PRIVATE');
  connect(foyer,living,'internal',1.0);connect(foyer,kitchen);connect(foyer,commonBath);connect(kitchen,utility);connect(living,passage,'internal',1.0);if(balcony)connect(living,balcony,'balcony',1.8);
  for(let i=0;i<bedroomsCount;i++) {
    const slot=W/bedroomsCount,u=i*slot,attached=i<bedroomsCount-1;
    const bathH=attached?1.8:0;
    const bed=add(i===0?'master_bed':`bed_${i+1}`,i===0?'Master Bedroom':`Bedroom ${i+1}`,i===0?'master_bedroom':'bedroom',u,privateStart+bathH,slot,D-privateStart-bathH,'PRIVATE');
    if(attached) {
      const bath=add(i===0?'master_bath':`bath_${i+1}`,i===0?'Master En-suite Toilet':`Attached Toilet ${i+1}`,'master_toilet',u,privateStart,1.5,bathH,'SERVICE',{isEnsuite:true,ensuiteOf:bed.id});
      const access=add(`suite_access_${i+1}`,'Private Suite Access','passage',u+1.5,privateStart,slot-1.5,bathH,'PRIVATE',{hostRoomId:bed.id});
      connect(passage,access);connect(access,bed);connect(bed,bath);
    } else connect(passage,bed);
  }
  doors.push({id:`${unitId}_entrance`,parentUnitId:unitId,fromRoomId:'common_lobby',toRoomId:foyer.id,kind:'flat_entrance',doorType:'single',widthM:1.05,center:envelope.commonLobbyConnection.doorPoint,wallAxis:envelope.commonLobbyConnection.wallAxis});
  // Interior carpet excludes the balcony; no percentage is invented as measured area.
  const actualCarpetAreaSqM=rooms.filter(r=>r.zone!=='OUTDOOR').reduce((sum,r)=>sum+r.areaSqM,0);
  return {unitId,label:envelope.label,unitType,boundary,rooms,doors,entrancePoint:envelope.commonLobbyConnection.doorPoint,actualCarpetAreaSqM,actualBuiltUpAreaSqM:boundary.width*boundary.height,bedroomsCount,bathroomsCount,furnishabilityPassed:rooms.every(r=>r.furnishabilityStatus==='PASS'),hardErrors};

}

/**
 * Backward compatibility wrapper for 3BHK unit topology solving.
 */
export function solve3BhkUnitTopology(envelope: ApartmentEnvelope): SolvedUnitTopology {
  return solveUnitTopology(envelope);
}
