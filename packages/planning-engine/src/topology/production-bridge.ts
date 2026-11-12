/**
 * Production integration for the generative topology engine.
 *
 * `solveMultiSheetApartmentProject` needs ONE chosen organization expressed as
 * a `MacroPartition`, because the stilt, typical, refuge and terrace sheets all
 * repeat the same core geometry level by level. This module:
 *
 *   1. runs the topology engine for the brief and envelope,
 *   2. picks the top-ranked concept,
 *   3. converts its partition into a `MacroPartition` the existing sheet
 *      solvers already understand,
 *   4. keeps the full concept list and rejection reasons available as evidence.
 *
 * Vertical continuity is the reason the conversion keeps every corridor, lobby
 * and shaft rather than only the primary pair: the stilt and terrace sheets
 * tile the same envelope from the same partition, so dropping a secondary
 * corridor would leave unassigned area and fail the planar area ledger, and a
 * shaft present on one floor but not another would put a slab through a duct.
 */

import type { ApartmentBhkType } from '@ai-floor-planner/core';
import type { Box2D as SnapperBox, MacroPartition } from '../interpretation/space-filling-snapper';
import type { Box2D } from './rect-frame';
import type { TopologyPartition } from './topology-families';
import {
  generateDesignConcepts,
  type DesignConcept,
  type GenerateConceptsResult,
} from './generative-topology-engine';

const toSnapper = (b: Box2D): SnapperBox => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/**
 * Converts a topology partition into the `MacroPartition` shape the existing
 * sheet solvers consume.
 *
 * `corridorIsEastForFlat` is derived from each flat's real access edge. The
 * legacy flag is a boolean, so a north- or south-entered flat is reported by
 * whichever side of the flat its entrance actually lies on; the authoritative
 * per-flat edge travels with the topology partition itself.
 */
export function macroFromTopology(partition: TopologyPartition): MacroPartition {
  const corridors = partition.corridorBoxes.map(toSnapper);
  const lobbies = partition.lobbyBoxes.map(toSnapper);

  // `corridorBox`/`lobbyBox` are the legacy single-box fields. A topology may
  // genuinely have no separate lift lobby — where the stack is too narrow for a
  // landing, the cars open straight onto the corridor — so the primary lobby
  // then ALIASES the primary corridor. The arrays below stay authoritative and
  // keep the lobby list empty in that case: a consumer that placed a room from
  // each legacy field would otherwise emit two rooms on one rectangle, which is
  // a true geometric overlap, not a labelling detail.
  const byArea = (a: SnapperBox, b: SnapperBox) => b.w * b.h - a.w * a.h;
  const primaryCorridor = [...corridors].sort(byArea)[0]
    ?? [...lobbies].sort(byArea)[0]
    ?? toSnapper(partition.envelope);
  const primaryLobby = [...lobbies].sort(byArea)[0] ?? primaryCorridor;

  // Core bounding region, for consumers that want one box.
  const regions = partition.coreBoxes.length ? partition.coreBoxes : partition.stairBoxes;
  const coreBox: SnapperBox = regions.length
    ? {
        x: Math.min(...regions.map(b => b.x)),
        y: Math.min(...regions.map(b => b.y)),
        w: Math.max(...regions.map(b => b.x + b.w)) - Math.min(...regions.map(b => b.x)),
        h: Math.max(...regions.map(b => b.y + b.h)) - Math.min(...regions.map(b => b.y)),
      }
    : toSnapper(partition.envelope);

  return {
    coreBox,
    flatBoxes: partition.flatBoxes.map(toSnapper),
    corridorBox: primaryCorridor,
    lobbyBox: primaryLobby,
    liftBoxes: partition.liftBoxes.map(toSnapper),
    stairBoxes: partition.stairBoxes.map(toSnapper),
    shaftBoxes: partition.shaftBoxes.map(toSnapper),
    shaftRoles: [...partition.shaftRoles],
    corridorIsEastForFlat: partition.accessEdgeForFlat.map(edge => edge === 'EAST' || edge === 'SOUTH'),
    corridorBoxes: corridors,
    lobbyBoxes: lobbies,
    coreBoxes: partition.coreBoxes.map(toSnapper),
  };
}

export interface SelectTopologyInput {
  readonly envelope: Box2D;
  readonly flatsPerFloor: 2 | 3 | 4;
  readonly unitTypes: readonly ApartmentBhkType[];
  readonly aiPrompt?: string;
  readonly seed?: number;
  readonly conceptLimit?: number;
}

export interface SelectedTopology {
  readonly macro: MacroPartition;
  readonly chosen: DesignConcept;
  readonly result: GenerateConceptsResult;
}

/**
 * Runs the topology engine and returns the top-ranked concept, converted for
 * the production sheet solvers.
 *
 * Returns `undefined` when no organization is feasible for this envelope and
 * brief, so the caller can fall back to the legacy partition rather than fail
 * a generation the previous engine could complete.
 */
export function selectProductionTopology(input: SelectTopologyInput): SelectedTopology | undefined {
  // A caller may omit the unit mix; the solver then plans a default type per
  // flat. Pad to the flat count so the program is well formed, rather than
  // throwing and failing a generation the previous engine could complete.
  const unitTypes = input.unitTypes.length === input.flatsPerFloor
    ? input.unitTypes
    : Array.from({ length: input.flatsPerFloor }, (_, i) => input.unitTypes[i] ?? '2BHK');

  const result = generateDesignConcepts({
    envelope: input.envelope,
    flatsPerFloor: input.flatsPerFloor,
    unitTypes,
    aiPrompt: input.aiPrompt,
    seed: input.seed,
    conceptLimit: input.conceptLimit ?? 3,
  });

  const chosen = result.concepts[0];
  if (!chosen) return undefined;

  return { macro: macroFromTopology(chosen.partition), chosen, result };
}
