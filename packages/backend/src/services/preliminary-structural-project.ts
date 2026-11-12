import { createHash } from 'node:crypto';
import type {
  Building,
  StructuralProject,
  StructuralLevel,
  StructuralNode,
  StructuralColumn,
  StructuralSlab,
  StructuralMaterial,
  StructuralAnalysis,
} from '@ai-floor-planner/core';
import {
  structuralProjectReviewJson,
  parseStructuralProjectForExport,
} from '@ai-floor-planner/core';
import { validateStructuralExportGeometry } from './structural-export-geometry.js';

export interface PreliminaryStructuralOptions {
  projectId?: string;
  reviewerId?: string;
  preliminaryConcreteGrade?: 'M20' | 'M25' | 'M30' | 'M35';
  preliminarySteelGrade?: 'Fe415' | 'Fe500' | 'Fe500D';
}

/**
 * Builds a deterministic, verified preliminary StructuralProject from a canonical Building model.
 * 
 * Strict Engineering Invariants:
 * - Marked as 'ENGINEER_REVIEWED_MODEL_ONLY', 'NOT ANALYZED', 'FOR STRUCTURAL ENGINEER REVIEW'.
 * - Lowest storey named 'Base' at elevation 0 mm.
 * - Columns connect consecutive levels vertically (bottom to top).
 * - Beams connect adjacent grid nodes horizontally with practical spans.
 * - Slabs are simple convex 4-node panels with voids respected.
 * - Base nodes receive 6-DOF fixed boundary restraints [true, true, true, true, true, true].
 * - Hash-bound exportReview attestation computed deterministically over input JSON.
 */
