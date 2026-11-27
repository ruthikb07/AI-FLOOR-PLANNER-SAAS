/**
 * @ai-floor-planner/structural-engine — Explicit Solver & Section Capability Registry (Carbon 4 Section 02 & 03)
 *
 * Publishes exact library provenance, supported formulations, and fail-closed exclusions so
 * unsupported or unverified structural paths can never silently masquerade as certified checks.
 */

import type {
  AnalysisMethodKind,
  Carbon4StructuralLifecycleStatus,
  SectionCapacityBackend,
  StructuralCapabilityClassification,
  StructuralSolverBackend,
} from '../types/solver-types.js';

export interface SolverBackendCapabilityEntry {
  readonly backend: StructuralSolverBackend | 'ETABS_EXTERNAL_CLI';
  readonly libraryName: string;
  readonly pinnedVersion: string;
  readonly pinnedCommitOrSha256: string;
  readonly license: string;
  readonly classification: StructuralCapabilityClassification;
  readonly requiresPythonWorker: boolean;
  readonly supportedMethods: readonly AnalysisMethodKind[];
  readonly exclusions: readonly string[];
}

export interface SectionProviderCapabilityEntry {
  readonly provider: SectionCapacityBackend;
  readonly libraryName: string;
  readonly pinnedVersion: string;
  readonly pinnedCommitSha: string;
  readonly license: string;
  readonly classification: StructuralCapabilityClassification;
  readonly requiresPythonWorker: boolean;
  readonly stressStrainBasis: string;
  readonly exclusions: readonly string[];
}

export const CARBON4_SOLVER_CAPABILITY_REGISTRY: Readonly<
  Record<SolverBackendCapabilityEntry['backend'], SolverBackendCapabilityEntry>
> = {
  AWATIF_CPP_WASM: {
    backend: 'AWATIF_CPP_WASM',
    libraryName: 'Awatif FEA C++ / Eigen::SparseLU WASM',
    pinnedVersion: '3.4.0',
    pinnedCommitOrSha256: '3dfc46bb417524ca226532f947326b2297638dd983fc0b0ae380b5d04df028ef',
    license: 'MIT (Copyright Mohamed Adil)',
    classification: 'EMBEDDED_LIBRARY_VERIFIED',
    requiresPythonWorker: false,
    supportedMethods: ['LINEAR_STATIC_FRAME', 'MODAL_EIGENVALUE_FRAME', 'EQUIVALENT_STATIC_SEISMIC_FRAME'],
    exclusions: [
      'Plate/shell FEM elements are not executed in lSolver.wasm',
      'Second-order P-Delta and material nonlinearity are excluded',
      'Remote Awatif nonlinear solver endpoints are prohibited',
    ],
  },
  TYPESCRIPT_SPARSE_LU_REFERENCE: {
    backend: 'TYPESCRIPT_SPARSE_LU_REFERENCE',
    libraryName: 'RH Planner Pure-TypeScript Banded/Sparse LU Reference Solver',
    pinnedVersion: '1.0.0',
    pinnedCommitOrSha256: '548929820c9295b1368fea55ce3a316136e1d345',
    license: 'Internal / Proprietary',
    classification: 'FULLY_INTERNAL_VERIFIED',
    requiresPythonWorker: false,
    supportedMethods: ['LINEAR_STATIC_FRAME', 'MODAL_EIGENVALUE_FRAME', 'EQUIVALENT_STATIC_SEISMIC_FRAME'],
    exclusions: ['Plate/shell FEM and second-order P-Delta are excluded'],
  },
  PYNITE_3D_FRAME: {
    backend: 'PYNITE_3D_FRAME',
    libraryName: 'PyNiteFEA (FEModel3D / Member3D)',
    pinnedVersion: '3.2.1',
    pinnedCommitOrSha256: 'fdf3e12b102716b7009e64335be6916377d70f31',
    license: 'MIT (Copyright (c) 2018 D. Craig Brinck)',
    classification: 'EMBEDDED_LIBRARY_VERIFIED',
    requiresPythonWorker: true,
    supportedMethods: ['LINEAR_STATIC_FRAME', 'EQUIVALENT_STATIC_SEISMIC_FRAME'],
    exclusions: ['Material inelasticity / plastic hinge pushover not enabled in verified design flow'],
  },
  PYNITE_PLATE_QUAD: {
    backend: 'PYNITE_PLATE_QUAD',
    libraryName: 'PyNiteFEA (Plate3D Kirchhoff + Quad3D MITC4/DKMQ)',
    pinnedVersion: '3.2.1',
    pinnedCommitOrSha256: 'fdf3e12b102716b7009e64335be6916377d70f31',
    license: 'MIT (Copyright (c) 2018 D. Craig Brinck)',
    classification: 'EMBEDDED_LIBRARY_VERIFIED',
    requiresPythonWorker: true,
    supportedMethods: ['SHELL_FEM', 'LINEAR_STATIC_FRAME'],
    exclusions: [
      'Opt-in meshed slab/plate mode only; when active on a slab bay, tributary beam line loads for that bay must be suppressed to prevent double counting',
      'Cannot be combined with PyNite analyze_PDelta',
    ],
  },
  PYNITE_PDELTA: {
    backend: 'PYNITE_PDELTA',
    libraryName: 'PyNiteFEA (FEModel3D.analyze_PDelta)',
    pinnedVersion: '3.2.1',
    pinnedCommitOrSha256: 'fdf3e12b102716b7009e64335be6916377d70f31',
    license: 'MIT (Copyright (c) 2018 D. Craig Brinck)',
    classification: 'EMBEDDED_LIBRARY_VERIFIED',
    requiresPythonWorker: true,
    supportedMethods: ['P_DELTA'],
    exclusions: [
      'Second-order geometric stiffness Kg is assembled for Member3D frame elements ONLY; Plate3D/Quad3D elements are rejected fail-closed',
    ],
  },
  ETABS_EXTERNAL_CLI: {
    backend: 'ETABS_EXTERNAL_CLI',
    libraryName: 'CSI ETABS OAPI External Desktop Verification Bridge',
    pinnedVersion: '23.3.2 (host-dependent)',
    pinnedCommitOrSha256: 'EXTERNAL_HOST_BINARY',
    license: 'Commercial Host License Required',
    classification: 'EXTERNAL_VERIFICATION_ONLY',
    requiresPythonWorker: false,
    supportedMethods: ['LINEAR_STATIC_FRAME'],
    exclusions: ['Optional external verification harness only; never required for localhost operation'],
  },
};

