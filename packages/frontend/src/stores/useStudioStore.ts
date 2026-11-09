import { useSyncExternalStore } from 'react';
import type { AuthorityType, CongestionZone } from '@ai-floor-planner/core';
import type { PipelineStageProgressEvent } from '@ai-floor-planner/planning-engine';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';

export type ArgonWorkspaceId =
  | 'setup'
  | 'cad_2d'
  | 'isometric'
  | 'building_3d'
  | 'engineering'
  | 'export';

export type BhkType = '1BHK' | '2BHK' | '3BHK' | '4BHK';

export interface WizardState {
  authorityType?: AuthorityType | '';
  congestionZone?: CongestionZone | '';
  projectName: string;
  plotWidthM: number;
  plotDepthM: number;
  roadWidthM: number;
  roadFacing: 'North' | 'East' | 'South' | 'West';
  frontSetbackM: number;
  rearSetbackM: number;
  sideSetbackM: number;
  floorsCount: number;
  hasStiltParking: boolean;
  flatsPerFloor: 2 | 3 | 4;
  bhkCounts: Record<BhkType, number>;
  bhkCarpetAreas: Record<BhkType, number>;
  aiPrompt: string;
  referenceSketchName?: string;
  referenceImage?: { name: string; mimeType: string; dataUrl: string };
}

export interface StudioStoreState {
  currentStep: 1 | 2 | 3 | 4;
  wizard: WizardState;
  activeWorkspace: ArgonWorkspaceId;
  isGenerating: boolean;
  generationProgress: PipelineStageProgressEvent | null;
  generationError: string | null;
}

const DEFAULT_WIZARD_STATE: WizardState = {
  authorityType: '',
  congestionZone: '',
  projectName: 'ARGON Residence Towers',
  plotWidthM: 30,
  plotDepthM: 40,
  roadWidthM: 12,
  roadFacing: 'North',
  frontSetbackM: 3.0,
  rearSetbackM: 2.0,
  sideSetbackM: 2.0,
  floorsCount: 4,
  hasStiltParking: true,
  flatsPerFloor: 4,
  bhkCounts: {
    '1BHK': 0,
    '2BHK': 2,
    '3BHK': 2,
    '4BHK': 0,
  },
  bhkCarpetAreas: {
    '1BHK': 550,
    '2BHK': 850,
    '3BHK': 1250,
    '4BHK': 1800,
  },
  aiPrompt:
    'Modern multi-unit residential apartment with central elevator core, ventilated OTS shafts, private balconies for bedrooms, and Vastu-compliant kitchen placement.',
};

const STORAGE_KEY = 'argon_studio_store_wizard_v1';

function loadPersistedWizard(): WizardState {
  if (typeof window === 'undefined') return DEFAULT_WIZARD_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIZARD_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_WIZARD_STATE,
      ...parsed,
      bhkCounts: { ...DEFAULT_WIZARD_STATE.bhkCounts, ...(parsed.bhkCounts ?? {}) },
      bhkCarpetAreas: { ...DEFAULT_WIZARD_STATE.bhkCarpetAreas, ...(parsed.bhkCarpetAreas ?? {}) },
    };
  } catch {
    return DEFAULT_WIZARD_STATE;
  }
}

function savePersistedWizard(wizard: WizardState) {
  if (typeof window === 'undefined') return;
  try {
    // Avoid saving large base64 image strings into localStorage
    const toSave = { ...wizard, referenceImage: undefined };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or disabled
  }
}

// ─── Module-level Reactive Store ──────────────────────────────────────────────

let storeState: StudioStoreState = {
  currentStep: 1,
  wizard: loadPersistedWizard(),
  activeWorkspace: 'setup',
  isGenerating: false,
  generationProgress: null,
  generationError: null,
};

const listeners = new Set<() => void>();

function emitChange() {
  savePersistedWizard(storeState.wizard);
  for (const listener of listeners) {
    listener();
  }
}

