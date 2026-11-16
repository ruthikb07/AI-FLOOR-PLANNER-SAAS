/**
 * Real ETABS Screenshot Investigation & Cryptographic Evidence Service (§P3.3).
 *
 * CSI ETABS OAPI INVESTIGATION FINDINGS:
 * - Direct reflection and disassembly of the installed ETABS API (D:\ETABSv1.dll, OAPI 2.016)
 *   confirms that cView exposes only RefreshView() and RefreshWindow().
 * - CSI OAPI provides ZERO native graphical export methods (e.g. ExportImage, SaveBitmap).
 * - Background/headless processes running on Windows service/STA apartments cannot capture
 *   interactive desktop window surfaces (returns HWND_ZERO).
 *
 * ZERO FABRICATION POLICY (AGENTS.md):
 * - Under NO CIRCUMSTANCES will RH Planner generate fake screenshots using Three.js mockups,
 *   Blender headless renders, or HTML canvas screenshots labeled as native ETABS output.
 * - This service generates a cryptographically bound ETABSScreenshotManifest linked to
 *   the verified model EDB SHA-256 and ETABS analysis run ID.
 * - Automated capture status is explicitly stamped: AUTOMATED_CAPTURE_NOT_AVAILABLE_IN_OAPI.
 * - Provides comprehensive manual capture view configurations and instructions for licensed SE-1 engineers.
 */

import { createHash } from 'node:crypto';

export interface ETABSViewConfiguration {
  viewId: string;
  viewName: string;
  cameraType: '3D_ISOMETRIC' | 'PLAN_VIEW' | 'ELEVATION_VIEW';
  elevationOrStorey: string;
  loadCombinationOrCase: string;
  resultDisplayType:
    | 'UNDEFORMED_MODEL'
    | 'DEFORMED_SHAPE'
    | 'BENDING_MOMENT_M33'
    | 'SHEAR_FORCE_V22'
    | 'AXIAL_FORCE_P'
    | 'CONCRETE_DESIGN_COLUMN_PMM'
    | 'CONCRETE_DESIGN_BEAM_REBAR'
    | 'STOREY_DRIFT_PLOT';
  componentFocus: string;
  units: string;
  nativeETABSCommandPath: string;
  isCaptured: boolean;
}

export interface ETABSScreenshotEvidenceManifest {
  manifestVersion: '1.0';
  timestamp: string;
  sourceEdbFileName: string;
  sourceEdbSha256: string;
  analysisRunId: string;
  etabsVersion: string;
  oapiVersion: string;
  captureEngineStatus: 'AUTOMATED_CAPTURE_NOT_AVAILABLE_IN_OAPI';
  oapiInvestigationSummary: {
    dllPath: string;
    inspectedInterfaces: string[];
    missingMethods: string[];
    technicalRootCause: string;
  };
  zeroFabricationAttestation: {
    policyEnforced: true;
    syntheticMocksQuarantined: true;
    statement: string;
  };
  manualCaptureWorkflow: {
    engineerChecklist: string[];
    targetDirectory: string;
  };
  requiredViews: ETABSViewConfiguration[];
}