export const CARBON4_SECTION_CAPABILITY_REGISTRY: Readonly<
  Record<SectionCapacityBackend, SectionProviderCapabilityEntry>
> = {
  RH_IS456_ANALYTICAL: {
    provider: 'RH_IS456_ANALYTICAL',
    libraryName: 'RH Planner IS 456:2000 Analytical Strain-Compatibility Integrator',
    pinnedVersion: '1.0.0',
    pinnedCommitSha: '548929820c9295b1368fea55ce3a316136e1d345',
    license: 'Internal / Proprietary',
    classification: 'FULLY_INTERNAL_VERIFIED',
    requiresPythonWorker: false,
    stressStrainBasis:
      'IS 456:2000 Cl. 38.1 & 39.1(b) parabolic-rectangular concrete (0.447 fck) with variable pure-compression pivot + IS 1786 / SP-16 HYSD steel (0.87 fy) + Bresler Cl. 39.6 biaxial check',
    exclusions: ['Rectangular perimeter layouts only; non-rectangular polygons require CONCRETE_PROPERTIES_FIBER'],
  },
  CONCRETE_PROPERTIES_FIBER: {
    provider: 'CONCRETE_PROPERTIES_FIBER',
    libraryName: 'concreteproperties + sectionproperties + shapely',
    pinnedVersion: '0.8.0',
    pinnedCommitSha: '13bfb7bfd75b265bcd418e2f8ed72106a0362678',
    license: 'MIT (Copyright © 2026 Robbie van Leeuwen)',
    classification: 'EMBEDDED_LIBRARY_VERIFIED',
    requiresPythonWorker: true,
    stressStrainBasis:
      'Explicit concrete polygon + exact (x, y) bar coordinates with geometric displaced-concrete subtraction; IS 456 parabolic-rectangular concrete (0.447 fck, eps0=0.002, eps_cu=0.0035, zero tension) + IS 1786 HYSD steel (0.87 fy) + exact 2D (Mx, My) biaxial failure contour ray capacity with IS 456 Cl. 39.1(b) pure-compression cap',
    exclusions: ['Australian AS 3600 and Eurocode partial safety factors are NOT used; IS 456 design curves are injected directly without double-factoring'],
  },
};

/**
 * Maps computed design evidence to the automated Carbon 4 lifecycle.
 */
export function resolveCarbon4LifecycleStatus(params: {
  readonly hasUnsupportedScope: boolean;
  readonly hasDesignFailure: boolean;
  readonly hasPreliminaryInputsOrLoadPaths: boolean;
  readonly hasUnverifiedMethod: boolean;
  readonly allChecksPassedWithinScope: boolean;
}): Carbon4StructuralLifecycleStatus {
  if (params.hasUnsupportedScope) return 'UNSUPPORTED';
  if (params.hasDesignFailure) return 'DESIGN_FAILED';
  if (params.hasUnverifiedMethod) return 'NOT_VERIFIED';
  if (params.hasPreliminaryInputsOrLoadPaths) return 'PRELIMINARY';
  if (params.allChecksPassedWithinScope) return 'CHECKS_PASSED_WITHIN_SCOPE';
  return 'ANALYSIS_COMPLETED';
}
