import {
  EXACT_SQMM_PER_SQFT,
  EXACT_SQMM_PER_SQM,
  RoomType,
  diffBuildings,
  type Building,
  type Floor,
  type GenerationControlState,
} from '@ai-floor-planner/core';
import {
  ENGINEERING_MIN_ROOM_AREAS,
  auditArchitecturalElementRealism,
  auditFloorFunctionalQuality,
  computeFloorEfficiencyBreakdown,
  proposeControlledCadEdit,
  type CadAiEditProposalResult,
} from '@ai-floor-planner/planning-engine';
import type { BimClash } from './bim-clash';
import type { BimKind, BimQuantityRow } from './bim-quantities';

export interface BimAssistantExecutionContext {
  readonly building?: Building;
  readonly previousBuilding?: Building;
  readonly floor?: Floor;
  readonly clashes?: readonly BimClash[];
  readonly control?: GenerationControlState;
}

export interface BimQueryResponse {
  readonly mode: 'DETERMINISTIC' | 'PROPOSAL_PREVIEW' | 'GEMINI_ASSISTED' | 'UNSUPPORTED';
  readonly commandClass?:
    | 'LIST_ELEMENTS'
    | 'CALCULATE_QUANTITY'
    | 'BELOW_TARGET_ROOMS'
    | 'CLASH_RESOLUTION'
    | 'LOCAL_FLAT_REGENERATION'
    | 'MOVE_DOOR_CLEARANCE'
    | 'RESIZE_ROOM_TARGET'
    | 'COMPLIANCE_EXPLANATION'
    | 'REVISION_DIFF';
  readonly text: string;
  readonly matches: readonly BimQuantityRow[];
  readonly highlightEntityIds?: readonly string[];
  /** Non-null ONLY when the user explicitly requested a controlled model edit; requires explicit Accept! */
  readonly proposalPreview?: CadAiEditProposalResult;
  readonly apiCallCount: number;
}

/** Strips control characters and caps untrusted reference text so external IFC labels cannot inject instructions. */
export function sanitizeUntrustedReferenceLabel(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = raw[i]!;
    if (code >= 0x20 && code !== 0x7f && ch !== '<' && ch !== '>' && ch !== '`') {
      out += ch;
    }
  }
  return out.trim().slice(0, 120);
}

/**
 * Deterministic BIM & CAD Intelligence Executor (Phase 5 Gate J).
 *
 * Executes factual schedule queries, area totals, below-target checks, clash resolution advisories,
 * compliance explanations, and revision diffs with `0` provider calls, and routes explicit mutation
 * requests into validated `PREVIEW_READY` canonical proposals that NEVER auto-apply without user acceptance!
 */
