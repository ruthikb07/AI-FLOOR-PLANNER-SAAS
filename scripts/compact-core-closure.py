from pathlib import Path
r=Path(__file__).resolve().parents[1]
p=r/'packages/ai-orchestration/src/apartment/core-optimizer.ts';s=p.read_text(encoding='utf8');s=s.replace('  readonly lobbyBounds: CoreRect;','  readonly lobbyBounds: CoreRect;\n  readonly corridors?: readonly CoreRect[];');a=s.index('  const liftW = 2.1;');b=s.index('\n}\n',a)
s=s[:a]+'''  if(!Number.isInteger(liftCount)||liftCount<1||liftCount>3||!Number.isInteger(stairCount)||stairCount<1||stairCount>2)throw new Error('UNSUPPORTED_CORE_COUNTS');
  // Two equipment banks face a real central access spine. These dimensions
  // are planning heuristics, with no assertion of fire or structural approval.
  const variants:CoreConfigurationType[]=corePlacement==='SIDE'?['CORE_D_SIDE_PERIMETER','CORE_A_SHARED_LIFT_BANK','CORE_C_COMPACT_INLINE']:['CORE_A_SHARED_LIFT_BANK','CORE_B_CENTRAL_THROUGH','CORE_C_COMPACT_INLINE'];
  return variants.map((id,index)=>{
    const spineW=1.6+index*0.2,bankW=2.4,lobbyW=2*bankW+spineW,lobbyD=4.8;
    const x=centerPoint.x-lobbyW/2,y=centerPoint.y;
    const rows=Math.ceil(liftCount/2),liftH=rows*2.1,totalH=4+liftH;
    const lobby={x,y,width:lobbyW,height:lobbyD};
    const corridor={x:x+bankW,y:y-totalH,width:spineW,height:totalH};
    const stairs:PlannedCoreStair[]=Array.from({length:stairCount},(_,i)=>({id:`stair_${i+1}`,label:`STAIR ${i+1}`,type:i===0?'main':'fire_escape',bounds:{x:i===0?x:x+bankW+spineW,y:y-4,width:bankW,height:4}}));
    const lifts=Array.from({length:liftCount},(_,i)=>({id:`lift_${i+1}`,label:`LIFT ${i+1}`,bounds:{x:i%2===0?x+0.3:x+bankW+spineW,y:y-4-2.1*(1+Math.floor(i/2)),width:2.1,height:2.1}}));
    const shafts=lifts.map((l,i)=>({id:`shaft_${i+1}`,bounds:{x:i%2===0?x:x+lobbyW-0.3,y:l.bounds.y,width:0.3,height:2.1}}));
    const area=(rect:CoreRect)=>rect.width*rect.height;
    return {id,name:id,description:'Equipment banks joined to the arrival lobby by a shared access spine.',bounds:{x,y:y-totalH,width:lobbyW,height:totalH+lobbyD},lobbyBounds:lobby,corridors:[corridor],liftBank:{id:`bank_${index}`,lifts,totalBounds:{x,y:y-totalH,width:lobbyW,height:liftH},isSharedBank:true},stairs,shafts,totalCoreAreaSqM:stairs.reduce((n,s)=>n+area(s.bounds),0)+lifts.reduce((n,l)=>n+area(l.bounds),0)+shafts.reduce((n,s)=>n+area(s.bounds),0),lobbyAreaSqM:area(lobby)+area(corridor),commonCirculationLengthM:totalH+lobbyD,averageEntranceDistanceM:Math.hypot(lobbyW/2,lobbyD/2),repeatedPlumbingWetStacks:0};
  });
''' + s[b:];p.write_text(s,encoding='utf8')
p=r/'packages/ai-orchestration/src/apartment/envelope-solver.ts';s=p.read_text(encoding='utf8');s=s.replace('    lobbyBounds: adjustedLobby,','    lobbyBounds: adjustedLobby,\n    corridors:core.corridors?.map(translateRect),');s=s.replace('      const f_y = lobby.y + lobby.height + 0.2;','      const f_y = lobby.y + lobby.height;');s=s.replace('currentX += u.unitW + 0.1;','currentX += u.unitW;')
s=s.replace('  const adjustedLobby = translateRect(core.lobbyBounds);', '''  const rowMinX=Math.min(...rawEnvelopes.map(e=>e.boundary.x));
  const rowMaxX=Math.max(...rawEnvelopes.map(e=>e.boundary.x+e.boundary.width));
  const adjustedLobby = translateRect(family==='SIDE_CORE'?{...core.lobbyBounds,x:rowMinX,width:rowMaxX-rowMinX}:core.lobbyBounds);''')
