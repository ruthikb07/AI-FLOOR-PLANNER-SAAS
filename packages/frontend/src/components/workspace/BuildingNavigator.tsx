import React from 'react';
import { Box, Building2, ChevronRight, Eye, EyeOff, LockKeyhole, Ruler, ShieldAlert } from 'lucide-react';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import type { EditorContextValue } from '../../stores/editor-store';
import { calculateFloorPlatePercentage } from '../../services/workspace-commands';

export type WorkspaceLayer = 'rooms' | 'walls' | 'openings' | 'stairs' | 'dimensions' | 'grid' | 'validation' | 'siteZones';

interface BuildingNavigatorProps {
  editor: EditorContextValue;
  layers: Readonly<Record<WorkspaceLayer, boolean>>;
  onToggleLayer: (layer: WorkspaceLayer) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const layerLabels: Array<{ id: WorkspaceLayer; label: string }> = [
  { id: 'siteZones', label: 'Site zones & plot' },
  { id: 'rooms', label: 'Rooms' }, { id: 'walls', label: 'Walls' },
  { id: 'openings', label: 'Doors & windows' }, { id: 'stairs', label: 'Stairs' },
  { id: 'dimensions', label: 'Dimensions' }, { id: 'grid', label: 'Grid' },
  { id: 'validation', label: 'Validation' },
];

export const BuildingNavigator: React.FC<BuildingNavigatorProps> = ({ editor, layers, onToggleLayer, collapsed, onToggleCollapsed }) => {
  const baseArea = Math.max(1, polygonArea(editor.building.floors[0]?.boundary ?? { points: [] }));
  return (
    <aside className={`building-navigator ${collapsed ? 'collapsed' : ''}`} aria-label="Building navigator">
      <header>
        <span><Building2 size={15} /><strong>Architecture</strong></span>
        <button onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand building navigator' : 'Collapse building navigator'}><ChevronRight size={15} /></button>
      </header>
      {!collapsed && <>
        <section>
          <span className="navigator-eyebrow">Building / floors</span>
          <div className="navigator-floor-list">
            {[...editor.building.floors].sort((a, b) => b.level - a.level).map(floor => {
              const scale = calculateFloorPlatePercentage(baseArea, polygonArea(floor.boundary));
              const locked = editor.generationControl.lockedFloorIds.includes(floor.id);
              const issueCount = editor.validationSummary.violations.filter(issue => issue.affectedEntities.some((id: string) =>
                floor.rooms.some(room => room.id === id) || floor.doors.some(door => door.id === id) || floor.windows.some(window => window.id === id),
              )).length;
              return <button key={floor.id} className={editor.activeFloor.id === floor.id ? 'active' : ''} onClick={() => editor.switchFloor(floor.id)}>
                <span><strong>{floor.name}</strong><small>{scale}% plate · {floor.rooms.length} spaces</small></span>
                <span>{locked && <LockKeyhole size={12} aria-label="Locked for generation" />}{issueCount > 0 && <em>{issueCount}</em>}</span>
              </button>;
            })}
          </div>
          <p><LockKeyhole size={11} /> Locks constrain generation; they do not make manual editing read-only.</p>
        </section>
        <section>
          <span className="navigator-eyebrow">Drawing layers</span>
          <div className="navigator-layer-list">
            {layerLabels.map(layer => <button key={layer.id} aria-pressed={layers[layer.id]} onClick={() => onToggleLayer(layer.id)}>
              {layers[layer.id] ? <Eye size={13} /> : <EyeOff size={13} />}<span>{layer.label}</span>
            </button>)}
          </div>
        </section>
        <section className="future-modes">
          <span className="navigator-eyebrow">Other disciplines</span>
          <div><Box size={13} /><span><strong>Structure</strong><small>Not implemented</small></span></div>
          <div><ShieldAlert size={13} /><span><strong>Vastu</strong><small>Guidance only</small></span></div>
          <div><Ruler size={13} /><span><strong>3D</strong><small>Canonical model</small></span></div>
        </section>
      </>}
    </aside>
  );
};