export function queryBimSchedule(
  question: string,
  rows: readonly BimQuantityRow[],
  ctx: BimAssistantExecutionContext = {},
): BimQueryResponse {
  const trimmed = question.trim().replace(/[?.!]+$/, '');
  const input = trimmed.toLowerCase();

  // ── 1. List / count elements (optionally scoped by Flat N or Floor) ────────
  const flatScopeMatch = /\b(?:in|for|of)\s+(?:flat|unit|apartment)\s*#?\s*0?(\d+)\b/.exec(input);
  const entityMatch = /^(?:show|list|count|find)\s+(?:all\s+)?(doors|windows|rooms|walls|flats|stairs|slabs)(?:\s+(?:in|on|for|of)\s+.+)?$/.exec(input);
  if (entityMatch) {
    const plural = entityMatch[1]!;
    const kind = (plural === 'slabs' ? 'slab' : plural.slice(0, -1)) as BimKind;
    let matches = rows.filter(row => row.kind === kind);

    if (flatScopeMatch && ctx.floor?.apartmentUnits?.length) {
      const unitIdx = Number.parseInt(flatScopeMatch[1]!, 10) - 1;
      const unit = ctx.floor.apartmentUnits[unitIdx];
      if (unit) {
        const unitRoomIds = new Set(ctx.floor.rooms.filter(r => r.unitId === unit.id).map(r => r.id));
        const unitWallIds = new Set(
          ctx.floor.walls.filter(w => w.roomIds.some(id => unitRoomIds.has(id))).map(w => w.id),
        );
        const unitDoorIds = new Set(
          ctx.floor.doors
            .filter(d => d.connectsRooms.some(id => id !== undefined && unitRoomIds.has(id)))
            .map(d => d.id),
        );
        const unitWinIds = new Set(ctx.floor.windows.filter(w => unitRoomIds.has(w.roomId)).map(w => w.id));
        matches = matches.filter(r =>
          kind === 'room'
            ? unitRoomIds.has(r.id)
            : kind === 'wall'
              ? unitWallIds.has(r.id)
              : kind === 'door'
                ? unitDoorIds.has(r.id)
                : kind === 'window'
                  ? unitWinIds.has(r.id)
                  : r.id === unit.id,
        );
        return {
          mode: 'DETERMINISTIC',
          commandClass: 'LIST_ELEMENTS',
          text: `${matches.length} ${plural} in Flat 0${unitIdx + 1} (${unit.unitType}) on ${ctx.floor.name}`,
          matches,
          highlightEntityIds: matches.map(m => m.id),
          apiCallCount: 0,
        };
      }
    }

    return {
      mode: 'DETERMINISTIC',
      commandClass: 'LIST_ELEMENTS',
      text: `${matches.length} ${plural} on the active floor`,
      matches,
      highlightEntityIds: matches.map(m => m.id),
      apiCallCount: 0,
    };
  }

  // ── 2. Exact Quantity Totals (Window, Wall, Slab, Door, Carpet, Balcony) ───
  if (/^(?:calculate\s+(?:the\s+)?)?(?:total\s+)?window\s+area(?:\s+on\s+.+)?$/.test(input)) {
    const matches = rows.filter(row => row.kind === 'window');
    const area = matches.reduce((sum, row) => sum + (row.areaMm2 ?? 0), 0);
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'CALCULATE_QUANTITY',
      text: `${(area / EXACT_SQMM_PER_SQM).toFixed(3)} m² of window openings (${(area / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft) on the active floor`,
      matches,
      apiCallCount: 0,
    };
  }

  const areaQuantityMatch = /^(?:calculate|compute|what\s+is|show)?\s*(?:the\s+)?total\s+(wall|slab|carpet|room|balcony|door)\s+(?:area|volume)\b/.exec(input);
  if (areaQuantityMatch) {
    const target = areaQuantityMatch[1]!;
    const wantsVolume = input.includes('volume');
    if (target === 'wall') {
      const matches = rows.filter(r => r.kind === 'wall');
      const area = matches.reduce((s, r) => s + (r.areaMm2 ?? 0), 0);
      const vol = matches.reduce((s, r) => s + (r.volumeMm3 ?? 0), 0);
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CALCULATE_QUANTITY',
        text: wantsVolume
          ? `${(vol / 1e9).toFixed(3)} m³ net wall masonry volume across ${matches.length} walls`
          : `${(area / EXACT_SQMM_PER_SQM).toFixed(2)} m² (${(area / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft) net wall elevation area across ${matches.length} walls`,
        matches,
        apiCallCount: 0,
      };
    }
    if (target === 'slab') {
      const matches = rows.filter(r => r.kind === 'slab');
      const area = matches.reduce((s, r) => s + (r.areaMm2 ?? 0), 0);
      const vol = matches.reduce((s, r) => s + (r.volumeMm3 ?? 0), 0);
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CALCULATE_QUANTITY',
        text: wantsVolume
          ? `${(vol / 1e9).toFixed(3)} m³ built slab concrete volume`
          : `${(area / EXACT_SQMM_PER_SQM).toFixed(2)} m² (${(area / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft) built slab footprint area`,
        matches,
        apiCallCount: 0,
      };
    }
    if (target === 'carpet' || target === 'room') {
      const matches = rows.filter(r => r.kind === 'flat');
      const carpet = matches.reduce((s, r) => s + (r.modeledAreaMm2 ?? r.areaMm2 ?? 0), 0);
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CALCULATE_QUANTITY',
        text: `${(carpet / EXACT_SQMM_PER_SQM).toFixed(2)} m² (${(carpet / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft) modeled apartment carpet area`,
        matches,
        apiCallCount: 0,
      };
    }
    if (target === 'balcony') {
      const matches = rows.filter(r => r.kind === 'room' && r.name.toLowerCase().includes('balcony'));
      const area = matches.reduce((s, r) => s + (r.modeledAreaMm2 ?? r.areaMm2 ?? 0), 0);
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CALCULATE_QUANTITY',
        text: `${(area / EXACT_SQMM_PER_SQM).toFixed(2)} m² (${(area / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft) balcony deck area`,
        matches,
        apiCallCount: 0,
      };
    }
    const matches = rows.filter(r => r.kind === 'door');
    const area = matches.reduce((s, r) => s + (r.areaMm2 ?? 0), 0);
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'CALCULATE_QUANTITY',
      text: `${(area / EXACT_SQMM_PER_SQM).toFixed(2)} m² across ${matches.length} door openings`,
      matches,
      apiCallCount: 0,
    };
  }

  // ── 3. Highlight rooms below target area / minimum habitable standard ──────
  if (/\b(?:highlight|find|list|show|check)\b.*\b(?:below|under|undersized|short)\b.*\b(?:target|minimum|area)\b/.test(input)) {
    if (!ctx.floor) {
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'BELOW_TARGET_ROOMS',
        text: 'Open an active floor to inspect rooms against target and habitable minimum areas.',
        matches: [],
        apiCallCount: 0,
      };
    }
    const belowIds: string[] = [];
    const notes: string[] = [];
    for (const room of ctx.floor.rooms) {
      if (room.spaceUse === 'VOID' || room.type === RoomType.Staircase || room.type === RoomType.Lift || room.type === RoomType.ServiceShaft) {
        continue;
      }
      const minStd = ENGINEERING_MIN_ROOM_AREAS[room.type] ?? 0;
      const threshold = Math.max(room.minArea ?? 0, minStd);
      const actual = room.area;
      if (threshold > 0 && actual + 10_000 < threshold) {
        belowIds.push(room.id);
        notes.push(`${room.name} (${(actual / EXACT_SQMM_PER_SQM).toFixed(2)} m² < ${(threshold / EXACT_SQMM_PER_SQM).toFixed(2)} m²)`);
      }
    }
    const matches = rows.filter(r => r.kind === 'room' && belowIds.includes(r.id));
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'BELOW_TARGET_ROOMS',
      text:
        belowIds.length === 0
          ? `0 rooms below target/minimum habitable area on ${ctx.floor.name} — all habitable rooms meet or exceed minimum standards.`
          : `${belowIds.length} room(s) below target/minimum area: ${notes.join('; ')}`,
      matches,
      highlightEntityIds: belowIds,
      apiCallCount: 0,
    };
  }

  // ── 4. Identify clashes and suggest resolutions ────────────────────────────
  if (/\b(?:clash|clashes|collision|interference|clearance\s+issue)\b/.test(input)) {
    const activeClashes = (ctx.clashes ?? []).filter(c => c.status === 'OPEN');
    if (!ctx.clashes) {
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CLASH_RESOLUTION',
        text: 'Link and align a read-only IFC4 reference model, then click “Check wall clashes” to compute 3D intersections and clearance distances.',
        matches: [],
        apiCallCount: 0,
      };
    }
    if (activeClashes.length === 0) {
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'CLASH_RESOLUTION',
        text: '0 open clashes on the active floor. All previously detected clashes are resolved or clear.',
        matches: [],
        apiCallCount: 0,
      };
    }
    const hardCount = activeClashes.filter(c => c.kind !== 'CLEARANCE').length;
    const clearCount = activeClashes.filter(c => c.kind === 'CLEARANCE').length;
    const top = activeClashes[0]!;
    const safeRefClass = sanitizeUntrustedReferenceLabel(top.ifcClass);
    const suggestion =
      safeRefClass === 'IFCDUCTSEGMENT' || safeRefClass === 'IFCPIPESEGMENT'
        ? 'Provide a coordinated MEP sleeve/opening or reroute the MEP segment through the dedicated service shaft.'
        : safeRefClass === 'IFCCOLUMN' || safeRefClass === 'IFCBEAM'
          ? 'Shift the non-structural partition/door away from the structural member via Preview Canonical Edit.'
          : 'Re-align the discipline reference offset or shift the conflicting internal partition via Preview Canonical Edit.';
    const matchedRows = rows.filter(r => activeClashes.some(c => c.elementId === r.id));
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'CLASH_RESOLUTION',
      text: `${activeClashes.length} open issue(s) (${hardCount} hard intersection(s), ${clearCount} clearance violation(s)). Primary conflict: ${top.elementKind} '${top.elementId}' vs ${safeRefClass} (${(top.volumeMm3 / 1e9).toFixed(4)} m³). Suggested resolution: ${suggestion}`,
      matches: matchedRows,
      highlightEntityIds: activeClashes.map(c => c.elementId),
      apiCallCount: 0,
    };
  }

  // ── 5, 6, 7. Controlled Mutation Proposals (Preview Required — NEVER Auto-Mutates!) ──
  const isLocalRegenCmd =
    /\bregenerate\b.*\b(?:flat|unit|apartment|room|bedroom|kitchen)\b/.test(input) ||
    /\b(?:relocate\s+kitchen|convert\s+flat)\b/.test(input);
  const isMoveDoorCmd = /\b(?:move|shift|slide)\b.*\b(?:door|window)\b/.test(input);
  const isResizeRoomCmd = /\b(?:resize|increase|decrease|expand|set)\b.*\b(?:bedroom|living|dining|kitchen|room)\b/.test(input);

  if ((isLocalRegenCmd || isMoveDoorCmd || isResizeRoomCmd) && ctx.building && ctx.floor) {
    const proposal = proposeControlledCadEdit({
      building: ctx.building,
      floorId: ctx.floor.id,
      control: ctx.control,
      expectedRevision: ctx.building.version,
      instruction: trimmed,
      intentSource: 'DETERMINISTIC',
    });
    const commandClass = isLocalRegenCmd
      ? 'LOCAL_FLAT_REGENERATION'
      : isMoveDoorCmd
        ? 'MOVE_DOOR_CLEARANCE'
        : 'RESIZE_ROOM_TARGET';
    return {
      mode: 'PROPOSAL_PREVIEW',
      commandClass,
      text:
        proposal.status === 'PREVIEW_READY'
          ? `PREVIEW READY (Rev ${ctx.building.version} -> ${proposal.proposedRevision}): ${proposal.message} Review and click Accept Preview to commit.`
          : `Proposal rejected (${proposal.status}): ${proposal.message}`,
      matches: rows.filter(r => proposal.resolvedEntityIds.includes(r.id)),
      highlightEntityIds: proposal.resolvedEntityIds,
      proposalPreview: proposal,
      apiCallCount: 0,
    };
  }

  // ── 8. Explain compliance / architectural design quality findings ──────────
  if (/\b(?:explain|summarize|audit|check)\b.*\b(?:compliance|quality|efficiency|udcpr|design|findings)\b/.test(input) && ctx.floor) {
    const func = auditFloorFunctionalQuality(ctx.floor);
    const elem = auditArchitecturalElementRealism(ctx.floor);
    const eff = computeFloorEfficiencyBreakdown(ctx.floor);
    const totalIssues = func.findings.length + elem.findings.length;
    const detail =
      totalIssues === 0
        ? '0 functional or element realism violations (entry privacy, kitchen adjacency, bathroom ventilation, balcony parapets, and door clearances all pass).'
        : `${totalIssues} finding(s): ${[...func.findings.map(f => f.description), ...elem.findings.map(f => f.description)].slice(0, 3).join(' | ')}`;
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'COMPLIANCE_EXPLANATION',
      text: `Floor '${ctx.floor.name}' (${eff.grossFloorPlate.areaSqM.toFixed(1)} m² gross; Carpet ${eff.modeledHabitableCarpet.shareOfGrossPercent}%, Walls ${eff.wallFootprint.shareOfGrossPercent}%, Core ${eff.verticalCore.shareOfGrossPercent}%, Common Circ ${eff.commonCirculation.shareOfGrossPercent}%): ${detail} [INTERNAL ENGINEERING AUDIT — PROFESSIONAL REVIEW REQUIRED]`,
      matches: [],
      apiCallCount: 0,
    };
  }

  // ── 9. Compare current revision with previous revision ─────────────────────
  if (/\b(?:compare|diff|changes?|what\s+changed)\b.*\b(?:revision|previous|prior|version|history)\b/.test(input)) {
    if (!ctx.building || !ctx.previousBuilding) {
      return {
        mode: 'DETERMINISTIC',
        commandClass: 'REVISION_DIFF',
        text: ctx.building
          ? `Current model is at Revision ${ctx.building.version}. Make a canonical edit to compare against the prior revision.`
          : 'No active building loaded for revision comparison.',
        matches: [],
        apiCallCount: 0,
      };
    }
    const diff = diffBuildings(ctx.previousBuilding, ctx.building);
    const modifiedRoomIds = [...new Set([...diff.movedRooms, ...diff.resizedRooms])];
    const changedWallIds = [...new Set([...diff.addedWalls, ...diff.removedWalls])];
    const openingChanges =
      diff.addedDoors.length + diff.removedDoors.length + diff.addedWindows.length + diff.removedWindows.length;
    return {
      mode: 'DETERMINISTIC',
      commandClass: 'REVISION_DIFF',
      text: `Revision diff (${ctx.previousBuilding.version} -> ${ctx.building.version}): ${diff.addedRooms.length} room(s) added, ${diff.removedRooms.length} removed, ${modifiedRoomIds.length} modified; ${changedWallIds.length} wall change(s); ${openingChanges} opening change(s).`,
      matches: rows.filter(r => modifiedRoomIds.includes(r.id) || changedWallIds.includes(r.id)),
      highlightEntityIds: [...modifiedRoomIds, ...changedWallIds],
      apiCallCount: 0,
    };
  }

  return {
    mode: 'UNSUPPORTED',
    text: 'Try “Show all doors in Flat 2”, “Total window area”, “Highlight rooms below target area”, “Identify clashes”, “Explain compliance findings”, “Compare with previous revision”, or “Regenerate Flat 2”.',
    matches: [],
    apiCallCount: 0,
  };
}
