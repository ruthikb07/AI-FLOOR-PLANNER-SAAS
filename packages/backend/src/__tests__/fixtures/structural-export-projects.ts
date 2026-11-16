import type { StructuralProject, StructuralAnalysis } from '@ai-floor-planner/core';

/** Synthetic software-verification inputs only. No engineering review or client design is claimed. */
export function structuralExportProjects(): [StructuralProject,StructuralProject] {
  function make(id:string,xs:number[],ys:number[],zs:number[],triangles:boolean):StructuralProject {
    const revision=id+'-arch-r7', provenance={sourceArchitecturalRevisionId:revision};
    const levels=zs.map((elevationMm,i)=>({...provenance,id:id+'-L'+i,name:i?'Level '+i:'Base',elevationMm}));
    const nodes:StructuralAnalysis.StructuralNode[]=[];
    const nodeId=(l:number,x:number,y:number)=>id+'-N'+l+'-'+x+'-'+y;
    for(let l=0;l<zs.length;l++)for(let y=0;y<ys.length;y++)for(let x=0;x<xs.length;x++)
      nodes.push({...provenance,id:nodeId(l,x,y),levelId:levels[l]!.id,xMm:xs[x]!,yMm:ys[y]!,zMm:zs[l]!,
        restraints:l===0?[true,true,true,true,true,true]:[false,false,false,false,false,false]});
    const materials:StructuralAnalysis.StructuralMaterial[]=[
      {...provenance,id:id+'-elastic1',name:'Fixture elastic 1',analysisModel:'ISOTROPIC_NO_DESIGN',elasticModulusNPerMm2:31250,
        poissonRatio:0.21,massDensityKgPerM3:2475,thermalExpansionPerC:1e-5,provenance:'API_VERIFICATION_FIXTURE'},
      {...provenance,id:id+'-elastic2',name:'Fixture elastic 2',analysisModel:'ISOTROPIC_NO_DESIGN',elasticModulusNPerMm2:199500,
        poissonRatio:0.29,massDensityKgPerM3:7825,thermalExpansionPerC:1.2e-5,provenance:'API_VERIFICATION_FIXTURE'},
    ];
    const columns:StructuralAnalysis.StructuralColumn[]=[],beams:StructuralAnalysis.StructuralBeam[]=[],slabs:StructuralAnalysis.StructuralSlab[]=[];
    for(let l=1;l<zs.length;l++){
      for(let y=0;y<ys.length;y++)for(let x=0;x<xs.length;x++){
        columns.push({...provenance,id:id+'-C'+columns.length,kind:'COLUMN',startNodeId:nodeId(l-1,x,y),endNodeId:nodeId(l,x,y),
          materialId:materials[0]!.id,section:{kind:'RECTANGLE',widthMm:triangles?325.5:300.25,depthMm:triangles?475.25:425.5},localAxisAngleDeg:0});
        for(const [dx,dy] of [[1,0],[0,1]] as const)if(x+dx<xs.length&&y+dy<ys.length)
          beams.push({...provenance,id:id+'-B'+beams.length,kind:'BEAM',startNodeId:nodeId(l,x,y),endNodeId:nodeId(l,x+dx,y+dy),
            materialId:materials[1]!.id,section:{kind:'RECTANGLE',widthMm:triangles?245.5:260.75,depthMm:triangles?510.25:480.5},localAxisAngleDeg:beams.length===0?15:0});
      }
      for(let x=0;x<xs.length-1;x++){
        const ring=[nodeId(l,x,0),nodeId(l,x+1,0),nodeId(l,x+1,1),nodeId(l,x,1)];
        const rings=triangles&&x===1?[[ring[0]!,ring[1]!,ring[2]!],[ring[0]!,ring[2]!,ring[3]!]]:[ring];
        for(const boundaryNodeIds of rings)slabs.push({...provenance,id:id+'-A'+slabs.length,levelId:levels[l]!.id,
          boundaryNodeIds,openingNodeIds:[],materialId:materials[0]!.id,thicknessMm:triangles?165.25:150.75,formulation:triangles?'SHELL_THICK':'SHELL_THIN'});
      }
    }
    return {...provenance,id,schemaVersion:1,architecturalBuildingId:id+'-architecture',units:{length:'mm',force:'N',temperature:'C',mass:'kg'},
      reviewStatus:'DRAFT',exportReview:{status:'API_VERIFICATION_FIXTURE',reviewerId:'SOFTWARE-TEST-ONLY',reviewedAt:'2026-11-11T00:00:00Z'},
      levels,nodes,materials,columns,beams,slabs,loadCases:[],loadCombinations:[]};
  }
  return [make('Project_001',[0,5250.5],[0,4125.25],[100.25,3151],false),
    make('Project_002',[-250.5,3400.25,7600.5],[150.25,5275.75],[-300.5,2849.75,6125.25],true)];
}
