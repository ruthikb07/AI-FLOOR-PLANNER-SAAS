import { useSyncExternalStore } from 'react';
import type {
  AuthorityType,
  BuildingMassingShape,
  CongestionZone,
  GalleryCoordinationMode,
  ParametricShapeParams,
  PlanCategory,
} from '@ai-floor-planner/core';
import type { PipelineStageProgressEvent } from '@ai-floor-planner/planning-engine';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';
import {
  DEFAULT_REDEVELOPMENT_PROGRAM,
  evaluateRedevelopmentFeasibility,
  type OwnerRoomBrief,
  type ProjectDevelopmentType,
  type RedevelopmentFeasibilitySummary,
  type RedevelopmentProgramConfig,
} from '../services/redevelopment-feasibility';
import type { ReferenceWorkflowState } from '../services/reference-workflow';
import type { SurveyDraft } from '../services/survey-draft';

export type ArgonWorkspaceId =
  | 'setup'
  | 'cad_2d'
  | 'edit_plan'
  | 'isometric'
  | 'building_3d'
  | 'structural_cad'
  | 'engineering'
  | 'export';

export type BhkType = '1BHK' | '2BHK' | '3BHK' | '4BHK';

export interface WizardState {
  projectType?: ProjectDevelopmentType;
  authorityType?: AuthorityType | '';
  congestionZone?: CongestionZone | '';
  clearRoomHeightMm?: number;
  stiltClearHeightBelowBeamMm?: number;
  projectName: string;
  plotWidthM: number;
  plotDepthM: number;
  siteGeometryMode?: 'survey' | 'rectangle';
  surveyDraft?: SurveyDraft;
  roadWidthM: number;
  roadFacing: 'North' | 'East' | 'South' | 'West';
  frontSetbackM: number;
  rearSetbackM: number;
  sideSetbackM: number;
  floorsCount: number;
  hasStiltParking: boolean;
  duplexCount?: number;
  triplexCount?: number;
  flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  bhkCounts: Record<BhkType, number>;
  bhkCarpetAreas: Record<BhkType, number>;
  buildingMassingShape?: BuildingMassingShape | 'AUTO';
  planCategory?: PlanCategory;
  autoExploreNovelShape?: boolean;
  shapeParams?: ParametricShapeParams;
  usedShapeIds?: readonly string[];
  usedArchetypeIds?: readonly string[];
  includeWindowChajjas: boolean;
  staggeredBalconies: boolean;
  galleryCoordinationMode: GalleryCoordinationMode;
  includeDiningHall: boolean;
  includeStudyRoom: boolean;
  aiPrompt: string;
  referenceSketchName?: string;
  referenceImage?: { name: string; mimeType: string; dataUrl: string };
  referenceWorkflow?: ReferenceWorkflowState;
  redevelopment?: RedevelopmentProgramConfig;
}

export type StudioLightingMode = 'day' | 'golden' | 'night';
export type StudioDisplayUnit = 'ft' | 'm';

export interface StudioStoreState {
  currentStep: 1 | 2 | 3 | 4;
  wizard: WizardState;
  activeWorkspace: ArgonWorkspaceId;
  studioTheme: 'day' | 'night';
  lightingMode: StudioLightingMode;
  displayUnit: StudioDisplayUnit;
  isGenerating: boolean;
  generationProgress: PipelineStageProgressEvent | null;
  generationError: string | null;
}

