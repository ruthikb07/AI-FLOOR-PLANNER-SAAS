import type { Building, Direction, Floor, PlotShape, Setbacks, Site, SiteZone } from '../../types';
import { rectToPolygon } from '../../models/factory';
import { generateId } from '../../models/id';
import type { CommandExecutionResult, EditorState, IEditorCommand } from '../types';

export interface UpdateSiteParams {
  readonly plotWidth?: number;
  readonly plotDepth?: number;
  readonly plotShape?: PlotShape;
  readonly orientation?: number;
  readonly setbacks?: Partial<Setbacks>;
  readonly roadFacing?: Direction;
  readonly plannedFloorCount?: number;
  readonly roadWidth?: number;
  readonly cornerPlot?: boolean;
  readonly siteZones?: readonly SiteZone[];
  /** Whether to synchronize floor boundaries to the new buildable envelope. Defaults to true. */
  readonly syncFloorBoundaries?: boolean;
}

/**
 * Updates the canonical Site configuration and recalculates the buildable envelope.
 * Fully undoable and atomic.
 */
export class UpdateSiteCommand implements IEditorCommand {
  readonly id = generateId();
  readonly description: string;
  private readonly before: Building;
  private readonly after: Building;

  constructor(building: Building, params: UpdateSiteParams, description = 'Update site configuration') {
    this.before = building;
    this.description = description;

    const plotWidth = Math.max(1000, params.plotWidth ?? building.site.plotWidth);
    const plotDepth = Math.max(1000, params.plotDepth ?? building.site.plotDepth);
    const setbacks: Setbacks = {
      front: Math.max(0, params.setbacks?.front ?? building.site.setbacks.front),
      rear: Math.max(0, params.setbacks?.rear ?? building.site.setbacks.rear),
      left: Math.max(0, params.setbacks?.left ?? building.site.setbacks.left),
      right: Math.max(0, params.setbacks?.right ?? building.site.setbacks.right),
    };

    const orientation = params.orientation ?? building.site.orientation;
    const roadFacing = params.roadFacing ?? building.site.roadFacing;
    const plotShape = params.plotShape ?? building.site.plotShape;

    const updatedSite: Site = {
      ...building.site,
      plotWidth,
      plotDepth,
      plotArea: plotWidth * plotDepth,
      plotBoundary: rectToPolygon(0, 0, plotWidth, plotDepth),
      setbacks,
      orientation,
      roadFacing,
      plotShape,
      plannedFloorCount: params.plannedFloorCount ?? building.site.plannedFloorCount,
      roadWidth: params.roadWidth ?? building.site.roadWidth,
      cornerPlot: params.cornerPlot ?? building.site.cornerPlot,
      siteZones: params.siteZones !== undefined ? params.siteZones : building.site.siteZones,
    };

    const syncFloors = params.syncFloorBoundaries ?? true;
    let floors: readonly Floor[] = building.floors;

    if (syncFloors) {
      const envelopeX = setbacks.left;
      const envelopeY = setbacks.front;
      const envelopeW = Math.max(0, plotWidth - setbacks.left - setbacks.right);
      const envelopeH = Math.max(0, plotDepth - setbacks.front - setbacks.rear);
      const envelopeBoundary = rectToPolygon(envelopeX, envelopeY, envelopeW, envelopeH);

      floors = building.floors.map(floor => {
        return {
          ...floor,
          boundary: envelopeBoundary,
        };
      });
    }

    this.after = {
      ...building,
      site: updatedSite,
      floors,
      version: building.version + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  execute(_building: Building, _state: EditorState): CommandExecutionResult {
    return { building: this.after };
  }

  undo(_building: Building, _state: EditorState): CommandExecutionResult {
    return { building: this.before };
  }
}
