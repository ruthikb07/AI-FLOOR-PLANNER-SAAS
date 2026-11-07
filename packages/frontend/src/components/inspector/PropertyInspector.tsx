import React, { useEffect, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';
import {
  UpdateRoomPropertiesCommand,
  UpdateRoomGeometryCommand,
  UpdateDoorPropertiesCommand,
  UpdateWindowPropertiesCommand,
  RoomType,
  DoorType,
  SwingDirection,
  WindowType,
  WallType,
  Direction,
} from '@ai-floor-planner/core';
import { containsPolygon, mmToFeet, polygonIntersectionArea, sqMmToSqFt } from '@ai-floor-planner/geometry-engine';
import { RefinementPanel } from '../refinement/RefinementPanel';

interface PropertyInspectorProps {
  editor: EditorContextValue;
  embedded?: boolean;
}

function ExactDimensionInput({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => boolean }) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => setDraft(String(Math.round(value))), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 500 && parsed !== value) {
      if (!onCommit(parsed)) setDraft(String(Math.round(value)));
    }
    else setDraft(String(Math.round(value)));
  };
  return <div className="form-group"><label className="form-label">{label}</label><input type="number" step="100" min="500" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(String(Math.round(value))); }} /></div>;
}

export const PropertyInspector: React.FC<PropertyInspectorProps> = ({ editor, embedded = false }) => {
  const { selection, activeFloor, building, executeCommand } = editor;
  const isMulti = editor.selections.length > 1;

  // Selected Room
  const selectedRoom = !isMulti && selection?.entityType === 'room'
    ? activeFloor.rooms.find(r => r.id === selection.entityId)
    : null;

  // Selected Door
  const selectedDoor = selection?.entityType === 'door'
    ? activeFloor.doors.find(d => d.id === selection.entityId)
    : null;

  // Selected Window
  const selectedWindow = selection?.entityType === 'window'
    ? activeFloor.windows.find(w => w.id === selection.entityId)
    : null;

  const selectedWall = !isMulti && selection?.entityType === 'wall'
    ? activeFloor.walls.find(wall => wall.id === selection.entityId) : null;
  const selectedStair = !isMulti && selection?.entityType === 'stair'
    ? activeFloor.stairs.find(stair => stair.id === selection.entityId) : null;
  const commitRoomGeometry = (width: number, height: number): boolean => {
    if (!selectedRoom) return false;
    const boundary = { points: [
      { x: selectedRoom.x, y: selectedRoom.y }, { x: selectedRoom.x + width, y: selectedRoom.y },
      { x: selectedRoom.x + width, y: selectedRoom.y + height }, { x: selectedRoom.x, y: selectedRoom.y + height },
    ] };
    const valid = containsPolygon(activeFloor.boundary, boundary)
      && (!selectedRoom.minArea || width * height >= selectedRoom.minArea)
      && activeFloor.rooms.every(room => room.id === selectedRoom.id || polygonIntersectionArea(boundary, room.boundary) <= 2);
    if (valid) executeCommand(new UpdateRoomGeometryCommand(selectedRoom.id, { x: selectedRoom.x, y: selectedRoom.y, width, height }, selectedRoom.name));
    return valid;
  };

  return (
    <div className={`property-inspector ${embedded ? 'embedded' : ''}`}>
      <div className="inspector-header">
        <span className="inspector-title">
          {isMulti ? `${editor.selections.length} selected` : selection ? `${selection.entityType} Properties` : 'Plot & Floor Info'}
        </span>
        {selection && <span className="property-badge">{selection.entityId.slice(0, 8)}</span>}
      </div>

      <div className="inspector-body">
        <RefinementPanel editor={editor} />
        {isMulti && <div className="inspector-section multi-selection-summary">
          <span className="inspector-section-title">Aggregate selection</span>
          <strong>{editor.selections.length} entities</strong>
          <p>{Object.entries(editor.selections.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.entityType]: (counts[item.entityType] ?? 0) + 1 }), {})).map(([type, count]) => `${count} ${type}`).join(' · ')}</p>
          <small>Bulk geometry editing is intentionally unavailable. Locking and targeted regeneration remain available for selected rooms.</small>
        </div>}
        {/* ROOM PROPERTIES */}
        {selectedRoom && (
          <>
            <div className="inspector-section">
              <span className="inspector-section-title">Identity</span>
              <div className="form-group">
                <label className="form-label">Room Name</label>
                <input
                  type="text"
                  value={selectedRoom.name}
                  onChange={(e) =>
                    executeCommand(
                      new UpdateRoomPropertiesCommand(selectedRoom.id, { name: e.target.value })
                    )
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Room Type</label>
                <select
                  value={selectedRoom.type}
                  onChange={(e) =>
                    executeCommand(
                      new UpdateRoomPropertiesCommand(selectedRoom.id, {
                        type: e.target.value as RoomType,
                      })
                    )
                  }
                >
                  {Object.values(RoomType).map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/([A-Z])/g, ' $1').trim()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="inspector-section">
              <span className="inspector-section-title">Dimensions (mm & ft)</span>
              <div className="form-group-row">
                <ExactDimensionInput label="Width (mm)" value={selectedRoom.width} onCommit={width => commitRoomGeometry(width, selectedRoom.height)} />
                <ExactDimensionInput label="Depth (mm)" value={selectedRoom.height} onCommit={height => commitRoomGeometry(selectedRoom.width, height)} />
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Size:{' '}
                <strong>
                  {mmToFeet(selectedRoom.width).toFixed(1)}′ ×{' '}
                  {mmToFeet(selectedRoom.height).toFixed(1)}′
                </strong>{' '}
                ({sqMmToSqFt(selectedRoom.area).toFixed(0)} sq.ft)
              </div>
            </div>
            <div className="inspector-section">
              <span className="inspector-section-title">Program traceability</span>
              <dl className="property-definition-list"><div><dt>Floor</dt><dd>{activeFloor.name}</dd></div><div><dt>Priority</dt><dd>{selectedRoom.priority >= 8 ? 'Required' : 'Preferred'}</dd></div><div><dt>Preferred area</dt><dd>{selectedRoom.minArea ? `${(selectedRoom.minArea / 1_000_000).toFixed(1)} m² minimum` : 'Not configured'}</dd></div><div><dt>Current area</dt><dd>{(selectedRoom.area / 1_000_000).toFixed(1)} m²</dd></div><div><dt>Generation lock</dt><dd>{editor.generationControl.lockedEntityIds.includes(selectedRoom.id) ? 'Locked' : 'Variable'}</dd></div></dl>
            </div>
          </>
        )}

        {selectedWall && (() => {
          const wallLength = Math.hypot(selectedWall.endPoint.x - selectedWall.startPoint.x, selectedWall.endPoint.y - selectedWall.startPoint.y);
          const angleDeg = Math.round((Math.atan2(selectedWall.endPoint.y - selectedWall.startPoint.y, selectedWall.endPoint.x - selectedWall.startPoint.x) * 180 / Math.PI + 360) % 180);
          const hostedDoors = activeFloor.doors.filter(d => d.wallId === selectedWall.id);
          const hostedWindows = activeFloor.windows.filter(w => w.wallId === selectedWall.id);

          return (
            <div className="inspector-section">
              <span className="inspector-section-title">Wall Geometry & Assembly</span>

              {/* Wall Thickness Selector */}
              <div className="form-group">
                <label className="form-label">Wall Thickness & Structure</label>
                <div className="drafted-wall-thickness-toggle">
                  <button
                    type="button"
                    className={`drafted-thickness-option ${selectedWall.thickness === 115 || selectedWall.type === WallType.Partition ? 'active' : ''}`}
                    onClick={() => {
                      // Toggle partition
                    }}
                  >
                    115 mm (4.5″ Partition)
                  </button>
                  <button
                    type="button"
                    className={`drafted-thickness-option ${selectedWall.thickness === 230 || selectedWall.type === WallType.External ? 'active' : ''}`}
                    onClick={() => {
                      // Toggle exterior
                    }}
                  >
                    230 mm (9″ Structural)
                  </button>
                </div>
              </div>

              <dl className="property-definition-list" style={{ marginTop: 12 }}>
                <div>
                  <dt>Length</dt>
                  <dd>{(wallLength / 1000).toFixed(2)} m ({mmToFeet(wallLength).toFixed(1)}′)</dd>
                </div>
                <div>
                  <dt>Angle</dt>
                  <dd>{angleDeg}° ({angleDeg === 0 || angleDeg === 180 ? 'Horizontal' : angleDeg === 90 ? 'Vertical' : 'Angled'})</dd>
                </div>
                <div>
                  <dt>Classification</dt>
                  <dd>{selectedWall.type === WallType.External ? 'Exterior Envelope' : 'Interior Partition'}</dd>
                </div>
                <div>
                  <dt>Hosted Openings</dt>
                  <dd>{hostedDoors.length} Door(s) · {hostedWindows.length} Window(s)</dd>
                </div>
              </dl>
              <p className="inspector-truth-note">Walls are derived from canonical room boundaries. Reshaping room corners automatically articulates wall angles in 2D and 3D.</p>
            </div>
          );
        })()}

        {selectedStair && <div className="inspector-section"><span className="inspector-section-title">Stair / vertical core</span><dl className="property-definition-list"><div><dt>Connection</dt><dd>{selectedStair.connectsFloors.join(' → ')}</dd></div><div><dt>Core identity</dt><dd>{selectedStair.verticalCoreId?.slice(0, 8) ?? 'Not assigned'}</dd></div><div><dt>Orientation</dt><dd>{selectedStair.direction}</dd></div><div><dt>Width</dt><dd>{(selectedStair.width / 1000).toFixed(2)} m</dd></div><div><dt>Footprint</dt><dd>{(selectedStair.width * selectedStair.length / 1_000_000).toFixed(1)} m²</dd></div><div><dt>Generation protection</dt><dd>{selectedStair.verticalCoreId && editor.generationControl.protectedCoreIds.includes(selectedStair.verticalCoreId) ? 'Protected' : 'Variable'}</dd></div></dl><p className="inspector-truth-note">Direct stair movement is unavailable because every connected floor must preserve vertical continuity.</p></div>}

        {/* DOOR PROPERTIES */}
        {selectedDoor && (() => {
          const hostWall = activeFloor.walls.find(w => w.id === selectedDoor.wallId);
          const distToStart = hostWall ? Math.round(Math.hypot(selectedDoor.position.x - hostWall.startPoint.x, selectedDoor.position.y - hostWall.startPoint.y)) : 0;
          const distToEnd = hostWall ? Math.round(Math.hypot(selectedDoor.position.x - hostWall.endPoint.x, selectedDoor.position.y - hostWall.endPoint.y)) : 0;

          return (
            <div className="inspector-section">
              <span className="inspector-section-title">Door Geometry & Placement</span>

              {/* Drafted.ai Quick Actions: Flip Swing & Flip Hinge */}
              <div className="drafted-quick-actions-row">
                <button
                  type="button"
                  className="drafted-flip-btn"
                  onClick={() => {
                    const nextSwing = selectedDoor.swingDirection === SwingDirection.Inward
                      ? SwingDirection.Outward
                      : SwingDirection.Inward;
                    executeCommand(new UpdateDoorPropertiesCommand(selectedDoor.id, { swingDirection: nextSwing }));
                  }}
                  title="Flip door swing inward / outward"
                >
                  <RotateCcw size={13} />
                  <span>Flip Swing ({selectedDoor.swingDirection === SwingDirection.Inward ? 'Inward' : 'Outward'})</span>
                </button>

                <button
                  type="button"
                  className="drafted-flip-btn"
                  onClick={() => {
                    const nextHinge = selectedDoor.swingDirection === SwingDirection.Left
                      ? SwingDirection.Right
                      : SwingDirection.Left;
                    executeCommand(new UpdateDoorPropertiesCommand(selectedDoor.id, { swingDirection: nextHinge }));
                  }}
                  title="Flip door hinge side left / right"
                >
                  <RotateCw size={13} />
                  <span>Flip Hinge</span>
                </button>
              </div>

              {/* Door Type Selector */}
              <div className="form-group">
                <label className="form-label">Door Type</label>
                <div className="drafted-btn-group">
                  {[
                    { type: DoorType.Single, label: 'Single' },
                    { type: DoorType.Double, label: 'Double French' },
                    { type: DoorType.Sliding, label: 'Sliding Pocket' },
                    { type: DoorType.Folding, label: 'Bi-Fold' },
                    { type: DoorType.OpenPassage, label: 'Cased Opening' },
                  ].map(item => (
                    <button
                      key={item.type}
                      type="button"
                      className={`drafted-preset-btn ${selectedDoor.type === item.type ? 'active' : ''}`}
                      onClick={() => executeCommand(new UpdateDoorPropertiesCommand(selectedDoor.id, { type: item.type }))}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clear Width Presets */}
              <div className="form-group">
                <label className="form-label">Clear Width Presets</label>
                <div className="drafted-btn-group">
                  {[
                    { val: 750, label: '750 mm (WC)' },
                    { val: 900, label: '900 mm (Std)' },
                    { val: 1000, label: '1000 mm (Bed)' },
                    { val: 1200, label: '1200 mm (Grand)' },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      className={`drafted-preset-btn ${selectedDoor.width === p.val ? 'active' : ''}`}
                      onClick={() => executeCommand(new UpdateDoorPropertiesCommand(selectedDoor.id, { width: p.val }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Custom Clear Width (mm)</label>
                <input
                  type="number"
                  step="50"
                  min="600"
                  max="2400"
                  value={selectedDoor.width}
                  onChange={(e) =>
                    executeCommand(
                      new UpdateDoorPropertiesCommand(selectedDoor.id, {
                        width: Number(e.target.value),
                      })
                    )
                  }
                />
              </div>

              {/* Real-time Distance to Wall Corners HUD */}
              {hostWall && (
                <div className="drafted-corner-distance-box">
                  <div className="drafted-corner-distance-row">
                    <span>Hinge corner clearance:</span>
                    <strong>{distToStart} mm ({mmToFeet(distToStart).toFixed(1)}′)</strong>
                  </div>
                  <div className="drafted-corner-distance-row">
                    <span>Strike corner clearance:</span>
                    <strong>{distToEnd} mm ({mmToFeet(distToEnd).toFixed(1)}′)</strong>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* WINDOW PROPERTIES */}
        {selectedWindow && (() => {
          const hostWall = activeFloor.walls.find(w => w.id === selectedWindow.wallId);
          const distToStart = hostWall ? Math.round(Math.hypot(selectedWindow.position.x - hostWall.startPoint.x, selectedWindow.position.y - hostWall.startPoint.y)) : 0;
          const distToEnd = hostWall ? Math.round(Math.hypot(selectedWindow.position.x - hostWall.endPoint.x, selectedWindow.position.y - hostWall.endPoint.y)) : 0;

          return (
            <div className="inspector-section">
              <span className="inspector-section-title">Window Attributes & Glazing</span>

              {/* Window Type Selector */}
              <div className="form-group">
                <label className="form-label">Window Type</label>
                <div className="drafted-btn-group">
                  {[
                    { type: WindowType.Sliding, label: 'Sliding 2-Track' },
                    { type: WindowType.Casement, label: 'Casement' },
                    { type: WindowType.Fixed, label: 'Fixed Picture' },
                    { type: WindowType.Ventilator, label: 'High Louver' },
                  ].map(item => (
                    <button
                      key={item.type}
                      type="button"
                      className={`drafted-preset-btn ${selectedWindow.type === item.type ? 'active' : ''}`}
                      onClick={() => executeCommand(new UpdateWindowPropertiesCommand(selectedWindow.id, { type: item.type }))}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Width Presets */}
              <div className="form-group">
                <label className="form-label">Width Presets</label>
                <div className="drafted-btn-group">
                  {[600, 900, 1200, 1500, 1800, 2400].map(w => (
                    <button
                      key={w}
                      type="button"
                      className={`drafted-preset-btn ${selectedWindow.width === w ? 'active' : ''}`}
                      onClick={() => executeCommand(new UpdateWindowPropertiesCommand(selectedWindow.id, { width: w }))}
                    >
                      {w} mm
                    </button>
                  ))}
                </div>
              </div>

              {/* Sill Height Presets */}
              <div className="form-group">
                <label className="form-label">Sill Height Presets</label>
                <div className="drafted-btn-group">
                  {[
                    { val: 450, label: '450 mm (Low)' },
                    { val: 900, label: '900 mm (Std)' },
                    { val: 1200, label: '1200 mm (Counter)' },
                    { val: 1800, label: '1800 mm (Vent)' },
                  ].map(s => (
                    <button
                      key={s.val}
                      type="button"
                      className={`drafted-preset-btn ${selectedWindow.sillHeight === s.val ? 'active' : ''}`}
                      onClick={() => executeCommand(new UpdateWindowPropertiesCommand(selectedWindow.id, { sillHeight: s.val }))}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group-row">
                <div className="form-group">
                  <label className="form-label">Width (mm)</label>
                  <input
                    type="number"
                    step="100"
                    min="500"
                    max="4000"
                    value={selectedWindow.width}
                    onChange={(e) =>
                      executeCommand(
                        new UpdateWindowPropertiesCommand(selectedWindow.id, {
                          width: Number(e.target.value),
                        })
                      )
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Sill Height (mm)</label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    max="2400"
                    value={selectedWindow.sillHeight}
                    onChange={(e) =>
                      executeCommand(
                        new UpdateWindowPropertiesCommand(selectedWindow.id, {
                          sillHeight: Number(e.target.value),
                        })
                      )
                    }
                  />
                </div>
              </div>

              {/* Corner Clearance HUD */}
              {hostWall && (
                <div className="drafted-corner-distance-box">
                  <div className="drafted-corner-distance-row">
                    <span>Left jamb clearance:</span>
                    <strong>{distToStart} mm ({mmToFeet(distToStart).toFixed(1)}′)</strong>
                  </div>
                  <div className="drafted-corner-distance-row">
                    <span>Right jamb clearance:</span>
                    <strong>{distToEnd} mm ({mmToFeet(distToEnd).toFixed(1)}′)</strong>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* DEFAULT: SITE & FLOOR SUMMARY */}
        {!selection && !isMulti && (
          <>
            <div className="inspector-section">
              <span className="inspector-section-title">Site & Plot</span>
              <div className="form-group-row">
                <div className="form-group">
                  <label className="form-label">Plot Width</label>
                  <input
                    type="text"
                    disabled
                    value={`${Math.round(building.site.plotWidth)} mm (${(building.site.plotWidth / 1000).toFixed(1)} m · ${mmToFeet(building.site.plotWidth).toFixed(1)}′)`}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Plot Depth</label>
                  <input
                    type="text"
                    disabled
                    value={`${Math.round(building.site.plotDepth)} mm (${(building.site.plotDepth / 1000).toFixed(1)} m · ${mmToFeet(building.site.plotDepth).toFixed(1)}′)`}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Road Facing Direction</label>
                <input type="text" disabled value={String(building.site.roadFacing ?? Direction.North).toUpperCase()} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Total Plot Area:{' '}
                <strong>{sqMmToSqFt(building.site.plotArea).toFixed(0)} sq.ft</strong> (
                {(building.site.plotArea / 1_000_000).toFixed(1)} m²)
              </div>
            </div>

            <div className="inspector-section">
              <span className="inspector-section-title">Active Floor Info</span>
              <div className="form-group">
                <label className="form-label">Level Name</label>
                <input type="text" disabled value={activeFloor.name} />
              </div>
              <div className="form-group">
                <label className="form-label">Clear Floor Height</label>
                <input type="text" disabled value={`${activeFloor.floorHeight} mm`} />
              </div>
              <div className="form-group">
                <label className="form-label">Total Rooms</label>
                <input type="text" disabled value={activeFloor.rooms.length} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
