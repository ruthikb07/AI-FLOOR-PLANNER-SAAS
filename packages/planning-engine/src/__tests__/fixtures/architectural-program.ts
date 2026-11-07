import { createEmptySpaceProgram, createProgramItem, getSpaceDefinition, createBuilding, createDefaultFootprintIntent,
  Direction, type SpaceFloorPreference, type SpaceProgramItem } from '@ai-floor-planner/core';

/** The unchanged seed-20260904 Program/footprint shared by placement and diversity tests. */
export function architecturalBenchmarkInput() {
  const item = (definitionId: string, id: string, name: string, floorPreference: SpaceFloorPreference = { kind: 'any' }, extra: Partial<SpaceProgramItem> = {}) =>
    createProgramItem(getSpaceDefinition(definitionId)!, id, { name, quantity: 1, floorPreference, ...extra });
  const owners = { bath1: 'master1', bath2: 'master2', bath3: 'master3', bath4: 'guest' };
  const items = [
    item('living','living','Living'), item('kitchen','kitchen','Kitchen'), item('dining','dining','Dining'), item('utility','utility','Utility'),
    item('bedroom','parents','Parents Bedroom',{kind:'ground_required'}),
    item('primary_bedroom','master1','Master Bedroom 01',{kind:'specific',specificFloor:0}),
    item('primary_bedroom','master2','Master Bedroom 02',{kind:'specific',specificFloor:1}),
    item('primary_bedroom','master3','Master Bedroom 03',{kind:'specific',specificFloor:1}),
    item('guest_bedroom','guest','Guest Bedroom',{kind:'specific',specificFloor:1}),
    ...Object.entries(owners).map(([bath,owner],index) => item('attached_bathroom',bath,`Attached Bath ${['01','02','03','Guest'][index]}`,{kind:'any'},{attachedToRoomId:owner})),
    item('common_bathroom','common','Common Bathroom',{kind:'ground_required'}), item('staircase','stairs','Stair'),
    item('pooja','pooja','Pooja',{kind:'ground_required'}), item('garage','garage','Garage'), item('balcony','balcony','Balcony',{kind:'specific',specificFloor:1}),
  ];
  const program = {...createEmptySpaceProgram('residential'),items};
  const building = createBuilding({projectId:'rbea-001-audit',name:'RBEA-001 relationship benchmark',site:{plotWidth:22000,plotDepth:28000,plannedFloorCount:2,roadFacing:Direction.North,setbacks:{front:1500,rear:1000,left:1000,right:1000}},floors:[{buildingId:'',level:0}]});
  const base = createDefaultFootprintIntent(building);
  const footprint = {...base,parameters:{...base.parameters,width:20000,depth:25500},transform:{...base.transform,x:1000,y:1500},strategy:'custom_per_floor' as const,floorOverrides:[{floorLevel:1,scalePercent:75}]};
  return { building, program, footprint, category: 'residential' as const, owners };
}
