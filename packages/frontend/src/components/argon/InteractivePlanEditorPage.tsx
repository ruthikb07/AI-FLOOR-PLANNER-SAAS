import React, { useMemo, useRef, useState } from 'react';
import type { Floor, Point, Room } from '@ai-floor-planner/core';
import { architecturalSpaceRole } from '@ai-floor-planner/core';
import { polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { fitToView, renderFloor, screenToWorld, worldToScreen } from '@ai-floor-planner/renderer';
import {
  expandFlatIntoSetbackMargin,
  regenerateWithPreservedRatios,
  type RoomAreaCandidate,
} from '@ai-floor-planner/planning-engine';
import { solveRoomArea } from '../../services/room-area-solver';
import type { EditorContextValue } from '../../stores/editor-store';

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

  const [selectedRoomId, setSelectedRoomId] = useState<string>(() => editableRooms[0]?.id ?? floor.rooms[0]?.id ?? '');
  const selectedRoom: Room | undefined = useMemo(
    () => floor.rooms.find((r) => r.id === selectedRoomId) ?? editableRooms[0] ?? floor.rooms[0],
    [floor.rooms, editableRooms, selectedRoomId],
  );

  const [targetRoomSqFtInput, setTargetRoomSqFtInput] = useState<string>(() =>
    selectedRoom ? Math.round(selectedRoom.area * MM2_TO_SQFT).toString() : '160',
  );
  const [widthMmInput, setWidthMmInput] = useState<string>(() =>
    selectedRoom ? Math.round(selectedRoom.width).toString() : '3600',
  );
  const [lengthMmInput, setLengthMmInput] = useState<string>(() =>
    selectedRoom ? Math.round(selectedRoom.height).toString() : '4200',
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
    setSelectedRoomId(room.id);
    setTargetRoomSqFtInput((room.area * MM2_TO_SQFT).toFixed(1));
    setWidthMmInput(Math.round(room.width).toString());
    setLengthMmInput(Math.round(room.height).toString());
    setCandidates([]);
    setErrorMessage('');
  };

  const applyCandidate = (cand: RoomAreaCandidate, label?: string) => {
    editor.applyRefinement(cand.building, label ?? cand.name);
    setCandidates([]);
    setErrorMessage('');
    const updated = cand.building.floors
      .find((f) => f.id === floor.id)
      ?.rooms.find((r) => r.id === cand.targetRoomId);
    if (updated) {
      setTargetRoomSqFtInput((updated.area * MM2_TO_SQFT).toFixed(1));
      setWidthMmInput(Math.round(updated.width).toString());
      setLengthMmInput(Math.round(updated.height).toString());
    }
    setStatusMessage(
      `Applied ${cand.name}: achieved ${(cand.achievedAreaMm2 * MM2_TO_SQFT).toFixed(1)} sq.ft. (${(cand.achievedAreaMm2 / 1_000_000).toFixed(2)} m²).`,
    );
  };

  const handleApplyRoomTarget = async (overrideAreaMm2?: number) => {
    if (!selectedRoom) return;
    setErrorMessage('');
    setStatusMessage('');
    const targetSqFt = Number(targetRoomSqFtInput);
    const areaMm2 = overrideAreaMm2 ?? (Number.isFinite(targetSqFt) && targetSqFt > 0 ? targetSqFt * SQFT_TO_MM2 : 0);
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
      applyCandidate(res.candidates[0]!, 'Mode A: Expand Flat into Setback');
    } else {
      setErrorMessage(res.infeasibilityReason ?? 'Setback expansion reached minimum plot setback boundary.');
    }
  };

  const handleModeBRegenerateSimilar = () => {
    setErrorMessage('');
    setStatusMessage('');
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
    const nextAreaMm2 = Math.max(
      1_800_000,
      isX ? (origRoom.width + delta) * origRoom.height : origRoom.width * (origRoom.height + delta),
    );
    setTargetRoomSqFtInput((nextAreaMm2 * MM2_TO_SQFT).toFixed(1));
    void handleApplyRoomTarget(nextAreaMm2);
  };

  const selectedBox = selectedRoom
    ? {
        tl: worldToScreen({ x: selectedRoom.x, y: selectedRoom.y }, transform),
        br: worldToScreen({ x: selectedRoom.x + selectedRoom.width, y: selectedRoom.y + selectedRoom.height }, transform),
      }
    : null;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      aria-label="Interactive Plan Editor Studio"
    >
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <strong className="text-sm font-bold text-amber-400">03 · Interactive Plan Editor Studio</strong>
          <div className="flex gap-1.5" aria-label="Edit Plan Floors">
            {editor.building.floors.map((fl) => (
              <button
                key={fl.id}
                type="button"
                onClick={() => editor.switchFloor(fl.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  fl.id === floor.id ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
            onClick={() => editor.undo()}
            className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => editor.redo()}
            className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
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
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Interactive Canvas */}
        <div className="relative min-h-[360px] flex-1 overflow-hidden bg-slate-950 p-3">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-full w-full rounded-lg border border-slate-800 bg-white select-none"
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
            <div className="pointer-events-none absolute left-6 top-6 rounded bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-amber-300 shadow">
              Dragging {dragRef.current.side} wall: {dragDeltaMm >= 0 ? `+${dragDeltaMm}` : dragDeltaMm} mm
            </div>
          )}
        </div>

        {/* Right Parametric Edit Panel */}
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 lg:w-96">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Mode A · Parametric Room & Boundary Resize
            </h3>
            <label className="mt-2 block text-xs text-slate-300">
              Selected Room
              <select
                value={selectedRoom?.id ?? ''}
                onChange={(e) => {
                  const next = floor.rooms.find((r) => r.id === e.target.value);
                  if (next) selectRoom(next);
                }}
                className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100"
              >
                {editableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({Math.round(r.area * MM2_TO_SQFT)} sq.ft.)
                  </option>
                ))}
              </select>
            </label>

            {selectedRoom && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Current Size</span>
                  <span className="font-mono font-semibold text-amber-300">
                    {(selectedRoom.width / 304.8).toFixed(1)}&apos; x {(selectedRoom.height / 304.8).toFixed(1)}&apos; ({(selectedRoom.area * MM2_TO_SQFT).toFixed(0)} sq.ft.)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-slate-400">
                    Width (mm)
                    <input
                      type="number"
                      value={widthMmInput}
                      onChange={(e) => {
                        setWidthMmInput(e.target.value);
                        const w = Number(e.target.value);
                        const l = Number(lengthMmInput);
                        if (w > 0 && l > 0) setTargetRoomSqFtInput((w * l * MM2_TO_SQFT).toFixed(1));
                      }}
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                  </label>
                  <label className="text-[11px] text-slate-400">
                    Length (mm)
                    <input
                      type="number"
                      value={lengthMmInput}
                      onChange={(e) => {
                        setLengthMmInput(e.target.value);
                        const w = Number(widthMmInput);
                        const l = Number(e.target.value);
                        if (w > 0 && l > 0) setTargetRoomSqFtInput((w * l * MM2_TO_SQFT).toFixed(1));
                      }}
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    />
                  </label>
                </div>
                <label className="block text-[11px] text-slate-400">
                  Target Room Area (sq.ft.)
                  <input
                    type="number"
                    value={targetRoomSqFtInput}
                    onChange={(e) => setTargetRoomSqFtInput(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={expandIntoSetback}
                    onChange={(e) => setExpandIntoSetback(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-amber-500"
                  />
                  Expand External Boundary into Setback
                </label>

                <label className="block text-[11px] text-slate-400">
                  Minimum Preserved Setback (mm)
                  <input
                    type="number"
                    value={minSetbackMm}
                    min={0}
                    step={100}
                    onChange={(e) => setMinSetbackMm(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSolving}
                    onClick={() => void handleApplyRoomTarget()}
                    className="flex-1 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {isSolving ? 'Solving...' : 'Apply Room Size'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeAExpandEdge(300)}
                    className="rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
                    title="Expand exterior boundary 300 mm outward into free setback margin"
                  >
                    +300mm Out
                  </button>
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-700" />

          {/* Mode B Section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Mode B · Proportional Ratio-Preserving Scaling
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              Scales flats proportionally while keeping your edited room area ratios, lift core, staircase, and plot setbacks intact.
            </p>
            <label className="mt-2 block text-[11px] text-slate-300">
              Target Area Per Flat (sq.ft.)
              <input
                type="number"
                aria-label="Target Area Per Flat (sq.ft.)"
                value={targetFlatSqFtInput}
                min={350}
                step={25}
                onChange={(e) => setTargetFlatSqFtInput(e.target.value)}
                className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100"
              />
            </label>
            <button
              type="button"
              onClick={handleModeBRegenerateSimilar}
              className="mt-2.5 w-full rounded bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400"
            >
              Regenerate Similar (Keep Edited Ratios)
            </button>

            <div className="mt-3 max-h-40 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px]">
              <div className="mb-1 font-semibold text-slate-300">
                Active Flat Proportions ({currentUnitAreaSqFt} sq.ft.)
              </div>
              {ratioBreakdown.map((item) => (
                <div key={item.id} className="flex justify-between py-0.5 text-slate-400">
                  <span className="truncate pr-2">{item.name}</span>
                  <span className="font-mono text-slate-300">
                    {item.sqFt} sq.ft. ({item.pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          {candidates.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-300">Alternative Candidates</div>
              {candidates.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => applyCandidate(cand)}
                  className="block w-full rounded border border-slate-700 bg-slate-800 p-2 text-left text-[11px] hover:border-amber-500"
                >
                  <div className="font-semibold text-amber-300">{cand.name}</div>
                  <div className="text-slate-400">{cand.tradeOffs}</div>
                </button>
              ))}
            </div>
          )}

          {statusMessage && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
              {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300">
              {errorMessage}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
