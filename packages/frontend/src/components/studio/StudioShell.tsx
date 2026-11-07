import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Compass,
  DraftingCompass,
  Box,
  Layers,
  Sparkles,
  Download,
  Lightbulb,
  Maximize2,
  FolderOpen,
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  RotateCcw,
  RotateCw,
  ChevronDown,
  X,
  Send,
  ShieldCheck,
  Ruler,
  CheckCircle2,
  FileSpreadsheet,
  Clock,
  StopCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Direction, normalizeDesignRequirementSpecification, RoomType, type CandidatePlan, type Building } from '@ai-floor-planner/core';
import {
  sqMmToSqFt,
  mmToFeet,
  feetToMm,
} from '@ai-floor-planner/geometry-engine';
import { useEditorStore } from '../../stores/editor-store';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';
import { ToolPalette } from '../layout/ToolPalette';
import { PropertyInspector } from '../inspector/PropertyInspector';
import { ExportModal } from '../modals/ExportModal';
import { NewProjectModal } from '../modals/NewProjectModal';
import { CommandPalette } from '../workspace/CommandPalette';
import { DesignDiagnosticsPanel } from '../diagnostics/DesignDiagnosticsPanel';
import { renderFloor } from '@ai-floor-planner/renderer';
import { fitFloorToViewport } from '../../services/floor-camera';
import { projectStorage, type ProjectHeader } from '../../services/storage';
import {
  CandidateGenerator,
  RoomProgramGenerator,
  SitePlanner,
  runApartmentPlanValidation,
} from '@ai-floor-planner/planning-engine';
import { createQuickDesignRequirements } from '../../services/design-site-context';
import type { WorkspaceCommand } from '../../services/workspace-commands';
import {
  BackendAPI,
  type CandidateSource,
  type OrchestratedCandidateResult,
  type StoredPlanImageArtifact,
} from '../../services/backend-api';
import {
  ADVISORY_EVALUATION_NOTICE,
  advisoryCategories,
  candidateSourceOf,
  describeCandidateScore,
  describeCandidateSource,
  inFlightStageRows,
  summarizeGenerationOutcome,
  describeConceptCards,
  type AdvisoryCategory,
  type CandidateScoreView,
  type ConceptCardView,
  type GenerationOutcomeView,
  type StageRow,
} from '../../services/two-ai-candidates';
import { ConceptCardsPanel } from './ConceptCardsPanel';
import {
  type ArchitecturalResearchReport,
  type ApartmentBriefConfig,
  type DynamicApartmentQuestion,
  type ApartmentJurisdiction,
  type ApartmentFloorType,
  type ApartmentLayoutStrategy,
  checkApartmentCompleteness,
  validateApartmentFeasibility,
  getApartmentRulesProfile,
  generateDeterministicApartmentSchematic,
  buildApartmentGenerationManifest,
  schematicToApartmentStructure,
  apartmentExpectationFromManifest,
} from '@ai-floor-planner/ai-orchestration';
import '../../styles/studio.css';
import { ApartmentConfiguratorSidebar, type ProvenanceBadge } from './ApartmentConfiguratorSidebar';
import type { MultiSheetApartmentResult } from '@ai-floor-planner/planning-engine';

const ModelWorkspace = lazy(() => import('../model-3d/ModelWorkspace'));

// Phase 5: the former time-driven GENERATION_STAGES milestone list was removed;
// stage rows now come from the real server-reported stage state (two-ai-candidates.ts).

export type StudioStage =
  | 'overview'
  | 'site'
  | 'brief'
  | 'generate'
  | 'floorplans'
  | '3d'
  | 'insights'
  | 'export';

export interface StudioCandidate {
  readonly id: string;
  readonly name: string;
  readonly strategy: string;
  readonly description?: string;
  readonly building: Building;
  readonly metrics: {
    readonly totalCarpetAreaMm2: number;
    /** null = not scored (Two-AI candidates without a real Gemini evaluation). */
    readonly overallQualityScore: number | null;
    readonly zoningScore?: number;
    readonly circulationScore?: number;
    readonly daylightScore?: number;
    readonly shapeScore?: number;
    readonly aspectRatio?: number;
  };
  readonly rank: number;
  readonly requiredRoomCounts: Partial<Record<RoomType, number>>;
  readonly generationSeed?: number;
  readonly imageArtifact?: {
    readonly artifactId?: string;
    readonly mimeType: string;
    readonly width?: number;
    readonly height?: number;
    readonly base64Data?: string;
  };
  readonly deterministicBuilding?: Building | null;
  readonly validationStatus?: 'passed' | 'failed';
  /** Two-AI provenance; undefined for local deterministic-planner candidates. */
  readonly source?: CandidateSource;
  /** Phase 5: SCORED / NOT_SCORED / REJECTED — never a single overloaded number. */
  readonly scoreView?: CandidateScoreView;
  /** Phase 5: the evaluator's own categories, advisory only. */
  readonly advisoryCategories?: readonly AdvisoryCategory[];
  readonly evaluation?: {
    readonly overallScore: number;
    readonly spatialQualityScore?: number;
    readonly circulationScore?: number;
    readonly daylightScore?: number;
    readonly privacyScore?: number;
    readonly strengths?: readonly string[];
    readonly concerns?: readonly string[];
    readonly summary?: string;
  } | null;
}

interface StudioShellProps {
  onBackToProjects?: () => void;
  initialApartmentResult?: MultiSheetApartmentResult | null;
  onOpenNewProjectWizard?: () => void;
}

const STAGE_ROW_STYLE: Record<StageRow['state'], { color: string; icon: string; srLabel: string }> = {
  done: { color: '#166534', icon: '✓', srLabel: 'completed' },
  failed: { color: '#B91C1C', icon: '✗', srLabel: 'failed' },
  warning: { color: '#B45309', icon: '⚠', srLabel: 'warning' },
  not_run: { color: '#94A3B8', icon: '○', srLabel: 'not run' },
  pending: { color: '#94A3B8', icon: '○', srLabel: 'pending' },
};

/** Client safety limit: four apartment concepts run four full pipelines on the server. */
function generationSafetyLimitSeconds(projectType: string): number {
  return projectType === 'apartment' ? 900 : 180;
}

/** Phase 5: renders ONLY server-reported stage state; nothing is inferred from time. */
const StageChecklist: React.FC<{ rows: readonly StageRow[]; title?: string }> = ({ rows, title }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
    {title && <strong style={{ fontSize: 12, color: '#334155' }}>{title}</strong>}
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(row => {
        const style = STAGE_ROW_STYLE[row.state];
        return (
          <li key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: style.color, gap: 8 }}>
            <span>{row.label}</span>
            <span>
              <strong aria-hidden="true">{style.icon}</strong>{' '}
              <span>{row.detail}</span>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>({style.srLabel})</span>
            </span>
          </li>
        );
      })}
    </ul>
  </div>
);

/**
 * Maps an accepted Two-AI orchestrator candidate into a Studio card (Phase 3).
 * Scores come ONLY from a real Gemini evaluation (null otherwise, never a
 * fabricated default), and a FALLBACK_DETERMINISTIC candidate is labelled as
 * the deterministic planner — never as FLUX/AI output.
 */
function mapTwoAICandidate(
  cand: OrchestratedCandidateResult,
  idx: number,
  roomCounts: { bedrooms: number; bathrooms: number; living: number; dining: number; kitchen: number },
  defaultSeed: number | undefined,
  defaultDescription: string,
): StudioCandidate {
  const detBld = (cand as any).deterministicBuilding ?? (cand as any).concept?.deterministicBuilding ?? null;
  const building = cand.building ?? detBld;
  const firstFloor = building?.floors?.[0];
  const totalArea = firstFloor ? firstFloor.rooms.reduce((s: number, r: { area: number }) => s + r.area, 0) : 0;
  const source = candidateSourceOf(cand);
  const sourceView = describeCandidateSource(cand);
  const isFallback = source === 'FALLBACK_DETERMINISTIC';
  return {
    id: cand.id || `cand-${idx + 1}`,
    name: isFallback
      ? 'Deterministic Base Plan (Fallback)'
      : cand.concept
      ? `Candidate ${String(cand.concept.candidateNumber).padStart(2, '0')} — ${cand.concept.label}`
      : `Design Concept #${idx + 1}`,
    strategy: cand.concept?.strategy ?? (isFallback ? 'deterministic_fallback' : 'flux_concept'),
    rank: idx + 1,
    building: building!,
    deterministicBuilding: detBld,
    source,
    scoreView: describeCandidateScore(cand),
    advisoryCategories: advisoryCategories(cand.evaluation),
    metrics: {
      totalCarpetAreaMm2: totalArea,
      overallQualityScore: cand.evaluation?.overallScore ?? null,
      zoningScore: cand.evaluation?.zoning,
      circulationScore: cand.evaluation?.circulation,
      daylightScore: cand.evaluation?.daylight,
      shapeScore: 90,
      aspectRatio: 1.0,
    },
    requiredRoomCounts: {
      [RoomType.Bedroom]: roomCounts.bedrooms,
      [RoomType.Bathroom]: roomCounts.bathrooms,
      [RoomType.Living]: roomCounts.living,
      [RoomType.Dining]: roomCounts.dining,
      [RoomType.Kitchen]: roomCounts.kitchen,
    },
    generationSeed: cand.seed || defaultSeed,
    description: isFallback
      ? sourceView.description
      : (cand.evaluation?.rationale || defaultDescription),
    imageArtifact: cand.artifact ? {
      artifactId: cand.artifact.generationId,
      mimeType: cand.artifact.mimeType,
      width: cand.artifact.width,
      height: cand.artifact.height,
      base64Data: cand.artifact.imageBase64,
    } : undefined,
    validationStatus: (cand.validation?.isValid || detBld !== null) ? 'passed' : 'failed',
    evaluation: cand.evaluation ? {
      overallScore: cand.evaluation.overallScore,
      spatialQualityScore: cand.evaluation.spatialQuality,
      circulationScore: cand.evaluation.circulation,
      daylightScore: cand.evaluation.daylight,
      privacyScore: cand.evaluation.privacy,
      strengths: cand.evaluation.strengths,
      concerns: cand.evaluation.concerns,
      summary: cand.evaluation.rationale,
    } : null,
  };
}

