import { architectureHash, mepSchemaErrors, MEP_PIPE_DIAMETERS, type Building, type Floor, type Polygon, type Point, type CanonicalMepFixture, type CanonicalMepSystems, type MepPlacementIssue, type MepShaft, type ServiceShaftStack, type PipeService } from '@ai-floor-planner/core';
import { containsPolygon, polygonBoundingBox, polygonCentroid } from './polygon';
import { columnFootprint, beamFootprint, hardeningOverlapArea, projectOnSegment } from './hardening-geometry';
import { wallToPolygon } from './walls';
import { pointInPolygon } from './point';

export const MEP_FINISH_OFFSET_MM=8;
export function mepFloorElevations(building:Building):Map<string,number>{
  const result=new Map<string,number>();let z=0;
  for(const f of [...building.floors].sort((a,b)=>a.level-b.level)){z=f.elevationMm??z;result.set(f.id,z);z+=f.floorHeight;}
  return result;
}
export function mepFootprint(f:Pick<CanonicalMepFixture,'position'|'rotationRad'|'widthMm'|'depthMm'>,padding=0):Polygon {
  const c=Math.cos(f.rotationRad),s=Math.sin(f.rotationRad),w=f.widthMm/2+padding,d=f.depthMm/2+padding;
  return {points:[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,y])=>({x:f.position.x+c*x!-s*y!,y:f.position.y+s*x!+c*y!}))};
}
export function mepPipeFootprint(position:Point,diameter:number):Polygon {
  return {points:Array.from({length:32},(_,i)=>({x:position.x+diameter/2*Math.cos(i*Math.PI/16),y:position.y+diameter/2*Math.sin(i*Math.PI/16)}))};
}
const zOverlap=(a:number,b:number,c:number,d:number)=>Math.min(b,d)-Math.max(a,c)>0.001;
function structuralOverlap(floor:Floor,poly:Polygon,bottom:number,top:number):boolean {
  return floor.columns.some(c=>hardeningOverlapArea(poly,columnFootprint(c))>0.001)
    ||(zOverlap(bottom,top,floor.floorHeight-450,floor.floorHeight)&&(floor.beams??[]).some(b=>hardeningOverlapArea(poly,beamFootprint(b))>0.001));
}
function symbolFootprint(f:CanonicalMepFixture):Polygon {
  const size=f.type==='PENDENT_SPRINKLER'?100:Math.max(f.widthMm,80);
  return mepFootprint({...f,widthMm:size,depthMm:Math.max(f.depthMm,80)},15);
}
function roomHasShaft(floor:Floor,poly:Polygon):boolean {
  return [...floor.rooms.filter(r=>['service_shaft','ots'].includes(r.type)).map(r=>r.boundary),...(floor.voidBoundaries??[])].some(p=>containsPolygon(p,poly));
}
export function validateMepGeometry(building:Building):MepPlacementIssue[] {
  if(!building.mep)return [];
  const issues:MepPlacementIssue[]=mepSchemaErrors(building).map(message=>({code:'MEP_SCHEMA_INVALID',message}));
  if(issues.length)return issues;
  const m=building.mep;
  if(m.sourceArchitectureHash!==architectureHash(building))issues.push({code:'STALE_MEP_ARCHITECTURE',message:'Architecture changed; regenerate MEP before export.'});
  const elevations=mepFloorElevations(building);
  for(const fixture of m.fixtures) {
    const floor=building.floors.find(f=>f.id===fixture.floorId)!,room=floor.rooms.find(r=>r.id===fixture.roomId)!;
    const footprint=mepFootprint(fixture),bottom=fixture.elevationAfflMm+MEP_FINISH_OFFSET_MM,top=bottom+fixture.heightMm;
    const fail=(code:string,message:string)=>issues.push({code,entityId:fixture.id,floorId:floor.id,roomId:room.id,message});
    if(!containsPolygon(room.boundary,footprint)||top>floor.floorHeight-(floor.slabThicknessMm??150)+0.001)fail('MEP_OUTSIDE_ROOM','Fixture exceeds its room or ceiling soffit');
    if(structuralOverlap(floor,footprint,bottom,top))fail('MEP_STRUCTURE_COLLISION','Fixture intersects a column or beam');
    if(floor.walls.some(w=>hardeningOverlapArea(footprint,wallToPolygon(w))>0.001))fail('MEP_WALL_COLLISION','Fixture penetrates a wall');
    if(fixture.mounting==='WALL') {
      const wall=floor.walls.find(w=>w.id===fixture.hostWallId);
      if(!wall)fail('MEP_HOST_REQUIRED','Wall mounted equipment requires a registered wall');
      else {
        const p=projectOnSegment(fixture.position,wall.startPoint,wall.endPoint);
        const actual=(p?.distance??Infinity)-wall.thickness/2-fixture.depthMm/2;
        if(Math.abs(actual-10)>0.1)fail('MEP_FINISH_OFFSET_INVALID','Wall equipment must stand 10 mm forward of the wall face');
      }
    }
    if(fixture.type==='PENDENT_SPRINKLER') {
      const p=mepFootprint({...fixture,widthMm:600,depthMm:600});
      if(!containsPolygon(room.boundary,p)||floor.walls.some(w=>hardeningOverlapArea(p,wallToPolygon(w))>0.001))fail('SPRINKLER_WALL_CLEARANCE','Sprinkler needs 300 mm wall clearance');
    }
  }
  for(let i=0;i<m.fixtures.length;i++)for(const other of m.fixtures.slice(i+1)) {
    const f=m.fixtures[i]!;
    if(f.floorId===other.floorId&&hardeningOverlapArea(symbolFootprint(f),symbolFootprint(other))>0.001)
      issues.push({code:'MEP_SYMBOL_COLLISION',floorId:f.floorId,entityId:f.id,message:'Fixture CAD symbol overlaps '+other.id});
  }
  for(const stack of m.stacks) {
    const shaft=m.shafts.find(s=>s.id===stack.shaftId)!,poly=mepPipeFootprint(stack.position,stack.outerDiameterMm);
    if(stack.outerDiameterMm!==MEP_PIPE_DIAMETERS[stack.service])issues.push({code:'PIPE_DIAMETER_INVALID',entityId:stack.id,message:'Pipe OD differs from supplied design brief'});
    for(const id of stack.floorIds) {
      const floor=building.floors.find(f=>f.id===id)!,boundary=shaft.floors.find(f=>f.floorId===id)?.boundary;
      if(!boundary||!roomHasShaft(floor,boundary)||!containsPolygon(boundary,poly)||!containsPolygon(floor.boundary,poly))
        issues.push({code:'PIPE_OUTSIDE_REGISTERED_SHAFT',floorId:id,entityId:stack.id,message:'Every pipe level needs an existing registered shaft/void'});
      const z=elevations.get(id)!;
      if(structuralOverlap(floor,poly,stack.bottomMm-z,stack.topMm-z))issues.push({code:'PIPE_STRUCTURE_COLLISION',floorId:id,entityId:stack.id,message:'Vertical stack intersects structure'});
      if(floor.walls.some(w=>hardeningOverlapArea(poly,wallToPolygon(w))>0.001))issues.push({code:'PIPE_WALL_COLLISION',floorId:id,entityId:stack.id,message:'Pipe penetrates enclosure'});
    }
  }
  for(let i=0;i<m.stacks.length;i++)for(const other of m.stacks.slice(i+1)){
    const s=m.stacks[i]!;
    if(zOverlap(s.bottomMm,s.topMm,other.bottomMm,other.topMm)&&Math.hypot(s.position.x-other.position.x,s.position.y-other.position.y)<(s.outerDiameterMm+other.outerDiameterMm)/2+10)
      issues.push({code:'PIPE_PIPE_COLLISION',entityId:s.id,message:'Insufficient separation between vertical stacks'});
  }
  return issues;
}
export function assertMepGeometry(building:Building):void {
  const errors=validateMepGeometry(building);
  if(errors.length)throw new Error(errors.slice(0,8).map(e=>e.code+': '+e.message).join('; '));
}
/** Pure deterministic proposal. Unplaceable equipment is reported, never moved through structure. */
export function proposeMepSystems(building:Building):CanonicalMepSystems {
  const fixtures:CanonicalMepFixture[]=[],issues:MepPlacementIssue[]=[],shafts:MepShaft[]=[],stacks:ServiceShaftStack[]=[];
  const empty=():CanonicalMepSystems=>({sourceRevision:building.version,sourceArchitectureHash:architectureHash(building),status:'PROPOSED_REQUIRES_REVIEW',fixtures,shafts,stacks,issues,hydraulicDesign:'NOT_VERIFIED',electricalDesign:'NOT_VERIFIED',fireCoverage:'NOT_VERIFIED'});
  const attempt=(candidate:CanonicalMepFixture):boolean=>{
    const source={...building,mep:{...empty(),fixtures:[candidate],stacks:[]}};
    if(validateMepGeometry(source).length)return false;
    const shape=symbolFootprint(candidate);
    if(fixtures.some(f=>f.floorId===candidate.floorId&&hardeningOverlapArea(shape,symbolFootprint(f))>0.001))return false;
    fixtures.push(candidate);return true;
  };
  const fail=(code:string,floorId:string,roomId:string,message:string)=>issues.push({code,floorId,roomId,message});
  for(const floor of [...building.floors].sort((a,b)=>a.level-b.level)){
    const soffit=floor.floorHeight-(floor.slabThicknessMm??150)-MEP_FINISH_OFFSET_MM;
    for(const room of [...floor.rooms].sort((a,b)=>a.id.localeCompare(b.id))){
      if(['service_shaft','ots','lift','staircase','balcony','utility','terrace','garden'].includes(room.type))continue;
      const base={floorId:floor.id,roomId:room.id,unitId:room.unitId,rotationRad:0,provenance:'ASSERTED_FROM_BRIEF' as const};
      let serial=0;
      const make=(kind:CanonicalMepFixture['kind'],type:CanonicalMepFixture['type'],w:number,d:number,h:number,z:number,position:Point,mounting:CanonicalMepFixture['mounting'],hostWallId?:string,rotationRad=0):CanonicalMepFixture=>({
        ...base,id:`mep:${room.id}:${type}:${serial++}`,kind,type,widthMm:w,depthMm:d,heightMm:h,elevationAfflMm:z,position,mounting,hostWallId,rotationRad,
        provenance:['CEILING_LIGHT','CEILING_FAN'].includes(type)?'VISUALIZATION_DEFAULT':'ASSERTED_FROM_BRIEF',
      } as CanonicalMepFixture);
      const walls=floor.walls.filter(w=>w.roomIds.includes(room.id)||w.leftRoomId===room.id||w.rightRoomId===room.id).sort((a,b)=>a.id.localeCompare(b.id));
      const mount=(kind:CanonicalMepFixture['kind'],type:CanonicalMepFixture['type'],w:number,d:number,h:number,z:number,entranceOnly=false)=>{
        for(const wall of walls) {
          const dx=wall.endPoint.x-wall.startPoint.x,dy=wall.endPoint.y-wall.startPoint.y,length=Math.hypot(dx,dy);
          if(length<w+100)continue;
          const door=floor.doors.find(o=>o.wallId===wall.id&&o.connectsRooms.includes(room.id));
          if(entranceOnly&&!door)continue;
          const along=door?((door.position.x-wall.startPoint.x)*dx+(door.position.y-wall.startPoint.y)*dy)/length:length/2;
          const offsets=door?[along+door.width/2+125+w/2,along-door.width/2-125-w/2]:[along,along-200,along+200,along-500,along+500,along-800,along+800];
          for(const a of offsets)for(const sign of [1,-1]){
            if(a<w/2+20||a>length-w/2-20)continue;
            const normal=(wall.thickness/2+10+d/2)*sign;
            const position={x:wall.startPoint.x+dx/length*a-dy/length*normal,y:wall.startPoint.y+dy/length*a+dx/length*normal};
            const f=make(kind,type,w,d,h,z,position,kind==='PLUMBING'?'CONNECTION':'WALL',wall.id,Math.atan2(dy,dx));
            if(attempt(f))return f;
          }
        }
        fail('MEP_POSITION_UNAVAILABLE',floor.id,room.id,type+': no collision-free registered wall position');return undefined;
      };
      const center=polygonCentroid(room.boundary),box=polygonBoundingBox(room.boundary);
      const ceiling=(kind:CanonicalMepFixture['kind'],type:CanonicalMepFixture['type'],w:number,h:number,p:Point)=>{
        if(!attempt(make(kind,type,w,w,h,soffit-h,p,'CEILING')))fail('MEP_CEILING_POSITION_UNAVAILABLE',floor.id,room.id,type+': center/bay position blocked');
      };
      if(floor.floorUse==='RESIDENTIAL'||floor.floorUse===undefined){
        mount('ELECTRICAL','SWITCHBOARD_PRIMARY',150,45,120,1200,true);
        if(['living','bedroom','study'].includes(room.type)){
          mount('ELECTRICAL','SOCKET_6A',80,45,80,300);
          mount('ELECTRICAL','SOCKET_16A_POWER',80,45,80,300);
          ceiling('ELECTRICAL','CEILING_FAN',1200,160,center);
          for(const sign of [-1,1])ceiling('ELECTRICAL','CEILING_LIGHT',200,40,{x:center.x+sign*box.width/4,y:center.y});
        }else ceiling('ELECTRICAL','CEILING_LIGHT',200,40,center);
        if(room.type==='kitchen'){
          mount('ELECTRICAL','SOCKET_16A_POWER',80,45,80,1200);
          mount('ELECTRICAL','SWITCHBOARD_SECONDARY',150,45,120,1200);
          mount('PLUMBING','KITCHEN_SINK_DRAIN',40,40,40,600);
          mount('PLUMBING','KITCHEN_SINK_SUPPLY',40,40,40,900);
        }
        if(room.type==='bathroom'){
          mount('PLUMBING','WC_DRAIN',110,110,40,150);
          mount('PLUMBING','WASHBASIN_DRAIN',40,40,40,550);
          mount('PLUMBING','WASHBASIN_SUPPLY',40,40,40,850);
        }
        if(room.type==='foyer')mount('ELECTRICAL','DISTRIBUTION_BOARD',400,100,600,1800,true);
      }
      const common=(room.type==='corridor'&&room.spaceUse!=='UNIT')||room.type==='foyer'||room.type==='parking';
      if(common||floor.floorUse==='STILT_PARKING'){
        const nx=Math.floor((box.width-600)/3500)+1,ny=Math.floor((box.height-600)/3500)+1;
        for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){
          const p={x:box.x+box.width/2+(x-(nx-1)/2)*3500,y:box.y+box.height/2+(y-(ny-1)/2)*3500};
          ceiling('FIRE','PENDENT_SPRINKLER',30,65,p);
        }
      }
      if((room.type==='foyer'||(room.type==='corridor'&&room.spaceUse!=='UNIT')||room.tags.includes('ELECTRICAL_METER_ROOM'))&&!room.unitId)
        ceiling('FIRE','SMOKE_DETECTOR',100,40,center);
      const adjacentStair=floor.doors.some(d=>d.connectsRooms.includes(room.id)&&d.connectsRooms.some(id=>floor.rooms.some(r=>r.id===id&&r.type==='staircase')));
      if(adjacentStair||(floor.floorUse==='STILT_PARKING'&&common))mount('FIRE','ABC_6KG_EXTINGUISHER',150,150,500,1000);
    }
  }
  // Derive aligned service enclosures only from registered source rooms/voids; never from lifts.
  const levels=[...building.floors].sort((a,b)=>a.level-b.level),first=levels[0]!;
  const candidates=first.rooms.filter(r=>['service_shaft','ots'].includes(r.type));
  for(const room of candidates){
    const center=polygonCentroid(room.boundary),id='mep:shaft:'+room.id;
    const entries=levels.map(f=>{const match=f.rooms.find(r=>['service_shaft','ots'].includes(r.type)&&pointInPolygon(center,r.boundary));return match?{floorId:f.id,boundary:match.boundary,sourceRoomId:match.id}:undefined;});
    if(entries.some(e=>!e)){fail('SHAFT_DISCONTINUOUS',first.id,room.id,'Service shaft does not exist at every physical floor');continue;}
    shafts.push({id,type:room.tags.includes('FIRE_RISER')?'FIRE_RISER':room.type==='ots'?'OTS_SHAFT':'PLUMBING_CHASE',enclosureWallThicknessMm:100,floors:entries as MepShaft['floors']});
  }
  for(const registered of building.mep?.shafts??[])if(!shafts.some(s=>s.id===registered.id))shafts.push(registered);
  const zs=mepFloorElevations(building),last=levels[levels.length-1]!;
  for(const shaft of shafts){
    const poly=shaft.floors[0]?.boundary;if(!poly)continue;
    const box=polygonBoundingBox(poly);
    const services:PipeService[]=shaft.type==='FIRE_RISER'?['WET_RISER']:['SOIL','WASTE','VENT','RAINWATER'];
    for(const service of services){
      const diameter=MEP_PIPE_DIAMETERS[service];let placed=false;
      for(let y=box.y+diameter/2+110;y<=box.y+box.height-diameter/2-110&&!placed;y+=100)for(let x=box.x+diameter/2+110;x<=box.x+box.width-diameter/2-110&&!placed;x+=100){
        const stack:ServiceShaftStack={id:`mep:${shaft.id}:${service}`,shaftId:shaft.id,service,floorIds:levels.map(f=>f.id),position:{x,y},outerDiameterMm:diameter,bottomMm:zs.get(first.id)!,topMm:zs.get(last.id)!+last.floorHeight-(last.slabThicknessMm??150),provenance:'ASSERTED_FROM_BRIEF'};
        const test={...building,mep:{...empty(),fixtures:[],stacks:[...stacks,stack]}};
        if(!validateMepGeometry(test).length){stacks.push(stack);placed=true;}
      }
      if(!placed)issues.push({code:'PIPE_ROUTE_UNAVAILABLE',entityId:shaft.id,message:service+': no continuous collision-free shaft route'});
    }
  }
  if(!shafts.length)issues.push({code:'SHAFT_NOT_REGISTERED',message:'No continuous designated plumbing shaft; soil/waste/vent/rainwater stacks not invented.'});
  if(!stacks.some(s=>s.service==='WET_RISER'))issues.push({code:'FIRE_RISER_NOT_REGISTERED',message:'A reviewed fire riser recess/shaft is required; no pipe is placed in a staircase flight or lift.'});
  issues.push({code:'ENGINEERING_REVIEW_REQUIRED',message:'Brief dimensions and 3.5m sprinkler grid are proposals. Fire coverage/hydraulics, electrical circuits, drainage gradients, firestopping and local statutory applicability remain NOT_VERIFIED.'});
  return empty();
}
