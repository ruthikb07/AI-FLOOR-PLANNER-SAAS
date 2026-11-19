import { useMemo } from 'react';
import type { Building } from '@ai-floor-planner/core';
import { Building3DProjector } from '@ai-floor-planner/projection-3d';
import { ThreeBuildingScene } from '../model-3d/ThreeBuildingScene';
import { DEFAULT_MODEL_VIEW_PREFERENCES } from '../../services/projection-preferences';

const projector = new Building3DProjector();
export default function ConceptModel({ building }: { building: Building }) {
  const projection = useMemo(() => projector.project(building, DEFAULT_MODEL_VIEW_PREFERENCES.heightSettings), [building]);
  return <ThreeBuildingScene
    projection={projection} activeFloorId={building.floors[0]?.id ?? ''} selection={null}
    viewMode="solid" cameraPreset="isometric" floorMode="all" exploded={false}
    layers={DEFAULT_MODEL_VIEW_PREFERENCES.layers} fitRequest={0} onSelect={() => {}} onClearSelection={() => {}}
  />;
}
