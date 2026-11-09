import { MEP_MATERIALS, type Building } from '@ai-floor-planner/core';
import { assertMepGeometry, mepFloorElevations, MEP_FINISH_OFFSET_MM } from '@ai-floor-planner/geometry-engine';
import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import type { BuildingScene, SceneGeometry, SceneMesh } from './building-scene-projector';
function extracted(g:BufferGeometry):SceneGeometry {
  const p=g.getAttribute('position'),vertices:number[][]=[],faces:number[][]=[];
  for(let i=0;i<p.count;i++)vertices.push([p.getX(i),p.getY(i),p.getZ(i)]);
  const index=g.getIndex();
  for(let i=0;i<(index?.count??p.count);i+=3)faces.push(index?[index.getX(i),index.getX(i+1),index.getX(i+2)]:[i,i+1,i+2]);
  g.dispose();return {vertices,faces};
}
/** Derived component details remain inside the canonical equipment collision envelope. */
export function appendMepScene(building:Building,scene:BuildingScene):void {
  if(!building.mep)return;assertMepGeometry(building);
  const elevations=mepFloorElevations(building);
  const push=(source:string,floorId:string,kind:string,material:keyof typeof MEP_MATERIALS,g:BufferGeometry)=>{
    const node:SceneMesh={id:source+':'+floorId+':'+kind,sourceEntityId:source,floorId,buildingId:building.id,canonicalRevision:building.version,kind,material,geometry:extracted(g),provenance:'CANONICAL'};
    scene.meshes.push(node);
  };
  for(const f of building.mep.fixtures){
    const z=elevations.get(f.floorId)!+MEP_FINISH_OFFSET_MM+f.elevationAfflMm;
    const orient=(g:BufferGeometry,x=0,y=0,bottom=0)=>g.translate(x,y,z+bottom).rotateZ(f.rotationRad).translate(f.position.x,f.position.y,0);
    const cylinder=(kind:string,diameter:number,height:number,bottom:number,mat:keyof typeof MEP_MATERIALS,x=0,y=0,axis:'Z'|'Y'='Z')=>{
      const g=new CylinderGeometry(diameter/2,diameter/2,height,32);
      if(axis==='Z')g.rotateX(Math.PI/2);
      g.translate(0,0,axis==='Z'?height/2:diameter/2);
      push(f.id,f.floorId,'mep-'+kind,mat,orient(g,x,y,bottom));
    };
    const box=(kind:string,w:number,d:number,h:number,bottom:number,mat:keyof typeof MEP_MATERIALS,x=0,y=0)=>push(f.id,f.floorId,'mep-'+kind,mat,orient(new BoxGeometry(w,d,h).translate(0,0,h/2),x,y,bottom));
    switch(f.type){
      case 'PENDENT_SPRINKLER':
        cylinder('sprinkler-deflector',30,3,0,'MAT_Chrome_Sprinkler');
        cylinder('sprinkler-bulb',6,28,5,'MAT_Fire_Red');
        cylinder('sprinkler-body',15,25,33,'MAT_Chrome_Sprinkler');
        cylinder('sprinkler-thread',15,7,58,'MAT_Chrome_Sprinkler');break;
      case 'SMOKE_DETECTOR':
        cylinder('smoke-detector',100,40,0,'MAT_Electrical_Plate');
        cylinder('smoke-grille',65,1,0,'MAT_Black_Nozzle');break;
      case 'ABC_6KG_EXTINGUISHER':
        cylinder('extinguisher-canister',150,500,0,'MAT_Fire_Red');
        cylinder('extinguisher-hose',12,210,150,'MAT_Black_Nozzle',65,0);
        box('extinguisher-nozzle',14,14,45,360,'MAT_Black_Nozzle',65,0);
        cylinder('extinguisher-gauge',25,8,420,'MAT_Chrome_Sprinkler',30,65,'Y');
        box('extinguisher-handle',100,18,15,480,'MAT_Black_Nozzle');break;
      case 'LANDING_VALVE':
        cylinder('landing-valve',65,12,0,'MAT_Fire_Red',0,0,'Y');
        box('landing-valve-stem',100,20,20,22.5,'MAT_Chrome_Sprinkler');break;
      case 'CEILING_LIGHT':cylinder('ceiling-light',f.widthMm,f.heightMm,0,'MAT_Electrical_Plate');break;
      case 'CEILING_FAN':
        cylinder('fan-hub',160,80,0,'MAT_Electrical_Plate');
        for(let i=0;i<3;i++)push(f.id,f.floorId,'mep-fan-blade-'+i,'MAT_Electrical_Plate',
          new BoxGeometry(520,100,12).translate(300,0,z+40).rotateZ(f.rotationRad+i*2*Math.PI/3).translate(f.position.x,f.position.y,0));
        break;
      default:
        if(f.kind==='PLUMBING')cylinder('connection-'+f.type,f.widthMm,f.heightMm,0,'MAT_Copper_Terminal');
        else {
          box(f.type.toLowerCase(),f.widthMm,f.depthMm,f.heightMm,0,'MAT_Electrical_Plate');
          box('terminal-'+f.type,12,2,12,f.heightMm/2,'MAT_Copper_Terminal',0,-f.depthMm/2+2);
        }
    }
  }
  const sorted=[...building.floors].sort((a,b)=>a.level-b.level);
  for(const stack of building.mep.stacks){
    const mat=({SOIL:'MAT_Pipe_Soil',WASTE:'MAT_Pipe_Waste',VENT:'MAT_Pipe_Vent',RAINWATER:'MAT_Pipe_Rain',WET_RISER:'MAT_Fire_Red'} as const)[stack.service];
    for(let i=0;i<sorted.length;i++){
      const floor=sorted[i]!;if(!stack.floorIds.includes(floor.id))continue;
      const bottom=Math.max(stack.bottomMm,elevations.get(floor.id)!);
      const top=Math.min(stack.topMm,i+1<sorted.length?elevations.get(sorted[i+1]!.id)!:elevations.get(floor.id)!+floor.floorHeight);
      if(top<=bottom)continue;
      push(stack.id,floor.id,'mep-pipe-'+stack.service.toLowerCase(),mat,
        new CylinderGeometry(stack.outerDiameterMm/2,stack.outerDiameterMm/2,top-bottom,32).rotateX(Math.PI/2).translate(stack.position.x,stack.position.y,(bottom+top)/2));
    }
  }
  scene.warnings.push(...building.mep.issues.map(i=>i.code+': '+i.message));
}
