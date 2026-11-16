import { expect, it } from 'vitest';
import { createDynamicApartmentManifest } from '@ai-floor-planner/core';
import { solveOrthogonalSpaceFillingApartment } from '../interpretation/space-filling-snapper';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from '@ai-floor-planner/core';

it.each([[40000,50000],[50012.5,40000],[36000,40000]])('creates eight directly accessible inset bedroom balconies for four 2BHK flats at %s x %s', (width,depth)=>{
  const manifest=createDynamicApartmentManifest({plotWidthMm:width,plotDepthMm:depth,flatsPerFloor:4,jurisdiction:'pune_pmc',lotAllotmentMode:'FULL_LOT_100_PERCENT',
    units:Array.from({length:4},(_,i)=>({unitIndex:i+1,bhkType:'2BHK' as const,attachedBathCount:1,hasUtilityBalcony:true}))});
  const plan=solveOrthogonalSpaceFillingApartment({plan:{flats:[],rooms:[]} as never,site:{plotWidth:width,plotDepth:depth},frame:{width:1000,height:1000},manifest,lotAllotmentMode:'FULL_LOT_100_PERCENT'});
  let count=0;
  for(const flat of plan.flats){
    const bedrooms=flat.rooms.filter(r=>r.type==='bedroom');expect(bedrooms).toHaveLength(2);
    for(const bedroom of bedrooms){
      const interiorDoors=plan.openings.filter(d=>d.connects?.includes(bedroom.id)&&!d.connects.includes(bedroom.id+'__balcony'));
      const entry=interiorDoors.find(d=>d.connects?.some(id=>flat.rooms.find(r=>r.id===id)?.type==='corridor'));
      expect(entry, `${bedroom.id} must be entered from the private passage`).toBeDefined();
      expect(interiorDoors.some(d=>d.connects?.some(id=>['living','dining'].includes(flat.rooms.find(r=>r.id===id)?.type??'')))).toBe(false);
      const balcony=flat.rooms.find(r=>r.id===bedroom.id+'__balcony');expect(balcony).toBeDefined();
      const b=balcony!.rect,r=bedroom.rect;
      expect(Math.abs(b.x)<0.001||Math.abs(b.x+b.width-width)<0.001).toBe(true);
      expect(b.y).toBe(r.y);expect(b.height).toBe(r.height);
      expect(Math.min(b.x+b.width,r.x+r.width)-Math.max(b.x,r.x)).toBeCloseTo(0,6);
      const door=plan.openings.find(d=>d.connects?.includes(bedroom.id)&&d.connects.includes(balcony!.id));expect(door).toBeDefined();
      expect(Math.max(door!.rect.width,door!.rect.height)).toBe(900);count++;
    }
    const roomArea=flat.rooms.reduce((sum,r)=>sum+r.rect.width*r.rect.height,0);
    expect(Math.abs(roomArea-flat.rect.width*flat.rect.height)).toBeLessThan(0.001);
  }
  expect(count).toBe(8);
});

it('retains bedroom balcony access in the canonical multi-storey production output',()=>{
  const result=solveMultiSheetApartmentProject({plotWidthMm:40000,plotDepthMm:50000,roadWidthMm:12000,roadAccessSides:[Direction.North],
    lotAllotmentMode:'STATUTORY_SETBACK_100_PERCENT',setbacksMm:{front:4500,rear:3000,left:3000,right:3000},jurisdiction:'pune_pmc',
    verticalStackType:'G_PLUS_N',numTypicalFloors:4,flatsPerFloor:4,parkingMode:'STILT_AND_SURFACE',
    siteAmenities:DEFAULT_SITE_AMENITIES,stiltAmenities:DEFAULT_STILT_AMENITIES,terraceAmenities:DEFAULT_TERRACE_AMENITIES,
    units:Array.from({length:4},(_,i)=>({unitIndex:i+1,bhkType:'2BHK' as const,attachedBathCount:1,hasUtilityBalcony:true}))});
  const rows=result.building.metadata.bedroomBalconySchedule!;
  expect(rows.length).toBeGreaterThanOrEqual(32);
  expect(rows.every(row=>row.balconyId&&row.accessDoorId)).toBe(true);
  expect(rows.every(row=>row.udcprStatus==='NOT_VERIFIED')).toBe(true);
},30000);
