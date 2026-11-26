import React, { useMemo, useRef, useState } from 'react';
import type { ApartmentBhkType, Floor, Point, Room } from '@ai-floor-planner/core';
import {
  architecturalSpaceRole,
  formatArchitecturalArea,
  formatArchitecturalLength,
  parseArchitecturalAreaMm2,
  parseArchitecturalLengthMm,
} from '@ai-floor-planner/core';
import { polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { fitToView, renderFloor, screenToWorld, worldToScreen } from '@ai-floor-planner/renderer';
import {
  ENGINEERING_MIN_ROOM_AREAS,
  createRoomAreaRegenerationCommand,
  expandFlatIntoSetbackMargin,
  proposeProtectedLocalRegeneration,
  regenerateWithPreservedRatios,
  type LocalizedRegenerationCandidate,
  type LocalizedRegenerationOperation,
  type LocalizedRegenerationScope,
  type RoomAreaCandidate,
} from '@ai-floor-planner/planning-engine';
import { solveRoomArea } from '../../services/room-area-solver';
import type { EditorContextValue } from '../../stores/editor-store';
import { ApartmentOpeningEditor } from './ApartmentOpeningEditor';

export interface InteractivePlanEditorPageProps {
  editor: EditorContextValue;
  onBackToCad?: () => void;
}

const SQFT_TO_MM2 = 92_903.04;
const MM2_TO_SQFT = 1 / SQFT_TO_MM2;
const VIEW_W = 920;
const VIEW_H = 620;

export const InteractivePlanEditorPage: React.FC<InteractivePlanEditorPageProps> = ({
  editor,
  onBackToCad,
}) => {
  const floor: Floor = editor.activeFloor;
  const editableRooms = useMemo(
    () =>
      floor.rooms.filter(
        (r) => architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID' && r.type !== 'staircase' && r.type !== 'lift',
      ),
    [floor.rooms],
  );

  const getRoomBounds = (room: Room) => {
    if (room.boundary?.points?.length >= 3) {
      const box = polygonBoundingBox(room.boundary);
      if (box.width > 0 && box.height > 0) {
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }
    }
    return { x: room.x, y: room.y, width: room.width, height: room.height };
  };

  const [selectedRoomId, setSelectedRoomId] = useState<string>(() => (editor.selection?.entityType === 'room' ? editor.selection.entityId : undefined) ?? editableRooms[0]?.id ?? floor.rooms[0]?.id ?? '');

  const selectedRoom: Room | undefined = useMemo(
    () => floor.rooms.find((r) => r.id === selectedRoomId) ?? editableRooms[0] ?? floor.rooms[0],
    [floor.rooms, editableRooms, selectedRoomId],
  );

  const selectedRoomDims = useMemo(() => {
    if (!selectedRoom) return { x: 0, y: 0, width: 3600, height: 3600 };
    return getRoomBounds(selectedRoom);
  }, [selectedRoom]);


  const [targetRoomSqFtInput, setTargetRoomSqFtInput] = useState<string>(() =>
    selectedRoom ? Math.round(selectedRoom.area * MM2_TO_SQFT).toString() : '160',
  );
  const [widthMmInput, setWidthMmInput] = useState<string>(() =>
    selectedRoom ? Math.round(getRoomBounds(selectedRoom).width).toString() : '3600',
  );
  const [lengthMmInput, setLengthMmInput] = useState<string>(() =>
    selectedRoom ? Math.round(getRoomBounds(selectedRoom).height).toString() : '4200',
  );
  const [expandIntoSetback, setExpandIntoSetback] = useState<boolean>(true);
  const [minSetbackMm, setMinSetbackMm] = useState<number>(2000);

  const unitIds = useMemo(() => {
    const ids = new Set<string>();
    floor.apartmentUnits?.forEach((u) => ids.add(u.id));
    floor.rooms.forEach((r) => {
      if (r.unitId) ids.add(r.unitId);
    });
    return [...ids];
  }, [floor.apartmentUnits, floor.rooms]);

  const activeUnitId = selectedRoom?.unitId ?? unitIds[0];
  const selectedFlat = floor.apartmentUnits?.find(unit => unit.id === activeUnitId);
  const lockedEntities = editor.generationControl.lockedEntityIds;
  const flatLocked = Boolean(selectedFlat && lockedEntities.includes(selectedFlat.id));
  const floorLocked = editor.generationControl.lockedFloorIds.includes(floor.id);
  const currentUnitAreaSqFt = useMemo(() => {
    const unitRooms = floor.rooms.filter(
      (r) =>
        architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID' &&
        (activeUnitId ? r.unitId === activeUnitId : r.type !== 'staircase' && r.type !== 'lift' && r.type !== 'corridor'),
    );
    const totalMm2 = unitRooms.reduce((sum, r) => sum + polygonArea(r.boundary), 0);
    return Math.round(totalMm2 * MM2_TO_SQFT);
  }, [floor.rooms, activeUnitId]);

  const [targetFlatSqFtInput, setTargetFlatSqFtInput] = useState<string>(() =>
    Math.max(500, currentUnitAreaSqFt).toString(),
  );
  const [multiUnitExprInput, setMultiUnitExprInput] = useState<string>('');
  const [localScope, setLocalScope] = useState<LocalizedRegenerationScope>('SINGLE_FLAT');
  const [localOperation, setLocalOperation] = useState<LocalizedRegenerationOperation>('REGENERATE_ALTERNATIVE');
  const [localTargetUnitId, setLocalTargetUnitId] = useState<string>(() => floor.apartmentUnits?.[1]?.id ?? floor.apartmentUnits?.[0]?.id ?? '');
  const [localTargetBhk, setLocalTargetBhk] = useState<ApartmentBhkType>('3BHK');
  const [localRegenPreview, setLocalRegenPreview] = useState<{
    readonly candidates: readonly LocalizedRegenerationCandidate[];
    readonly selectedIndex: number;
    readonly baseRevisionDigest: string;
    readonly message: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [candidates, setCandidates] = useState<readonly RoomAreaCandidate[]>([]);
  const [isSolving, setIsSolving] = useState(false);

  const dragRef = useRef<{
    side: 'east' | 'west' | 'north' | 'south';
    startWorld: Point;
    origRoom: Room;
  } | null>(null);
  const [dragDeltaMm, setDragDeltaMm] = useState<number>(0);

  const transform = useMemo(() => fitToView(polygonBoundingBox(floor.boundary), VIEW_W, VIEW_H, 48), [floor]);

  const baseSvgMarkup = useMemo(() => {
    const svg = renderFloor(floor, editor.building, transform, VIEW_W, VIEW_H, {
      showGrid: false,
      showTitleBlock: false,
      showDimensions: true,
    });
    const innerMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    return innerMatch?.[1] ?? '';
  }, [floor, editor.building, transform]);

  const selectRoom = (room: Room) => {
    const b = getRoomBounds(room);
    setSelectedRoomId(room.id);
    editor.selectEntity('room', room.id, floor.id);
    setTargetRoomSqFtInput((room.area * MM2_TO_SQFT).toFixed(1));
    setWidthMmInput(Math.round(b.width).toString());
    setLengthMmInput(Math.round(b.height).toString());
    setCandidates([]);
    setErrorMessage('');
  };

  const applyCandidate = (cand: RoomAreaCandidate) => {
    try {
      const command = createRoomAreaRegenerationCommand(editor.building, cand, {
        targetAreaMm2: cand.requestedAreaMm2,
        allowAdjacentAdjustments: true,
        allowEnvelopeExpansion: expandIntoSetback,
        minSetbackMm,
        preserveStructural: true,
      }, () => editor.getGenerationControl?.() ?? editor.generationControl);
      editor.executeCommand(command);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'This room edit did not pass acceptance.');
      return;
    }
    setCandidates([]);
    setErrorMessage('');
    const updated = cand.building.floors
      .find((f) => f.id === floor.id)
      ?.rooms.find((r) => r.id === cand.targetRoomId);
    if (updated) {
      const b = getRoomBounds(updated);
      setTargetRoomSqFtInput((updated.area * MM2_TO_SQFT).toFixed(1));
      setWidthMmInput(Math.round(b.width).toString());
      setLengthMmInput(Math.round(b.height).toString());
    }
    setStatusMessage(
      `Applied ${cand.name}: achieved ${(cand.achievedAreaMm2 * MM2_TO_SQFT).toFixed(1)} sq.ft. (${(cand.achievedAreaMm2 / 1_000_000).toFixed(2)} m²).`,
    );
  };

  const handleApplyRoomTarget = async (overrideAreaMm2?: number) => {
    if (!selectedRoom) return;
    setErrorMessage('');
    setStatusMessage('');
    let resolvedMm2 = overrideAreaMm2 ?? 0;
    if (!(resolvedMm2 > 0) && multiUnitExprInput.trim()) {
      const parsed = parseArchitecturalAreaMm2(multiUnitExprInput.trim());
      if (!parsed.ok) {
        setErrorMessage(parsed.error);
        return;
      }
      resolvedMm2 = parsed.mm2;
    }
    if (!(resolvedMm2 > 0)) {
      const parsedInput = parseArchitecturalAreaMm2(targetRoomSqFtInput, 'sqft');
      resolvedMm2 = parsedInput.ok ? parsedInput.mm2 : 0;
    }
    const areaMm2 = resolvedMm2;
    if (!(areaMm2 > 0)) {
      setErrorMessage('Enter a positive room target area or valid Width x Length dimensions.');
      return;
    }

    setIsSolving(true);
    const controller = new AbortController();
    try {
      const result = await solveRoomArea(
        editor.building,
        selectedRoom.id,
        {
          targetAreaMm2: areaMm2,
          allowAdjacentAdjustments: true,
          allowEnvelopeExpansion: expandIntoSetback,
          minSetbackMm,
          control: editor.generationControl,
        },
        controller.signal,
      );
      if (result.isFeasible && result.candidates.length > 0) {
        setCandidates(result.candidates);
        applyCandidate(result.candidates[0]!);
      } else {
        setErrorMessage(result.infeasibilityReason ?? 'Could not fit target room area within current bounds.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSolving(false);
    }
  };

  const handleModeAExpandEdge = (sideDeltaMm: number) => {
    if (!selectedRoom) return;
    setErrorMessage('');
    const targetAreaMm2 = Math.max(
      1_800_000,
      selectedRoom.area + sideDeltaMm * Math.max(selectedRoom.width, selectedRoom.height),
    );
    const res = expandFlatIntoSetbackMargin(editor.building, selectedRoom.id, targetAreaMm2, {
      floorId: floor.id,
      minSetbackMm,
      control: editor.generationControl,
    });
    if (res.isFeasible && res.candidates.length > 0) {
      applyCandidate(res.candidates[0]!);
    } else {
      setErrorMessage(res.infeasibilityReason ?? 'Setback expansion reached minimum plot setback boundary.');
    }
  };

  const handleModeBRegenerateSimilar = () => {
    setErrorMessage('');
    setStatusMessage('');
    if (floorLocked || flatLocked || lockedEntities.includes(selectedRoom?.id ?? '')) {
      setErrorMessage('Unlock the selected room, flat and floor before requesting proportional regeneration.');
      return;
    }
    const parsedSqFt = Number(targetFlatSqFtInput);
    const editedSqFt = Number(targetRoomSqFtInput);
    const result = regenerateWithPreservedRatios(editor.building, {
      floorId: floor.id,
      unitId: activeUnitId,
      editedRoomId: selectedRoom?.id,
      targetFlatSqFt: Number.isFinite(parsedSqFt) && parsedSqFt > 0 ? parsedSqFt : undefined,
      targetRoomAreaMm2:
        (!parsedSqFt || Math.abs(parsedSqFt - currentUnitAreaSqFt) < 1) &&
          Number.isFinite(editedSqFt) &&
          editedSqFt > 0
          ? editedSqFt * SQFT_TO_MM2
          : undefined,
      minSetbackMm,
    });
    if (!result.isFeasible) {
      setErrorMessage(result.error ?? 'Proportional ratio scaling exceeded plot envelope.');
      return;
    }
    const proposedFloor = result.building.floors.find(item => item.id === floor.id);
    const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after);
    const outsideUnit = floor.rooms.filter(room => !activeUnitId || room.unitId !== activeUnitId || lockedEntities.includes(room.id));
    const outsideChanged = !proposedFloor || editor.building.floors.some(item => item.id !== floor.id &&
      !same(item, result.building.floors.find(candidate => candidate.id === item.id))) ||
      outsideUnit.some(room => !same(room.boundary, proposedFloor.rooms.find(candidate => candidate.id === room.id)?.boundary));
    if (outsideChanged) {
      setErrorMessage('This proportional change requires moving other floors, a neighbouring flat or the core. Adjust a room target inside the current flat instead.');
      return;
    }
    editor.applyRefinement(result.building, 'Mode B: Regenerate Similar (Keep Edited Ratios)');
    if (result.achievedUnitSqFt) {
      setTargetFlatSqFtInput(Math.round(result.achievedUnitSqFt).toString());
    }
    setStatusMessage(
      `Regenerated with preserved room ratios (${(result.appliedScaleFactor * 100).toFixed(1)}% linear scale, ${result.achievedUnitSqFt?.toFixed(0) ?? '-'} sq.ft. per flat, 0.000 mm² delta).`,
    );
  };

  const ratioBreakdown = useMemo(() => {
    const scopeRooms = floor.rooms.filter(
      (r) =>
        architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID' &&
        (activeUnitId ? r.unitId === activeUnitId : r.type !== 'staircase' && r.type !== 'lift' && r.type !== 'corridor'),
    );
    const total = Math.max(1, scopeRooms.reduce((s, r) => s + r.area, 0));
    return scopeRooms.map((r) => ({
      id: r.id,
      name: r.name,
      sqFt: (r.area * MM2_TO_SQFT).toFixed(0),
      pct: ((r.area / total) * 100).toFixed(1),
    }));
  }, [floor.rooms, activeUnitId]);

  const toClientPoint = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * VIEW_W;
    const sy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * VIEW_H;
    return screenToWorld({ x: sx, y: sy }, transform);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const worldPt = toClientPoint(e);
    const { side, startWorld } = dragRef.current;
    const rawDelta =
      side === 'east'
        ? worldPt.x - startWorld.x
        : side === 'west'
          ? startWorld.x - worldPt.x
          : side === 'south'
            ? worldPt.y - startWorld.y
            : startWorld.y - worldPt.y;
    setDragDeltaMm(Math.round(rawDelta / 50) * 50);
  };

  const handleSvgPointerUp = () => {
    if (!dragRef.current) return;
    const { side, origRoom } = dragRef.current;
    const delta = dragDeltaMm;
    dragRef.current = null;
    setDragDeltaMm(0);
    if (Math.abs(delta) < 50) return;
    const isX = side === 'east' || side === 'west';
    const b = getRoomBounds(origRoom);
    const nextAreaMm2 = Math.max(
      1_800_000,
      isX ? (b.width + delta) * b.height : b.width * (b.height + delta),
    );
    setTargetRoomSqFtInput((nextAreaMm2 * MM2_TO_SQFT).toFixed(1));
    void handleApplyRoomTarget(nextAreaMm2);
  };

  const selectedBox = selectedRoom
    ? {
      tl: worldToScreen({ x: selectedRoomDims.x, y: selectedRoomDims.y }, transform),
      br: worldToScreen({ x: selectedRoomDims.x + selectedRoomDims.width, y: selectedRoomDims.y + selectedRoomDims.height }, transform),
    }
    : null;

  return (
    <section
      className="flex h-full min-h-0 flex-col rh-workspace bg-argon-bg text-argon-text"
      aria-label="Interactive Plan Editor Studio"
    >
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-argon-border bg-argon-card px-4 py-2.5">
        <div className="flex items-center gap-3">
          <strong className="text-sm font-bold text-argon-text">Room dimensions</strong>
          <div className="flex flex-wrap gap-1.5" aria-label="Edit Plan Floors">
            {editor.building.floors.map((fl) => (
              <button
                key={fl.id}
                type="button"
                onClick={() => editor.switchFloor(fl.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${fl.id === floor.id ? 'bg-argon-btn text-argon-card font-semibold' : 'bg-argon-surface text-argon-muted hover:bg-argon-border'
                  }`}
              >
                {fl.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="edit-plan-undo"
            disabled={!editor.canUndo}
            onClick={editor.undo}
            className="rounded border border-argon-border bg-argon-surface px-2.5 py-1 text-xs text-argon-text hover:bg-argon-border disabled:opacity-45"
          >
            Undo
          </button>
          <button
            type="button"
            data-testid="edit-plan-redo"
            disabled={!editor.canRedo}
            onClick={editor.redo}
            className="rounded border border-argon-border bg-argon-surface px-2.5 py-1 text-xs text-argon-text hover:bg-argon-border disabled:opacity-45"
          >
            Redo
          </button>
          {onBackToCad && (
            <button
              type="button"
              onClick={onBackToCad}
              className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Done Editing · Back to 2D CAD
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Split */}
      <div className="rh-workspace-body flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Interactive Canvas */}
        <div className="relative min-h-[360px] flex-1 overflow-hidden bg-argon-bg p-3">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-full w-full rounded-lg border border-argon-border bg-white select-none"
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
          >
            <g dangerouslySetInnerHTML={{ __html: baseSvgMarkup }} />
            {/* Interactive Room Hit Targets */}
            {editableRooms.map((room) => {
              const pts = room.boundary.points
                .map((p) => {
                  const sc = worldToScreen(p, transform);
                  return `${sc.x.toFixed(1)},${sc.y.toFixed(1)}`;
                })
                .join(' ');
              const isSel = selectedRoom?.id === room.id;
              return (
                <polygon
                  key={room.id}
                  points={pts}
                  fill={isSel ? 'rgba(245, 158, 11, 0.22)' : 'transparent'}
                  stroke={isSel ? '#d97706' : 'transparent'}
                  strokeWidth={isSel ? 2.5 : 1}
                  className="cursor-pointer hover:fill-amber-400/15"
                  onClick={() => selectRoom(room)}
                />
              );
            })}
            {/* Draggable Boundary Wall Handles on Selected Room */}
            {selectedRoom && selectedBox && (
              <g data-testid="edit-plan-drag-handles">
                {(
                  [
                    {
                      side: 'east' as const,
                      x: Math.max(selectedBox.tl.x, selectedBox.br.x),
                      y: (selectedBox.tl.y + selectedBox.br.y) / 2,
                      cursor: 'ew-resize',
                    },
                    {
                      side: 'west' as const,
                      x: Math.min(selectedBox.tl.x, selectedBox.br.x),
                      y: (selectedBox.tl.y + selectedBox.br.y) / 2,
                      cursor: 'ew-resize',
                    },
                    {
                      side: 'south' as const,
                      x: (selectedBox.tl.x + selectedBox.br.x) / 2,
                      y: Math.max(selectedBox.tl.y, selectedBox.br.y),
                      cursor: 'ns-resize',
                    },
                    {
                      side: 'north' as const,
                      x: (selectedBox.tl.x + selectedBox.br.x) / 2,
                      y: Math.min(selectedBox.tl.y, selectedBox.br.y),
                      cursor: 'ns-resize',
                    },
                  ] as const
                ).map((h) => (
                  <circle
                    key={h.side}
                    cx={h.x}
                    cy={h.y}
                    r={6}
                    fill="#f59e0b"
                    stroke="#0f172a"
                    strokeWidth={1.8}
                    style={{ cursor: h.cursor }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      const svgEl = ev.currentTarget.ownerSVGElement;
                      if (!svgEl) return;
                      const rect = svgEl.getBoundingClientRect();
                      const sx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * VIEW_W;
                      const sy = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * VIEW_H;
                      dragRef.current = {
                        side: h.side,
                        startWorld: screenToWorld({ x: sx, y: sy }, transform),
                        origRoom: selectedRoom,
                      };
                      setDragDeltaMm(0);
                    }}
                  />
                ))}
              </g>
            )}
          </svg>
          {dragRef.current && (
            <div className="pointer-events-none absolute left-6 top-6 rounded bg-argon-card/90 px-3 py-1.5 text-xs font-semibold text-argon-text shadow">
              Dragging {dragRef.current.side} wall: {dragDeltaMm >= 0 ? `+${dragDeltaMm}` : dragDeltaMm} mm
            </div>
          )}
        </div>

        {/* Right Parametric Edit Panel */}
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-l border-argon-border bg-argon-card p-4 lg:w-96">
          <div>
            <h3 className="font-display text-xl font-semibold text-argon-text">
              Mode A · Parametric Room & Boundary Resize
            </h3>
            <label className="mt-2 block text-xs text-argon-muted">
              Selected Room
              <select
                value={selectedRoom?.id ?? ''}
                onChange={(e) => {
                  const next = floor.rooms.find((r) => r.id === e.target.value);
                  if (next) selectRoom(next);
                }}
                className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2.5 py-1.5 text-xs text-argon-text"
              >
                {editableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({Math.round(r.area * MM2_TO_SQFT)} sq.ft.)
                  </option>
                ))}
              </select>
            </label>

            {selectedRoom && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-argon-border bg-argon-bg/60 p-3">
                <div className="flex items-center justify-between text-xs text-argon-muted">
                  <span>Current Size</span>
                  <span className="font-mono font-semibold text-argon-text">
                    {(selectedRoomDims.width / 304.8).toFixed(1)}&apos; x {(selectedRoomDims.height / 304.8).toFixed(1)}&apos; ({Math.round(selectedRoomDims.width)} × {Math.round(selectedRoomDims.height)} mm) ({(selectedRoom.area * MM2_TO_SQFT).toFixed(0)} sq.ft.)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-argon-muted">
                    Width (mm or ft&apos; in&quot;)
                    <input
                      type="text"
                      value={widthMmInput}
                      onChange={(e) => {
                        setWidthMmInput(e.target.value);
                        const pw = parseArchitecturalLengthMm(e.target.value, 'mm');
                        const pl = parseArchitecturalLengthMm(lengthMmInput, 'mm');
                        if (pw.ok && pl.ok) setTargetRoomSqFtInput((pw.mm * pl.mm * MM2_TO_SQFT).toFixed(1));
                      }}
                      className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2 py-1 text-xs text-argon-text"
                    />
                  </label>
                  <label className="text-[11px] text-argon-muted">
                    Length (mm or ft&apos; in&quot;)
                    <input
                      type="text"
                      value={lengthMmInput}
                      onChange={(e) => {
                        setLengthMmInput(e.target.value);
                        const pw = parseArchitecturalLengthMm(widthMmInput, 'mm');
                        const pl = parseArchitecturalLengthMm(e.target.value, 'mm');
                        if (pw.ok && pl.ok) setTargetRoomSqFtInput((pw.mm * pl.mm * MM2_TO_SQFT).toFixed(1));
                      }}
                      className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2 py-1 text-xs text-argon-text"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between text-[11px] text-argon-muted">
                  <span>
                    Min Constraint:{' '}
                    <strong className="font-mono text-argon-text">
                      {formatArchitecturalArea(ENGINEERING_MIN_ROOM_AREAS[selectedRoom.type] ?? 1_800_000).labelImperial}
                    </strong>
                  </span>
                  <span>
                    Lock:{' '}
                    <strong className="font-mono text-argon-text">
                      {lockedEntities.includes(selectedRoom.id) ? 'LOCKED' : 'EDITABLE'}
                    </strong>
                  </span>
                </div>
                <label className="block text-[11px] text-argon-muted">
                  Target Room Area (sq.ft.)
                  <input
                    type="number"
                    value={targetRoomSqFtInput}
                    onChange={(e) => {
                      setTargetRoomSqFtInput(e.target.value);
                      setMultiUnitExprInput('');
                    }}
                    className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2.5 py-1.5 text-xs text-argon-text"
                  />
                </label>
                <label className="block text-[11px] text-argon-muted">
                  Multi-Unit Target (sq ft, sq m, fractional, or ft&apos; in&quot; × ft&apos; in&quot;)
                  <input
                    type="text"
                    data-testid="multi-unit-area-input"
                    placeholder={`e.g. 18.5 sq m, 165 1/2 sq ft, or ${formatArchitecturalLength(selectedRoomDims.width).feetInches} x ${formatArchitecturalLength(selectedRoomDims.height).feetInches}`}
                    value={multiUnitExprInput}
                    onChange={(e) => setMultiUnitExprInput(e.target.value)}
                    className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2.5 py-1.5 text-xs font-mono text-argon-text"
                  />
                </label>
                {(() => {
                  const parsedPreview = multiUnitExprInput.trim()
                    ? parseArchitecturalAreaMm2(multiUnitExprInput.trim())
                    : parseArchitecturalAreaMm2(targetRoomSqFtInput, 'sqft');
                  if (!parsedPreview.ok) return null;
                  const deltaSqFt = parsedPreview.sqFt - selectedRoom.area * MM2_TO_SQFT;
                  return (
                    <div data-testid="room-target-deviation" className="text-[11px] font-mono text-argon-muted">
                      Target: {parsedPreview.sqFt.toFixed(1)} sq ft ({parsedPreview.sqM.toFixed(2)} m²) · Δ{' '}
                      {deltaSqFt >= 0 ? `+${deltaSqFt.toFixed(1)}` : deltaSqFt.toFixed(1)} sq ft
                    </div>
                  );
                })()}

                <label className="flex items-center gap-2 text-xs text-argon-text">
                  <input
                    type="checkbox"
                    checked={expandIntoSetback}
                    onChange={(e) => setExpandIntoSetback(e.target.checked)}
                    className="rounded border-argon-border bg-argon-surface text-amber-500"
                  />
                  Expand External Boundary into Setback
                </label>

                <label className="block text-[11px] text-argon-muted">
                  Minimum Preserved Setback (mm)
                  <input
                    type="number"
                    value={minSetbackMm}
                    min={0}
                    step={100}
                    onChange={(e) => setMinSetbackMm(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2 py-1 text-xs text-argon-text"
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSolving}
                    onClick={() => void handleApplyRoomTarget()}
                    className="flex-1 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-argon-btnHover disabled:opacity-50"
                  >
                    {isSolving ? 'Solving...' : 'Apply Room Size'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeAExpandEdge(300)}
                    className="rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-argon-text hover:bg-amber-500/25"
                    title="Expand exterior boundary 300 mm outward into free setback margin"
                  >
                    +300mm Out
                  </button>
                </div>
              </div>
            )}
          </div>

          <hr className="border-argon-border" />

          {/* Mode B Section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-argon-muted">
              Mode B · Proportional Ratio-Preserving Scaling
            </h3>
            <p className="mt-1 text-[11px] text-argon-muted">
              Scales flats proportionally while keeping your edited room area ratios, lift core, staircase, and plot setbacks intact.
            </p>
            <label className="mt-2 block text-[11px] text-argon-muted">
              Target Area Per Flat (sq.ft.)
              <input
                type="number"
                aria-label="Target Area Per Flat (sq.ft.)"
                value={targetFlatSqFtInput}
                min={350}
                step={25}
                onChange={(e) => setTargetFlatSqFtInput(e.target.value)}
                className="mt-1 w-full rounded border border-argon-border bg-argon-surface px-2.5 py-1.5 text-xs text-argon-text"
              />
            </label>
            <button
              type="button"
              onClick={handleModeBRegenerateSimilar}
              className="mt-2.5 w-full rounded bg-argon-btn px-3 py-2 text-xs font-semibold text-white hover:bg-argon-btnHover"
            >
              Regenerate Similar (Keep Edited Ratios)
            </button>

            <div className="mt-3 max-h-40 overflow-y-auto rounded border border-argon-border bg-argon-bg/60 p-2 text-[11px]">
              <div className="mb-1 font-semibold text-argon-muted">
                Active Flat Proportions ({currentUnitAreaSqFt} sq.ft.)
              </div>
              {ratioBreakdown.map((item) => (
                <div key={item.id} className="flex justify-between py-0.5 text-argon-muted">
                  <span className="truncate pr-2">{item.name}</span>
                  <span className="font-mono text-argon-muted">
                    {item.sqFt} sq.ft. ({item.pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          {candidates.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-argon-muted">Alternative Candidates</div>
              {candidates.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => applyCandidate(cand)}
                  className="block w-full rounded border border-argon-border bg-argon-surface p-2 text-left text-[11px] hover:border-amber-500"
                >
                  <div className="font-semibold text-argon-text">{cand.name}</div>
                  <div className="text-argon-muted">{cand.tradeOffs}</div>
                </button>
              ))}
            </div>
          )}

          {floor.apartmentUnits?.length ? <>
            <div aria-label="Plan locks" className="flex flex-wrap gap-2">
              {selectedRoom && <button type="button" className="rounded border border-argon-border px-2 py-1 text-xs"
                onClick={() => editor.setRoomLocks([selectedRoom.id], !lockedEntities.includes(selectedRoom.id))}>
                {lockedEntities.includes(selectedRoom.id) ? 'Unlock room' : 'Lock room'}
              </button>}
              {selectedFlat && <button type="button" className="rounded border border-argon-border px-2 py-1 text-xs"
                onClick={() => editor.setRoomLocks([selectedFlat.id], !flatLocked)}>{flatLocked ? 'Unlock flat' : 'Lock flat'}</button>}
              <button type="button" className="rounded border border-argon-border px-2 py-1 text-xs"
                onClick={() => editor.setFloorLock(floor.id, !floorLocked)}>{floorLocked ? 'Unlock floor' : 'Lock floor'}</button>
              {[...new Set(floor.stairs.map(stair => stair.verticalCoreId).filter((id): id is string => Boolean(id)))].map((coreId, index) => {
                const locked = editor.generationControl.protectedCoreIds.includes(coreId);
                return <button key={coreId} type="button" className="rounded border border-argon-border px-2 py-1 text-xs"
                  onClick={() => editor.setCoreLock(coreId, !locked)}>{locked ? 'Unlock' : 'Lock'} core {index + 1}</button>;
              })}
            </div>
            <section
              data-testid="protected-local-regen-panel"
              aria-label="Protected localized regeneration"
              className="space-y-2 rounded-lg border border-argon-border bg-argon-bg/60 p-3 text-xs"
            >
              <div className="font-bold uppercase tracking-wider text-argon-text">
                Protected Localized Regeneration
              </div>
              <p className="text-[11px] text-argon-muted">
                Regenerate one flat, one room, or one zone while keeping all other flats, 230 mm party walls, cores, and storeys byte-identical.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-argon-muted">
                  Scope
                  <select
                    data-testid="local-regen-scope"
                    value={localScope}
                    onChange={(e) => {
                      setLocalScope(e.target.value as LocalizedRegenerationScope);
                      setLocalRegenPreview(null);
                    }}
                    className="rounded border border-argon-border bg-argon-surface p-1 text-xs text-argon-text"
                  >
                    <option value="SINGLE_FLAT">Single Flat</option>
                    <option value="SINGLE_ROOM">Selected Room</option>
                    <option value="CONNECTED_ROOM_GROUP">Public Zone Group</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-argon-muted">
                  Target Flat
                  <select
                    data-testid="local-regen-unit"
                    value={localTargetUnitId || floor.apartmentUnits[0]?.id || ''}
                    onChange={(e) => {
                      setLocalTargetUnitId(e.target.value);
                      setLocalRegenPreview(null);
                    }}
                    className="rounded border border-argon-border bg-argon-surface p-1 text-xs text-argon-text"
                  >
                    {floor.apartmentUnits.map((u, i) => (
                      <option key={u.id} value={u.id}>
                        Flat 0{i + 1} ({u.unitType ?? 'Unit'})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-argon-muted">
                  Operation
                  <select
                    data-testid="local-regen-operation"
                    value={localOperation}
                    onChange={(e) => {
                      setLocalOperation(e.target.value as LocalizedRegenerationOperation);
                      setLocalRegenPreview(null);
                    }}
                    className="rounded border border-argon-border bg-argon-surface p-1 text-xs text-argon-text"
                  >
                    <option value="REGENERATE_ALTERNATIVE">Distinct Layout</option>
                    <option value="RELOCATE_KITCHEN">Relocate Kitchen</option>
                    <option value="RECONFIGURE_LIVING_DINING">Living/Dining Flow</option>
                    <option value="CONVERT_BHK">Convert BHK</option>
                    <option value="RESIZE_MASTER_BEDROOM">Expand Master Bed</option>
                  </select>
                </label>
                {localOperation === 'CONVERT_BHK' && (
                  <label className="grid gap-1 text-[11px] text-argon-muted">
                    Target BHK
                    <select
                      data-testid="local-regen-bhk"
                      value={localTargetBhk}
                      onChange={(e) => setLocalTargetBhk(e.target.value as ApartmentBhkType)}
                      className="rounded border border-argon-border bg-argon-surface p-1 text-xs text-argon-text"
                    >
                      <option value="1BHK">1BHK</option>
                      <option value="2BHK">2BHK</option>
                      <option value="3BHK">3BHK</option>
                      <option value="4BHK">4BHK</option>
                    </select>
                  </label>
                )}
              </div>
              <button
                type="button"
                data-testid="btn-preview-protected-regen"
                onClick={() => {
                  setErrorMessage('');
                  setStatusMessage('');
                  const control = editor.generationControl;
                  const unitId = localTargetUnitId || floor.apartmentUnits?.[0]?.id;
                  const publicGroupIds =
                    localScope === 'CONNECTED_ROOM_GROUP'
                      ? floor.rooms
                          .filter(
                            (r) =>
                              r.unitId === unitId &&
                              (r.type === 'living' || r.type === 'dining' || r.type === 'kitchen'),
                          )
                          .map((r) => r.id)
                      : localScope === 'SINGLE_ROOM' && selectedRoom
                        ? [selectedRoom.id]
                        : undefined;
                  const res = proposeProtectedLocalRegeneration({
                    building: editor.building,
                    floorId: floor.id,
                    scope: localScope,
                    operation: localOperation,
                    targetUnitId: unitId,
                    targetRoomIds: publicGroupIds,
                    ...(localOperation === 'CONVERT_BHK' ? { targetBhk: localTargetBhk } : {}),
                    control,
                  });
                  if (res.status !== 'PREVIEW_READY' || !res.selectedCandidate) {
                    setLocalRegenPreview(null);
                    setErrorMessage(res.message);
                    return;
                  }
                  setLocalRegenPreview({
                    candidates: res.candidates,
                    selectedIndex: 0,
                    baseRevisionDigest: res.baseRevisionDigest,
                    message: res.message,
                  });
                }}
                className="w-full rounded bg-argon-btn px-3 py-1.5 text-xs font-semibold text-argon-card hover:bg-argon-btnHover"
              >
                Preview Protected Regeneration
              </button>
              {localRegenPreview && (() => {
                const cand = localRegenPreview.candidates[localRegenPreview.selectedIndex]!;
                return (
                  <div data-testid="local-regen-preview-card" className="space-y-2 rounded border border-emerald-500/40 bg-argon-card p-2.5">
                    <div className="font-semibold text-argon-text">{cand.label}</div>
                    <p className="text-[11px] text-argon-muted">{cand.summary}</p>
                    <p className="font-mono text-[10px] text-emerald-700">
                      Invariance verified · {cand.invarianceProof.entityDiff.untouchedRoomCount} protected rooms byte-identical · Δ ={' '}
                      {cand.invarianceProof.floorPlanarDeltaMm2.toFixed(4)} mm²
                    </p>
                    {localRegenPreview.candidates.length > 1 && (
                      <div className="flex flex-wrap gap-1">
                        {localRegenPreview.candidates.map((c, idx) => (
                          <button
                            key={c.candidateId}
                            type="button"
                            onClick={() => setLocalRegenPreview({ ...localRegenPreview, selectedIndex: idx })}
                            className={`rounded border px-2 py-0.5 text-[10px] ${
                              idx === localRegenPreview.selectedIndex
                                ? 'border-amber-500 bg-amber-500/20 font-semibold'
                                : 'border-argon-border'
                            }`}
                          >
                            Option {idx + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="btn-accept-protected-regen"
                        onClick={() => {
                          try {
                            editor.applyRefinement(
                              cand.building,
                              `Protected local regeneration: ${cand.label}`,
                              true,
                              localRegenPreview.baseRevisionDigest,
                            );
                            setStatusMessage(`Applied ${cand.label}. All neighbouring flats and storeys preserved unchanged.`);
                            setLocalRegenPreview(null);
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : 'Could not apply protected preview.');
                          }
                        }}
                        className="flex-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Accept Protected Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocalRegenPreview(null)}
                        className="rounded border border-argon-border px-2.5 py-1 text-xs"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                );
              })()}
            </section>
            <ApartmentOpeningEditor key={floor.id} editor={editor} />
          </> : null}

          {statusMessage && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-argon-pass">
              {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-argon-error">
              {errorMessage}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
