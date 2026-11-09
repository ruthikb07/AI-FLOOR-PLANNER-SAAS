import type { Building, RegulatoryContextInput } from "../../types";
import { ReplaceBuildingCommand } from "./replace-building-command";
/** Undoable context edits invalidate the same canonical revision as geometry edits. */
export class UpdateRegulatoryContextCommand extends ReplaceBuildingCommand {
  constructor(building: Building, context: RegulatoryContextInput) {
    super(
      building,
      {
        ...building,
        regulatoryContext: { ...context },
        version: building.version + 1,
        updatedAt: new Date().toISOString(),
      },
      "Update regulatory context",
    );
  }
}