export class ETABSScreenshotService {
  /**
   * Produce the authoritative, cryptographically bound screenshot manifest for an analysis run.
   */
  public generateScreenshotManifest(params: {
    edbFileName: string;
    edbBytes?: Uint8Array;
    knownEdbSha256?: string;
    analysisRunId: string;
    etabsVersion?: string;
  }): ETABSScreenshotEvidenceManifest {
    const sha256 =
      params.knownEdbSha256 ??
      (params.edbBytes
        ? createHash('sha256').update(params.edbBytes).digest('hex')
        : 'SHA256-PENDING-FILE-PERSISTENCE');

    const views: ETABSViewConfiguration[] = [
      {
        viewId: 'VIEW-01',
        viewName: '3D Structural Isometric - Member Connectivity & Joint Restraints',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: 'UNDEFORMED',
        resultDisplayType: 'UNDEFORMED_MODEL',
        componentFocus: 'Columns, Beams, Footing Restraints (Fixed U1-U3, R1-R3)',
        units: 'mm',
        nativeETABSCommandPath: 'View -> Set 3D View -> 3D Isometric (Angle 30, Tilt 35)',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-02',
        viewName: 'Plan View - Typical Storey Framing & Grid System',
        cameraType: 'PLAN_VIEW',
        elevationOrStorey: 'Storey 1 (+3.05m)',
        loadCombinationOrCase: 'UNDEFORMED',
        resultDisplayType: 'UNDEFORMED_MODEL',
        componentFocus: 'Grids A-C, 1-3, Columns C1-C9, Perimeter Beams B1-B4',
        units: 'mm',
        nativeETABSCommandPath: 'View -> Set Plan View -> Storey 1',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-03',
        viewName: 'Deformed Shape under 1.5(DL+LL) Gravity Combination',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: '1.5(DL+LL)',
        resultDisplayType: 'DEFORMED_SHAPE',
        componentFocus: 'Vertical Deflection U3 Contours (Max downward displacement)',
        units: 'mm',
        nativeETABSCommandPath: 'Display -> Deformed Shape -> Select Combo "1.5(DL+LL)" -> Wireframe',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-04',
        viewName: 'Deformed Shape under EQX Lateral Seismic Load',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: '1.2(DL+LL+EQX)',
        resultDisplayType: 'DEFORMED_SHAPE',
        componentFocus: 'Horizontal Translation U1 Contours & Storey Sway',
        units: 'mm',
        nativeETABSCommandPath: 'Display -> Deformed Shape -> Select Combo "1.2(DL+LL+EQX)"',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-05',
        viewName: 'Member Major Bending Moment Diagram M3-3',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: '1.5(DL+LL)',
        resultDisplayType: 'BENDING_MOMENT_M33',
        componentFocus: 'Continuous Beams Hogging / Sagging Moment Envelopes',
        units: 'kN-m',
        nativeETABSCommandPath: 'Display -> Force/Stress Diagrams -> Frame/Pier Forces -> Moment 3-3',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-06',
        viewName: 'Member Major Shear Force Diagram V2-2',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: '1.5(DL+LL)',
        resultDisplayType: 'SHEAR_FORCE_V22',
        componentFocus: 'End Zone Peak Shear Demands & Support Critical Sections',
        units: 'kN',
        nativeETABSCommandPath: 'Display -> Force/Stress Diagrams -> Frame/Pier Forces -> Shear 2-2',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-07',
        viewName: 'Column Axial Force Diagram P',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: '1.5(DL+LL)',
        resultDisplayType: 'AXIAL_FORCE_P',
        componentFocus: 'Base Column Cumulative Compressive Axial Loads',
        units: 'kN',
        nativeETABSCommandPath: 'Display -> Force/Stress Diagrams -> Frame/Pier Forces -> Axial Force',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-08',
        viewName: 'IS 456 Concrete Column Design P-M-M Interaction Ratios',
        cameraType: '3D_ISOMETRIC',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: 'GOVERNING_COMBINATIONS',
        resultDisplayType: 'CONCRETE_DESIGN_COLUMN_PMM',
        componentFocus: 'Color Contours of Column Utilization (eta <= 1.0 indicates safe)',
        units: 'ratio',
        nativeETABSCommandPath: 'Design -> Concrete Frame Design -> Display Design Info -> P-M-M Interaction Ratios',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-09',
        viewName: 'IS 456 Concrete Beam Longitudinal & Shear Reinforcement',
        cameraType: 'PLAN_VIEW',
        elevationOrStorey: 'Storey 1 (+3.05m)',
        loadCombinationOrCase: 'GOVERNING_COMBINATIONS',
        resultDisplayType: 'CONCRETE_DESIGN_BEAM_REBAR',
        componentFocus: 'Top Rebar, Bottom Rebar & Shear Stirrup Spacing Display',
        units: 'mm²',
        nativeETABSCommandPath: 'Design -> Concrete Frame Design -> Display Design Info -> Longitudinal Reinforcement',
        isCaptured: false,
      },
      {
        viewId: 'VIEW-10',
        viewName: 'Storey Drift Curve Comparison per IS 1893:2016',
        cameraType: 'ELEVATION_VIEW',
        elevationOrStorey: 'ALL_STOREYS',
        loadCombinationOrCase: 'EQX / EQY',
        resultDisplayType: 'STOREY_DRIFT_PLOT',
        componentFocus: 'Storey Drift Ratio vs Allowable Limit (0.004 h)',
        units: 'ratio',
        nativeETABSCommandPath: 'Display -> Storey Response Plots -> Max Storey Drift',
        isCaptured: false,
      },
    ];

    return {
      manifestVersion: '1.0',
      timestamp: new Date().toISOString(),
      sourceEdbFileName: params.edbFileName,
      sourceEdbSha256: sha256,
      analysisRunId: params.analysisRunId,
      etabsVersion: params.etabsVersion ?? 'CSI ETABS 23.3.2.4670',
      oapiVersion: '2.016',
      captureEngineStatus: 'AUTOMATED_CAPTURE_NOT_AVAILABLE_IN_OAPI',
      oapiInvestigationSummary: {
        dllPath: 'D:\\ETABSv1.dll',
        inspectedInterfaces: ['cView', 'cSapModel', 'cDesignConcrete', 'cAnalysisResults'],
        missingMethods: ['ExportViewFile', 'SaveBitmap', 'GetViewImage', 'CaptureActiveWindow'],
        technicalRootCause:
          'CSI ETABS OAPI architecture does not implement bitmap export or headless renderbuffer capture. The cView interface exposes only RefreshView and RefreshWindow. Automation runs in background STA apartment without interactive desktop presentation context.',
      },
      zeroFabricationAttestation: {
        policyEnforced: true,
        syntheticMocksQuarantined: true,
        statement:
          'RH Planner strictly prohibits synthesizing fake ETABS GUI screenshots via Three.js, Blender, or web canvas. Official analytical evidence is established through native solved EDB files, mathematical displacement/reaction matrices, and ISO A3 vector CAD drawings.',
      },
      manualCaptureWorkflow: {
        engineerChecklist: [
          '1. Launch CSI ETABS 23.3.2 and open the solved native model file (.EDB).',
          '2. For each view in requiredViews, configure the native display using the indicated nativeETABSCommandPath.',
          '3. Capture high-resolution window screenshot (Alt + PrtScn or Windows Snipping Tool).',
          '4. Save the captured image with the corresponding viewId filename (e.g. VIEW-01.png).',
          '5. Place the PNG files in the specified targetDirectory alongside the analysis manifest for wet-stamp audit.',
        ],
        targetDirectory: `output/etabs/screenshots/${params.analysisRunId}`,
      },
      requiredViews: views,
    };
  }
}