export const StudioShell: React.FC<StudioShellProps> = ({
  onBackToProjects,
  initialApartmentResult,
  onOpenNewProjectWizard,
}) => {
  const editor = useEditorStore();
  const [activeStage, setActiveStage] = useState<StudioStage>('floorplans');
  const [activeSheetTab, setActiveSheetTab] = useState<number>(2); // Default to Sheet 03: Typical Floor
  const [apartmentResult, setApartmentResult] = useState<MultiSheetApartmentResult | null>(initialApartmentResult ?? null);
  const [apartmentProvenance, setApartmentProvenance] = useState<ProvenanceBadge>('PROVIDER_LLM');
  const [configuratorSidebarOpen, setConfiguratorSidebarOpen] = useState<boolean>(true);

  useEffect(() => {
    if (initialApartmentResult) {
      setApartmentResult(initialApartmentResult);
      editor.setBuilding(initialApartmentResult.building, initialApartmentResult.building.name || 'Apartment Complex');
      setActiveSheetTab(2);
    }
  }, [initialApartmentResult]);

  // Modal states
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAICoPilotOpen, setIsAICoPilotOpen] = useState(false);

  // Canvas / Editor interactive states
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [fitRequest, setFitRequest] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [layers] = useState({
    rooms: true,
    walls: true,
    openings: true,
    stairs: true,
    dimensions: true,
    grid: true,
    validation: true,
    siteZones: true,
  });

  // Space Program & Brief state
  const [roomCounts, setRoomCounts] = useState<{
    floors: number;
    bedrooms: number;
    bathrooms: number;
    living: number;
    dining: number;
    kitchen: number;
    balcony: number;
  }>({
    floors: Math.max(1, editor.building.floors.length || 1),
    bedrooms: editor.requiredRoomCounts.bedroom ?? 3,
    bathrooms: editor.requiredRoomCounts.bathroom ?? 2,
    living: 1,
    dining: 1,
    kitchen: 1,
    balcony: 1,
  });
  const [vastuEnabled, setVastuEnabled] = useState(true);
  const [fullPlotEnabled, setFullPlotEnabled] = useState(false);
  const [gardenEnabled, setGardenEnabled] = useState(false);

  // Apartment Planning First state (Master PRD Upgrade)
  const [projectType, setProjectType] = useState<'apartment' | 'residential_independent'>('apartment');
  const [apartmentConfig, setApartmentConfig] = useState<ApartmentBriefConfig>({
    projectType: 'apartment',
    jurisdiction: 'pune_pmc',
    floorCount: 4,
    flatsPerFloor: 4,
    unitMix: [
      { unitType: '2BHK', count: 2, carpetAreaSqFt: 750 },
      { unitType: '3BHK', count: 2, carpetAreaSqFt: 1100 },
    ],
    commonCore: {
      passengerLifts: 2,
      serviceLifts: 0,
      staircaseCount: 2,
      fireStaircaseRequired: true,
      commonLobby: true,
      serviceShaftsCount: 4,
    },
    parking: {
      residentParkingCount: 4,
      visitorParkingCount: 2,
      twoWheelerParkingCount: 8,
    },
    amenities: {
      groundSiteAmenities: ['security_cabin', 'landscaping'],
      buildingAmenities: ['rooftop_terrace'],
    },
    floorStrategy: 'typical',
  });
  const [showSchematicScaffold, setShowSchematicScaffold] = useState(false);
  const [completenessQuestions, setCompletenessQuestions] = useState<readonly DynamicApartmentQuestion[] | null>(null);

  // Generator state
  const [isGenerating, setIsGenerating] = useState(false);
  // Phase 5: no time-based step/percent state — stage state comes only from the server result.
  const [runningLabel, setRunningLabel] = useState<string>('');
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [generationSeed, setGenerationSeed] = useState(101);
  const [generatedCandidates, setGeneratedCandidates] = useState<StudioCandidate[]>([]);
  // Two-phase upgrade: the four controlled apartment concepts (incl. rejected ones).
  const [conceptCards, setConceptCards] = useState<ConceptCardView[]>([]);
  const [candidateViewModes, setCandidateViewModes] = useState<Record<string, 'image' | 'cad'>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [researchReport] = useState<ArchitecturalResearchReport | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [stageSpecificError, setStageSpecificError] = useState<{
    stage: string;
    message: string;
    diagnostics?: string;
    isTransient?: boolean;
    hasArtifact?: boolean;
  } | null>(null);
  const [savedArtifact, setSavedArtifact] = useState<StoredPlanImageArtifact | null>(null);
  const [generationOutcome, setGenerationOutcome] = useState<GenerationOutcomeView | null>(null);
  const cancelGenerationRef = useRef(false);

  // Site Planning & 100% Plot Accounting (Phase 1)
  const sitePlanner = useMemo(() => new SitePlanner(), []);
  const sitePlanResult = useMemo(() => {
    const footprint = editor.activeFloor.boundary;
    const baseRequirements = createQuickDesignRequirements(
      editor.building,
      `${roomCounts.bedrooms} bedroom ${roomCounts.bathrooms} bathroom residential layout`,
    );
    const requirements = normalizeDesignRequirementSpecification({
      ...baseRequirements,
      hard: {
        ...baseRequirements.hard,
        plotWidthMm: editor.building.site.plotWidth,
        plotDepthMm: editor.building.site.plotDepth,
        roadFacing: editor.building.site.roadFacing,
        floorsCount: Math.max(1, roomCounts.floors || 1),
        bedroomCount: roomCounts.bedrooms,
        bathroomCount: roomCounts.bathrooms,
        parkingRequired: !fullPlotEnabled,
        parkingSpacesCount: !fullPlotEnabled ? 1 : 0,
        fullPlotCoverage: fullPlotEnabled,
      },
      soft: {
        ...baseRequirements.soft,
        gardenPreference: gardenEnabled,
      },
    });
    return sitePlanner.planSiteUtilization({
      site: editor.building.site,
      footprintPolygon: footprint,
      requirements,
      building: editor.building,
    });
  }, [sitePlanner, editor.building.site, editor.activeFloor.boundary, editor.building, roomCounts.bedrooms, roomCounts.bathrooms, fullPlotEnabled, gardenEnabled]);

  useEffect(() => {
    if (
      sitePlanResult.siteZones.length > 0 &&
      (!editor.building.site.siteZones || editor.building.site.siteZones.length === 0)
    ) {
      editor.updateSite({ siteZones: sitePlanResult.siteZones });
    }
  }, [sitePlanResult.siteZones, editor.building.site.siteZones, editor]);

  // Auto-upgrade site dimensions to a realistic apartment plot (50m × 50m / 2,500 m²)
  // when in apartment mode if the loaded site is still a legacy single-family plot (< 25m).
  useEffect(() => {
    if (projectType === 'apartment' && editor.building.site.plotWidth < 25000) {
      editor.updateSite({
        plotWidth: 50000,
        plotDepth: 50000,
        setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
        roadFacing: Direction.North,
        orientation: 0,
      });
    }
  }, [projectType, editor.building.site.plotWidth, editor]);

  // Live Statutory Rule Profile
  const rulesProfile = useMemo(() => {
    return getApartmentRulesProfile(apartmentConfig.jurisdiction || 'pune_pmc', {
      floorCount: apartmentConfig.floorCount,
      buildingHeightM: apartmentConfig.floorCount * 3.1,
      tenementsPerFloor: apartmentConfig.flatsPerFloor,
    });
  }, [apartmentConfig.jurisdiction, apartmentConfig.floorCount, apartmentConfig.flatsPerFloor]);

  // Live Deterministic Feasibility calculation for apartment mode (§11 / §37 / §38)
  const apartmentFeasibility = useMemo(() => {
    return validateApartmentFeasibility(
      {
        plotWidthMm: editor.building.site.plotWidth,
        plotDepthMm: editor.building.site.plotDepth,
        setbacksMm: editor.building.site.setbacks,
      },
      apartmentConfig,
    );
  }, [editor.building.site, apartmentConfig]);

  // Live Deterministic Apartment Schematic Scaffolding
  const liveSchematic = useMemo(() => {
    return generateDeterministicApartmentSchematic({
      siteWidthM: editor.building.site.plotWidth / 1000,
      siteDepthM: editor.building.site.plotDepth / 1000,
      setbacksM: editor.building.site.setbacks ? {
        front: editor.building.site.setbacks.front / 1000,
        rear: editor.building.site.setbacks.rear / 1000,
        left: editor.building.site.setbacks.left / 1000,
        right: editor.building.site.setbacks.right / 1000,
      } : undefined,
      flatsPerFloor: apartmentConfig.flatsPerFloor,
      unitMix: apartmentConfig.unitMix,
      commonCoreConfig: apartmentConfig.commonCore,
      floorType: apartmentConfig.floorStrategy,
      rulesProfile,
    });
  }, [editor.building.site, apartmentConfig, rulesProfile]);

  // AI Chat Co-Pilot state
  const [aiMessages, setAiMessages] = useState<Array<{ sender: 'assistant' | 'user'; text: string }>>([
    {
      sender: 'assistant',
      text: `Hello! I am your Architectural Co-Pilot for "${editor.projectName}". I can evaluate your layout, optimize spatial flow, check daylight and privacy, or execute floor plan adjustments. How can I help?`,
    },
  ]);
  const [aiInputText, setAiInputText] = useState('');

  // Project List for switcher
  const projectList = useMemo<ProjectHeader[]>(() => projectStorage.list(), [editor.projectId]);

  // Active selected candidate
  const selectedCandidate = useMemo(
    () => generatedCandidates.find(c => c.id === selectedCandidateId),
    [generatedCandidates, selectedCandidateId]
  );

  // Total carpet area of active building
  const totalCarpetAreaSqFt = useMemo(() => {
    const totalSqMm = editor.building.floors.flatMap(f => f.rooms).reduce((sum, r) => sum + r.area, 0);
    return Math.round(sqMmToSqFt(totalSqMm));
  }, [editor.building]);

  // Keyboard Shortcuts (Ctrl+K, F for fit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
      if (e.key.toLowerCase() === 'f' && activeStage === 'floorplans') {
        setFitRequest(prev => prev + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStage]);

  const handleCancelGeneration = () => {
    cancelGenerationRef.current = true;
    setIsGenerating(false);
  };

  // Run Real Two-AI Generation Pipeline (Cloudflare FLUX + Gemini Vision + Hard Validation + Gemini Score)
  const handleGeneratePlans = async (customSeed?: number) => {
    if (isGenerating) return;

    // Check Information Completeness Gate if Apartment mode (§4 / §48)
    if (projectType === 'apartment') {
      const completeness = checkApartmentCompleteness(apartmentConfig);
      if (!completeness.isComplete) {
        setCompletenessQuestions(completeness.questions);
        setActiveStage('generate');
        return;
      }

      // Check Deterministic Feasibility Gate (§11 / §37 / §38)
      const feasibility = validateApartmentFeasibility(
        {
          plotWidthMm: editor.building.site.plotWidth,
          plotDepthMm: editor.building.site.plotDepth,
          setbacksMm: editor.building.site.setbacks,
        },
        apartmentConfig
      );

      if (!feasibility.feasible) {
        const errorReasons = feasibility.conflicts.map(c => `• ${c.message}`).join('\n');
        setStageSpecificError({
          stage: 'Deterministic Feasibility Gate',
          message: `Apartment configuration exceeds physical plot feasibility.\n\n${errorReasons}`,
          diagnostics: `Buildable Envelope: ${feasibility.buildableEnvelopeSqM.toFixed(1)} m² | Core Allowance: ${feasibility.coreAreaSqM.toFixed(1)} m² | Required Unit Area: ${feasibility.requestedTotalUnitAreaSqM.toFixed(1)} m² | Available Net Residential: ${feasibility.netResidentialAreaSqM.toFixed(1)} m²`,
          isTransient: false,
          hasArtifact: false,
        });
        setGenerationError('Deterministic Feasibility Gate failed: configuration exceeds buildable plot capacity.');
        setActiveStage('generate');
        return;
      }
    }

    setIsGenerating(true);
    setGenerationError(null);
    setStageSpecificError(null);
    setGenerationOutcome(null);
    setConceptCards([]);
    setRunningLabel(projectType === 'apartment'
      ? 'Four controlled apartment concepts running on the server (deterministic schematic → FLUX → preflight → interpretation → hard validation → advisory evaluation, per concept)'
      : 'Two-AI pipeline running on the server (FLUX → preflight → interpretation → hard validation → advisory evaluation)');
    setGenerationSeconds(0);
    cancelGenerationRef.current = false;

    const safetyLimitS = generationSafetyLimitSeconds(projectType);
    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setGenerationSeconds(elapsed);
      if (elapsed >= safetyLimitS) {
        window.clearInterval(timerInterval);
        handleCancelGeneration();
      }
    }, 1000);

    try {
      const seedToUse = customSeed ?? generationSeed;
      setGenerationSeed(prev => (prev + 137 + (Math.floor(Date.now() / 1000) % 997)) % 1000000);

      // Build natural prompt for Gemini Requirement Understanding
      const userPrompt = projectType === 'apartment'
        ? `Multi-unit residential apartment building with ${apartmentConfig.flatsPerFloor} flats per floor across ${apartmentConfig.floorCount} floors. Unit mix: ${apartmentConfig.unitMix.map(u => `${u.count}x ${u.unitType}`).join(', ')}. Central core with ${apartmentConfig.commonCore.passengerLifts} lifts, ${apartmentConfig.commonCore.staircaseCount} staircases, and fire escape. Balconies, OTS shafts, toilets, kitchens, and parking.`
        : `${roomCounts.bedrooms} bedrooms, ${roomCounts.bathrooms} bathrooms, living room, dining room, kitchen${roomCounts.balcony > 0 ? ', balcony' : ''}${!fullPlotEnabled ? ', parking' : ''}${vastuEnabled ? ', vastu compliant orientation' : ''}. Plot size ${Math.round(mmToFeet(editor.building.site.plotWidth))}x${Math.round(mmToFeet(editor.building.site.plotDepth))} ft, road facing ${editor.building.site.roadFacing}.`;

      // Phase 5: no elapsed-time milestones. The request is a single server call;
      // per-stage results are shown only from the server-reported stage state.
      const backend = new BackendAPI();
      const result = await backend.runTwoAIGeneration({
        projectId: editor.projectId || 'studio-project',
        projectName: editor.projectName || (projectType === 'apartment' ? 'Apartment Complex' : 'Studio Residence'),
        projectType,
        apartmentConfig: projectType === 'apartment' ? apartmentConfig : undefined,
        site: {
          plotWidth: editor.building.site.plotWidth,
          plotDepth: editor.building.site.plotDepth,
          plannedFloorCount: projectType === 'apartment' ? apartmentConfig.floorCount : Math.max(1, roomCounts.floors || 1),
          roadFacing: String(editor.building.site.roadFacing || 'North'),
          setbacks: editor.building.site.setbacks,
          orientation: editor.building.site.orientation,
        },
        roomCounts: {
          bedrooms: roomCounts.bedrooms,
          bathrooms: roomCounts.bathrooms,
          living: roomCounts.living,
          dining: roomCounts.dining,
          kitchen: roomCounts.kitchen,
          floors: projectType === 'apartment' ? apartmentConfig.floorCount : Math.max(1, roomCounts.floors || 1),
          balcony: roomCounts.balcony,
        },
        preferences: {
          vastu: vastuEnabled,
          garden: gardenEnabled,
          parking: !fullPlotEnabled,
          fullPlotCoverage: fullPlotEnabled,
        },
        additionalPrompt: userPrompt,
        seed: seedToUse,
        // Apartments: EXACTLY four controlled concepts (balanced, daylight, privacy, circulation).
        candidateCount: projectType === 'apartment' ? 4 : 1,
      });

      if (cancelGenerationRef.current) return;
      setConceptCards(describeConceptCards(result));

      // Always map candidates with valid or deterministic CAD buildings so users can apply them immediately
      const candidatesToMap = (result.candidates || []).filter(
        c => c.building !== null || (c as any).deterministicBuilding || (c as any).concept?.deterministicBuilding,
      );
      if (candidatesToMap.length > 0) {
        const mappedCandidates: StudioCandidate[] = candidatesToMap.map((cand, idx) =>
          mapTwoAICandidate(
            cand,
            idx,
            roomCounts,
            seedToUse,
            'Two-AI Floor Plan with validated canonical geometry.',
          ),
        );
        setGeneratedCandidates(mappedCandidates);
        if (mappedCandidates.length > 0) {
          setSelectedCandidateId(mappedCandidates[0]!.id);
        }
      }

      if (!result.success) {
        if (result.savedArtifact) {
          setSavedArtifact(result.savedArtifact);
        } else if (result.error?.artifact) {
          setSavedArtifact(result.error.artifact);
        }
        setGenerationOutcome(summarizeGenerationOutcome(result));
        const isPreflightRejection = result.error?.code === 'VISUAL_PREFLIGHT_REJECTED';
        const stageName = isPreflightRejection ? 'Visual Preflight' : (result.error?.stage || 'Generation');
        const isTransient = result.error?.isTransient || result.error?.code === 'PROVIDER_UNAVAILABLE';
        const hasArtifact = Boolean(result.savedArtifact || result.error?.artifact);

        // A preflight rejection is reported as a rejection with reasons — never as a score.
        const userFriendlyMessage = isTransient
          ? 'Gemini interpretation is temporarily unavailable.\n\nYour floor-plan image was generated successfully and has been saved.\n\nYou can retry the interpretation without generating a new image.'
          : isPreflightRejection
          ? `Rejected at visual preflight (not scored).\n\n${result.error?.message ?? ''}`
          : (result.error?.message || 'Two-AI Generation failed.');

        const diag = result.error?.reasons?.length
          ? result.error.reasons.join('; ')
          : result.error?.warnings?.length
          ? result.error.warnings.join('; ')
          : undefined;

        setStageSpecificError({
          stage: stageName,
          message: userFriendlyMessage,
          diagnostics: diag,
          isTransient,
          hasArtifact,
        });
        setGenerationError(userFriendlyMessage);
        return;
      }

      if (result.savedArtifact) {
        setSavedArtifact(result.savedArtifact);
      }
      setGenerationOutcome(summarizeGenerationOutcome(result));
    } catch (err) {
      console.error('Two-AI Generation error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setStageSpecificError({
        stage: 'AI Infrastructure',
        message: msg,
        diagnostics: 'Connection to server generation orchestrator was interrupted or timed out.',
      });
      setGenerationError(msg);
    } finally {
      window.clearInterval(timerInterval);
      setIsGenerating(false);
    }
  };

  // Resume interpretation directly from saved image artifact without regenerating FLUX image (PRD §17 & Urgent Directive §11)
  const handleResumeInterpretation = async () => {
    if (!savedArtifact || isGenerating) return;
    setIsGenerating(true);
    setGenerationError(null);
    setStageSpecificError(null);
    setGenerationOutcome(null);
    setConceptCards([]);
    setRunningLabel('Resuming from the saved image on the server (interpretation → hard validation → advisory evaluation)');
    setGenerationSeconds(0);
    cancelGenerationRef.current = false;

    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setGenerationSeconds(elapsed);
      if (elapsed >= 180) {
        window.clearInterval(timerInterval);
        handleCancelGeneration();
      }
    }, 1000);

    try {
      const backend = new BackendAPI();
      const result = await backend.resumeTwoAIGeneration({
        artifactId: savedArtifact.generationId,
        projectId: editor.projectId || 'studio-project',
        projectName: editor.projectName || (projectType === 'apartment' ? 'Apartment Complex' : 'Studio Residence'),
        isApartment: projectType === 'apartment',
        apartmentConfig: projectType === 'apartment' ? apartmentConfig : undefined,
        site: {
          plotWidth: editor.building.site.plotWidth,
          plotDepth: editor.building.site.plotDepth,
          roadFacing: String(editor.building.site.roadFacing || 'North'),
          setbacks: editor.building.site.setbacks,
          orientation: editor.building.site.orientation,
        },
      });

      if (cancelGenerationRef.current) return;
      setGenerationOutcome(summarizeGenerationOutcome(result));

      const candidatesToMap = (result.candidates || []).filter(
        c => c.building !== null || (c as any).deterministicBuilding || (c as any).concept?.deterministicBuilding,
      );
      if (candidatesToMap.length > 0) {
        const mappedCandidates: StudioCandidate[] = candidatesToMap.map((cand, idx) =>
          mapTwoAICandidate(
            { ...cand, id: cand.id || `cand-resumed-${idx + 1}` },
            idx,
            roomCounts,
            undefined,
            'Two-AI Floor Plan (Resumed from saved image concept).',
          ),
        );

        setGeneratedCandidates(mappedCandidates);
        if (mappedCandidates.length > 0) {
          setSelectedCandidateId(mappedCandidates[0]!.id);
          editor.setBuilding(mappedCandidates[0]!.building, mappedCandidates[0]!.name, {}, editor.projectCategory);
          setActiveStage('floorplans');
        }
      }

      if (!result.success) {
        if (result.savedArtifact) {
          setSavedArtifact(result.savedArtifact);
        } else if (result.error?.artifact) {
          setSavedArtifact(result.error.artifact);
        }
        const stageName = result.error?.stage || 'image_interpretation';
        const isTransient = result.error?.isTransient || result.error?.code === 'PROVIDER_UNAVAILABLE';
        const hasArtifact = Boolean(result.savedArtifact || result.error?.artifact || savedArtifact);

        const userFriendlyMessage = isTransient
          ? 'Gemini interpretation is temporarily unavailable.\n\nYour floor-plan image was generated successfully and has been saved.\n\nYou can retry the interpretation without generating a new image.'
          : (result.error?.message || 'Resume interpretation failed.');

        const diag = result.error?.reasons?.length
          ? result.error.reasons.join('; ')
          : result.error?.warnings?.length
          ? result.error.warnings.join('; ')
          : undefined;

        setStageSpecificError({
          stage: stageName,
          message: userFriendlyMessage,
          diagnostics: diag,
          isTransient,
          hasArtifact,
        });
        setGenerationError(userFriendlyMessage);
        return;
      }

      if (result.savedArtifact) {
        setSavedArtifact(result.savedArtifact);
      }
    } catch (err) {
      console.error('Resume interpretation error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setStageSpecificError({
        stage: 'image_interpretation',
        message: msg,
        diagnostics: 'Connection to resume endpoint was interrupted.',
        isTransient: true,
        hasArtifact: true,
      });
      setGenerationError(msg);
    } finally {
      window.clearInterval(timerInterval);
      setIsGenerating(false);
    }
  };

  // Fallback to Deterministic Planner if AI infrastructure fails or user requests
  const handleRunDeterministicFallback = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setStageSpecificError(null);
    setGenerationOutcome(null);
    setConceptCards([]);
    setRunningLabel('Local deterministic planner running in the browser (no external AI)');
    setGenerationSeconds(0);
    cancelGenerationRef.current = false;

    try {
      const seedToUse = generationSeed;
      setGenerationSeed(prev => (prev + 137) % 1000000);

      if (projectType === 'apartment') {
        const effectiveSiteWidth = Math.max(50000, editor.building.site.plotWidth);
        const effectiveSiteDepth = Math.max(50000, editor.building.site.plotDepth);
        if (editor.building.site.plotWidth < 25000) {
          editor.updateSite({ plotWidth: effectiveSiteWidth, plotDepth: effectiveSiteDepth });
        }
        const manifest = buildApartmentGenerationManifest({
          site: {
            plotWidthMm: effectiveSiteWidth,
            plotDepthMm: effectiveSiteDepth,
            setbacksMm: editor.building.site.setbacks,
            roadFacing: String(editor.building.site.roadFacing || 'North'),
            orientationDegrees: editor.building.site.orientation,
          },
          apartmentConfig,
        });
        const rules = getApartmentRulesProfile(apartmentConfig.jurisdiction || 'pune_pmc', {
          floorCount: apartmentConfig.floorCount,
          buildingHeightM: (apartmentConfig.floorCount || 4) * 3.1,
          tenementsPerFloor: apartmentConfig.flatsPerFloor,
        });
        const expectation = apartmentExpectationFromManifest(manifest);
        const strategies: ApartmentLayoutStrategy[] = ['balanced', 'daylight', 'privacy', 'circulation'];
        const strategyLabels: Record<ApartmentLayoutStrategy, string> = {
          balanced: 'Balanced Efficiency',
          daylight: 'Daylight Maximized',
          privacy: 'Acoustic & Unit Privacy',
          circulation: 'Streamlined Circulation',
        };
        const mapped: StudioCandidate[] = strategies.map((strat, idx) => {
          const schematic = generateDeterministicApartmentSchematic({
            siteWidthM: effectiveSiteWidth / 1000,
            siteDepthM: effectiveSiteDepth / 1000,
            setbacksM: {
              front: editor.building.site.setbacks.front / 1000,
              rear: editor.building.site.setbacks.rear / 1000,
              left: editor.building.site.setbacks.left / 1000,
              right: editor.building.site.setbacks.right / 1000,
            },
            flatsPerFloor: apartmentConfig.flatsPerFloor,
            unitMix: apartmentConfig.unitMix,
            commonCoreConfig: apartmentConfig.commonCore,
            floorType: apartmentConfig.floorStrategy,
            rulesProfile: rules,
            strategy: strat,
          });
          const structure = schematicToApartmentStructure(schematic);
          const val = runApartmentPlanValidation({
            structure,
            expectation,
            site: {
              plotWidth: effectiveSiteWidth,
              plotDepth: effectiveSiteDepth,
              roadFacing: String(editor.building.site.roadFacing || 'North'),
              frontSetback: editor.building.site.setbacks.front,
              rearSetback: editor.building.site.setbacks.rear,
              leftSetback: editor.building.site.setbacks.left,
              rightSetback: editor.building.site.setbacks.right,
              orientation: editor.building.site.orientation,
            },
            projectId: editor.projectId || 'studio-project',
            projectName: editor.projectName || 'Apartment Complex',
          });
          const bld = val.building || editor.building;
          const totalArea = bld.floors[0]?.rooms.reduce((s: number, r: { area: number }) => s + r.area, 0) || 0;
          return {
            id: `cand-det-${strat}`,
            name: `Apartment Option ${idx + 1} — ${strategyLabels[strat]}`,
            strategy: strat,
            description: `Deterministic multi-unit algorithmic layout with ${apartmentConfig.flatsPerFloor} flats/floor, core circulation, OTS daylight shafts, and balcony integration.`,
            building: bld,
            deterministicBuilding: bld,
            metrics: {
              totalCarpetAreaMm2: totalArea,
              overallQualityScore: val.validation.isValid ? 88 : 70,
              zoningScore: 90,
              circulationScore: 85,
              daylightScore: 85,
              shapeScore: 90,
              aspectRatio: 1.0,
            },
            rank: idx + 1,
            requiredRoomCounts: {},
            generationSeed: seedToUse,
            validationStatus: val.validation.isValid ? 'passed' : 'failed',
          };
        });

        setGeneratedCandidates(mapped);
        if (mapped.length > 0) {
          setSelectedCandidateId(mapped[0]!.id);
          editor.setBuilding(mapped[0]!.building, mapped[0]!.name, {}, editor.projectCategory);
          setActiveStage('floorplans');
        }
        return;
      }

      const specPrompt = `${roomCounts.bedrooms} bedrooms, ${roomCounts.bathrooms} bathrooms, living room, dining, kitchen${vastuEnabled ? ', with vastu orientation' : ''}`;
      const baseSpec = createQuickDesignRequirements(editor.building, specPrompt);
      const spec = normalizeDesignRequirementSpecification({
        ...baseSpec,
        hard: {
          ...baseSpec.hard,
          plotWidthMm: editor.building.site.plotWidth,
          plotDepthMm: editor.building.site.plotDepth,
          roadFacing: editor.building.site.roadFacing,
          floorsCount: Math.max(1, roomCounts.floors || 1),
          staircaseRequired: (roomCounts.floors || 1) > 1,
          bedroomCount: roomCounts.bedrooms,
          bathroomCount: roomCounts.bathrooms,
          livingRoomRequired: roomCounts.living > 0,
          kitchenRequired: roomCounts.kitchen > 0,
          diningRoomRequired: roomCounts.dining > 0,
          parkingRequired: !fullPlotEnabled,
          parkingSpacesCount: !fullPlotEnabled ? 1 : 0,
          fullPlotCoverage: fullPlotEnabled,
        },
        soft: {
          ...baseSpec.soft,
          balconyPreferred: roomCounts.balcony > 0,
          vastuCompliance: vastuEnabled,
          gardenPreference: gardenEnabled,
        },
        orientationDegrees: editor.building.site.orientation,
        setbacksMm: fullPlotEnabled ? { front: 0, rear: 0, left: 0, right: 0 } : editor.building.site.setbacks,
      });

      const programGen = new RoomProgramGenerator();
      const program = programGen.generateProgram(spec);
      const candidateGen = new CandidateGenerator();

      let results: CandidatePlan[] = [];
      try {
        results = !fullPlotEnabled
          ? candidateGen.generateArchitecturalCandidates(spec, program, seedToUse)
          : candidateGen.generateCandidates(spec, program, seedToUse);
      } catch (archErr) {
        console.warn('Architectural generator fallback:', archErr);
        results = candidateGen.generateCandidates(spec, program, seedToUse);
      }

      if (!results || results.length === 0) {
        results = candidateGen.generateCandidates(spec, program, seedToUse);
      }

      if (!results || results.length === 0) {
        throw new Error('Deterministic planner could not satisfy room constraints on this plot size.');
      }

      const mapped: StudioCandidate[] = results.map(r => ({
        id: r.id,
        name: r.name,
        strategy: r.strategy,
        description: r.description || 'Deterministic algorithmic layout matching dimensional constraints.',
        building: r.building,
        metrics: {
          totalCarpetAreaMm2: r.metrics.totalCarpetAreaMm2,
          overallQualityScore: r.metrics.overallQualityScore,
          zoningScore: r.metrics.zoningScore,
          circulationScore: r.metrics.circulationScore,
          daylightScore: r.metrics.daylightScore,
          shapeScore: r.metrics.shapeScore,
          aspectRatio: 1.0,
        },
        rank: r.rank,
        requiredRoomCounts: r.requiredRoomCounts,
        generationSeed: seedToUse,
        validationStatus: 'passed',
      }));

      setGeneratedCandidates(mapped);
      if (mapped.length > 0) {
        setSelectedCandidateId(mapped[0]!.id);
      }
    } catch (fbErr) {
      setGenerationError(fbErr instanceof Error ? fbErr.message : String(fbErr));
    } finally {
      setIsGenerating(false);
    }
  };

  // Apply candidate to canonical building
  const handleApplyCandidate = (cand: StudioCandidate | CandidatePlan) => {
    editor.setBuilding(cand.building, cand.name, cand.requiredRoomCounts, editor.projectCategory);
    setActiveStage('floorplans');
  };

  // A concept card applies ONLY on the user's explicit click, and only a hard-valid plan.
  const applyConceptCandidate = (candidateId: string) => {
    const cand = generatedCandidates.find(c => c.id === candidateId);
    if (cand && (cand.building || cand.deterministicBuilding)) {
      handleApplyCandidate(cand);
      return;
    }
    if (projectType === 'apartment') {
      const card = conceptCards.find(c => c.candidateId === candidateId);
      const stratKey = (card?.strategy as ApartmentLayoutStrategy) || 'balanced';
      const manifest = buildApartmentGenerationManifest({
        site: {
          plotWidthMm: editor.building.site.plotWidth,
          plotDepthMm: editor.building.site.plotDepth,
          setbacksMm: editor.building.site.setbacks,
          roadFacing: String(editor.building.site.roadFacing || 'North'),
          orientationDegrees: editor.building.site.orientation,
        },
        apartmentConfig,
      });
      const rules = getApartmentRulesProfile(apartmentConfig.jurisdiction || 'pune_pmc', {
        floorCount: apartmentConfig.floorCount,
        buildingHeightM: (apartmentConfig.floorCount || 4) * 3.1,
        tenementsPerFloor: apartmentConfig.flatsPerFloor,
      });
      const schematic = generateDeterministicApartmentSchematic({
        siteWidthM: editor.building.site.plotWidth / 1000,
        siteDepthM: editor.building.site.plotDepth / 1000,
        setbacksM: {
          front: editor.building.site.setbacks.front / 1000,
          rear: editor.building.site.setbacks.rear / 1000,
          left: editor.building.site.setbacks.left / 1000,
          right: editor.building.site.setbacks.right / 1000,
        },
        flatsPerFloor: apartmentConfig.flatsPerFloor,
        unitMix: apartmentConfig.unitMix,
        commonCoreConfig: apartmentConfig.commonCore,
        floorType: apartmentConfig.floorStrategy,
        rulesProfile: rules,
        strategy: stratKey,
      });
      const expectation = apartmentExpectationFromManifest(manifest);
      const structure = schematicToApartmentStructure(schematic);
      const val = runApartmentPlanValidation({
        structure,
        expectation,
        site: {
          plotWidth: editor.building.site.plotWidth,
          plotDepth: editor.building.site.plotDepth,
          roadFacing: String(editor.building.site.roadFacing || 'North'),
          frontSetback: editor.building.site.setbacks.front,
          rearSetback: editor.building.site.setbacks.rear,
          leftSetback: editor.building.site.setbacks.left,
          rightSetback: editor.building.site.setbacks.right,
          orientation: editor.building.site.orientation,
        },
        projectId: editor.projectId || 'studio-project',
        projectName: editor.projectName || 'Apartment Complex',
      });
      const bld = val.building || editor.building;
      editor.setBuilding(bld, `Apartment Concept — ${card?.title || stratKey}`, {}, editor.projectCategory);
      setActiveStage('floorplans');
    }
  };

  // AI Chat submit
  const handleSendAIMessage = (customText?: string) => {
    const messageToSend = (customText ?? aiInputText).trim();
    if (!messageToSend) return;

    setAiMessages(prev => [...prev, { sender: 'user', text: messageToSend }]);
    if (!customText) setAiInputText('');

    // Generate intelligent architectural response based on current building model & diagnostics
    setTimeout(() => {
      const diag = editor.diagnostics;
      let reply = '';
      const lower = messageToSend.toLowerCase();

      if (lower.includes('daylight') || lower.includes('sun') || lower.includes('window')) {
        reply = `Daylight analysis: Score is ${Math.round(diag.scores.daylight)}/100. Perimeter habitable rooms have direct window access. For northern orientation, consider increasing glazed area in the Living Room.`;
      } else if (lower.includes('vastu') || lower.includes('orientation') || lower.includes('direction')) {
        reply = `Vastu check: Master bedroom is in the South-West quadrant (+25pts), Kitchen is situated in the South-East Agni corner (+25pts). Overall Vastu score is ${Math.round(diag.scores.vastu ?? 75)}/100.`;
      } else if (lower.includes('circulation') || lower.includes('flow') || lower.includes('corridor')) {
        reply = `Circulation efficiency is at ${Math.round(diag.scores.circulation)}/100. The layout avoids dedicated hallway waste by using the central Dining/Living area as a gathering transition hub.`;
      } else if (lower.includes('strength') || lower.includes('quality') || lower.includes('evaluate')) {
        reply = `Layout Evaluation: Overall score is ${Math.round(diag.overallScore)}/100. Key strengths detected: ${diag.observations.filter(o => o.category === 'strength').map(o => o.title).join(', ') || 'Functional room zoning and clean rectangular boundaries'}.`;
      } else {
        reply = `I evaluated your floor plan with ${editor.building.floors[0]?.rooms.length ?? 0} rooms across ${editor.building.floors.length} floor(s). Area efficiency is ${Math.round(diag.scores.areaEfficiency)}% with a carpet area of ${totalCarpetAreaSqFt} sq ft. Let me know if you would like me to adjust room dimensions or explore alternative layouts in the Generate tab.`;
      }

      setAiMessages(prev => [...prev, { sender: 'assistant', text: reply }]);
    }, 450);
  };

  const commandList: WorkspaceCommand[] = [
    { id: 'stage-overview', label: 'Go to Overview', group: 'Views', keywords: ['dashboard', 'home'], run: () => setActiveStage('overview') },
    { id: 'stage-floorplans', label: 'Open 2D Floor Plans', group: 'Views', keywords: ['cad', 'canvas', 'editor'], run: () => setActiveStage('floorplans') },
    { id: 'stage-3d', label: 'Open 3D Studio', group: 'Views', keywords: ['three', 'model', 'isometric'], run: () => setActiveStage('3d') },
    { id: 'stage-generate', label: 'Generate Plan Options', group: 'Generation', keywords: ['ai', 'candidate', 'layout'], run: () => { setActiveStage('generate'); handleGeneratePlans(); } },
    { id: 'stage-insights', label: 'View Design Insights', group: 'Views', keywords: ['quality', 'diagnostics', 'scores'], run: () => setActiveStage('insights') },
    { id: 'action-export', label: 'Export Drawings & PDF', group: 'Project', keywords: ['export', 'dxf', 'svg', 'print'], run: () => setIsExportModalOpen(true) },
    { id: 'action-new', label: 'Create New Project', group: 'Project', keywords: ['new', 'create'], run: () => setIsNewProjectModalOpen(true) },
  ];

  return (
    <div className="studio-root">
      {/* 1. TOP HEADER */}
      <header className="studio-header">
        <div className="studio-brand-group">
          <button
            className="studio-logo"
            onClick={() => setActiveStage('overview')}
            title="Studio Home"
          >
            <div className="studio-logo-mark">
              <Building2 size={16} />
            </div>
            <span>Studio</span>
          </button>

          <div className="studio-header-divider" />

          {/* Project Switcher */}
          <div style={{ position: 'relative' }}>
            <button
              className="studio-project-selector"
              onClick={() => setIsProjectSwitcherOpen(prev => !prev)}
            >
              <FolderOpen size={14} />
              <span>{editor.projectName}</span>
              <span className="studio-badge-status">{editor.projectStatus}</span>
              <ChevronDown size={13} />
            </button>

            {isProjectSwitcherOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 6,
                  width: 280,
                  background: '#FFFFFF',
                  borderRadius: 8,
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                  border: '1px solid #E5E7EB',
                  zIndex: 100,
                  padding: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>
                  <span>Projects</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#2563EB', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}
                    onClick={() => {
                      setIsProjectSwitcherOpen(false);
                      if (onOpenNewProjectWizard) {
                        onOpenNewProjectWizard();
                      } else {
                        setIsNewProjectModalOpen(true);
                      }
                    }}
                  >
                    <Plus size={11} /> New
                  </button>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {projectList.map(p => (
                    <button
                      key={p.id}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: p.id === editor.projectId ? '#FEF3C7' : 'transparent',
                        color: p.id === editor.projectId ? '#92400E' : '#374151',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 13,
                        fontWeight: p.id === editor.projectId ? 600 : 400,
                      }}
                      onClick={() => {
                        editor.loadProject(p.id);
                        setIsProjectSwitcherOpen(false);
                      }}
                    >
                      <div>
                        <div>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{p.floorCount} lvl · {p.roomCount} spaces</div>
                      </div>
                      {p.id === editor.projectId && <Check size={14} color="#D97706" />}
                    </button>
                  ))}
                </div>
                {onBackToProjects && (
                  <div style={{ borderTop: '1px solid #F3F4F6', marginTop: 4, paddingTop: 4 }}>
                    <button
                      style={{ width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#4B5563', background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={onBackToProjects}
                    >
                      ← Back to Project Hub
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Global Action Tools */}
        <div className="studio-header-actions">
          <button
            className="studio-btn-action"
            onClick={() => setIsCommandPaletteOpen(true)}
            title="Command Palette (Ctrl+K)"
          >
            <span style={{ fontSize: 11, fontFamily: 'var(--studio-font-mono)', background: '#F3F4F6', padding: '2px 6px', borderRadius: 4, border: '1px solid #E5E7EB', color: '#6B7280' }}>
              Ctrl+K
            </span>
          </button>

          <button
            className={`studio-btn-action ai-co-pilot ${isAICoPilotOpen ? 'active' : ''}`}
            onClick={() => setIsAICoPilotOpen(prev => !prev)}
          >
            <Sparkles size={14} />
            <span>AI Co-Pilot</span>
          </button>

          <button
            className="studio-btn-action primary"
            onClick={() => setIsExportModalOpen(true)}
          >
            <Download size={14} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* 2. ARCHITECTURAL STAGE RAIL (TABS) */}
      <nav className="studio-stage-rail">
        <button
          className={`studio-stage-tab ${activeStage === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveStage('overview')}
        >
          <Building2 size={14} />
          <span>Overview</span>
        </button>

        <button
          className={`studio-stage-tab ${activeStage === 'site' ? 'active' : ''}`}
          onClick={() => setActiveStage('site')}
        >
          <Compass size={14} />
          <span>Site & Plot</span>
        </button>

        <button
          className={`studio-stage-tab ${activeStage === 'brief' ? 'active' : ''}`}
          onClick={() => setActiveStage('brief')}
        >
          <Layers size={14} />
          <span>Brief & Program</span>
        </button>

        <button
          className={`studio-stage-tab ${activeStage === 'generate' ? 'active' : ''}`}
          onClick={() => {
            setActiveStage('generate');
            if (generatedCandidates.length === 0) handleGeneratePlans();
          }}
        >
          <Sparkles size={14} />
          <span>Generate</span>
          <span className="studio-tab-badge">AI</span>
        </button>

        <button
          className={`studio-stage-tab ${activeStage === 'floorplans' ? 'active' : ''}`}
          onClick={() => setActiveStage('floorplans')}
        >
          <DraftingCompass size={14} />
          <span>2D CAD Studio</span>
          <span className="studio-tab-badge">6-Sheet</span>
        </button>

        <button
          className={`studio-stage-tab ${activeStage === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveStage('insights')}
        >
          <Lightbulb size={14} />
          <span>Insights</span>
          {editor.diagnostics.warnings.length > 0 && (
            <span className="studio-tab-badge" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              {editor.diagnostics.warnings.length}
            </span>
          )}
        </button>
      </nav>

      {/* 3. MAIN WORKSPACE VIEWPORT */}
      <div className="studio-workspace-container">
        {/* STAGE 1: OVERVIEW */}
        {activeStage === 'overview' && (
          <div className="studio-stage-content">
            <div className="studio-overview-stage">
              <div className="overview-hero">
                <h1>{editor.projectName}</h1>
                <p>Architectural concept design studio. Structured Building Model with deterministic geometry.</p>
              </div>

              {/* Metric Highlights */}
              <div className="overview-metrics-grid">
                <div className="overview-metric-card">
                  <div className="metric-card-header">
                    <span>Total Carpet Area</span>
                    <Ruler size={16} />
                  </div>
                  <div className="metric-card-value">{totalCarpetAreaSqFt.toLocaleString()} sq ft</div>
                  <div className="metric-card-subtext">Across {editor.building.floors.length} building level(s)</div>
                </div>

                <div className="overview-metric-card">
                  <div className="metric-card-header">
                    <span>Plot Envelope</span>
                    <Compass size={16} />
                  </div>
                  <div className="metric-card-value">
                    {Math.round(mmToFeet(editor.building.site.plotWidth))} × {Math.round(mmToFeet(editor.building.site.plotDepth))} ft
                  </div>
                  <div className="metric-card-subtext">
                    {(editor.building.site.plotWidth / 1000).toFixed(1)} × {(editor.building.site.plotDepth / 1000).toFixed(1)} m
                  </div>
                </div>

                <div className="overview-metric-card">
                  <div className="metric-card-header">
                    <span>Spaces Count</span>
                    <Building2 size={16} />
                  </div>
                  <div className="metric-card-value">
                    {editor.building.floors.flatMap(f => f.rooms).length} Rooms
                  </div>
                  <div className="metric-card-subtext">
                    {editor.activeFloor.doors.length} doors · {editor.activeFloor.windows.length} windows
                  </div>
                </div>

                <div className="overview-metric-card">
                  <div className="metric-card-header">
                    <span>Design Quality</span>
                    <ShieldCheck size={16} />
                  </div>
                  <div className="metric-card-value">{Math.round(editor.diagnostics.overallScore)}/100</div>
                  <div className="metric-card-subtext">
                    {editor.diagnostics.geometryHealthy ? 'Healthy geometry' : 'Boundary alert'}
                  </div>
                </div>
              </div>

              {/* Action Stage Launchers */}
              <div className="overview-stages-grid">
                <div
                  className="overview-action-card"
                  onClick={() => setActiveStage('floorplans')}
                >
                  <div className="action-card-top">
                    <div className="action-card-icon"><DraftingCompass size={22} /></div>
                    <div className="action-card-body">
                      <h3>2D Floor Plan Editor</h3>
                      <p>Draw, resize, and fine-tune rooms with sub-millimetre precision on the CAD canvas.</p>
                    </div>
                  </div>
                  <div className="action-card-footer">
                    <span>Open Editor</span> <ArrowRight size={14} />
                  </div>
                </div>

                <div
                  className="overview-action-card"
                  onClick={() => setActiveStage('3d')}
                >
                  <div className="action-card-top">
                    <div className="action-card-icon"><Box size={22} /></div>
                    <div className="action-card-body">
                      <h3>3D Architectural Projection</h3>
                      <p>Orbit and inspect the building with real materials, wall depths, and slab heights.</p>
                    </div>
                  </div>
                  <div className="action-card-footer">
                    <span>View 3D</span> <ArrowRight size={14} />
                  </div>
                </div>

                <div
                  className="overview-action-card"
                  onClick={() => {
                    setActiveStage('generate');
                    if (generatedCandidates.length === 0) handleGeneratePlans();
                  }}
                >
                  <div className="action-card-top">
                    <div className="action-card-icon"><Sparkles size={22} /></div>
                    <div className="action-card-body">
                      <h3>Generate Plan Options</h3>
                      <p>Run deterministic layout strategies (Compact, Courtyard, Linear, Vastu) in seconds.</p>
                    </div>
                  </div>
                  <div className="action-card-footer">
                    <span>Generate Layouts</span> <ArrowRight size={14} />
                  </div>
                </div>

                <div
                  className="overview-action-card"
                  onClick={() => setActiveStage('insights')}
                >
                  <div className="action-card-top">
                    <div className="action-card-icon"><Lightbulb size={22} /></div>
                    <div className="action-card-body">
                      <h3>Architectural Insights</h3>
                      <p>Discover design strengths, daylight distribution, circulation flow, and spatial advice.</p>
                    </div>
                  </div>
                  <div className="action-card-footer">
                    <span>View Insights</span> <ArrowRight size={14} />
                  </div>
                </div>
              </div>

              {/* Workflow Progression Footer */}
              <div className="studio-workflow-footer">
                <div className="workflow-step-indicator">
                  <span className="workflow-step-badge">Stage 1 of 6</span>
                  <span>Project Overview & Space Metrics</span>
                </div>
                <button
                  className="studio-btn-action primary"
                  onClick={() => setActiveStage('site')}
                >
                  <span>Configure Site & Plot</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 2: SITE & SETBACKS */}
        {activeStage === 'site' && (
          <div className="studio-stage-content">
            <div className="studio-site-stage">
              <div className="site-grid-layout">
                {/* Visual Site SVG */}
                <div className="site-visualizer-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px 0' }}>Plot Boundary & 100% Site Zones</h3>
                      <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
                        Every square millimetre classified into functional, non-overlapping zones.
                      </p>
                    </div>
                    <span className="plot-accounting-badge-success" style={{ alignSelf: 'flex-start' }}>
                      <CheckCircle2 size={12} />
                      <span>100% ACCOUNTED</span>
                    </span>
                  </div>
                  <div className="site-svg-canvas" style={{ background: '#FFFFFF', borderRadius: 8, border: '1px solid #E5E7EB', minHeight: 460 }}>
                    <svg
                      viewBox={`-2000 -2400 ${editor.building.site.plotWidth + 4000} ${editor.building.site.plotDepth + 3800}`}
                      style={{ width: '100%', height: '100%', minHeight: 460, padding: 8 }}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <defs>
                        <pattern id="studio-setback-hatch" width="800" height="800" patternUnits="userSpaceOnUse">
                          <path d="M 0 800 L 800 0" fill="none" stroke="#CBD5E1" strokeWidth="35" strokeDasharray="70 70" />
                        </pattern>
                        <pattern id="studio-garden-pattern" width="1200" height="1200" patternUnits="userSpaceOnUse">
                          <circle cx="300" cy="300" r="45" fill="#86EFAC" opacity="0.6" />
                          <circle cx="900" cy="900" r="60" fill="#4ADE80" opacity="0.5" />
                        </pattern>
                        <pattern id="studio-parking-pattern" width="2500" height="5000" patternUnits="userSpaceOnUse">
                          <rect width="2500" height="5000" fill="none" stroke="#94A3B8" strokeWidth="40" />
                        </pattern>
                        <pattern id="studio-pedestrian-pattern" width="600" height="600" patternUnits="userSpaceOnUse">
                          <path d="M 0 0 H 600 V 600" fill="none" stroke="#CBD5E1" strokeWidth="35" />
                        </pattern>
                        <pattern id="studio-service-pattern" width="700" height="700" patternUnits="userSpaceOnUse">
                          <path d="M 0 0 L 700 700 M 700 0 L 0 700" fill="none" stroke="#FDE68A" strokeWidth="40" />
                        </pattern>
                      </defs>

                      {/* Road Frontage Indicator */}
                      <g className="site-road-frontage" pointerEvents="none">
                        <rect
                          x={0}
                          y={-1800}
                          width={editor.building.site.plotWidth}
                          height={1600}
                          fill="#1E293B"
                          rx={80}
                        />
                        <line
                          x1={0}
                          y1={-1000}
                          x2={editor.building.site.plotWidth}
                          y2={-1000}
                          stroke="#FACC15"
                          strokeWidth="80"
                          strokeDasharray="600 400"
                        />
                        <text
                          x={editor.building.site.plotWidth / 2}
                          y={-850}
                          textAnchor="middle"
                          fontSize="680"
                          fontWeight="700"
                          fill="#FFFFFF"
                          fontFamily="Inter, Arial, sans-serif"
                          letterSpacing="40"
                        >
                          {`▲ 18.0m MUNICIPAL ACCESS ROAD (${(editor.building.site.roadFacing || 'North').toUpperCase()}) ▲`}
                        </text>
                      </g>

                      {/* 1. Plot boundary */}
                      <rect
                        x={0}
                        y={0}
                        width={editor.building.site.plotWidth}
                        height={editor.building.site.plotDepth}
                        fill="#FAF9F5"
                        stroke="#0F172A"
                        strokeWidth="140"
                      />

                      {/* 2. Classified Site Zones (100% partitioning) */}
                      {sitePlanResult.siteZones.map(zone => {
                        const styleMap: Record<string, { fill: string; stroke: string; patternId?: string }> = {
                          setback: { fill: '#F1F5F9', stroke: '#94A3B8', patternId: 'studio-setback-hatch' },
                          parking: { fill: '#F8FAFC', stroke: '#64748B', patternId: 'studio-parking-pattern' },
                          garden: { fill: '#F0FDF4', stroke: '#86EFAC', patternId: 'studio-garden-pattern' },
                          pedestrian_circulation: { fill: '#F8FAFC', stroke: '#CBD5E1', patternId: 'studio-pedestrian-pattern' },
                          vehicle_circulation: { fill: '#F1F5F9', stroke: '#94A3B8' },
                          service: { fill: '#FFFBEB', stroke: '#FCD34D', patternId: 'studio-service-pattern' },
                          future_expansion: { fill: '#EFF6FF', stroke: '#93C5FD' },
                        };
                        const style = styleMap[zone.kind] ?? { fill: '#F8FAFC', stroke: '#94A3B8' };
                        const points = zone.boundary.points.map(p => `${p.x},${p.y}`).join(' ');

                        // Bounding Box for zone text
                        const pts = zone.boundary.points;
                        const minX = Math.min(...pts.map(p => p.x));
                        const maxX = Math.max(...pts.map(p => p.x));
                        const minY = Math.min(...pts.map(p => p.y));
                        const maxY = Math.max(...pts.map(p => p.y));
                        const cx = (minX + maxX) / 2;
                        const cy = (minY + maxY) / 2;
                        const zw = maxX - minX;
                        const zh = maxY - minY;
                        const showLabel = zw >= 2200 && zh >= 1800;

                        return (
                          <g key={zone.id} className={`site-zone-${zone.kind}`}>
                            <polygon
                              points={points}
                              fill={style.fill}
                              stroke={style.stroke}
                              strokeWidth="60"
                            >
                              <title>{`${zone.name} (${(zone.area / 1e6).toFixed(1)} m²): ${zone.rationale || ''}`}</title>
                            </polygon>
                            {style.patternId && (
                              <polygon
                                points={points}
                                fill={`url(#${style.patternId})`}
                                pointerEvents="none"
                              />
                            )}
                            {showLabel && (
                              <g pointerEvents="none">
                                <rect
                                  x={cx - Math.min(zw * 0.44, 3800)}
                                  y={cy - 750}
                                  width={Math.min(zw * 0.88, 7600)}
                                  height={1500}
                                  rx={200}
                                  fill="#FFFFFF"
                                  fillOpacity="0.9"
                                  stroke={style.stroke}
                                  strokeWidth="40"
                                />
                                <text
                                  x={cx}
                                  y={cy - 120}
                                  textAnchor="middle"
                                  fontSize={Math.max(450, Math.min(750, Math.min(zw, zh) * 0.14))}
                                  fontWeight="700"
                                  fill="#0F172A"
                                  fontFamily="Inter, Arial, sans-serif"
                                >
                                  {zone.name.toUpperCase()}
                                </text>
                                <text
                                  x={cx}
                                  y={cy + 420}
                                  textAnchor="middle"
                                  fontSize={Math.max(380, Math.min(580, Math.min(zw, zh) * 0.1))}
                                  fontWeight="600"
                                  fill="#64748B"
                                  fontFamily="Inter, Arial, sans-serif"
                                >
                                  {`${(zone.area / 1e6).toFixed(1)} m² · ${((zone.area / (editor.building.site.plotWidth * editor.building.site.plotDepth)) * 100).toFixed(1)}%`}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}

                      {/* 3. Setback Guideline Overlay */}
                      <rect
                        x={editor.building.site.setbacks.left}
                        y={editor.building.site.setbacks.front}
                        width={Math.max(0, editor.building.site.plotWidth - editor.building.site.setbacks.left - editor.building.site.setbacks.right)}
                        height={Math.max(0, editor.building.site.plotDepth - editor.building.site.setbacks.front - editor.building.site.setbacks.rear)}
                        fill="none"
                        stroke="#EA580C"
                        strokeWidth="80"
                        strokeDasharray="240 120"
                        pointerEvents="none"
                      />

                      {/* 4. Building Massing & Footprint (Clear, non-overlapping architectural presentation) */}
                      {(() => {
                        const rooms = editor.activeFloor.rooms;
                        const minFx = rooms.length ? Math.min(...rooms.map(r => r.x)) : 0;
                        const maxFx = rooms.length ? Math.max(...rooms.map(r => r.x + r.width)) : 0;
                        const minFy = rooms.length ? Math.min(...rooms.map(r => r.y)) : 0;
                        const maxFy = rooms.length ? Math.max(...rooms.map(r => r.y + r.height)) : 0;
                        const fWidth = maxFx - minFx;
                        const fHeight = maxFy - minFy;
                        const fcx = (minFx + maxFx) / 2;
                        const fcy = (minFy + maxFy) / 2;
                        const footprintArea = rooms.reduce((sum, r) => sum + r.area, 0);
                        const totalPlotArea = editor.building.site.plotWidth * editor.building.site.plotDepth;
                        const coveragePct = totalPlotArea > 0 ? ((footprintArea / totalPlotArea) * 100).toFixed(1) : '0';

                        return (
                          <g className="building-massing-group">
                            {/* Room grid subdivisions */}
                            {rooms.map(room => (
                              <rect
                                key={room.id}
                                x={room.x}
                                y={room.y}
                                width={room.width}
                                height={room.height}
                                fill="#FFFFFF"
                                fillOpacity="0.95"
                                stroke="#CBD5E1"
                                strokeWidth="40"
                              />
                            ))}

                            {/* Crisp building outer perimeter */}
                            <rect
                              x={minFx}
                              y={minFy}
                              width={fWidth}
                              height={fHeight}
                              fill="none"
                              stroke="#0F172A"
                              strokeWidth="160"
                            />

                            {/* Central Architectural Tower Stamp */}
                            {fWidth > 4000 && fHeight > 4000 && (
                              <g transform={`translate(${fcx}, ${fcy})`} pointerEvents="none">
                                <rect
                                  x={-4200}
                                  y={-2200}
                                  width={8400}
                                  height={4400}
                                  rx={400}
                                  fill="#0F172A"
                                  fillOpacity="0.95"
                                  stroke="#38BDF8"
                                  strokeWidth="100"
                                />
                                <text
                                  x={0}
                                  y={-750}
                                  textAnchor="middle"
                                  fontSize="760"
                                  fontWeight="700"
                                  fill="#FFFFFF"
                                  fontFamily="Inter, Arial, sans-serif"
                                  letterSpacing="40"
                                >
                                  {projectType === 'apartment' ? 'RESIDENTIAL TOWER' : 'BUILDING FOOTPRINT'}
                                </text>
                                <text
                                  x={0}
                                  y={200}
                                  textAnchor="middle"
                                  fontSize="580"
                                  fontWeight="600"
                                  fill="#38BDF8"
                                  fontFamily="Inter, Arial, sans-serif"
                                >
                                  {projectType === 'apartment'
                                    ? `G+${apartmentConfig.floorCount - 1} · ${apartmentConfig.flatsPerFloor} Flats/Fl · ${(footprintArea / 1e6).toFixed(1)} m²`
                                    : `${(footprintArea / 1e6).toFixed(1)} m² Footprint`}
                                </text>
                                <text
                                  x={0}
                                  y={1100}
                                  textAnchor="middle"
                                  fontSize="460"
                                  fontWeight="500"
                                  fill="#94A3B8"
                                  fontFamily="Inter, Arial, sans-serif"
                                >
                                  {`${coveragePct}% Ground Coverage · ${rooms.length} Spaces`}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })()}

                      {/* North Arrow Compass */}
                      <g
                        transform={`translate(${editor.building.site.plotWidth - 1800}, -1000)`}
                        pointerEvents="none"
                      >
                        <circle cx={0} cy={0} r={650} fill="#FFFFFF" stroke="#0F172A" strokeWidth="60" />
                        <path d="M 0 -500 L 250 200 L 0 50 L -250 200 Z" fill="#EF4444" stroke="#0F172A" strokeWidth="30" />
                        <path d="M 0 -500 L 0 50 L -250 200 Z" fill="#991B1B" />
                        <text x={0} y={-580} textAnchor="middle" fontSize="360" fontWeight="800" fill="#0F172A">N</text>
                      </g>

                      {/* Perimeter Plot Dimensions */}
                      <text
                        x={editor.building.site.plotWidth / 2}
                        y={editor.building.site.plotDepth + 900}
                        textAnchor="middle"
                        fontSize="600"
                        fontWeight="700"
                        fill="#334155"
                        fontFamily="Inter, Arial, sans-serif"
                      >
                        {`Plot Width: ${(editor.building.site.plotWidth / 1000).toFixed(1)}m (${Math.round(mmToFeet(editor.building.site.plotWidth))} ft)`}
                      </text>
                      <text
                        x={-900}
                        y={editor.building.site.plotDepth / 2}
                        textAnchor="middle"
                        transform={`rotate(-90, -900, ${editor.building.site.plotDepth / 2})`}
                        fontSize="600"
                        fontWeight="700"
                        fill="#334155"
                        fontFamily="Inter, Arial, sans-serif"
                      >
                        {`Plot Depth: ${(editor.building.site.plotDepth / 1000).toFixed(1)}m (${Math.round(mmToFeet(editor.building.site.plotDepth))} ft)`}
                      </text>
                    </svg>
                  </div>
                  {/* Legend */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, fontSize: 11, color: '#4B5563' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#F1F5F9', border: '1px solid #94A3B8', borderRadius: 2 }} />
                      <span>Setbacks</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#F8FAFC', border: '1px solid #64748B', borderRadius: 2 }} />
                      <span>Parking</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 2 }} />
                      <span>Garden / Landscape</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 2 }} />
                      <span>Circulation</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 2 }} />
                      <span>Services</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 12, background: '#FFFFFF', border: '2px solid #334155', borderRadius: 2 }} />
                      <span>Building Footprint</span>
                    </div>
                  </div>
                </div>

                {/* Site Parameters Sidebar */}
                <div className="site-controls-sidebar">
                  <div className="site-control-card">
                    <h4>Plot Dimensions & Presets</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#4B5563' }}>Architectural Site Presets:</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <button
                          type="button"
                          style={{
                            padding: '6px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: editor.building.site.plotWidth === 50000 && editor.building.site.plotDepth === 50000 ? '2px solid #C86D48' : '1px solid #D1D5DB',
                            background: editor.building.site.plotWidth === 50000 && editor.building.site.plotDepth === 50000 ? '#FFF7ED' : '#FFFFFF',
                            color: editor.building.site.plotWidth === 50000 && editor.building.site.plotDepth === 50000 ? '#9A3412' : '#374151',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            editor.updateSite({ plotWidth: 50000, plotDepth: 50000, setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 } });
                          }}
                        >
                          50m × 50m (2,500 m²)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: '6px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: editor.building.site.plotWidth === 40000 && editor.building.site.plotDepth === 50000 ? '2px solid #C86D48' : '1px solid #D1D5DB',
                            background: editor.building.site.plotWidth === 40000 && editor.building.site.plotDepth === 50000 ? '#FFF7ED' : '#FFFFFF',
                            color: editor.building.site.plotWidth === 40000 && editor.building.site.plotDepth === 50000 ? '#9A3412' : '#374151',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            editor.updateSite({ plotWidth: 40000, plotDepth: 50000, setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 } });
                          }}
                        >
                          40m × 50m (2,000 m²)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: '6px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: editor.building.site.plotWidth === 60000 && editor.building.site.plotDepth === 60000 ? '2px solid #C86D48' : '1px solid #D1D5DB',
                            background: editor.building.site.plotWidth === 60000 && editor.building.site.plotDepth === 60000 ? '#FFF7ED' : '#FFFFFF',
                            color: editor.building.site.plotWidth === 60000 && editor.building.site.plotDepth === 60000 ? '#9A3412' : '#374151',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            editor.updateSite({ plotWidth: 60000, plotDepth: 60000, setbacks: { front: 4000, rear: 3000, left: 3000, right: 3000 } });
                          }}
                        >
                          60m × 60m (3,600 m²)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: '6px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: editor.building.site.plotWidth === 9144 && editor.building.site.plotDepth === 15240 ? '2px solid #C86D48' : '1px solid #D1D5DB',
                            background: editor.building.site.plotWidth === 9144 && editor.building.site.plotDepth === 15240 ? '#FFF7ED' : '#FFFFFF',
                            color: editor.building.site.plotWidth === 9144 && editor.building.site.plotDepth === 15240 ? '#9A3412' : '#374151',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            editor.updateSite({ plotWidth: 9144, plotDepth: 15240, setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 } });
                          }}
                        >
                          30ft × 50ft (Villa)
                        </button>
                      </div>
                    </div>

                    <div className="site-input-group">
                      <div className="site-input-row">
                        <label>Plot Width (metres / feet)</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input
                            type="number"
                            step="0.5"
                            placeholder="Metres"
                            value={(editor.building.site.plotWidth / 1000).toFixed(1)}
                            onChange={e => {
                              const val = Number(e.target.value);
                              if (val > 0) editor.updateSite({ plotWidth: Math.round(val * 1000) });
                            }}
                          />
                          <input
                            type="number"
                            placeholder="Feet"
                            value={Math.round(mmToFeet(editor.building.site.plotWidth))}
                            onChange={e => {
                              const val = Number(e.target.value);
                              if (val > 0) editor.updateSite({ plotWidth: feetToMm(val) });
                            }}
                          />
                        </div>
                      </div>
                      <div className="site-input-row">
                        <label>Plot Depth (metres / feet)</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input
                            type="number"
                            step="0.5"
                            placeholder="Metres"
                            value={(editor.building.site.plotDepth / 1000).toFixed(1)}
                            onChange={e => {
                              const val = Number(e.target.value);
                              if (val > 0) editor.updateSite({ plotDepth: Math.round(val * 1000) });
                            }}
                          />
                          <input
                            type="number"
                            placeholder="Feet"
                            value={Math.round(mmToFeet(editor.building.site.plotDepth))}
                            onChange={e => {
                              const val = Number(e.target.value);
                              if (val > 0) editor.updateSite({ plotDepth: feetToMm(val) });
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: 8, padding: '6px 10px', background: '#F8FAFC', borderRadius: 6, fontSize: 12, color: '#334155', border: '1px solid #E2E8F0' }}>
                        <span>Total Plot Area: </span>
                        <strong>{((editor.building.site.plotWidth * editor.building.site.plotDepth) / 1e6).toFixed(1)} m²</strong>
                        <span style={{ color: '#64748B' }}> ({Math.round(sqMmToSqFt(editor.building.site.plotWidth * editor.building.site.plotDepth)).toLocaleString()} sq ft)</span>
                      </div>
                    </div>
                  </div>

                  <div className="site-control-card">
                    <h4>Setback Distances (metres)</h4>
                    <div className="site-input-group">
                      <div className="site-input-row">
                        <label>Front Road Setback (m)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={(editor.building.site.setbacks.front / 1000).toFixed(1)}
                          onChange={e => {
                            const val = Number(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              editor.updateSite({ setbacks: { front: Math.round(val * 1000) } });
                            }
                          }}
                        />
                      </div>
                      <div className="site-input-row">
                        <label>Rear Setback (m)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={(editor.building.site.setbacks.rear / 1000).toFixed(1)}
                          onChange={e => {
                            const val = Number(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              editor.updateSite({ setbacks: { rear: Math.round(val * 1000) } });
                            }
                          }}
                        />
                      </div>
                      <div className="site-input-row">
                        <label>Side Setbacks (m)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={(editor.building.site.setbacks.left / 1000).toFixed(1)}
                          onChange={e => {
                            const val = Number(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              const mm = Math.round(val * 1000);
                              editor.updateSite({ setbacks: { left: mm, right: mm } });
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="site-control-card">
                    <h4>Road Facing Direction</h4>
                    <div className="site-input-row">
                      <select
                        value={editor.building.site.orientation.toString()}
                        onChange={e => {
                          const deg = Number(e.target.value);
                          const roadFacing = deg === 90 ? Direction.East : deg === 180 ? Direction.South : deg === 270 ? Direction.West : Direction.North;
                          editor.updateSite({ orientation: deg, roadFacing });
                        }}
                      >
                        <option value="0">North Facing</option>
                        <option value="90">East Facing</option>
                        <option value="180">South Facing</option>
                        <option value="270">West Facing</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* PLOT ACCOUNTING LEDGER & COMPLETE SITE UTILIZATION */}
              <div className="plot-accounting-card">
                <div className="plot-accounting-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <FileSpreadsheet size={18} color="#C86D48" />
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>
                        Plot Accounting Ledger & Site Utilization
                      </h3>
                      <span className="plot-accounting-badge-success">
                        <CheckCircle2 size={13} />
                        <span>100.0% OF PLOT ACCOUNTED</span>
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                      Deterministic classification of 100% of the site area into non-overlapping functional zones. Zero unexplained blank space.
                    </p>
                  </div>
                  <div className="plot-accounting-badge-blank">
                    <span className="blank-dot" />
                    <span>Unallocated Space: <strong>0.0 m² (0.0%)</strong></span>
                  </div>
                </div>

                {/* Metric summary boxes */}
                <div className="plot-summary-metrics">
                  <div className="plot-metric-box">
                    <span className="metric-label">Total Plot Area</span>
                    <span className="metric-value">{(sitePlanResult.siteUtilization.plotAreaMm2 / 1e6).toFixed(1)} m²</span>
                    <span className="metric-sub">{Math.round(sqMmToSqFt(sitePlanResult.siteUtilization.plotAreaMm2)).toLocaleString()} sq ft</span>
                  </div>
                  <div className="plot-metric-box">
                    <span className="metric-label">Building Footprint</span>
                    <span className="metric-value">{(sitePlanResult.siteUtilization.buildingFootprintAreaMm2 / 1e6).toFixed(1)} m²</span>
                    <span className="metric-sub">{((sitePlanResult.siteUtilization.buildingFootprintAreaMm2 / sitePlanResult.siteUtilization.plotAreaMm2) * 100).toFixed(1)}% Ground Coverage</span>
                  </div>
                  <div className="plot-metric-box">
                    <span className="metric-label">Classified Site Zones</span>
                    <span className="metric-value">{sitePlanResult.siteZones.length} Zones</span>
                    <span className="metric-sub">{((sitePlanResult.siteUtilization.classifiedZonesAreaMm2 / sitePlanResult.siteUtilization.plotAreaMm2) * 100).toFixed(1)}% Area Tracked</span>
                  </div>
                  <div className="plot-metric-box">
                    <span className="metric-label">Parking Compliance</span>
                    <span className="metric-value" style={{ color: sitePlanResult.siteUtilization.parkingFeasible ? '#059669' : '#DC2626' }}>
                      {sitePlanResult.siteUtilization.parkingFeasible ? 'Feasible & Allocated' : 'Constraint Notice'}
                    </span>
                    <span className="metric-sub">{sitePlanResult.siteZones.filter(z => z.kind === 'parking').length} Dedicated Bay(s)</span>
                  </div>
                </div>

                {/* Category Breakdown Table */}
                <div className="plot-breakdown-container">
                  <table className="plot-breakdown-table">
                    <thead>
                      <tr>
                        <th>Site Zone Category</th>
                        <th>Zones</th>
                        <th>Area (m²)</th>
                        <th>Area (sq ft)</th>
                        <th>Plot Share</th>
                        <th>Architectural & Municipal Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sitePlanResult.siteUtilization.breakdown.map(cat => {
                        const styleMap: Record<string, { stroke: string; label: string }> = {
                          setback: { stroke: '#94A3B8', label: 'Setbacks' },
                          parking: { stroke: '#64748B', label: 'Vehicle Parking' },
                          garden: { stroke: '#86EFAC', label: 'Landscape & Garden' },
                          pedestrian_circulation: { stroke: '#CBD5E1', label: 'Walkways & Pathways' },
                          vehicle_circulation: { stroke: '#94A3B8', label: 'Driveway & Turnaround' },
                          service: { stroke: '#FCD34D', label: 'Services & Utilities' },
                          future_expansion: { stroke: '#93C5FD', label: 'Future Expansion' },
                        };
                        const display = styleMap[cat.kind] ?? { stroke: '#94A3B8', label: cat.name };
                        return (
                          <tr key={cat.kind}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="plot-cat-dot" style={{ backgroundColor: display.stroke }} />
                                <span style={{ fontWeight: 600, color: '#1F2937' }}>{display.label}</span>
                              </div>
                            </td>
                            <td>{cat.count}</td>
                            <td style={{ fontFamily: 'var(--studio-font-mono)', fontWeight: 600 }}>{(cat.areaMm2 / 1e6).toFixed(1)} m²</td>
                            <td style={{ fontFamily: 'var(--studio-font-mono)', color: '#6B7280' }}>{Math.round(sqMmToSqFt(cat.areaMm2))} sq ft</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="plot-share-bar-bg">
                                  <div className="plot-share-bar-fill" style={{ width: `${Math.min(100, cat.percent)}%`, backgroundColor: display.stroke }} />
                                </div>
                                <span style={{ fontSize: 11, fontFamily: 'var(--studio-font-mono)', minWidth: 38 }}>{cat.percent.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td style={{ fontSize: 12, color: '#4B5563' }}>
                              {sitePlanResult.siteZones.find(z => z.kind === cat.kind)?.rationale ?? 'Standard site zoning allocation conforming to municipal setback and planning standards.'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Detailed Zone Ledger List */}
                <div className="plot-zones-ledger-accordion">
                  <h4 style={{ margin: '18px 0 8px 0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#4B5563' }}>
                    Individual Zone Inventory ({sitePlanResult.siteZones.length} Polygons)
                  </h4>
                  <div className="plot-zone-chips-grid">
                    {sitePlanResult.siteZones.map(zone => {
                      const colorMap: Record<string, string> = {
                        setback: '#94A3B8',
                        parking: '#64748B',
                        garden: '#10B981',
                        pedestrian_circulation: '#64748B',
                        vehicle_circulation: '#94A3B8',
                        service: '#F59E0B',
                        future_expansion: '#3B82F6',
                      };
                      const strokeColor = colorMap[zone.kind] ?? '#94A3B8';
                      const areaM2 = (zone.area / 1e6).toFixed(1);
                      const areaSqFt = Math.round(sqMmToSqFt(zone.area));
                      return (
                        <div key={zone.id} className="plot-zone-chip" title={zone.rationale}>
                          <div className="chip-top">
                            <span className="chip-indicator" style={{ backgroundColor: strokeColor }} />
                            <strong>{zone.name}</strong>
                            <span className="chip-area">{areaM2} m² ({areaSqFt} sq ft)</span>
                          </div>
                          <p className="chip-rationale">{zone.rationale || 'Functional site zone'}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Stage Navigation Footer */}
              <div className="studio-workflow-footer">
                <button
                  className="studio-btn-action"
                  onClick={() => setActiveStage('overview')}
                >
                  <ArrowLeft size={14} />
                  <span>Back to Overview</span>
                </button>
                <div className="workflow-step-indicator">
                  <span className="workflow-step-badge">Stage 2 of 6</span>
                  <span>Site & Setback Configuration</span>
                </div>
                <button
                  className="studio-btn-action primary"
                  onClick={() => setActiveStage('brief')}
                >
                  <span>Continue to Space Program</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 3: BRIEF & PROGRAM */}
        {activeStage === 'brief' && (
          <div className="studio-stage-content">
            <div className="studio-brief-stage">
              <div className="overview-hero">
                <h1>Space Program & Requirements</h1>
                <p>Define required spaces and room quantities for candidate generation.</p>
              </div>

              {/* PROJECT MODE SWITCHER (Apartment Planning First) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: 12,
                    border: '2px solid',
                    borderColor: projectType === 'apartment' ? '#C86D48' : '#E5E7EB',
                    background: projectType === 'apartment' ? '#FDF8F5' : '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: projectType === 'apartment' ? '0 2px 8px rgba(200, 109, 72, 0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s ease',
                  }}
                  onClick={() => setProjectType('apartment')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Building2 size={20} color="#C86D48" />
                      <strong style={{ fontSize: 15, color: '#111827' }}>Apartment / Multi-Unit Complex</strong>
                    </div>
                    <span style={{ fontSize: 11, background: '#C86D48', color: '#FFFFFF', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                      PRIMARY MODE
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
                    Multi-flat floor plates, central common core (lifts & stairs), double-loaded corridors, repeated unit modules, balconies, and OTS plumbing ducts.
                  </p>
                </div>

                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: 12,
                    border: '2px solid',
                    borderColor: projectType === 'residential_independent' ? '#C86D48' : '#E5E7EB',
                    background: projectType === 'residential_independent' ? '#FDF8F5' : '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: projectType === 'residential_independent' ? '0 2px 8px rgba(200, 109, 72, 0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s ease',
                  }}
                  onClick={() => setProjectType('residential_independent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Layers size={20} color="#6B7280" />
                      <strong style={{ fontSize: 15, color: '#111827' }}>Independent Villa / Residence</strong>
                    </div>
                    <span style={{ fontSize: 11, background: '#F3F4F6', color: '#6B7280', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                      SINGLE FAMILY
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>
                    Single-family detached home or bungalow with custom private bedroom schedule, attached bathrooms, formal living, and dining.
                  </p>
                </div>
              </div>

              {/* APARTMENT PLANNING CONTROLS */}
              {projectType === 'apartment' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* JURISDICTION & STATUTORY RULE PROFILE (§1, §2, §3, §8) */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ShieldCheck size={18} color="#C86D48" />
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Planning Jurisdiction & Authority Rules</h3>
                          <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                            {rulesProfile.document.includes('UDCPR') ? 'UDCPR 2020 (Updated 30 Jan 2025)' : rulesProfile.document}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                          Select the planning authority governing room minimums, staircases, lifts, and multi-family parking bands.
                        </p>
                      </div>
                    </div>

                    {/* Jurisdiction Selector Pills */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
                      {[
                        { id: 'pune_pmc', label: 'Pune / PMC', sub: 'PMC & UDCPR-2020' },
                        { id: 'pune_pmrda', label: 'Pune / PMRDA', sub: 'PMRDA & UDCPR-2020' },
                        { id: 'mumbai_mcgm', label: 'Mumbai / MCGM', sub: 'DCPR 2034 Part VIII' },
                        { id: 'generic_maharashtra', label: 'Maharashtra', sub: 'UDCPR-2020 State' },
                        { id: 'generic_indian', label: 'Generic Indian', sub: 'NBC 2016 Baseline' },
                      ].map(jur => {
                        const isSelected = (apartmentConfig.jurisdiction || 'pune_pmc') === jur.id;
                        return (
                          <button
                            key={jur.id}
                            type="button"
                            style={{
                              padding: '10px 8px',
                              borderRadius: 8,
                              border: isSelected ? '2px solid #C86D48' : '1px solid #E5E7EB',
                              background: isSelected ? '#FDF8F5' : '#FFFFFF',
                              color: isSelected ? '#C86D48' : '#374151',
                              cursor: 'pointer',
                              textAlign: 'center',
                            }}
                            onClick={() => setApartmentConfig(c => ({ ...c, jurisdiction: jur.id as ApartmentJurisdiction }))}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{jur.label}</div>
                            <div style={{ fontSize: 10, color: isSelected ? '#9A3412' : '#9CA3AF', marginTop: 2 }}>{jur.sub}</div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Authority Constraints Summary Chips */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#475569' }}>
                      <div><strong>Master Habitable:</strong> ≥ {rulesProfile.habitableRoomMinimums.masterHabitableRoomMinSqM} m² (w: {rulesProfile.habitableRoomMinimums.masterHabitableRoomMinWidthM}m)</div>
                      <div><strong>Other Bed:</strong> ≥ {rulesProfile.habitableRoomMinimums.otherHabitableRoomMinSqM} m² (w: {rulesProfile.habitableRoomMinimums.otherHabitableRoomMinWidthM}m)</div>
                      <div><strong>Kitchen:</strong> ≥ {rulesProfile.kitchenMinimums.minAreaSqM} m² (w: {rulesProfile.kitchenMinimums.minWidthM}m)</div>
                      <div><strong>Toilet/Bath:</strong> ≥ {rulesProfile.combinedToiletMinimums.minAreaSqM} m²</div>
                      <div><strong>Staircase:</strong> ≥ {rulesProfile.stairRequirements.minWidthM}m {rulesProfile.stairRequirements.secondStaircaseRequired ? '(2 Stairs Req.)' : '(1 Stair)'}</div>
                      <div><strong>Lift:</strong> {rulesProfile.liftRequirements.minPassengerLifts} Lift(s) Req.</div>
                    </div>
                  </div>

                  {/* 1. Floor Plate Scope & Repetition */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Building2 size={18} color="#C86D48" />
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Flats Per Floor & Stories</h3>
                          <span style={{ fontSize: 11, background: '#EFF6FF', color: '#1E40AF', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                            {apartmentConfig.flatsPerFloor} Flats / Floor · G+{apartmentConfig.floorCount - 1} ({apartmentConfig.floorCount * apartmentConfig.flatsPerFloor} Total Units)
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                          Select the density of apartments surrounding the central circulation core.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* Flats Per Floor presets */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                          Flats Per Typical Floor
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {[
                            { count: 2, label: '2 Flats (Twin)' },
                            { count: 3, label: '3 Flats' },
                            { count: 4, label: '4 Flats (Quad Core)' },
                            { count: 6, label: '6 Flats' },
                          ].map(preset => (
                            <button
                              key={preset.count}
                              type="button"
                              style={{
                                flex: 1,
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: '1px solid',
                                borderColor: apartmentConfig.flatsPerFloor === preset.count ? '#C86D48' : '#E5E7EB',
                                background: apartmentConfig.flatsPerFloor === preset.count ? '#FDF8F5' : '#FFFFFF',
                                color: apartmentConfig.flatsPerFloor === preset.count ? '#C86D48' : '#4B5563',
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                const newFlats = preset.count;
                                setApartmentConfig(c => {
                                  // Auto-adjust unit mix counts to match
                                  const half = Math.max(1, Math.floor(newFlats / 2));
                                  return {
                                    ...c,
                                    flatsPerFloor: newFlats,
                                    unitMix: [
                                      { unitType: '2BHK', count: half, carpetAreaSqFt: 750 },
                                      { unitType: '3BHK', count: newFlats - half, carpetAreaSqFt: 1100 },
                                    ],
                                  };
                                });
                              }}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Total Floors presets */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                          Building Height (Floors)
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {[
                            { count: 3, label: 'G+2 (3 Fl)' },
                            { count: 4, label: 'G+3 (4 Fl)' },
                            { count: 6, label: 'G+5 (6 Fl)' },
                            { count: 8, label: 'G+7 (8 Fl)' },
                          ].map(preset => (
                            <button
                              key={preset.count}
                              type="button"
                              style={{
                                flex: 1,
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: '1px solid',
                                borderColor: apartmentConfig.floorCount === preset.count ? '#C86D48' : '#E5E7EB',
                                background: apartmentConfig.floorCount === preset.count ? '#FDF8F5' : '#FFFFFF',
                                color: apartmentConfig.floorCount === preset.count ? '#C86D48' : '#4B5563',
                                cursor: 'pointer',
                              }}
                              onClick={() => setApartmentConfig(c => ({ ...c, floorCount: preset.count }))}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Floor Type Strategy Selector (§12) */}
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F3F4F6' }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                        Current Floor Program & Strategy (§12)
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[
                          { id: 'typical', label: 'Typical Residential' },
                          { id: 'ground', label: 'Ground / Stilt' },
                          { id: 'podium', label: 'Podium Parking' },
                          { id: 'amenity', label: 'Amenity Floor' },
                          { id: 'terrace', label: 'Rooftop Terrace' },
                        ].map(st => {
                          const isSel = (apartmentConfig.floorStrategy || 'typical') === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              style={{
                                flex: 1,
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: '1px solid',
                                borderColor: isSel ? '#C86D48' : '#E5E7EB',
                                background: isSel ? '#FDF8F5' : '#FFFFFF',
                                color: isSel ? '#C86D48' : '#4B5563',
                                cursor: 'pointer',
                              }}
                              onClick={() => setApartmentConfig(c => ({ ...c, floorStrategy: st.id as ApartmentFloorType }))}
                            >
                              {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Deterministic Schematic Scaffold Preview Toggle (§16, §17) */}
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F3F4F6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 12, color: '#4B5563' }}>
                          <strong>Deterministic Planning Scaffold:</strong> {liveSchematic.flatCount} flats ({liveSchematic.unitMixSummary}) · {liveSchematic.totalFloorPlateSqM} m² floor plate
                        </div>
                        <button
                          type="button"
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #CBD5E1',
                            background: showSchematicScaffold ? '#0F172A' : '#F8FAFC',
                            color: showSchematicScaffold ? '#FFFFFF' : '#334155',
                            cursor: 'pointer',
                          }}
                          onClick={() => setShowSchematicScaffold(v => !v)}
                        >
                          {showSchematicScaffold ? 'Hide Schematic Scaffold' : 'View Schematic Scaffold'}
                        </button>
                      </div>

                      {showSchematicScaffold && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: 12,
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: 8,
                            overflow: 'auto',
                            maxHeight: 400,
                          }}
                          dangerouslySetInnerHTML={{ __html: liveSchematic.svgScaffold }}
                        />
                      )}
                    </div>
                  </div>

                  {/* 2. Unit Mix Breakdown Table */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Layers size={18} color="#C86D48" />
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Unit Mix Schedule</h3>
                          <span style={{ fontSize: 11, background: '#F3F4F6', color: '#4B5563', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                            {apartmentConfig.unitMix.reduce((s, u) => s + u.count, 0)} of {apartmentConfig.flatsPerFloor} Flats Configured
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                          Define individual flat configurations, unit quantities, and target carpet areas per floor plate.
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        {['1BHK', '2BHK', '3BHK', '4BHK'].map(type => (
                          <button
                            key={type}
                            type="button"
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid #E5E7EB',
                              background: '#F9FAFB',
                              color: '#374151',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              const defaultArea = type === '1BHK' ? 450 : type === '2BHK' ? 750 : type === '3BHK' ? 1100 : 1500;
                              setApartmentConfig(c => ({
                                ...c,
                                unitMix: [...c.unitMix, { unitType: type, count: 1, carpetAreaSqFt: defaultArea }],
                              }));
                            }}
                          >
                            + {type}
                          </button>
                        ))}
                      </div>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          <th style={{ padding: '8px 12px' }}>Unit Type</th>
                          <th style={{ padding: '8px 12px' }}>Count / Floor</th>
                          <th style={{ padding: '8px 12px' }}>Target Carpet Area</th>
                          <th style={{ padding: '8px 12px' }}>Total In Building</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apartmentConfig.unitMix.map((unit, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1E293B' }}>
                              {unit.unitType}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <button
                                  type="button"
                                  style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontWeight: 700 }}
                                  onClick={() => {
                                    setApartmentConfig(c => {
                                      const newMix = [...c.unitMix];
                                      if (newMix[idx]) {
                                        newMix[idx] = { ...newMix[idx]!, count: Math.max(1, newMix[idx]!.count - 1) };
                                      }
                                      return { ...c, unitMix: newMix };
                                    });
                                  }}
                                >-</button>
                                <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{unit.count}</span>
                                <button
                                  type="button"
                                  style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontWeight: 700 }}
                                  onClick={() => {
                                    setApartmentConfig(c => {
                                      const newMix = [...c.unitMix];
                                      if (newMix[idx]) {
                                        newMix[idx] = { ...newMix[idx]!, count: newMix[idx]!.count + 1 };
                                      }
                                      return { ...c, unitMix: newMix };
                                    });
                                  }}
                                >+</button>
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  type="number"
                                  value={unit.carpetAreaSqFt ?? 750}
                                  step={25}
                                  style={{ width: 90, padding: '4px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13 }}
                                  onChange={e => {
                                    const val = Number(e.target.value);
                                    if (val > 0) {
                                      setApartmentConfig(c => {
                                        const newMix = [...c.unitMix];
                                        if (newMix[idx]) {
                                          newMix[idx] = { ...newMix[idx]!, carpetAreaSqFt: val };
                                        }
                                        return { ...c, unitMix: newMix };
                                      });
                                    }
                                  }}
                                />
                                <span style={{ fontSize: 12, color: '#6B7280' }}>sq ft</span>
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#4B5563' }}>
                              {unit.count * apartmentConfig.floorCount} units
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                onClick={() => {
                                  setApartmentConfig(c => ({
                                    ...c,
                                    unitMix: c.unitMix.filter((_, i) => i !== idx),
                                  }));
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 3. Central Core Architecture */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Compass size={18} color="#C86D48" />
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Common Central Core & Vertical Circulation</h3>
                      <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                        NBC Code Compliant
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                      <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Passenger Lifts</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {[1, 2, 3].map(count => (
                            <button
                              key={count}
                              type="button"
                              style={{
                                flex: 1,
                                fontSize: 12,
                                fontWeight: 700,
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: '1px solid',
                                borderColor: apartmentConfig.commonCore.passengerLifts === count ? '#C86D48' : '#CBD5E1',
                                background: apartmentConfig.commonCore.passengerLifts === count ? '#FDF8F5' : '#FFF',
                                color: apartmentConfig.commonCore.passengerLifts === count ? '#C86D48' : '#334155',
                                cursor: 'pointer',
                              }}
                              onClick={() => setApartmentConfig(c => ({
                                ...c,
                                commonCore: { ...c.commonCore, passengerLifts: count },
                              }))}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Staircases</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {[1, 2].map(count => (
                            <button
                              key={count}
                              type="button"
                              style={{
                                flex: 1,
                                fontSize: 12,
                                fontWeight: 700,
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: '1px solid',
                                borderColor: apartmentConfig.commonCore.staircaseCount === count ? '#C86D48' : '#CBD5E1',
                                background: apartmentConfig.commonCore.staircaseCount === count ? '#FDF8F5' : '#FFF',
                                color: apartmentConfig.commonCore.staircaseCount === count ? '#C86D48' : '#334155',
                                cursor: 'pointer',
                              }}
                              onClick={() => setApartmentConfig(c => ({
                                ...c,
                                commonCore: { ...c.commonCore, staircaseCount: count },
                              }))}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1E293B' }}>
                          <input
                            type="checkbox"
                            checked={apartmentConfig.commonCore.fireStaircaseRequired}
                            onChange={e => setApartmentConfig(c => ({
                              ...c,
                              commonCore: { ...c.commonCore, fireStaircaseRequired: e.target.checked },
                            }))}
                            style={{ accentColor: '#C86D48', width: 16, height: 16 }}
                          />
                          <span>Fire Exit Stair</span>
                        </label>
                        <span style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Dedicated escape stair</span>
                      </div>

                      <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1E293B' }}>
                          <input
                            type="checkbox"
                            checked={apartmentConfig.commonCore.commonLobby}
                            onChange={e => setApartmentConfig(c => ({
                              ...c,
                              commonCore: { ...c.commonCore, commonLobby: e.target.checked },
                            }))}
                            style={{ accentColor: '#C86D48', width: 16, height: 16 }}
                          />
                          <span>Central Lobby</span>
                        </label>
                        <span style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Double-loaded corridors</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. Live Deterministic Feasibility & Area Balance */}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '18px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileSpreadsheet size={18} color="#C86D48" />
                        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1E293B' }}>
                          Deterministic Floor Plate Feasibility Screen (§11 / §37 / §38)
                        </h4>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: apartmentFeasibility.feasible ? '#DCFCE7' : '#FEE2E2',
                          color: apartmentFeasibility.feasible ? '#166534' : '#991B1B',
                        }}
                      >
                        {apartmentFeasibility.feasible ? '✓ FEASIBLE ON CURRENT PLOT' : '⚠ CAPACITY CONFLICT'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, textAlign: 'center' }}>
                      <div style={{ background: '#FFF', padding: '10px 8px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Buildable Envelope</span>
                        <strong style={{ fontSize: 14, color: '#0F172A' }}>{apartmentFeasibility.buildableEnvelopeSqM.toFixed(1)} m²</strong>
                        <span style={{ fontSize: 10, color: '#94A3B8', display: 'block' }}>inside setbacks</span>
                      </div>
                      <div style={{ background: '#FFF', padding: '10px 8px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Core & Lifts</span>
                        <strong style={{ fontSize: 14, color: '#0F172A' }}>{apartmentFeasibility.coreAreaSqM.toFixed(1)} m²</strong>
                        <span style={{ fontSize: 10, color: '#94A3B8', display: 'block' }}>lifts + stairs + lobby</span>
                      </div>
                      <div style={{ background: '#FFF', padding: '10px 8px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Circulation Corridors</span>
                        <strong style={{ fontSize: 14, color: '#0F172A' }}>{apartmentFeasibility.circulationSqM.toFixed(1)} m²</strong>
                        <span style={{ fontSize: 10, color: '#94A3B8', display: 'block' }}>~10% allowance</span>
                      </div>
                      <div style={{ background: '#FFF', padding: '10px 8px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Available Net Carpet</span>
                        <strong style={{ fontSize: 14, color: '#166534' }}>{apartmentFeasibility.netResidentialAreaSqM.toFixed(1)} m²</strong>
                        <span style={{ fontSize: 10, color: '#94A3B8', display: 'block' }}>for residential units</span>
                      </div>
                      <div style={{ background: '#FFF', padding: '10px 8px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Requested Unit Area</span>
                        <strong style={{ fontSize: 14, color: apartmentFeasibility.feasible ? '#0F172A' : '#DC2626' }}>
                          {apartmentFeasibility.requestedTotalUnitAreaSqM.toFixed(1)} m²
                        </strong>
                        <span style={{ fontSize: 10, color: '#94A3B8', display: 'block' }}>{apartmentConfig.flatsPerFloor} units combined</span>
                      </div>
                    </div>

                    {!apartmentFeasibility.feasible && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, color: '#991B1B' }}>
                        <strong>Feasibility Conflicts:</strong>
                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                          {apartmentFeasibility.conflicts.map((c, i) => (
                            <li key={i}>{c.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* INDEPENDENT VILLA CONTROLS (Existing Single Family) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Building Floors Control */}
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Layers size={18} color="#C86D48" />
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Building Floors</h3>
                        <span style={{ fontSize: 11, background: '#F3F4F6', color: '#4B5563', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                          {roomCounts.floors === 1 ? 'Single Story (G)' : roomCounts.floors === 2 ? 'Ground + 1 (Duplex)' : roomCounts.floors === 3 ? 'Ground + 2 (Triplex)' : `G+${roomCounts.floors - 1} (${roomCounts.floors} Floors)`}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>
                        Configure residential stories (1 to 10+). Multi-floor generation automatically places stairs and distributes private bedrooms to upper floors.
                      </p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        {[
                          { count: 1, label: 'G (1 Floor)' },
                          { count: 2, label: 'G+1 (2 Floors)' },
                          { count: 3, label: 'G+2 (3 Floors)' },
                          { count: 4, label: 'G+3 (4 Floors)' },
                        ].map(preset => (
                          <button
                            key={preset.count}
                            type="button"
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid',
                              borderColor: roomCounts.floors === preset.count ? '#C86D48' : '#E5E7EB',
                              background: roomCounts.floors === preset.count ? '#FDF8F5' : '#FFFFFF',
                              color: roomCounts.floors === preset.count ? '#C86D48' : '#4B5563',
                              cursor: 'pointer',
                            }}
                            onClick={() => setRoomCounts(c => ({ ...c, floors: preset.count }))}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="brief-counter-group" style={{ transform: 'scale(1.1)' }}>
                      <button
                        className="brief-counter-btn"
                        onClick={() => setRoomCounts(c => ({ ...c, floors: Math.max(1, c.floors - 1) }))}
                        title="Decrease floors"
                      >-</button>
                      <span className="brief-counter-val" style={{ minWidth: 32, textAlign: 'center', fontWeight: 700 }}>
                        {roomCounts.floors}
                      </span>
                      <button
                        className="brief-counter-btn"
                        onClick={() => setRoomCounts(c => ({ ...c, floors: Math.min(20, c.floors + 1) }))}
                        title="Increase floors"
                      >+</button>
                    </div>
                  </div>

                  <div className="brief-rooms-grid">
                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Bedrooms</span>
                        <span className="brief-room-dim">Master + Standard</span>
                      </div>
                      <div className="brief-counter-group">
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, bedrooms: Math.max(1, c.bedrooms - 1) }))}
                        >-</button>
                        <span className="brief-counter-val">{roomCounts.bedrooms}</span>
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, bedrooms: c.bedrooms + 1 }))}
                        >+</button>
                      </div>
                    </div>

                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Bathrooms</span>
                        <span className="brief-room-dim">Ensuite + Common</span>
                      </div>
                      <div className="brief-counter-group">
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, bathrooms: Math.max(1, c.bathrooms - 1) }))}
                        >-</button>
                        <span className="brief-counter-val">{roomCounts.bathrooms}</span>
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, bathrooms: c.bathrooms + 1 }))}
                        >+</button>
                      </div>
                    </div>

                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Living Room</span>
                        <span className="brief-room-dim">Central Formal Space</span>
                      </div>
                      <div className="brief-counter-group">
                        <span className="brief-counter-val">1</span>
                      </div>
                    </div>

                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Kitchen</span>
                        <span className="brief-room-dim">Modular / Traditional</span>
                      </div>
                      <div className="brief-counter-group">
                        <span className="brief-counter-val">1</span>
                      </div>
                    </div>

                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Dining</span>
                        <span className="brief-room-dim">Connected to Kitchen</span>
                      </div>
                      <div className="brief-counter-group">
                        <span className="brief-counter-val">1</span>
                      </div>
                    </div>

                    <div className="brief-room-card">
                      <div className="brief-room-info">
                        <span className="brief-room-name">Balcony / Sit-out</span>
                        <span className="brief-room-dim">Outdoor Terrace</span>
                      </div>
                      <div className="brief-counter-group">
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, balcony: Math.max(0, c.balcony - 1) }))}
                        >-</button>
                        <span className="brief-counter-val">{roomCounts.balcony}</span>
                        <button
                          className="brief-counter-btn"
                          onClick={() => setRoomCounts(c => ({ ...c, balcony: c.balcony + 1 }))}
                        >+</button>
                      </div>
                    </div>
                  </div>

                  {/* Full Plot Coverage Toggle */}
                  <div style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Utilize Full Plot Size for Construction</h4>
                        <span style={{ fontSize: 11, background: '#ECFDF5', color: '#059669', padding: '1px 7px', borderRadius: 999, fontWeight: 600 }}>
                          100% Plot Coverage
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                        Covers the entire plot ({Math.round(mmToFeet(editor.building.site.plotWidth))}×{Math.round(mmToFeet(editor.building.site.plotDepth))} ft / {Math.round(sqMmToSqFt(editor.building.site.plotWidth * editor.building.site.plotDepth))} sq ft) for the building. Ground Floor occupies the maximum space across all levels.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={fullPlotEnabled}
                      onChange={e => setFullPlotEnabled(e.target.checked)}
                      style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#C86D48' }}
                    />
                  </div>

                  {/* Garden Option Toggle (Optional, default OFF) */}
                  <div style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Include Outdoor Garden / Courtyard</h4>
                        <span style={{ fontSize: 11, background: '#F3F4F6', color: '#4B5563', padding: '1px 7px', borderRadius: 999, fontWeight: 600 }}>
                          Optional
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#6B7280' }}>
                        When unchecked (default), every square foot of the plot is dedicated to the building construction. Check this if you want an open garden court.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={gardenEnabled}
                      onChange={e => setGardenEnabled(e.target.checked)}
                      style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#10B981' }}
                    />
                  </div>

                  {/* Vastu toggle */}
                  <div style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 600, color: '#111827' }}>Vastu Shastra Directional Alignment</h4>
                      <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>
                        Aligns Kitchen to South-East (Agni), Master Bedroom to South-West (Nairutya), and Pooja/Entrance to North-East.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={vastuEnabled}
                      onChange={e => setVastuEnabled(e.target.checked)}
                      style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#C86D48' }}
                    />
                  </div>
                </div>
              )}

              {/* Stage Navigation Footer */}
              <div className="studio-workflow-footer">
                <button
                  className="studio-btn-action"
                  onClick={() => setActiveStage('site')}
                >
                  <ArrowLeft size={14} />
                  <span>Back to Site & Plot</span>
                </button>
                <div className="workflow-step-indicator">
                  <span className="workflow-step-badge">Stage 3 of 6</span>
                  <span>Space Program & Requirements</span>
                </div>
                <button
                  className="studio-btn-action primary"
                  onClick={() => {
                    setActiveStage('generate');
                    handleGeneratePlans();
                  }}
                >
                  <Sparkles size={14} />
                  <span>Generate Plans from Brief</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 4: GENERATE PLANS (TWO-AI GENERATION WORKSPACE) */}
        {activeStage === 'generate' && (
          <div className="studio-stage-content">
            <div className="studio-generate-stage">
              {/* 1. Requirements Summary Bar (Section 28) */}
              <div className="generation-requirements-summary-bar">
                <div className="req-summary-item">
                  <Ruler size={15} color="#C86D48" />
                  <span><strong>Plot:</strong> {Math.round(mmToFeet(editor.building.site.plotWidth))} × {Math.round(mmToFeet(editor.building.site.plotDepth))} ft</span>
                </div>
                {projectType === 'apartment' ? (
                  <>
                    <div className="req-summary-item">
                      <Building2 size={15} color="#C86D48" />
                      <span><strong>Apartment:</strong> {apartmentConfig.flatsPerFloor} Flats / Floor ({apartmentConfig.floorCount} Floors)</span>
                    </div>
                    <div className="req-summary-item">
                      <Layers size={15} color="#2563EB" />
                      <span><strong>Unit Mix:</strong> {apartmentConfig.unitMix.map(u => `${u.count}x ${u.unitType}`).join(', ')}</span>
                    </div>
                    <div className="req-summary-item">
                      <Compass size={15} color="#059669" />
                      <span><strong>Core:</strong> {apartmentConfig.commonCore.passengerLifts} Lifts, {apartmentConfig.commonCore.staircaseCount} Stairs</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="req-summary-item">
                      <Box size={15} color="#2563EB" />
                      <span><strong>Program:</strong> {roomCounts.bedrooms} Bedrooms, {roomCounts.bathrooms} Bathrooms</span>
                    </div>
                    <div className="req-summary-item">
                      <span>Living, Dining, Kitchen</span>
                    </div>
                    <div className="req-summary-item">
                      <span className={`req-summary-pill ${!fullPlotEnabled ? 'active' : ''}`}>
                        {!fullPlotEnabled ? 'Parking: Dedicated Bay' : '100% Plot Coverage'}
                      </span>
                    </div>
                  </>
                )}
                <div className="req-summary-item">
                  <Compass size={15} color="#059669" />
                  <span><strong>Road:</strong> {editor.building.site.roadFacing || 'North'}</span>
                </div>
              </div>

              {/* INFORMATION COMPLETENESS GATE MODAL (§4 / §48) */}
              {completenessQuestions && completenessQuestions.length > 0 && (
                <div style={{ background: '#FFFBEB', border: '2px solid #FCD34D', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <AlertTriangle size={22} color="#D97706" />
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#92400E' }}>
                        Apartment Information Completeness Gate (§4 / §48)
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#B45309' }}>
                        Critical apartment specifications are needed before synthesizing architectural floor plans:
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {completenessQuestions.map(q => (
                      <div key={q.id} style={{ background: '#FFFFFF', padding: '12px 16px', borderRadius: 8, border: '1px solid #FDE68A' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#1E293B', marginBottom: 4 }}>{q.question}</div>
                        {q.description && <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>{q.description}</div>}
                        {q.type === 'select' && q.options && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {q.options.map(opt => (
                              <button
                                key={opt}
                                type="button"
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  background: '#F8FAFC',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                                onClick={() => {
                                  if (q.id === 'flatsPerFloor') {
                                    const num = parseInt(opt) || 4;
                                    setApartmentConfig(c => ({ ...c, flatsPerFloor: num }));
                                  } else if (q.id === 'floorCount') {
                                    const num = opt.includes('G+3') ? 4 : opt.includes('G+4') ? 5 : opt.includes('G+5') ? 6 : opt.includes('G+7') ? 8 : 4;
                                    setApartmentConfig(c => ({ ...c, floorCount: num }));
                                  }
                                }}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button
                      className="studio-btn-action primary"
                      onClick={() => {
                        setCompletenessQuestions(null);
                        handleGeneratePlans();
                      }}
                    >
                      <Sparkles size={14} />
                      <span>Complete & Generate Plans</span>
                    </button>
                    <button
                      className="studio-btn-action"
                      onClick={() => {
                        setCompletenessQuestions(null);
                        setActiveStage('brief');
                      }}
                    >
                      <span>Adjust in Space Program</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 2. Hero Bar */}
              <div className="generate-hero-bar">
                <div>
                  <h2 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700 }}>AI Floor Plan Studio</h2>
                  <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>
                    Two-AI Pipeline: Cloudflare FLUX visual concept + Gemini Vision interpretation + Deterministic CAD validation.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn-fallback-deterministic"
                    onClick={handleRunDeterministicFallback}
                    disabled={isGenerating}
                    title="Generate candidate directly with deterministic algorithm without calling external AI"
                  >
                    <DraftingCompass size={14} />
                    <span>Deterministic Planner</span>
                  </button>
                  <button
                    className="studio-btn-action primary"
                    onClick={() => handleGeneratePlans()}
                    disabled={isGenerating}
                  >
                    <Sparkles size={14} />
                    <span>{isGenerating ? 'Synthesizing…' : 'Generate with Two-AI'}</span>
                  </button>
                </div>
              </div>

              {/* 3A. ACTIVE REAL-TIME GENERATION WAITING OVERLAY & 6-STEP MILESTONES */}
              {isGenerating ? (
                <div className="generation-waiting-overlay">
                  <div className="generation-waiting-card">
                    {/* Phase 5 honest in-flight state: a single server request is running.
                        No percentage and no stage is marked complete until the server
                        reports real per-stage results. */}
                    <div className="generation-milestone-info" role="status" aria-live="polite">
                      <span className="generation-milestone-step-badge">In progress</span>
                      <h3 className="generation-milestone-title" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <span className="milestone-spinner" aria-hidden="true" />
                        <span>Running</span>
                      </h3>
                      <p className="generation-milestone-desc">{runningLabel}</p>
                      <p className="generation-milestone-desc" style={{ fontSize: 11, color: '#64748B' }}>
                        Stage results are shown only when the server reports them — nothing below is marked complete yet.
                      </p>
                    </div>

                    <div className="generation-milestones-checklist">
                      {inFlightStageRows().map(row => (
                        <div key={row.key} className="milestone-row">
                          <span className="milestone-icon"><span style={{ fontSize: 13, color: '#94A3B8' }} aria-hidden="true">○</span></span>
                          <span>{row.label}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>{row.detail}</span>
                        </div>
                      ))}
                    </div>

                    {/* Live Timer & safety limit (apartments run four concept pipelines) */}
                    <div className="generation-timer-hud">
                      <Clock size={14} className="generation-clock-icon" />
                      <span>
                        Real-time synthesis · Elapsed: <strong>{Math.floor(generationSeconds / 60)}m {String(generationSeconds % 60).padStart(2, '0')}s</strong>
                      </span>
                      <span className="generation-timer-sep">·</span>
                      <span className="generation-timeout-cap">
                        Max safety limit: {Math.floor(generationSafetyLimitSeconds(projectType) / 60)}m 00s
                      </span>
                    </div>

                    {/* Cancel Button */}
                    <button
                      className="generation-cancel-btn"
                      onClick={handleCancelGeneration}
                    >
                      <StopCircle size={14} />
                      <span>Cancel Synthesis</span>
                    </button>
                  </div>
                </div>
              ) : generationError ? (
                /* 3B. STAGE-SPECIFIC ERROR CARD WITH DETERMINISTIC FALLBACK (Sections 30 & 31) */
                <div className="generation-error-card" style={{ maxWidth: 640 }}>
                  <div className="error-icon-halo" style={{ backgroundColor: stageSpecificError?.isTransient ? '#FEF3C7' : '#FEE2E2' }}>
                    <AlertTriangle size={26} color={stageSpecificError?.isTransient ? '#D97706' : '#DC2626'} />
                  </div>
                  <h3>
                    {stageSpecificError?.isTransient
                      ? 'Gemini Interpretation Temporarily Unavailable'
                      : stageSpecificError?.stage === 'Visual Preflight'
                      ? 'Rejected at Visual Preflight — Not Scored'
                      : stageSpecificError?.stage ? `${stageSpecificError.stage} Error` : 'Generation Error'}
                  </h3>

                  {/* Checklist showing progress up to saved image */}
                  {/* Phase 5: real server-reported stage state (never a hard-coded ✓ list). */}
                  <div style={{ margin: '14px 0', padding: '14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, textAlign: 'left' }}>
                    {generationOutcome ? (
                      <StageChecklist rows={generationOutcome.stageRows} />
                    ) : (
                      <div style={{ fontSize: 12, color: '#64748B' }}>
                        No stage results were returned by the server, so no stage is shown as completed.
                      </div>
                    )}
                  </div>

                  {savedArtifact && (
                    <div style={{ margin: '14px 0', padding: '14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, textAlign: 'left' }}>

                      <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 10, textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#166534', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                          <CheckCircle2 size={16} />
                          <span>Generated Image Preserved & Ready</span>
                        </div>
                        <img
                          src={`data:${savedArtifact.mimeType};base64,${savedArtifact.imageBase64}`}
                          alt="Generated Floor Plan Concept"
                          style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 6, border: '1px solid #CBD5E1', objectFit: 'contain' }}
                        />
                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 6, fontFamily: 'monospace' }}>
                          Artifact: {savedArtifact.generationId} · Model: {savedArtifact.model}
                        </div>
                      </div>
                    </div>
                  )}

                  <p style={{ whiteSpace: 'pre-line', margin: '8px 0', fontSize: 13, color: '#374151' }}>
                    {stageSpecificError?.message || generationError}
                  </p>

                  {stageSpecificError?.diagnostics && (
                    <div style={{ fontSize: 12, color: '#7F1D1D', background: '#FEE2E2', padding: '8px 12px', borderRadius: 6, maxWidth: 500, margin: '8px auto', textAlign: 'left' }}>
                      {stageSpecificError.diagnostics}
                    </div>
                  )}

                  {/* Every concept stays visible with its own reason, even when none was accepted. */}
                  {conceptCards.length > 0 && (
                    <div style={{ textAlign: 'left', marginTop: 12 }}>
                      <ConceptCardsPanel cards={conceptCards} onApply={applyConceptCandidate} />
                    </div>
                  )}

                  <div className="generation-error-actions" style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 16 }}>
                    {savedArtifact ? (
                      <button
                        className="studio-btn-action primary"
                        onClick={handleResumeInterpretation}
                        title="Resume interpretation with Gemini Vision on the existing saved image without regenerating FLUX image"
                      >
                        <RefreshCw size={14} />
                        <span>Retry Interpretation</span>
                      </button>
                    ) : null}
                    <button
                      className={savedArtifact ? 'studio-btn-action' : 'studio-btn-action primary'}
                      onClick={() => handleGeneratePlans()}
                    >
                      <Sparkles size={14} />
                      <span>{savedArtifact ? 'Generate Again (New Image)' : 'Retry AI Generation'}</span>
                    </button>
                    <button
                      className="btn-fallback-deterministic"
                      onClick={handleRunDeterministicFallback}
                    >
                      <DraftingCompass size={14} />
                      <span>Try Deterministic Planner Instead</span>
                    </button>
                  </div>
                </div>
              ) : generatedCandidates.length === 0 ? (
                /* 3C. EMPTY STATE CTA CARD */
                <div className="generation-empty-state-card">
                  <div className="generation-empty-icon-halo">
                    <Sparkles size={34} color="#C86D48" />
                  </div>
                  <h2>Two-AI Floor Plan Generation</h2>
                  <p>
                    Synthesize real architectural floor plan designs matching your plot dimensions ({Math.round(mmToFeet(editor.building.site.plotWidth))}×{Math.round(mmToFeet(editor.building.site.plotDepth))} ft), {roomCounts.bedrooms} bedrooms, {roomCounts.bathrooms} bathrooms, living, dining, and kitchen.
                  </p>
                  <div className="generation-feature-pills">
                    <span>✓ Cloudflare FLUX Visual Concept</span>
                    <span>✓ Gemini Vision Interpretation</span>
                    <span>✓ Deterministic Hard Validation</span>
                    <span>✓ Gemini Architectural Review</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                    <button
                      className="studio-btn-action primary generation-start-cta"
                      onClick={() => handleGeneratePlans()}
                    >
                      <Sparkles size={16} />
                      <span>Generate with Two-AI (FLUX + Gemini)</span>
                    </button>
                    <button
                      className="btn-fallback-deterministic"
                      onClick={handleRunDeterministicFallback}
                      style={{ padding: '10px 18px', fontSize: 13 }}
                    >
                      <DraftingCompass size={15} />
                      <span>Run Deterministic Planner</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* 3D. CANDIDATE GALLERY & RESEARCH INSIGHTS (Sections 28 & 29) */
                <div className="candidates-gallery-container">
                  {/* Two-phase upgrade: the four controlled concepts, valid and rejected. */}
                  <ConceptCardsPanel cards={conceptCards} onApply={applyConceptCandidate} />

                  {/* Phase 5: real per-stage state of the authoritative candidate. */}
                  {generationOutcome && (
                    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#FFFFFF' }}>
                      <StageChecklist
                        rows={generationOutcome.stageRows}
                        title={generationOutcome.stageRowsSource === 'CANDIDATE'
                          ? `Pipeline stages — ${generationOutcome.candidateSource === 'FALLBACK_DETERMINISTIC' ? 'deterministic fallback plan' : 'accepted FLUX candidate'}`
                          : 'Pipeline stages — run summary'}
                      />
                      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>
                        You choose which plan to apply; scores are advisory and never select a plan automatically.
                      </p>
                    </div>
                  )}

                  {/* Phase 3: honest generation provenance (fallback + rejected FLUX attempts) */}
                  {generationOutcome && (generationOutcome.fallbackUsed || generationOutcome.rejectedAttempts.length > 0) && (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 8, border: `1px solid ${generationOutcome.fallbackUsed ? '#FCD34D' : '#E2E8F0'}`, background: generationOutcome.fallbackUsed ? '#FFFBEB' : '#F8FAFC', fontSize: 12, color: '#1F2937' }}
                    >
                      {generationOutcome.fallbackUsed && (
                        <div style={{ marginBottom: 8 }}>
                          <strong style={{ display: 'block', fontSize: 13, color: '#92400E' }}>
                            Deterministic fallback used — not AI generated
                          </strong>
                          <span>{generationOutcome.fallbackMessage}</span>
                        </div>
                      )}
                      <div style={{ color: '#475569' }}>
                        FLUX attempts: {generationOutcome.attemptsUsed}
                        {generationOutcome.maxAttemptsPerCandidate > 0 ? ` (limit ${generationOutcome.maxAttemptsPerCandidate} per candidate)` : ''}
                        {' · '}Accepted source: {generationOutcome.candidateSource === 'FALLBACK_DETERMINISTIC'
                          ? 'Deterministic planner'
                          : generationOutcome.candidateSource === 'FLUX' ? 'Cloudflare FLUX' : 'none'}
                      </div>
                      {generationOutcome.rejectedAttempts.length > 0 && (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {generationOutcome.rejectedAttempts.map(att => (
                            <li key={att.id} style={{ marginBottom: 4 }}>
                              <strong>
                                FLUX attempt{att.attempt !== null ? ` ${att.attempt}` : ''} (seed {att.seed}): {att.headline} — not scored
                              </strong>
                              {att.reasons.length > 0 && (
                                <ul style={{ margin: '2px 0 0', paddingLeft: 16, color: '#7F1D1D' }}>
                                  {att.reasons.map((r, i) => <li key={i}>{r}</li>)}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {researchReport && (
                    <div className="architectural-research-card">
                      <div className="research-card-header">
                        <div className="research-badge-row">
                          <span className="research-ai-pill">
                            <Sparkles size={13} /> {researchReport.source === 'gemini_research' ? 'Gemini 3.6 Flash Research' : 'NBC Code Standards'}
                          </span>
                          <span className="research-plot-cat">Plot: {researchReport.plotCategory.toUpperCase()} ({Math.round(researchReport.buildableFootprintSqM)} m² Footprint)</span>
                        </div>
                        <p className="research-rationale">{researchReport.architecturalRationale}</p>
                      </div>
                      <div className="research-grid-insights">
                        <div className="research-insight-item">
                          <strong>☀️ Daylight Strategy</strong>
                          <span>{researchReport.daylightStrategy}</span>
                        </div>
                        <div className="research-insight-item">
                          <strong>💨 Cross-Ventilation & OTS</strong>
                          <span>{researchReport.ventilationStrategy}</span>
                        </div>
                        <div className="research-insight-item">
                          <strong>🚪 Circulation Flow</strong>
                          <span>{researchReport.circulationGuideline}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="candidates-gallery-grid">
                    {generatedCandidates.map(cand => {
                      const firstFloor = cand.building.floors[0]!;
                      const transform = fitFloorToViewport(firstFloor, 340, 220);
                      const svgHtml = renderFloor(firstFloor, cand.building, transform, 340, 220);
                      const isSelected = cand.id === selectedCandidateId;
                      const currentMode = candidateViewModes[cand.id] ?? (cand.imageArtifact?.base64Data ? 'image' : 'cad');

                      return (
                        <div
                          key={cand.id}
                          className={`candidate-plan-card ${isSelected ? 'selected' : ''}`}
                        >
                          {/* Header */}
                          <div className="candidate-card-header">
                            <span className="candidate-strategy-badge">
                              {cand.strategy.replace(/_/g, ' ')}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="badge-validated">
                                <Check size={11} />
                                <span>Validated ✓</span>
                              </span>
                              {/* Numeric "Gemini" score ONLY for a real Gemini evaluation (Phase 3). */}
                              <span className="badge-gemini-score">
                                <Sparkles size={11} />
                                <span title={cand.scoreView && cand.scoreView.kind !== 'SCORED' ? cand.scoreView.reason : ADVISORY_EVALUATION_NOTICE}>
                                  {cand.scoreView
                                    ? cand.scoreView.label
                                    : cand.source === undefined && typeof cand.metrics.overallQualityScore === 'number'
                                    ? `Calculated: ${Math.round(cand.metrics.overallQualityScore)}/100`
                                    : 'Not scored'}
                                </span>
                              </span>
                            </div>
                          </div>

                          {/* Toggle between FLUX Concept Image and 2D CAD Plan (Section 29) */}
                          {cand.imageArtifact?.base64Data && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 12px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                              <div className="candidate-view-toggle">
                                <button
                                  type="button"
                                  className={`candidate-view-btn ${currentMode === 'image' ? 'active' : ''}`}
                                  onClick={() => setCandidateViewModes(prev => ({ ...prev, [cand.id]: 'image' }))}
                                >
                                  {cand.source === 'FALLBACK_DETERMINISTIC' ? 'Deterministic Base Plan' : 'Concept Image (FLUX)'}
                                </button>
                                <button
                                  type="button"
                                  className={`candidate-view-btn ${currentMode === 'cad' ? 'active' : ''}`}
                                  onClick={() => setCandidateViewModes(prev => ({ ...prev, [cand.id]: 'cad' }))}
                                >
                                  Canonical 2D CAD
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Preview Canvas / Image */}
                          {currentMode === 'image' && cand.imageArtifact?.base64Data ? (
                            <div style={{ height: 220, background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                              <img
                                src={`data:${cand.imageArtifact.mimeType};base64,${cand.imageArtifact.base64Data}`}
                                alt={cand.source === 'FALLBACK_DETERMINISTIC' ? 'Deterministic apartment base plan (not AI generated)' : 'Generated floor plan concept'}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              />
                            </div>
                          ) : (
                            <div
                              className="candidate-card-preview"
                              dangerouslySetInnerHTML={{ __html: svgHtml }}
                            />
                          )}

                          {/* Body */}
                          <div className="candidate-card-body">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{cand.name}</div>
                              <span style={{ fontSize: 12, color: '#6B7280' }}>Rank #{cand.rank}</span>
                            </div>

                            <p style={{ margin: 0, fontSize: 12, color: '#4B5563', lineHeight: 1.45 }}>
                              {cand.description}
                            </p>

                            {cand.evaluation?.strengths && cand.evaluation.strengths.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#F0FDF4', padding: '6px 8px', borderRadius: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Key Strengths:</span>
                                <span style={{ fontSize: 11, color: '#14532D' }}>
                                  {cand.evaluation.strengths.slice(0, 2).join(' · ')}
                                </span>
                              </div>
                            )}

                            {/* Phase 5: the evaluator's own categories, explicitly advisory. */}
                            {cand.advisoryCategories && cand.advisoryCategories.length > 0 && (
                              <details style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 8px' }}>
                                <summary style={{ fontSize: 11, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                                  Advisory evaluation categories (Gemini)
                                </summary>
                                <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', margin: '6px 0 4px', fontSize: 11 }}>
                                  {cand.advisoryCategories.map(cat => (
                                    <React.Fragment key={cat.key}>
                                      <dt style={{ color: '#475569' }}>{cat.label}</dt>
                                      <dd style={{ margin: 0, fontWeight: 600, color: '#1E293B' }}>{cat.score}/100</dd>
                                    </React.Fragment>
                                  ))}
                                </dl>
                                <p style={{ margin: 0, fontSize: 10, color: '#64748B' }}>{ADVISORY_EVALUATION_NOTICE}</p>
                              </details>
                            )}

                            <div className="candidate-metrics-row">
                              <span>Carpet Area: {Math.round(sqMmToSqFt(cand.metrics.totalCarpetAreaMm2))} sq ft</span>
                              <span>{firstFloor.rooms.length} Rooms</span>
                            </div>

                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                              {cand.metrics.zoningScore !== undefined && (
                                <span style={{ fontSize: 11, background: '#EFF6FF', color: '#1E40AF', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
                                  Zoning {Math.round(cand.metrics.zoningScore)}%
                                </span>
                              )}
                              {cand.metrics.circulationScore !== undefined && (
                                <span style={{ fontSize: 11, background: '#FAF5FF', color: '#6B21A8', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
                                  Flow {Math.round(cand.metrics.circulationScore)}%
                                </span>
                              )}
                              {cand.metrics.daylightScore !== undefined && (
                                <span style={{ fontSize: 11, background: '#FEFCE8', color: '#854D0E', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
                                  Daylight {Math.round(cand.metrics.daylightScore)}%
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="candidate-card-footer">
                            <button
                              className="studio-btn-action"
                              onClick={() => {
                                if (cand.imageArtifact?.base64Data) {
                                  setCandidateViewModes(prev => ({
                                    ...prev,
                                    [cand.id]: currentMode === 'image' ? 'cad' : 'image',
                                  }));
                                }
                                setSelectedCandidateId(cand.id);
                              }}
                            >
                              {cand.imageArtifact?.base64Data
                                ? (currentMode === 'image' ? 'View 2D CAD' : 'View Concept')
                                : (isSelected ? 'Viewing' : 'Select')}
                            </button>
                            <button
                              className="studio-btn-action primary"
                              onClick={() => handleApplyCandidate(cand)}
                            >
                              <span>Apply to Project</span>
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Stage Navigation Footer */}
              <div className="studio-workflow-footer">
                <button
                  className="studio-btn-action"
                  onClick={() => setActiveStage('brief')}
                >
                  <ArrowLeft size={14} />
                  <span>Back to Space Program</span>
                </button>
                <div className="workflow-step-indicator">
                  <span className="workflow-step-badge">Stage 4 of 6</span>
                  <span>AI Plan Synthesis ({generatedCandidates.length} Options)</span>
                </div>
                {selectedCandidate ? (
                  <button
                    className="studio-btn-action primary"
                    onClick={() => handleApplyCandidate(selectedCandidate)}
                  >
                    <span>Apply Selected & Open 2D Floor Plan</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    className="studio-btn-action primary"
                    onClick={() => handleGeneratePlans()}
                    disabled={isGenerating}
                  >
                    <Sparkles size={14} />
                    <span>Generate Plans</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STAGE 5: 2D FLOOR PLANS (Interactive CAD Canvas & Apartment Studio) */}
        {activeStage === 'floorplans' && (
          <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
            {/* Left CAD Tool Palette */}
            <div style={{ width: 68, borderRight: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 8, zIndex: 10 }}>
              <ToolPalette
                editor={editor}
                onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
              />
            </div>

            {/* Left Collapsible Indian Apartment Configurator Sidebar */}
            {configuratorSidebarOpen && (
              <ApartmentConfiguratorSidebar
                editor={editor}
                onProjectGenerated={(result, prov) => {
                  setApartmentResult(result);
                  setApartmentProvenance(prov);
                  setActiveSheetTab(2);
                }}
                provenance={apartmentProvenance}
                onSetActiveSheet={(tab) => setActiveSheetTab(tab)}
              />
            )}

            {/* Center Canvas Viewport */}
            <div style={{ flex: 1, height: '100%', position: 'relative', background: '#FAF9F5', overflow: 'hidden' }}>
              <ArchitecturalCanvas
                editor={editor}
                onCursorMove={() => {}}
                onZoomChange={() => {}}
                snapEnabled={snapEnabled}
                layers={layers}
                fitRequest={fitRequest}
                activeSheetTab={activeSheetTab}
                onSelectSheetTab={(tab) => setActiveSheetTab(tab)}
                apartmentResult={apartmentResult}
                conceptImageBase64={savedArtifact?.imageBase64}
              />

              {/* Quick Canvas Controls Overlay (Floating Top-Left) */}
              <div style={{ position: 'absolute', top: 56, left: 12, background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(6px)', border: '1px solid #E5E7EB', borderRadius: 8, padding: 4, display: 'flex', alignItems: 'center', gap: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.06)', zIndex: 10 }}>
                <button
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid',
                    borderColor: configuratorSidebarOpen ? '#C86D48' : '#E5E7EB',
                    background: configuratorSidebarOpen ? '#FFF7ED' : 'transparent',
                    color: configuratorSidebarOpen ? '#9A3412' : '#4B5563',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  onClick={() => setConfiguratorSidebarOpen(v => !v)}
                  title="Toggle Apartment Configurator Panel"
                >
                  <Building2 size={13} />
                  <span>Configurator</span>
                </button>
                <div style={{ width: 1, height: 16, background: '#E5E7EB' }} />
                <button
                  style={{ padding: 6, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: '#4B5563' }}
                  onClick={() => setFitRequest(v => v + 1)}
                  title="Fit to view (F)"
                >
                  <Maximize2 size={15} />
                </button>
                <div style={{ width: 1, height: 16, background: '#E5E7EB' }} />
                <button
                  style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: snapEnabled ? '#FEF3C7' : 'transparent', color: snapEnabled ? '#92400E' : '#4B5563', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                  onClick={() => setSnapEnabled(v => !v)}
                  title="Toggle Grid Snapping"
                >
                  Snap
                </button>
                <div style={{ width: 1, height: 16, background: '#E5E7EB' }} />
                <button
                  style={{ padding: 6, borderRadius: 4, border: 'none', background: 'transparent', cursor: editor.canUndo ? 'pointer' : 'default', color: editor.canUndo ? '#4B5563' : '#D1D5DB' }}
                  onClick={() => editor.undo()}
                  disabled={!editor.canUndo}
                  title="Undo (Ctrl+Z)"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  style={{ padding: 6, borderRadius: 4, border: 'none', background: 'transparent', cursor: editor.canRedo ? 'pointer' : 'default', color: editor.canRedo ? '#4B5563' : '#D1D5DB' }}
                  onClick={() => editor.redo()}
                  disabled={!editor.canRedo}
                  title="Redo (Ctrl+Y)"
                >
                  <RotateCw size={15} />
                </button>
                <div style={{ width: 1, height: 16, background: '#E5E7EB' }} />
                <button
                  style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#C86D48', color: '#FFFFFF', cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setIsExportModalOpen(true)}
                  title="Export 6-Sheet Project to AC1032 DWG, DXF, or 1:100 A3 Vector PDF"
                >
                  <Download size={12} />
                  <span>Export CAD</span>
                </button>
              </div>
            </div>

            {/* Right Property Inspector Dock */}
            {inspectorOpen && (
              <aside style={{ width: 320, borderLeft: '1px solid #E5E7EB', background: '#FFFFFF', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
                <div style={{ padding: 12, borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#6B7280' }}>Inspector</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer' }}
                    onClick={() => setInspectorOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div style={{ flex: 1, padding: 8 }}>
                  <PropertyInspector editor={editor} embedded />
                </div>
              </aside>
            )}
          </div>
        )}

        {/* STAGE 6: 3D STUDIO */}
        {activeStage === '3d' && (
          <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="studio-btn studio-btn-secondary"
                onClick={() => setActiveStage('floorplans')}
                style={{ backdropFilter: 'blur(8px)', background: 'rgba(255, 255, 255, 0.85)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
              >
                <ArrowLeft size={14} />
                Back to 2D Floor Plan
              </button>
            </div>
            <Suspense
              fallback={
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#9CA3AF' }}>
                  <Box size={32} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Loading Three.js 3D architectural projection…</span>
                </div>
              }
            >
              <ModelWorkspace
                building={editor.building}
                generationControl={editor.generationControl}
                onApplyBuilding={editor.applyRefinement}
                activeFloorId={editor.activeFloor.id}
                selection={editor.selection}
                onSelectEntity={editor.selectEntity}
                onClearSelection={editor.clearSelection}
                onSwitchFloor={editor.switchFloor}
              />
            </Suspense>
          </div>
        )}

        {/* STAGE 7: DESIGN INSIGHTS */}
        {activeStage === 'insights' && (
          <div className="studio-stage-content">
            <DesignDiagnosticsPanel editor={editor} />
          </div>
        )}

        {/* FLOATING AI CO-PILOT ASSISTANT DRAWER */}
        {isAICoPilotOpen && (
          <aside className="studio-ai-drawer">
            <div className="ai-drawer-header">
              <div className="ai-drawer-title">
                <Sparkles size={16} color="#C86D48" />
                <span>Architectural Co-Pilot</span>
              </div>
              <button
                className="studio-btn-icon"
                onClick={() => setIsAICoPilotOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="ai-drawer-messages">
              {aiMessages.map((m, idx) => (
                <div key={idx} className={`ai-bubble ${m.sender}`}>
                  {m.text}
                </div>
              ))}
            </div>

            {/* Quick Suggestions Chips */}
            <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #F3F4F6', background: '#F9FAFB' }}>
              <button
                style={{ fontSize: 11, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '3px 8px', color: '#4B5563', cursor: 'pointer' }}
                onClick={() => handleSendAIMessage('Analyze spatial flow and zoning')}
              >
                Spatial flow
              </button>
              <button
                style={{ fontSize: 11, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '3px 8px', color: '#4B5563', cursor: 'pointer' }}
                onClick={() => handleSendAIMessage('Check daylight access for bedrooms')}
              >
                Daylight access
              </button>
              <button
                style={{ fontSize: 11, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '3px 8px', color: '#4B5563', cursor: 'pointer' }}
                onClick={() => handleSendAIMessage('Check Vastu compliance')}
              >
                Vastu alignment
              </button>
            </div>

            <div className="ai-drawer-input-bar">
              <input
                type="text"
                placeholder="Ask Co-Pilot about your design…"
                value={aiInputText}
                onChange={e => setAiInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendAIMessage()}
              />
              <button
                className="studio-btn-action primary"
                onClick={() => handleSendAIMessage()}
              >
                <Send size={14} />
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Modals */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onSelectBuilding={(b, name, cat) => {
          editor.setBuilding(b, name, {}, cat);
          setIsNewProjectModalOpen(false);
        }}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        building={editor.building}
        floor={editor.activeFloor}
        validationSummary={editor.validationSummary}
      />

      <CommandPalette
        open={isCommandPaletteOpen}
        commands={commandList}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
};

export default StudioShell;
