import { it, expect } from 'vitest';
import { validateBuildingSchema, deserializeBuilding, serializeBuilding, Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES } from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';
it.each([2,3,4] as const)('generates and validates a real %i unit request', async count => {
 const result=await executeAuditedPlanningPipeline({plotWidthMm:50000,plotDepthMm:50000,roadWidthMm:12000,roadAccessSides:[Direction.North],setbacksMm:{front:3000,rear:2500,left:2500,right:2500},lotAllotmentMode:'STATUTORY_SETBACK_100_PERCENT',jurisdiction:'generic_maharashtra',verticalStackType:'STILT_PLUS_N',numTypicalFloors:2,flatsPerFloor:count,units:Array.from({length:count},(_,i)=>({unitIndex:i+1,bhkType:'2BHK' as const,hasUtilityBalcony:true})),siteAmenities:DEFAULT_SITE_AMENITIES,stiltAmenities:DEFAULT_STILT_AMENITIES,terraceAmenities:DEFAULT_TERRACE_AMENITIES,parkingMode:'STILT_ONLY'});
 expect(result.validationReport.isValid).toBe(true);
 expect(result.building.floors).toHaveLength(4);
 for (const floor of result.building.floors.filter(f => f.apartmentUnits?.length)) {
   expect(floor.apartmentUnits).toHaveLength(count);
   for (const unit of floor.apartmentUnits!) expect(floor.rooms.filter(r => r.unitId === unit.id && r.type === 'bedroom')).toHaveLength(2);
 }
 expect(result.regulatoryStatus).toBe(result.udcprReport.status);
 expect(result.udcprReport.overallCompliant).toBe(false);
 expect(result.udcprReport.missingInputs).toContain('authorityType');
 expect(validateBuildingSchema(result.building).slice(0, 8)).toEqual([]);
 expect(deserializeBuilding(serializeBuilding(result.building))).toEqual(result.building);
});

it('keeps default wizard geometry, mixed BHK counts, ground level and stage outcomes faithful', async () => {
 const events: import('../pipeline/stage-progress-emitter').PipelineStageProgressEvent[]=[];
 const result=await executeAuditedPlanningPipeline({projectName:'Ground project',aiPrompt:'Facade intent',referenceImage:{name:'ref.png',mimeType:'image/png',dataUrl:'data:image/png;base64,AAAA'},plotWidthMm:30000,plotDepthMm:40000,roadWidthMm:12000,roadAccessSides:[Direction.East],setbacksMm:{front:3000,rear:2000,left:2000,right:2000},lotAllotmentMode:'STATUTORY_SETBACK_100_PERCENT',jurisdiction:'generic_maharashtra',verticalStackType:'G_PLUS_N',numTypicalFloors:2,flatsPerFloor:4,units:([1,2,3,4] as const).map((n,i)=>({unitIndex:i+1,bhkType:`${n}BHK` as '1BHK'|'2BHK'|'3BHK'|'4BHK',hasUtilityBalcony:true})),siteAmenities:DEFAULT_SITE_AMENITIES,stiltAmenities:DEFAULT_STILT_AMENITIES,terraceAmenities:DEFAULT_TERRACE_AMENITIES,parkingMode:'STILT_AND_SURFACE'},e=>events.push(e));
 expect(result.building.floors.map(f=>f.level)).toEqual([0,1,2]);
 expect(result.building.floors[0]!.rooms.filter(r=>r.type==='bedroom')).toHaveLength(10);
 expect(result.building.name).toBe('Ground project');
 expect(result.building.site.roadFacing).toBe(Direction.East);
 expect(result.building.site.setbacks).toEqual({front:3000,rear:2000,left:2000,right:2000});
 expect(result.building.metadata.generationBrief).toMatchObject({source:'DETERMINISTIC',aiPrompt:'Facade intent',referenceImage:{name:'ref.png'}});
 expect(events[0]!.progressPercent).toBe(0);
 expect(events.at(-1)!.progressPercent).toBe(100);
 expect(events.every((e,i)=>i===0 || e.progressPercent>=events[i-1]!.progressPercent)).toBe(true);
 expect(Object.values(events.at(-1)!.stageStatuses)).toEqual(Array(7).fill('COMPLETED'));
});
it('emits actionable failure rather than COMPLETE for invalid input', async () => {
 const events: import('../pipeline/stage-progress-emitter').PipelineStageProgressEvent[]=[];
 const request = {plotWidthMm:0} as import('@ai-floor-planner/core').MultiSheetApartmentConfig;
 await expect(executeAuditedPlanningPipeline(request,e=>events.push(e))).rejects.toThrow(/positive plot/);
 expect(events.at(-1)!.status).toBe('FAILED');
 expect(events.some(e=>e.stage==='COMPLETE')).toBe(false);
});
