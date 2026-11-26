/**
 * @ai-floor-planner/structural-engine — StructuralProject (`mm`/`N`/`MPa`) <-> Awatif Solver (`m`/`kN`/`kPa`) Adapter
 *
 * Converts RH Planner's `StructuralProject` contract (`@ai-floor-planner/core`) into an
 * `AnalyticalFrameModel` with a single explicit unit/coordinate boundary in and out!
 */

import type { StructuralProject } from '@ai-floor-planner/core';
import type {
  AnalyticalFrameElement,
  AnalyticalFrameModel,
  AnalyticalLoadCase,
  AnalyticalLoadCombination,
  AnalyticalNode,
} from '../types/solver-types.js';
import {
  canonicalMmToStructuralMeters,
  computeRectangularSectionProps,
  densityKgM3ToUnitWeightKnM3,
  nMmToKnM,
  newtonsToKn,
} from '../adapter/units-and-coordinates.js';

export function convertStructuralProjectToAnalyticalModel(
  project: StructuralProject,
): AnalyticalFrameModel {
  const nodeIndexById = new Map<string, number>();
  const nodes: AnalyticalNode[] = project.nodes.map((sn, idx) => {
    nodeIndexById.set(sn.id, idx);
    return {
      id: sn.id,
      index: idx,
      positionM: canonicalMmToStructuralMeters({ x: sn.xMm, y: sn.yMm, z: sn.zMm }),
      floorId: sn.levelId,
      restraint: sn.restraints,
    };
  });

  const materialById = new Map(project.materials.map((m) => [m.id, m]));
  const elements: AnalyticalFrameElement[] = [];

  for (const col of project.columns) {
    const mat = materialById.get(col.materialId);
    const sIdx = nodeIndexById.get(col.startNodeId);
    const eIdx = nodeIndexById.get(col.endNodeId);
    if (sIdx === undefined || eIdx === undefined || !mat) continue;

    elements.push({
      id: col.id,
      index: elements.length,
      category: 'COLUMN',
      startNodeIndex: sIdx,
      endNodeIndex: eIdx,
      localAxisAngleDeg: col.localAxisAngleDeg,
      section: computeRectangularSectionProps({
        widthMm: col.section.widthMm,
        depthMm: col.section.depthMm,
        elasticityMPa: mat.elasticModulusNPerMm2,
        poissonRatio: mat.poissonRatio,
        unitWeightKnM3: densityKgM3ToUnitWeightKnM3(mat.massDensityKgPerM3),
      }),
    });
  }

  for (const bm of project.beams) {
    const mat = materialById.get(bm.materialId);
    const sIdx = nodeIndexById.get(bm.startNodeId);
    const eIdx = nodeIndexById.get(bm.endNodeId);
    if (sIdx === undefined || eIdx === undefined || !mat) continue;

    elements.push({
      id: bm.id,
      index: elements.length,
      category: 'BEAM',
      startNodeIndex: sIdx,
      endNodeIndex: eIdx,
      localAxisAngleDeg: bm.localAxisAngleDeg,
      section: computeRectangularSectionProps({
        widthMm: bm.section.widthMm,
        depthMm: bm.section.depthMm,
        elasticityMPa: mat.elasticModulusNPerMm2,
        poissonRatio: mat.poissonRatio,
        unitWeightKnM3: densityKgM3ToUnitWeightKnM3(mat.massDensityKgPerM3),
      }),
    });
  }

  const loadCases: AnalyticalLoadCase[] = project.loadCases.map((lc) => {
    const memberUniformLoads =
      lc.selfWeightMultiplier > 0
        ? elements.map((el) => ({
            elementIndex: el.index,
            coordinateSystem: 'GLOBAL' as const,
            qStartKnPerM: [
              0,
              0,
              -el.section.areaM2 * (el.section.unitWeightKnM3 ?? 25.0) * lc.selfWeightMultiplier,
            ] as const,
            sourceDescription: `Self-weight x${lc.selfWeightMultiplier}`,
          }))
        : [];

    const nodalLoads = lc.nodalLoads
      .map((nl) => {
        const nIdx = nodeIndexById.get(nl.nodeId);
        if (nIdx === undefined) return null;
        // Canonical yMm is South (+y), Structural Y is North (-y): flip Fy & My signs consistently with right-handed transformation!
        return {
          nodeIndex: nIdx,
          vectorKnM: [
            newtonsToKn(nl.forceN[0]),
            -newtonsToKn(nl.forceN[1]),
            newtonsToKn(nl.forceN[2]),
            nMmToKnM(nl.momentNmm[0]),
            -nMmToKnM(nl.momentNmm[1]),
            nMmToKnM(nl.momentNmm[2]),
          ] as const,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      id: lc.id,
      name: lc.name,
      nature:
        lc.patternType === 'DEAD'
          ? 'DEAD'
          : lc.patternType === 'LIVE'
            ? 'LIVE'
            : lc.patternType === 'WIND'
              ? 'WIND_X'
              : 'SEISMIC_X',
      nodalLoads,
      memberUniformLoads,
    };
  });

  const combinations: AnalyticalLoadCombination[] = project.loadCombinations.map((combo) => {
    const factors: Record<string, number> = {};
    for (const term of combo.terms) {
      factors[term.loadCaseId] = (factors[term.loadCaseId] ?? 0) + term.factor;
    }
    const maxFactor = Math.max(0, ...Object.values(factors).map(Math.abs));
    return {
      id: combo.id,
      name: combo.name,
      limitState: maxFactor > 1.05 ? 'ULS' : 'SLS_CHARACTERISTIC',
      standardClause: 'Reviewed StructuralProject Load Combination',
      factors,
    };
  });

  return {
    modelId: project.id,
    sourceBuildingId: project.architecturalBuildingId,
    nodes,
    elements,
    loadCases,
    combinations,
  };
}
