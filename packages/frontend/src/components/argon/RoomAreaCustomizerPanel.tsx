import { solveRoomArea } from '../../services/room-area-solver';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Maximize2,
  Lock,
  LockOpen,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Shield,
  X,
  RotateCcw,
} from 'lucide-react';
import type { Room, Building, Floor, GenerationControlState } from '@ai-floor-planner/core';
import {
  sqMmToSqM,
  sqMToSqMm,
  sqMmToSqFt,
  sqFtToSqMm,
  mmToFeet,
  polygonArea,
} from '@ai-floor-planner/geometry-engine';
import {
  ENGINEERING_MIN_ROOM_AREAS,
  createRoomAreaRegenerationCommand,
  buildingRefinementRevision,
  type RoomAreaCandidate,
  type RoomAreaOptimizationResult,
} from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';

interface RoomAreaCustomizerPanelProps {
  editor: EditorContextValue;
  room: Room;
}

export const RoomAreaCustomizerPanel: React.FC<RoomAreaCustomizerPanelProps> = ({
  editor,
  room,
}) => {
  const { activeFloor, building, generationControl, executeCommand } = editor;

  // Measurement State
  const [unit, setUnit] = useState<'m2' | 'sqft'>('m2');
  const [targetInput, setTargetInput] = useState<string>('');
  const [allowAdjacent, setAllowAdjacent] = useState<boolean>(true);
  const [lockNeighbors, setLockNeighbors] = useState<boolean>(false);
  const [preserveStructural, setPreserveStructural] = useState<boolean>(true);

  const pending = useRef<AbortController | null>(null);
  const actualRevision = buildingRefinementRevision(building, generationControl);
  useEffect(() => () => { pending.current?.abort(); }, [room.id, actualRevision]);
  // Execution & Candidate State
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optimizationResult, setOptimizationResult] =
    useState<RoomAreaOptimizationResult | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<RoomAreaCandidate | null>(
    null
  );
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warn' | 'error';
    message: string;
  } | null>(null);

  // Derived Metrics
  const currentAreaM2 = sqMmToSqM(room.area);
  const currentAreaSqFt = sqMmToSqFt(room.area);

  const statutoryMinAreaMm2 =
    room.minArea ?? ENGINEERING_MIN_ROOM_AREAS[room.type] ?? 6_000_000;
  const statutoryMinAreaM2 = sqMmToSqM(statutoryMinAreaMm2);
  const statutoryMinAreaSqFt = sqMmToSqFt(statutoryMinAreaMm2);

  const floorAreaMm2 = polygonArea(activeFloor.boundary);
  const maxAllowableAreaM2 = sqMmToSqM(floorAreaMm2);
  const maxAllowableAreaSqFt = sqMmToSqFt(floorAreaMm2);

  const isRoomLocked =
    generationControl.lockedEntityIds.includes(room.id) ||
    generationControl.lockedFloorIds.includes(activeFloor.id);

  const [targetAreaMm2, setTargetAreaMm2] = useState(room.area);
  const liveControl = useRef(generationControl);
  liveControl.current = generationControl;
  useEffect(() => {
    setTargetAreaMm2(room.area);
    setTargetInput(String(unit === 'm2' ? sqMmToSqM(room.area) : sqMmToSqFt(room.area)));
    setOptimizationResult(null); setPreviewCandidate(null); setFeedback(null);
  }, [room.id]);
  const editTarget = (value: string) => {
    setTargetInput(value);
    const number = Number(value);
    setTargetAreaMm2(Number.isFinite(number) && number > 0 ? unit === 'm2' ? sqMToSqMm(number) : sqFtToSqMm(number) : 0);
  };

  const targetAreaM2 = sqMmToSqM(targetAreaMm2);
  const deltaAreaM2 = targetAreaM2 - currentAreaM2;
  const deltaPercent =
    currentAreaM2 > 0 ? (deltaAreaM2 / currentAreaM2) * 100 : 0;

  // Feasibility Check
  const feasibilityValidation = useMemo(() => {
    if (targetAreaMm2 <= 0) {
      return {
        status: 'INVALID',
        message: 'Enter a valid positive area',
        isWarning: true,
      };
    }
    if (targetAreaMm2 < statutoryMinAreaMm2) {
      return {
        status: 'BELOW_MINIMUM',
        message: `Below engineering minimum of ${statutoryMinAreaM2.toFixed(2)} m²`,
        isWarning: true,
      };
    }
    if (targetAreaMm2 > floorAreaMm2) {
      return {
        status: 'EXCEEDS_ENVELOPE',
        message: `Exceeds floor envelope capacity (${maxAllowableAreaM2.toFixed(2)} m²)`,
        isWarning: true,
      };
    }
    if (Math.abs(deltaAreaM2) <= Math.max(0.1, currentAreaM2 * 0.01)) {
      return {
        status: 'CURRENT_MATCH',
        message: 'Matches current measured room area',
        isWarning: false,
      };
    }
    return {
      status: 'VALID',
      message: `${deltaAreaM2 > 0 ? '+' : ''}${deltaAreaM2.toFixed(2)} m² (${deltaPercent > 0 ? '+' : ''}${deltaPercent.toFixed(1)}%)`,
      isWarning: false,
    };
  }, [
    targetAreaMm2,
    statutoryMinAreaMm2,
    statutoryMinAreaM2,
    floorAreaMm2,
    maxAllowableAreaM2,
    deltaAreaM2,
    currentAreaM2,
    deltaPercent,
  ]);

  // Unit Toggle Handler
  const handleUnitToggle = (newUnit: 'm2' | 'sqft') => {
    if (newUnit === unit) return;
    setTargetInput(String(newUnit === 'm2' ? sqMmToSqM(targetAreaMm2) : sqMmToSqFt(targetAreaMm2)));
    setUnit(newUnit);
  };

  // Reset to original
  const handleReset = () => {
    setTargetAreaMm2(room.area);
    setTargetInput(
      unit === 'm2' ? currentAreaM2.toFixed(2) : currentAreaSqFt.toFixed(1)
    );
    setOptimizationResult(null);
    setFeedback(null);
  };

  // Run Solver
  const handleRegenerate = async () => {
    if (isRoomLocked) {
      setFeedback({
        type: 'error',
        message: `Room "${room.name}" is locked. Unlock it to allow area optimization.`,
      });
      return;
    }

    if (feasibilityValidation.status === 'BELOW_MINIMUM') {
      setFeedback({
        type: 'error',
        message: `Requested area is below the engineering minimum for ${room.name} (${statutoryMinAreaM2.toFixed(2)} m²).`,
      });
      return;
    }

    if (feasibilityValidation.status === 'EXCEEDS_ENVELOPE') {
      setFeedback({
        type: 'error',
        message: `Requested area exceeds the building floor envelope capacity.`,
      });
      return;
    }

    setIsOptimizing(true);
    setFeedback(null);

    pending.current?.abort();
    const request = new AbortController(); pending.current = request;

    try {
      const result = await solveRoomArea(building, room.id, {
        targetAreaMm2,
        control: generationControl,
        allowAdjacentAdjustments: allowAdjacent,
        lockNeighboringRooms: lockNeighbors,
        preserveStructural,
      }, request.signal);
      if (request.signal.aborted) return;

      setOptimizationResult(result);

      if (!result.isFeasible) {
        setFeedback({
          type: 'warn',
          message:
            result.infeasibilityReason ??
            'Could not satisfy room area constraints within structural and perimeter limits.',
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Generated ${result.candidates.length} geometrically checked alternative(s). Professional review required.`,
        });
      }
    } catch (err) {
      if (request.signal.aborted) return;
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unknown error occurred during room regeneration.',
      });
    } finally {
      if (pending.current === request) setIsOptimizing(false);
    }
  };

  // Apply Candidate
  const handleAcceptCandidate = (candidate: RoomAreaCandidate) => {
    const currentRevision = buildingRefinementRevision(
      editor.building,
      editor.generationControl
    );
    if (candidate.baseRevision !== currentRevision) {
      setFeedback({
        type: 'error',
        message:
          'Base model has changed since generating this candidate. Regenerate to obtain a fresh plan.',
      });
      return;
    }

    if (candidate.feasibilityStatus !== 'FEASIBLE' || !candidate.toleranceSatisfied || candidate.constraintViolations.length) {
      setFeedback({ type: 'error', message: 'Unsatisfied alternatives cannot be accepted.' }); return;
    }
    try {
      const command = createRoomAreaRegenerationCommand(editor.building, candidate, {
        targetAreaMm2: candidate.requestedAreaMm2, allowAdjacentAdjustments: allowAdjacent,
        lockNeighboringRooms: lockNeighbors, preserveStructural: true,
      }, () => editor.getGenerationControl?.() ?? liveControl.current);
      executeCommand(command);
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Candidate acceptance failed' }); return;
    }
    setPreviewCandidate(null);
    setOptimizationResult(null);
    setFeedback({
      type: 'success',
      message: `Successfully applied Candidate ${candidate.candidateType} for "${room.name}".`,
    });
  };

  return (
    <div className="rounded-lg border border-amber-900/30 bg-slate-900/90 p-3 text-slate-100 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Maximize2 className="h-4 w-4 text-amber-400" />
          <h3 className="text-xs font-bold tracking-wide uppercase text-amber-300">
            Room Area Customizer
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => editor.setRoomLocks([room.id], !isRoomLocked)}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              isRoomLocked
                ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={isRoomLocked ? 'Room is locked against modification' : 'Lock room'}
          >
            {isRoomLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
            {isRoomLocked ? 'Locked' : 'Unlocked'}
          </button>
        </div>
      </div>

      {/* Room Identity & Current Geometry */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-950/70 p-2 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
            Measured Internal Area
          </span>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold text-slate-100">
              {currentAreaM2.toFixed(2)} m²
            </span>
            <span className="text-[11px] text-slate-400">
              ({currentAreaSqFt.toFixed(1)} sq ft)
            </span>
          </div>
        </div>

        <div className="rounded bg-slate-950/70 p-2 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
            Clear Dimensions
          </span>
          <div className="mt-0.5 text-xs font-medium text-slate-200">
            {(room.width / 1000).toFixed(2)} × {(room.height / 1000).toFixed(2)} m
          </div>
          <div className="text-[10px] text-slate-400">
            {mmToFeet(room.width).toFixed(1)}′ × {mmToFeet(room.height).toFixed(1)}′
          </div>
        </div>
      </div>

      {/* Statutory & Envelope Limits */}
      <div className="mt-2 flex items-center justify-between text-[11px] px-1 text-slate-400">
        <span>
          Project / engineering Min:{' '}
          <strong className="text-slate-300">
            {statutoryMinAreaM2.toFixed(2)} m²
          </strong>
        </span>
        <span>
          Floor Limit:{' '}
          <strong className="text-slate-300">
            {maxAllowableAreaM2.toFixed(1)} m²
          </strong>
        </span>
      </div>

      {/* Target Area Configuration */}
      <div className="mt-3 rounded bg-slate-950/90 p-2.5 border border-slate-800">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-amber-200">
            Target Desired Area
          </label>
          <div className="flex rounded border border-slate-700 bg-slate-900 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => handleUnitToggle('m2')}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                unit === 'm2'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              m²
            </button>
            <button
              type="button"
              onClick={() => handleUnitToggle('sqft')}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                unit === 'sqft'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              sq ft
            </button>
          </div>
        </div>

        {/* Number Input & Reset */}
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              step={unit === 'm2' ? '0.1' : '1'}
              min={unit === 'm2' ? statutoryMinAreaM2 : statutoryMinAreaSqFt}
              max={unit === 'm2' ? maxAllowableAreaM2 : maxAllowableAreaSqFt}
              value={targetInput}
              disabled={isRoomLocked}
              onChange={(e) => editTarget(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              placeholder={unit === 'm2' ? 'e.g. 15.00' : 'e.g. 160'}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">
              {unit === 'm2' ? 'm²' : 'sq ft'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Reset to current measured area"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>

        {/* Fine Adjustment Slider */}
        <div className="mt-2">
          <input
            type="range"
            min={unit === 'm2' ? Math.max(4, statutoryMinAreaM2 * 0.9) : statutoryMinAreaSqFt * 0.9}
            max={unit === 'm2' ? Math.min(60, maxAllowableAreaM2) : Math.min(650, maxAllowableAreaSqFt)}
            step={unit === 'm2' ? 0.25 : 2.5}
            value={parseFloat(targetInput) || currentAreaM2}
            disabled={isRoomLocked}
            onChange={(e) => editTarget(e.target.value)}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>

        {/* Feasibility Indicator */}
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span
            className={`font-medium ${
              feasibilityValidation.isWarning ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {feasibilityValidation.message}
          </span>
          <span className="text-[10px] text-slate-500">
            Tol: ±0.10 m² / 1.0%
          </span>
        </div>
      </div>

      {/* Constraints & Regeneration Preferences */}
      <div className="mt-2.5 space-y-1.5 text-xs text-slate-300">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allowAdjacent}
            onChange={(e) => setAllowAdjacent(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
          />
          <span>Allow adjacent room repartitioning</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lockNeighbors}
            onChange={(e) => setLockNeighbors(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
          />
          <span>Lock neighboring rooms (envelope growth only)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={preserveStructural}
            disabled
            onChange={() => setPreserveStructural(true)}
            className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
          />
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3 text-amber-400 inline" />
            Preserve columns (S-COLS) & structural elements
          </span>
        </label>
      </div>

      {/* Regeneration Trigger Button */}
      <button
        type="button"
        onClick={handleRegenerate}
        disabled={isOptimizing || isRoomLocked || feasibilityValidation.status === 'BELOW_MINIMUM'}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-amber-500 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isOptimizing ? 'animate-spin' : ''}`} />
        {isOptimizing ? 'Solving Geometry...' : 'Regenerate Selected Room'}
      </button>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`mt-2.5 rounded p-2 text-xs flex items-start gap-2 ${
            feedback.type === 'error'
              ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
              : feedback.type === 'warn'
              ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
              : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
          }`}
        >
          {feedback.type === 'error' || feedback.type === 'warn' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-current mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-current mt-0.5" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Candidate Alternatives List */}
      {optimizationResult && optimizationResult.candidates.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Proposed Alternatives ({optimizationResult.candidates.length})
            </span>
          </div>

          <div className="mt-2 space-y-2">
            {optimizationResult.candidates.map((cand) => (
              <CandidateCard
                key={cand.id}
                candidate={cand}
                onPreview={() => setPreviewCandidate(cand)}
                onApply={() => handleAcceptCandidate(cand)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Interactive Candidate Preview Modal */}
      {previewCandidate && (
        <CandidatePreviewModal
          candidate={previewCandidate}
          baseBuilding={editor.building}
          control={generationControl}
          floor={activeFloor}
          onClose={() => setPreviewCandidate(null)}
          onAccept={() => handleAcceptCandidate(previewCandidate)}
        />
      )}
    </div>
  );
};

// ============================================================================
// CANDIDATE CARD SUBCOMPONENT
// ============================================================================
interface CandidateCardProps {
  candidate: RoomAreaCandidate;
  onPreview: () => void;
  onApply: () => void;
}

const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate,
  onPreview,
  onApply,
}) => {
  const achievedM2 = sqMmToSqM(candidate.achievedAreaMm2);
  const diffM2 = sqMmToSqM(candidate.differenceMm2);
  const diffPercent =
    candidate.requestedAreaMm2 > 0
      ? (candidate.differenceMm2 / candidate.requestedAreaMm2) * 100
      : 0;

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-2.5 transition-all hover:border-slate-600">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
            Candidate {candidate.candidateType}
          </span>
          <span className="text-xs font-semibold text-slate-200">
            {candidate.candidateType === 'A'
              ? 'Minimum Disturbance'
              : candidate.candidateType === 'B'
              ? 'Circulation & Adjacency'
              : 'Space Optimization'}
          </span>
        </div>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            candidate.toleranceSatisfied
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              : 'bg-amber-950 text-amber-300 border border-amber-800'
          }`}
        >
          {candidate.toleranceSatisfied ? 'FEASIBLE' : 'PARTIALLY_FEASIBLE'}
        </span>
      </div>

      {/* Achieved Area Metrics */}
      <div className="mt-1.5 flex items-baseline justify-between text-xs">
        <div>
          <span className="text-slate-400">Achieved: </span>
          <strong className="text-slate-100">{achievedM2.toFixed(2)} m²</strong>
        </div>
        <div className="text-[11px] text-slate-400">
          Diff:{' '}
          <span
            className={
              Math.abs(diffM2) <= 0.05
                ? 'text-emerald-400 font-semibold'
                : 'text-amber-400'
            }
          >
            {diffM2 > 0 ? '+' : ''}
            {diffM2.toFixed(2)} m² ({diffPercent > 0 ? '+' : ''}
            {diffPercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Trade-offs & Modifications */}
      <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
        {candidate.tradeOffs}
      </p>

      {/* Modifications Summary */}
      {candidate.modifiedRooms.length > 0 && (
        <div className="mt-1.5 rounded bg-slate-900/80 p-1.5 text-[10px] text-slate-300">
          <span className="text-slate-400 block font-medium">Impact Ledger:</span>
          {candidate.modifiedRooms.map((mod) => (
            <div key={mod.roomId} className="flex justify-between py-0.5">
              <span>{mod.roomName}</span>
              <span className="font-mono">
                {sqMmToSqM(mod.beforeAreaMm2).toFixed(1)} →{' '}
                {sqMmToSqM(mod.afterAreaMm2).toFixed(1)} m² (
                {mod.deltaAreaMm2 > 0 ? '+' : ''}
                {sqMmToSqM(mod.deltaAreaMm2).toFixed(1)})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-slate-800/80 pt-2">
        <button
          type="button"
          onClick={onPreview}
          className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <button
          type="button"
          disabled={!candidate.toleranceSatisfied || candidate.feasibilityStatus !== 'FEASIBLE' || candidate.constraintViolations.length > 0}
          onClick={onApply}
          className="flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400"
        >
          <CheckCircle2 className="h-3 w-3" />
          Accept
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// CANDIDATE PREVIEW MODAL SUBCOMPONENT
// ============================================================================
interface CandidatePreviewModalProps {
  candidate: RoomAreaCandidate;
  baseBuilding: Building;
  control: GenerationControlState;
  floor: Floor;
  onClose: () => void;
  onAccept: () => void;
}

const CandidatePreviewModal: React.FC<CandidatePreviewModalProps> = ({
  candidate,
  baseBuilding,
  control,
  floor,
  onClose,
  onAccept,
}) => {
  // Candidate Floor
  const candidateFloor = candidate.building.floors.find((f) => f.id === floor.id) ?? floor;
  const targetRoom = candidateFloor.rooms.find((r) => r.id === candidate.targetRoomId);

  // Staleness check
  const isStale =
    candidate.baseRevision !==
    buildingRefinementRevision(baseBuilding, control);

  // Calculate SVG ViewBox from floor boundary
  const xs = floor.boundary.points.map((p) => p.x);
  const ys = floor.boundary.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad = 800;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  const changedRoomIds = new Set(candidate.modifiedRooms.map((r) => r.roomId));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-amber-900/40 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
              Candidate {candidate.candidateType}
            </span>
            <h2 id="preview-title" className="text-sm font-bold text-slate-100">
              {candidate.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Plan SVG Viewer */}
          <div className="relative flex-1 bg-slate-950 p-4 flex items-center justify-center overflow-hidden">
            <svg
              className="h-full w-full select-none"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Floor boundary */}
              <polygon
                points={candidateFloor.boundary.points
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="#0f172a"
                stroke="#475569"
                strokeWidth="120"
              />

              {/* Rooms */}
              {candidateFloor.rooms.map((rm) => {
                const isTarget = rm.id === candidate.targetRoomId;
                const isModified = changedRoomIds.has(rm.id);

                return (
                  <g key={rm.id}>
                    <polygon
                      points={rm.boundary.points
                        .map((p) => `${p.x},${p.y}`)
                        .join(' ')}
                      fill={
                        isTarget
                          ? '#064e3b' // Emerald deep
                          : isModified
                          ? '#451a03' // Amber deep
                          : '#1e293b' // Slate neutral
                      }
                      stroke={
                        isTarget
                          ? '#10b981' // Emerald bright
                          : isModified
                          ? '#f59e0b' // Amber bright
                          : '#64748b' // Slate
                      }
                      strokeWidth={isTarget ? 90 : isModified ? 70 : 40}
                    />
                    <text
                      x={rm.x + rm.width / 2}
                      y={rm.y + rm.height / 2 - 150}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="240"
                      fontWeight="bold"
                    >
                      {rm.name}
                    </text>
                    <text
                      x={rm.x + rm.width / 2}
                      y={rm.y + rm.height / 2 + 150}
                      textAnchor="middle"
                      fill="#cbd5e1"
                      fontSize="180"
                    >
                      {sqMmToSqM(rm.area).toFixed(2)} m²
                    </text>
                  </g>
                );
              })}

              {/* Protected Columns (S-COLS) */}
              {candidateFloor.columns.map((col) => (
                <rect
                  key={col.id}
                  x={col.position.x - col.width / 2}
                  y={col.position.y - col.depth / 2}
                  width={col.width}
                  height={col.depth}
                  fill="#ef4444"
                  stroke="#991b1b"
                  strokeWidth="30"
                />
              ))}
            </svg>

            {/* Legend Overlay */}
            <div className="absolute bottom-3 left-3 rounded bg-slate-900/90 p-2 text-[10px] text-slate-300 border border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" />
                <span>Target Room ({targetRoom?.name})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500 inline-block" />
                <span>Adjusted Neighbor Room</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500 inline-block" />
                <span>Structural Column (Protected)</span>
              </div>
            </div>
          </div>

          {/* Right Verification Details Drawer */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900 p-4 flex flex-col justify-between overflow-y-auto">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300 block">
                Verification Ledger
              </span>

              {/* Target room comparison */}
              <div className="mt-3 rounded bg-slate-950 p-2.5 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">
                  Target Room Area
                </span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">Requested:</span>
                  <strong className="text-xs text-slate-200">
                    {sqMmToSqM(candidate.requestedAreaMm2).toFixed(2)} m²
                  </strong>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">Achieved:</span>
                  <strong className="text-sm text-emerald-400">
                    {sqMmToSqM(candidate.achievedAreaMm2).toFixed(2)} m²
                  </strong>
                </div>
              </div>

              {/* Modifications list */}
              <div className="mt-3">
                <span className="text-xs font-semibold text-slate-300 block">
                  Affected Spaces
                </span>
                <div className="mt-1.5 space-y-1.5">
                  {candidate.modifiedRooms.map((mod) => (
                    <div
                      key={mod.roomId}
                      className="rounded bg-slate-950 p-2 border border-slate-800/80 text-[11px]"
                    >
                      <div className="flex justify-between font-semibold text-slate-200">
                        <span>{mod.roomName}</span>
                        <span
                          className={
                            mod.deltaAreaMm2 > 0
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }
                        >
                          {mod.deltaAreaMm2 > 0 ? '+' : ''}
                          {sqMmToSqM(mod.deltaAreaMm2).toFixed(2)} m²
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {sqMmToSqM(mod.beforeAreaMm2).toFixed(2)} m² →{' '}
                        {sqMmToSqM(mod.afterAreaMm2).toFixed(2)} m²
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Architectural Safety Checklist */}
              <div className="mt-4 border-t border-slate-800 pt-3">
                <span className="text-xs font-semibold text-slate-300 block mb-2">
                  Engineering Checks
                </span>
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Geometric checks only; structural safety not certified</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Envelope containment strictly verified</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Candidate geometry checked by deterministic solver</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Engineering defaults only; regulatory compliance not verified</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="mt-5 border-t border-slate-800 pt-3 space-y-2">
              {isStale && (
                <div className="rounded bg-rose-950/80 p-2 text-[11px] text-rose-300 border border-rose-800">
                  Base project has changed since generating this preview. Regenerate to obtain current alternatives.
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                >
                  Reject / Cancel
                </button>
                <button
                  type="button"
                  disabled={isStale || !candidate.toleranceSatisfied || candidate.feasibilityStatus !== 'FEASIBLE' || candidate.constraintViolations.length > 0}
                  onClick={onAccept}
                  className="flex-1 rounded bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Accept Design
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