# For two units, a north/south arrangement accommodates narrow plots, while
# the core stays within its own depth band. Core B is a genuine layout variant.
needle="  else if (family === 'COMPACT_RECTANGULAR' || flatCount === 2) {";assert needle in s
s=s.replace(needle,"""  else if ((family === 'COMPACT_RECTANGULAR' || flatCount === 2) && core.id==='CORE_B_CENTRAL_THROUGH') {
    unitSizes.forEach((u,i)=>{
      const x=lobby.x+(lobby.width-u.unitW)/2;
      const y=i===0?lobby.y+lobby.height:core.bounds.y-u.unitH;
      const entranceY=i===0?y:y+u.unitH;
      rawEnvelopes.push({unitId:u.unitId,label:u.unitId,unitType:u.unitType,boundary:{x,y,width:u.unitW,height:u.unitH},targetAreaSqM:u.targetBuiltUpSqM,minAcceptableAreaSqM:u.minAcceptableSqM,actualAreaSqM:u.unitW*u.unitH,aspect:u.unitW/u.unitH,entranceEdge:{side:i===0?'south':'north',from:{x:lobby.x,y:entranceY},to:{x:lobby.x+lobby.width,y:entranceY},lengthM:lobby.width},commonLobbyConnection:{doorPoint:{x:lobby.x+2.4+(core.corridors?.[0]?.width??1.6)/2,y:entranceY},wallAxis:'x'},exteriorFacades:i===0?['north','east','west']:['south','east','west']});
    });
  }
"""+needle)
# South entrance opens to the bottom of the shared spine, not through a lift.
p.write_text(s,encoding='utf8')
p=r/'packages/ai-orchestration/src/apartment/schematic.ts';s=p.read_text(encoding='utf8');a=s.index('    ...lifts.map(l => ({',s.index('  const doors: SchematicDoor[] = ['));b=s.index('\n  ];',a)
s=s[:a]+'''    ...(() => {
      const common=[{id:'core_lobby',bounds:lobbyBounds},...(coreConfig.corridors??[]).map((bounds,i)=>({id:`corridor_${i+1}`,bounds}))];
      const result:SchematicDoor[]=[];
      const connect=(a:{id:string;bounds:Rect2D},b:{id:string;bounds:Rect2D})=>{
        const A=a.bounds,B=b.bounds,loX=Math.max(A.x,B.x),hiX=Math.min(A.x+A.width,B.x+B.width),loY=Math.max(A.y,B.y),hiY=Math.min(A.y+A.height,B.y+B.height);
        let center:{x:number;y:number}|undefined;let wallAxis:'x'|'y'='x';
        if((Math.abs(A.y+A.height-B.y)<1e-6||Math.abs(B.y+B.height-A.y)<1e-6)&&hiX-loX>=1.2)center={x:(loX+hiX)/2,y:Math.max(A.y,B.y)};
        else if((Math.abs(A.x+A.width-B.x)<1e-6||Math.abs(B.x+B.width-A.x)<1e-6)&&hiY-loY>=1.2){wallAxis='y';center={x:Math.max(A.x,B.x),y:(loY+hiY)/2};}
        if(center)result.push({id:`core_door_${a.id}_${b.id}`,flatId:null,connects:[a.id,b.id],kind:'core',doorType:'single',swing:'inward',widthM:1,center,wallAxis,bounds:doorBounds(center,1,wallAxis)});
      };
      for(const el of [...lifts,...stairs])for(const c of common)connect(c,el);
      for(let i=0;i<common.length;i++)for(let j=i+1;j<common.length;j++)connect(common[i]!,common[j]!);
      return result;
    })(),''' + s[b:]
s=s.replace('      corridors: [],','      corridors: (coreConfig.corridors??[]).map(bounds=>({bounds,label:\'COMMON ACCESS SPINE\'})),');p.write_text(s,encoding='utf8')
# South unit entrance references the actual spine.
p=r/'packages/ai-orchestration/src/apartment/apartment-structure.ts';s=p.read_text(encoding='utf8');s=s.replace('const a = sid(door.connects[0]);','let a = sid(door.connects[0]);\n    if(door.kind===\'flat_entrance\'&&a===\'core_lobby\'){const c=schematic.core.corridors.findIndex(c=>door.center.x>=c.bounds.x&&door.center.x<=c.bounds.x+c.bounds.width&&door.center.y>=c.bounds.y&&door.center.y<=c.bounds.y+c.bounds.height);if(c>=0)a=`corridor_${c+1}`;}');p.write_text(s,encoding='utf8')