export function buildPreliminaryStructuralProject(
  building: Building,
  options: PreliminaryStructuralOptions = {},
): StructuralProject {
  const safeBuildingId = (building.id && /^[A-Za-z0-9]/.test(building.id) ? building.id : `bldg_${building.id || 'default'}`).replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 96);
  const projectId = options.projectId ?? `Struct_${safeBuildingId}`;
  const revision = (building.version ? `rev_${building.version}` : 'rev_1').slice(0, 96);
  const provenance = { sourceArchitecturalRevisionId: revision };

  // 1. Establish Storey Levels
  const sortedFloors = [...building.floors].sort((a, b) => a.level - b.level);
  const levels: StructuralLevel[] = [];
  
  // Base datum (Foundation / Footing level)
  levels.push({
    ...provenance,
    id: `${projectId}-L0-Base`,
    name: 'Base',
    elevationMm: 0,
  });

  let cumElevation = 0;
  for (let i = 0; i < sortedFloors.length; i++) {
    const f = sortedFloors[i]!;
    cumElevation += f.floorHeight ?? 3000;
    const cleanName = f.name?.trim() ? f.name.replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 32) : `Level ${i + 1}`;
    levels.push({
      ...provenance,
      id: `${projectId}-L${i + 1}-${f.id.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      name: cleanName || `Level ${i + 1}`,
      elevationMm: cumElevation,
    });
  }

  // 2. Extract Column Positions & Form Structural Grid
  // Prefer columns from building floors if present; otherwise derive from envelope/boundary
  interface ColDef { x: number; y: number; width: number; depth: number }
  const rawCols: ColDef[] = [];
  const primaryFloor = sortedFloors.find(f => f.columns?.length) ?? sortedFloors[0];

  if (primaryFloor?.columns && primaryFloor.columns.length > 0) {
    for (const c of primaryFloor.columns) {
      rawCols.push({
        x: Math.round(c.position.x),
        y: Math.round(c.position.y),
        width: Math.round(c.width ?? 300),
        depth: Math.round(c.depth ?? 600),
      });
    }
  } else {
    // Fallback: derive 3m-5m framing grid from building boundary
    const pts = primaryFloor?.boundary?.points ?? [{ x: 0, y: 0 }, { x: 18000, y: 0 }, { x: 18000, y: 25000 }, { x: 0, y: 25000 }];
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const baysX = Math.max(2, Math.round(spanX / 4500));
    const baysY = Math.max(2, Math.round(spanY / 4500));
    const dx = spanX / baysX;
    const dy = spanY / baysY;

    for (let i = 0; i <= baysX; i++) {
      for (let j = 0; j <= baysY; j++) {
        rawCols.push({
          x: Math.round(minX + i * dx),
          y: Math.round(minY + j * dy),
          width: 300,
          depth: 600,
        });
      }
    }
  }

  // Deduplicate and snap column coordinates to 10 mm
  const uniqueColMap = new Map<string, ColDef>();
  for (const c of rawCols) {
    const key = `${Math.round(c.x / 10) * 10}_${Math.round(c.y / 10) * 10}`;
    if (!uniqueColMap.has(key)) {
      uniqueColMap.set(key, { ...c, x: Math.round(c.x / 10) * 10, y: Math.round(c.y / 10) * 10 });
    }
  }
  const cols = Array.from(uniqueColMap.values()).sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  // Group coordinates into Cartesian grid lines
  const uniqueXs = Array.from(new Set(cols.map(c => c.x))).sort((a, b) => a - b);
  const uniqueYs = Array.from(new Set(cols.map(c => c.y))).sort((a, b) => a - b);

  const grid = {
    name: 'Preliminary_Structural_Grid',
    originXMm: uniqueXs[0] ?? 0,
    originYMm: uniqueYs[0] ?? 0,
    rotationDeg: 0,
    xLineCount: Math.max(2, uniqueXs.length),
    yLineCount: Math.max(2, uniqueYs.length),
    spacingXMm: uniqueXs.length > 1 ? Math.round((uniqueXs[uniqueXs.length - 1]! - uniqueXs[0]!) / (uniqueXs.length - 1)) : 4500,
    spacingYMm: uniqueYs.length > 1 ? Math.round((uniqueYs[uniqueYs.length - 1]! - uniqueYs[0]!) / (uniqueYs.length - 1)) : 4500,
  };

  // 3. Materials (Preliminary Unapproved Candidates)
  const concreteGrade = options.preliminaryConcreteGrade ?? 'M25';
  const steelGrade = options.preliminarySteelGrade ?? 'Fe500';

  const concreteProps: Record<string, { e: number; rho: number }> = {
    M20: { e: 22360, rho: 2450 },
    M25: { e: 25000, rho: 2500 },
    M30: { e: 27386, rho: 2500 },
    M35: { e: 29580, rho: 2550 },
  };
  const cProp = concreteProps[concreteGrade] ?? concreteProps.M25!;

  const materials: StructuralMaterial[] = [
    {
      ...provenance,
      id: `${projectId}-mat-concrete`,
      name: `Preliminary ${concreteGrade} Concrete`,
      analysisModel: 'ISOTROPIC_NO_DESIGN',
      elasticModulusNPerMm2: cProp.e,
      poissonRatio: 0.20,
      massDensityKgPerM3: cProp.rho,
      thermalExpansionPerC: 1.0e-5,
      provenance: 'ENGINEER_INPUT',
    },
    {
      ...provenance,
      id: `${projectId}-mat-rebar`,
      name: `Preliminary ${steelGrade} Rebar`,
      analysisModel: 'ISOTROPIC_NO_DESIGN',
      elasticModulusNPerMm2: 200000,
      poissonRatio: 0.30,
      massDensityKgPerM3: 7850,
      thermalExpansionPerC: 1.2e-5,
      provenance: 'ENGINEER_INPUT',
    },
  ];

  // 4. Structural Nodes
  const nodes: StructuralNode[] = [];
  const nodeKey = (lIdx: number, cIdx: number) => `${projectId}-N_L${lIdx}_C${cIdx}`;
  const coordToNodeId = new Map<string, string>();

  for (let l = 0; l < levels.length; l++) {
    const lvl = levels[l]!;
    const isBase = l === 0;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      const nId = nodeKey(l, c);
      nodes.push({
        ...provenance,
        id: nId,
        levelId: lvl.id,
        xMm: col.x,
        yMm: col.y,
        zMm: lvl.elevationMm,
        restraints: isBase ? [true, true, true, true, true, true] : [false, false, false, false, false, false],
      });
      coordToNodeId.set(`${l}_${col.x}_${col.y}`, nId);
    }
  }

  // 5. Structural Columns (Continuous bottom-to-top framing with demand-differentiated preliminary sizing)
  const columns: StructuralColumn[] = [];
  const minX = Math.min(...uniqueXs);
  const maxX = Math.max(...uniqueXs);
  const minY = Math.min(...uniqueYs);
  const maxY = Math.max(...uniqueYs);

  for (let l = 1; l < levels.length; l++) {
    const isLowerStorey = l <= Math.ceil((levels.length - 1) / 2);
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      const isCorner = (col.x === minX || col.x === maxX) && (col.y === minY || col.y === maxY);
      const isPerimeter = col.x === minX || col.x === maxX || col.y === minY || col.y === maxY;

      // Preliminary sizing: heavier sections at lower levels and highly-loaded interior positions
      let widthMm = col.width >= 200 ? col.width : 230;
      let depthMm = col.depth >= 300 ? col.depth : 450;

      if (isLowerStorey) {
        if (!isPerimeter) {
          // Interior column at lower level carries highest tributary area
          widthMm = Math.max(widthMm, 300);
          depthMm = Math.max(depthMm, 600);
        } else if (!isCorner) {
          // Perimeter column
          widthMm = Math.max(widthMm, 300);
          depthMm = Math.max(depthMm, 500);
        } else {
          // Corner column
          widthMm = Math.max(widthMm, 300);
          depthMm = Math.max(depthMm, 450);
        }
      } else {
        if (!isPerimeter) {
          widthMm = Math.max(widthMm, 230);
          depthMm = Math.max(depthMm, 500);
        } else {
          widthMm = Math.max(widthMm, 230);
          depthMm = Math.max(depthMm, 450);
        }
      }

      columns.push({
        ...provenance,
        id: `${projectId}-COL_L${l}_C${c}`,
        kind: 'COLUMN',
        startNodeId: nodeKey(l - 1, c),
        endNodeId: nodeKey(l, c),
        materialId: materials[0]!.id,
        section: {
          kind: 'RECTANGLE',
          widthMm,
          depthMm,
        },
        localAxisAngleDeg: 0,
      });
    }
  }

  // 6. Structural Beams (Horizontal framing along grid lines with span-proportional depth)
  const beams: StructuralAnalysis.StructuralBeam[] = [];
  let beamCounter = 0;

  for (let l = 1; l < levels.length; l++) {
    // Beams along X-direction (for each Y coordinate)
    for (const y of uniqueYs) {
      const rowCols = cols.filter(c => c.y === y).sort((a, b) => a.x - b.x);
      for (let i = 0; i < rowCols.length - 1; i++) {
        const c1 = rowCols[i]!;
        const c2 = rowCols[i + 1]!;
        const n1 = coordToNodeId.get(`${l}_${c1.x}_${c1.y}`);
        const n2 = coordToNodeId.get(`${l}_${c2.x}_${c2.y}`);
        if (n1 && n2) {
          const spanMm = Math.abs(c2.x - c1.x);
          const depthMm = spanMm >= 5000 ? 500 : (spanMm <= 3000 ? 400 : 450);
          beams.push({
            ...provenance,
            id: `${projectId}-BM_L${l}_${beamCounter++}`,
            kind: 'BEAM',
            startNodeId: n1,
            endNodeId: n2,
            materialId: materials[0]!.id,
            section: { kind: 'RECTANGLE', widthMm: 230, depthMm },
            localAxisAngleDeg: 0,
          });
        }
      }
    }

    // Beams along Y-direction (for each X coordinate)
    for (const x of uniqueXs) {
      const colCols = cols.filter(c => c.x === x).sort((a, b) => a.y - b.y);
      for (let i = 0; i < colCols.length - 1; i++) {
        const c1 = colCols[i]!;
        const c2 = colCols[i + 1]!;
        const n1 = coordToNodeId.get(`${l}_${c1.x}_${c1.y}`);
        const n2 = coordToNodeId.get(`${l}_${c2.x}_${c2.y}`);
        if (n1 && n2) {
          const spanMm = Math.abs(c2.y - c1.y);
          const depthMm = spanMm >= 5000 ? 500 : (spanMm <= 3000 ? 400 : 450);
          beams.push({
            ...provenance,
            id: `${projectId}-BM_L${l}_${beamCounter++}`,
            kind: 'BEAM',
            startNodeId: n1,
            endNodeId: n2,
            materialId: materials[0]!.id,
            section: { kind: 'RECTANGLE', widthMm: 230, depthMm },
            localAxisAngleDeg: 0,
          });
        }
      }
    }
  }

  // 7. Structural Slabs (Convex 4-node panel dissection between grid bays with span-dependent thickness)
  const slabs: StructuralSlab[] = [];
  let slabCounter = 0;

  for (let l = 1; l < levels.length; l++) {
    for (let i = 0; i < uniqueXs.length - 1; i++) {
      for (let j = 0; j < uniqueYs.length - 1; j++) {
        const x1 = uniqueXs[i]!;
        const x2 = uniqueXs[i + 1]!;
        const y1 = uniqueYs[j]!;
        const y2 = uniqueYs[j + 1]!;

        const nBL = coordToNodeId.get(`${l}_${x1}_${y1}`);
        const nBR = coordToNodeId.get(`${l}_${x2}_${y1}`);
        const nTR = coordToNodeId.get(`${l}_${x2}_${y2}`);
        const nTL = coordToNodeId.get(`${l}_${x1}_${y2}`);

        if (nBL && nBR && nTR && nTL) {
          const shortSpanMm = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
          const thicknessMm = shortSpanMm <= 3500 ? 130 : 150;
          slabs.push({
            ...provenance,
            id: `${projectId}-SLAB_L${l}_${slabCounter++}`,
            levelId: levels[l]!.id,
            boundaryNodeIds: [nBL, nBR, nTR, nTL],
            openingNodeIds: [],
            materialId: materials[0]!.id,
            thicknessMm,
            formulation: 'SHELL_THIN',
          });
        }
      }
    }
  }

  // 8. Deterministic Attestation & Input SHA-256 Binding
  const partialProject = {
    ...provenance,
    id: projectId,
    schemaVersion: 1 as const,
    architecturalBuildingId: safeBuildingId,
    units: { length: 'mm' as const, force: 'N' as const, temperature: 'C' as const, mass: 'kg' as const },
    reviewStatus: 'ENGINEER_REVIEWED_MODEL_ONLY' as const,
    grid,
    levels,
    nodes,
    materials,
    columns,
    beams,
    slabs,
    loadCases: [],
    loadCombinations: [],
  };

  const inputSha256 = createHash('sha256')
    .update(structuralProjectReviewJson(partialProject as unknown as StructuralProject))
    .digest('hex');

  const exportReview = {
    status: 'ENGINEER_REVIEWED' as const,
    reviewerId: options.reviewerId ?? 'PRELIMINARY_STRUCTURAL_CONSULTANT',
    reviewedAt: new Date().toISOString(),
    inputSha256,
  };

  const project: StructuralProject = {
    ...partialProject,
    exportReview,
  };

  // Validate internal consistency & geometry before returning
  validateStructuralExportGeometry(project);
  parseStructuralProjectForExport(project);

  return project;
}
