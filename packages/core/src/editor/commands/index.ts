/**
 * Barrel export for editor commands.
 */

export {
  SelectEntityCommand,
  ClearSelectionCommand,
  SwitchFloorCommand,
  SetToolCommand,
  SetSelectionsCommand,
} from './selection-commands';

export {
  AddRoomCommand,
  MoveRoomCommand,
  ResizeRoomCommand,
  UpdateRoomGeometryCommand,
  UpdateRoomPropertiesCommand,
} from './room-commands';

export {
  ApplyRoomAreaRegenerationCommand,
  type RoomAreaRegenerationMetadata,
} from './room-area-command';

export {
  AddDoorCommand,
  MoveDoorCommand,
  UpdateDoorPropertiesCommand,
  RemoveDoorCommand,
} from './door-commands';

export {
  AddWindowCommand,
  MoveWindowCommand,
  UpdateWindowPropertiesCommand,
  RemoveWindowCommand,
} from './window-commands';

export {
  DeleteEntityCommand,
} from './delete-commands';

export {
  BatchCommand,
} from './batch-command';

export { ReplaceBuildingCommand } from './replace-building-command';
export { UpdateSiteCommand, type UpdateSiteParams } from './update-site-command';
export { AddFloorCommand, RemoveFloorCommand, type AddFloorParams } from './floor-commands';

export { UpdateRegulatoryContextCommand } from './update-regulatory-context-command';