const DEFAULT_WIZARD_STATE: WizardState = {
  projectType: 'new_construction',
  authorityType: '',
  congestionZone: '',
  projectName: 'Manu Residences Towers',
  plotWidthM: 30,
  plotDepthM: 40,
  roadWidthM: 12,
  roadFacing: 'North',
  frontSetbackM: 3.0,
  rearSetbackM: 2.0,
  sideSetbackM: 2.0,
  floorsCount: 4,
  hasStiltParking: true,
  duplexCount: 0,
  triplexCount: 0,
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
  buildingMassingShape: 'AUTO',
  planCategory: 'HIGH_RISE_APARTMENT',
  autoExploreNovelShape: false,
  usedShapeIds: [],
  usedArchetypeIds: [],
  includeWindowChajjas: true,
  staggeredBalconies: true,
  galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
  includeDiningHall: true,
  includeStudyRoom: false,
  aiPrompt:
    'Modern multi-unit residential apartment with central elevator core, ventilated OTS shafts, private balconies for bedrooms, and Vastu-compliant kitchen placement.',
  redevelopment: DEFAULT_REDEVELOPMENT_PROGRAM,
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
      redevelopment: {
        ...DEFAULT_REDEVELOPMENT_PROGRAM,
        ...(parsed.redevelopment ?? {}),
        ownerRoomBriefs: Array.isArray(parsed.redevelopment?.ownerRoomBriefs)
          ? parsed.redevelopment.ownerRoomBriefs
          : DEFAULT_REDEVELOPMENT_PROGRAM.ownerRoomBriefs,
      },
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
  studioTheme: 'night',
  lightingMode: 'golden',
  displayUnit: 'ft',
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

  setProjectType(projectType: ProjectDevelopmentType) {
    const nextRedevelopment = storeState.wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        projectType,
        redevelopment: nextRedevelopment,
        floorsCount:
          projectType === 'redevelopment'
            ? Math.max(storeState.wizard.floorsCount, nextRedevelopment.requiredStoreys)
            : storeState.wizard.floorsCount,
      },
    };
    emitChange();
  },

  updateRedevelopment(patch: Partial<RedevelopmentProgramConfig>) {
    const currentRedev = storeState.wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
    const nextRedev = { ...currentRedev, ...patch };
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        redevelopment: nextRedev,
        floorsCount:
          patch.requiredStoreys !== undefined
            ? Math.max(1, Math.min(12, patch.requiredStoreys))
            : storeState.wizard.floorsCount,
      },
    };
    emitChange();
  },

  addOwnerRoomBrief(brief?: Partial<OwnerRoomBrief>) {
    const currentRedev = storeState.wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
    const nextIndex = currentRedev.ownerRoomBriefs.length + 1;
    const nextBrief: OwnerRoomBrief = {
      id: `owner-${Date.now()}-${nextIndex}`,
      ownerLabel: brief?.ownerLabel ?? `Member ${100 + nextIndex}`,
      targetTypology: brief?.targetTypology ?? '3BHK',
      targetCarpetSqFt: brief?.targetCarpetSqFt ?? 1250,
      disposition: brief?.disposition ?? 'reallot_new_core',
      requiredRooms: brief?.requiredRooms ?? ['Living/Dining', 'Vastu Kitchen', 'Master En-suite'],
    };
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        redevelopment: {
          ...currentRedev,
          ownerRoomBriefs: [...currentRedev.ownerRoomBriefs, nextBrief],
        },
      },
    };
    emitChange();
  },

  updateOwnerRoomBrief(id: string, patch: Partial<OwnerRoomBrief>) {
    const currentRedev = storeState.wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        redevelopment: {
          ...currentRedev,
          ownerRoomBriefs: currentRedev.ownerRoomBriefs.map(item =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        },
      },
    };
    emitChange();
  },

  removeOwnerRoomBrief(id: string) {
    const currentRedev = storeState.wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        redevelopment: {
          ...currentRedev,
          ownerRoomBriefs: currentRedev.ownerRoomBriefs.filter(item => item.id !== id),
        },
      },
    };
    emitChange();
  },

  setReferenceWorkflow(referenceWorkflow: ReferenceWorkflowState | undefined) {
    storeState = {
      ...storeState,
      wizard: {
        ...storeState.wizard,
        referenceWorkflow,
      },
    };
    emitChange();
  },

  setStudioTheme(studioTheme: 'day' | 'night') {
    const lightingMode: StudioLightingMode = studioTheme === 'night' ? 'night' : 'day';
    if (storeState.studioTheme !== studioTheme || storeState.lightingMode !== lightingMode) {
      storeState = { ...storeState, studioTheme, lightingMode };
      emitChange();
    }
  },

  setLightingMode(lightingMode: StudioLightingMode) {
    const studioTheme: 'day' | 'night' = lightingMode === 'day' ? 'day' : 'night';
    if (storeState.lightingMode !== lightingMode || storeState.studioTheme !== studioTheme) {
      storeState = { ...storeState, lightingMode, studioTheme };
      emitChange();
    }
  },

  setDisplayUnit(displayUnit: StudioDisplayUnit) {
    if (storeState.displayUnit !== displayUnit) {
      storeState = { ...storeState, displayUnit };
      emitChange();
    }
  },

    setFlatsPerFloor(flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6) {
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

    recordGeneratedHistory(shapeId ?: string, archetypeId ?: string) {
      const prevShapes = storeState.wizard.usedShapeIds ?? [];
      const prevArchs = storeState.wizard.usedArchetypeIds ?? [];
      const nextShapes = shapeId && !prevShapes.includes(shapeId) ? [...prevShapes, shapeId] : prevShapes;
      const nextArchs = archetypeId && !prevArchs.includes(archetypeId) ? [...prevArchs, archetypeId] : prevArchs;
      storeState = {
        ...storeState,
        wizard: {
          ...storeState.wizard,
          usedShapeIds: nextShapes,
          usedArchetypeIds: nextArchs,
        },
      };
      emitChange();
    },

    clearGeneratedHistory() {
      storeState = {
        ...storeState,
        wizard: {
          ...storeState.wizard,
          usedShapeIds: [],
          usedArchetypeIds: [],
        },
      };
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
        projectType: wizard.projectType ?? 'new_construction',
        authorityType: wizard.authorityType || undefined,
        congestionZone: wizard.congestionZone || undefined,
        clearRoomHeightMm: wizard.clearRoomHeightMm,
        stiltClearHeightBelowBeamMm: wizard.hasStiltParking ? wizard.stiltClearHeightBelowBeamMm : undefined,
        projectName: wizard.projectName,
        plotWidthM: wizard.plotWidthM,
        plotDepthM: wizard.plotDepthM,
        siteGeometryMode: wizard.siteGeometryMode,
        roadWidthM: wizard.roadWidthM,
        roadFacing: wizard.roadFacing,
        frontSetbackM: wizard.frontSetbackM,
        rearSetbackM: wizard.rearSetbackM,
        sideSetbackM: wizard.sideSetbackM,
        floorsCount: wizard.floorsCount,
        hasStiltParking: wizard.hasStiltParking,
        duplexCount: wizard.duplexCount ?? 0,
        triplexCount: wizard.triplexCount ?? 0,
        flatsPerFloor: wizard.flatsPerFloor,
        bhkMix: bhkMixArray,
        buildingMassingShape: wizard.buildingMassingShape,
        planCategory: wizard.planCategory ?? 'HIGH_RISE_APARTMENT',
        autoExploreNovelShape: wizard.autoExploreNovelShape ?? false,
        shapeParams: wizard.shapeParams,
        usedShapeIds: wizard.usedShapeIds ?? [],
        usedArchetypeIds: wizard.usedArchetypeIds ?? [],
        includeWindowChajjas: wizard.includeWindowChajjas ?? true,
        galleryCoordinationMode: wizard.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER',
        staggeredBalconies: (wizard.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER') === 'DOUBLE_HEIGHT_STAGGER',
        includeDiningHall: wizard.includeDiningHall ?? true,
        includeStudyRoom: wizard.includeStudyRoom ?? false,
        aiPrompt: wizard.aiPrompt,
        referenceSketchName: wizard.referenceSketchName,
        referenceImage: wizard.referenceImage,
        referenceWorkflow: wizard.referenceWorkflow,
        redevelopment: wizard.projectType === 'redevelopment'
          ? (wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM)
          : undefined,
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

const redevelopmentFeasibility: RedevelopmentFeasibilitySummary | null =
  wizard.projectType === 'redevelopment' && wizard.siteGeometryMode !== 'survey'
    ? evaluateRedevelopmentFeasibility({
      plotWidthM: wizard.plotWidthM,
      plotDepthM: wizard.plotDepthM,
      frontSetbackM: wizard.frontSetbackM,
      rearSetbackM: wizard.rearSetbackM,
      sideSetbackM: wizard.sideSetbackM,
      floorsCount: wizard.floorsCount,
      hasStiltParking: wizard.hasStiltParking,
      duplexCount: wizard.duplexCount ?? 0,
      triplexCount: wizard.triplexCount ?? 0,
      redevelopment: wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM,
    })
    : null;

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
  redevelopmentFeasibility,
};
}