export const studioStoreActions = {
  setStep(step: 1 | 2 | 3 | 4) {
    if (storeState.currentStep !== step) {
      storeState = { ...storeState, currentStep: step };
      emitChange();
    }
  },

  nextStep() {
    if (storeState.currentStep < 4) {
      storeState = { ...storeState, currentStep: (storeState.currentStep + 1) as 1 | 2 | 3 | 4 };
      emitChange();
    }
  },

  prevStep() {
    if (storeState.currentStep > 1) {
      storeState = { ...storeState, currentStep: (storeState.currentStep - 1) as 1 | 2 | 3 | 4 };
      emitChange();
    }
  },

  updateWizard(patch: Partial<WizardState>) {
    storeState = {
      ...storeState,
      wizard: { ...storeState.wizard, ...patch },
    };
    emitChange();
  },

  setFlatsPerFloor(flatsPerFloor: 2 | 3 | 4) {
    storeState = {
      ...storeState,
      wizard: { ...storeState.wizard, flatsPerFloor },
    };
    emitChange();
  },

  setBhkCount(type: BhkType, deltaOrValue: number, isDelta = false) {
    const current = storeState.wizard.bhkCounts[type] ?? 0;
    const nextVal = Math.max(0, isDelta ? current + deltaOrValue : deltaOrValue);
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        bhkCounts: {
          ...storeState.wizard.bhkCounts,
          [type]: nextVal,
        },
      },
    };
    emitChange();
  },

  setBhkCarpetArea(type: BhkType, sqFt: number) {
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        bhkCarpetAreas: {
          ...storeState.wizard.bhkCarpetAreas,
          [type]: Math.max(100, sqFt),
        },
      },
    };
    emitChange();
  },

  setActiveWorkspace(ws: ArgonWorkspaceId) {
    if (storeState.activeWorkspace !== ws) {
      storeState = { ...storeState, activeWorkspace: ws };
      emitChange();
    }
  },

  setIsGenerating(isGenerating: boolean) {
    storeState = { ...storeState, isGenerating };
    emitChange();
  },

  setGenerationProgress(generationProgress: PipelineStageProgressEvent | null) {
    storeState = { ...storeState, generationProgress };
    emitChange();
  },

  setGenerationError(generationError: string | null) {
    storeState = { ...storeState, generationError };
    emitChange();
  },

  resetWizard() {
    storeState = {
      ...storeState,
      currentStep: 1,
      wizard: DEFAULT_WIZARD_STATE,
      generationError: null,
      generationProgress: null,
    };
    emitChange();
  },

  getProjectSetupWizardData(): ProjectSetupWizardData {
    const { wizard } = storeState;
    const bhkMixArray: ProjectSetupWizardData['bhkMix'] = [];

    (['1BHK', '2BHK', '3BHK', '4BHK'] as const).forEach((type) => {
      const count = wizard.bhkCounts[type] ?? 0;
      if (count > 0) {
        bhkMixArray.push({
          unitType: type,
          carpetAreaSqFt: wizard.bhkCarpetAreas[type] ?? 850,
          count,
        });
      }
    });

    return {
      authorityType: wizard.authorityType || undefined,
      congestionZone: wizard.congestionZone || undefined,
      projectName: wizard.projectName,
      plotWidthM: wizard.plotWidthM,
      plotDepthM: wizard.plotDepthM,
      roadWidthM: wizard.roadWidthM,
      roadFacing: wizard.roadFacing,
      frontSetbackM: wizard.frontSetbackM,
      rearSetbackM: wizard.rearSetbackM,
      sideSetbackM: wizard.sideSetbackM,
      floorsCount: wizard.floorsCount,
      hasStiltParking: wizard.hasStiltParking,
      flatsPerFloor: wizard.flatsPerFloor,
      bhkMix: bhkMixArray,
      aiPrompt: wizard.aiPrompt,
      referenceSketchName: wizard.referenceSketchName,
      referenceImage: wizard.referenceImage,
    };
  },
};

// ─── Custom Hook: useStudioStore ──────────────────────────────────────────────

export function useStudioStore() {
  const state = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => storeState,
    () => storeState
  );

  const { wizard } = state;

  // Computed metrics
  const plotAreaM2 = Math.round(wizard.plotWidthM * wizard.plotDepthM * 100) / 100;
  const plotAreaSqFt = Math.round(plotAreaM2 * 10.7639);
  const buildableWidthM = Math.max(0, Math.round((wizard.plotWidthM - wizard.sideSetbackM * 2) * 10) / 10);
  const buildableDepthM = Math.max(0, Math.round((wizard.plotDepthM - wizard.frontSetbackM - wizard.rearSetbackM) * 10) / 10);
  const buildableFootprintM2 = Math.round(buildableWidthM * buildableDepthM * 100) / 100;
  const buildableFootprintSqFt = Math.round(buildableFootprintM2 * 10.7639);
  const groundCoveragePct = plotAreaM2 > 0 ? Math.round((buildableFootprintM2 / plotAreaM2) * 100) : 0;
  const estimatedBuildingHeightM = Math.round((wizard.floorsCount + (wizard.hasStiltParking ? 1 : 0)) * 3.15 * 10) / 10;
  const totalSelectedFlats = Object.values(wizard.bhkCounts).reduce((a, b) => a + b, 0);
  const isBhkMixValid = totalSelectedFlats === wizard.flatsPerFloor;
  const remainingFlatsToAssign = wizard.flatsPerFloor - totalSelectedFlats;

  return {
    ...state,
    ...studioStoreActions,
    // Computed values
    plotAreaM2,
    plotAreaSqFt,
    buildableWidthM,
    buildableDepthM,
    buildableFootprintM2,
    buildableFootprintSqFt,
    groundCoveragePct,
    estimatedBuildingHeightM,
    totalSelectedFlats,
    isBhkMixValid,
    remainingFlatsToAssign,
  };
}

