from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'packages/ai-orchestration/src/apartment/unit-topology-solver.ts'
s=p.read_text(); start=s.index('  const { unitId, boundary, unitType } = envelope;'); end=s.index('\n}\n',start)
s=s[:start]+'''  const {unitId, boundary, unitType} = envelope;
  const match = /^([123])BHK$/.exec(unitType.toUpperCase());
  if (!match) throw new Error(`UNSUPPORTED_UNIT_TYPE: ${unitType}`);
  const bedroomsCount = Number(match[1]);
  const bathroomsCount = bedroomsCount;
  const side = envelope.entranceEdge.side;
  const vertical = side === 'east' || side === 'west';
  const W = vertical ? boundary.height : boundary.width;
  const D = vertical ? boundary.width : boundary.height;
  // Local v points inward from the entrance face. Transform the whole graph,
  // including the physical doors, so side changes do not change ownership.
  const point = (u:number,v:number) => side==='south' ? {x:boundary.x+u,y:boundary.y+v} : side==='north' ? {x:boundary.x+u,y:boundary.y+D-v} : side==='west' ? {x:boundary.x+v,y:boundary.y+u} : {x:boundary.x+D-v,y:boundary.y+u};
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
  const living=add('living_dining','Living and Dining','living_dining',4.5,foyerH,W-6,publicH,'PUBLIC');
  // One deliberate exterior recess, sized before room placement; never leftover.
  const balcony=add('living_balcony','Living Balcony','balcony',W-1.5,foyerH,1.5,publicH,'OUTDOOR',{hostRoomId:living.id,hasBalcony:true});
  const passage=add('private_passage','Private Passage','passage',0,foyerH+publicH,W,passageH,'PRIVATE');
  connect(foyer,living,'internal',1.0);connect(foyer,kitchen);connect(foyer,commonBath);connect(kitchen,utility);connect(living,passage,'internal',1.0);connect(living,balcony,'balcony',1.8);
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
  doors.push({id:`${unitId}_entrance`,parentUnitId:unitId,fromRoomId:'common_lobby',toRoomId:foyer.id,kind:'flat_entrance',doorType:'single',widthM:1,center:envelope.commonLobbyConnection.doorPoint,wallAxis:envelope.commonLobbyConnection.wallAxis});
  // Interior carpet excludes the balcony; no percentage is invented as measured area.
  const actualCarpetAreaSqM=rooms.filter(r=>r.zone!=='OUTDOOR').reduce((sum,r)=>sum+r.areaSqM,0);
  return {unitId,label:envelope.label,unitType,boundary,rooms,doors,entrancePoint:envelope.commonLobbyConnection.doorPoint,actualCarpetAreaSqM,actualBuiltUpAreaSqM:boundary.width*boundary.height,bedroomsCount,bathroomsCount,furnishabilityPassed:rooms.every(r=>r.furnishabilityStatus==='PASS'),hardErrors};
''' +s[end:];p.write_text(s)
p=root/'packages/ai-orchestration/src/apartment/envelope-solver.ts';s=p.read_text();needle='    return {\n      unitId: u.unitId,';assert needle in s
s=s.replace(needle,"    // Provisional geometry budget: preserve minimum bedroom depth after the\n    // public/service and access bands. Feasibility uses these actual dimensions.\n    unitW = Math.max(11.5, unitW);\n    unitH = Math.max(11.5, unitH);\n\n"+needle,1)
s=s.replace('if (overlapW > 0.08 && overlapH > 0.08)','if (overlapW > 0.001 && overlapH > 0.001)');p.write_text(s)
