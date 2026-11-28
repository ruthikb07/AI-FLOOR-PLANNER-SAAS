import * as acad from '@node-projects/acad-ts';
import type {generateFrameCandidateSchedule,BeamRccDesignResult} from '@ai-floor-planner/structural-engine';

/** Separate dimensionally true local sections. Sheet origins are for display only. */
export function coupledFrameSectionsDxf(schedule:ReturnType<typeof generateFrameCandidateSchedule>,beams:readonly BeamRccDesignResult[],resultId:string,revision:number){
  const doc=new acad.CadDocument(acad.ACadVersion.AC1032);
  doc.header!.insUnits=acad.UnitsType.Millimeters;
  doc.header!.measurementUnits=acad.MeasurementUnits.Metric;
  const layer=(name:string,color:number)=>{
    const layer=new acad.Layer(name);
    layer.color=new acad.Color(color);
    doc.layers!.add(layer);
    return layer;
  };
  const outlines=layer('SECTION-BOUNDARY',7),steel=layer('LONGITUDINAL-STEEL',1),notes=layer('SECTION-NOTES',3);
  let origin=0;
  function note(value:string,y:number){
    const label=new acad.TextEntity(value.replace(/[\r\n]/g,' '));
    label.layer=notes;
    label.height=20;
    label.insertPoint=new acad.XYZ(origin,y,0);
    doc.entities!.add(label);
  }
  function section(id:string,width:number,depth:number,bars:readonly {xMm:number;yMm:number;diaMm:number}[]){
    const outline=new acad.LwPolyline();
    outline.layer=outlines;
    outline.isClosed=true;
    for(const [x,y] of [[0,0],[width,0],[width,depth],[0,depth]] as const)
      outline.vertices.push(new acad.LwPolylineVertex(new acad.XY(origin+x,y)));
    doc.entities!.add(outline);
    for(const bar of bars){
      const circle=new acad.Circle(new acad.XYZ(origin+bar.xMm,bar.yMm,0),bar.diaMm/2);
      circle.layer=steel;
      doc.entities!.add(circle);
    }
    note(id,-40);
    origin+=Math.max(width+150,id.length*22);
  }
  note('PRELIMINARY GRAVITY - LONGITUDINAL BAR SECTIONS - mm',-150);
  note('Result '+resultId+' / structural revision '+revision,-195);
  const missing=beams.filter(beam=>!beam.barLayout);
  note('Beam sections without explicit coordinates omitted: '+missing.length+'. Anchorage and joints require review.',-240);
  for(const col of schedule.reinforcement.columns)
    section(col.physicalMemberId,col.layout.widthMm,col.layout.depthMm,col.layout.bars);
  for(const beam of beams){
    if(!beam.barLayout) continue;
    section(beam.physicalMemberId,beam.widthMm,beam.depthMm,[
      ...beam.barLayout.top.map(point=>({...point,diaMm:beam.topBarsSupport.barDiaMm})),
      ...beam.barLayout.bottom.map(point=>({...point,diaMm:beam.bottomBarsMidspan.barDiaMm})),
    ]);
  }
  const chunks:string[]=[];
  const writer=new acad.DxfWriter({write:(chunk:string)=>{chunks.push(chunk);}},doc,false);
  writer.write();
  return Buffer.from(chunks.join(''),'utf8');
}
