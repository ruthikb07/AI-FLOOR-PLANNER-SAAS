import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Compass,
  Layers,
  DraftingCompass,
  Box,
  ShieldCheck,
  Download,
  FolderOpen,
  ChevronDown,
  Sun,
  Sunset,
  Moon,
  Plus,
  Check,
  Edit3,
  Save,
  FileUp,
  Library,
  Sparkles,
} from 'lucide-react';
import type { Building, BuildingMassingShape, GalleryCoordinationMode, PlanCategory } from '@ai-floor-planner/core';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { fitFloorOpeningsInsideWalls } from '@ai-floor-planner/geometry-engine';
import { useEditorStore } from '../../stores/editor-store';
import { studioStoreActions, useStudioStore } from '../../stores/useStudioStore';
import type { ProjectSetupWizardData } from './ProjectSetupWizard';
import { RHWelcomeScreen } from '../studio/RHWelcomeScreen';
import { ArchitecturalCADWorkspace } from './ArchitecturalCADWorkspace';
import { InteractivePlanEditorPage } from './InteractivePlanEditorPage';
import { FloorIsometricEditor } from './FloorIsometricEditor';
import { UdcprEtabsAnalysis } from './UdcprEtabsAnalysis';
import { GenerationProgressModal } from './GenerationProgressModal';
import { DesignAssistant } from './DesignAssistant';
import { CommandPalette } from '../workspace/CommandPalette';
import { exportProjectAsJsonFile, projectStorage } from '../../services/storage';
import {
  buildAlternativeExhaustionExplanation,
  compareCanonicalBuildingAlternatives,
  coordinateBuildingFacade,
  evaluateStudioLayoutScore,
  evaluateUDCPRCompliance,
  generateTargetedRefinements,
  RefinementError,
   synthesizeStructuralFraming,
  type AlternativeExplorationControls,
  type PipelineStageProgressEvent,
} from '@ai-floor-planner/planning-engine';
import type { WorkspaceCommand } from '../../services/workspace-commands';
import { createArgonRequest } from '../../services/argon-request';
import { generatedRevision, planInWorker } from '../../services/argon-generation';
import { ConceptReviewWorkspace, ProjectLibrary, representativeFloor, type GeneratedConcept } from './ProjectPortfolio';
import { CadImportModal, type CadImportCommittedPayload } from './CadImportModal';
import {
  deleteLocalDiskProject,
  listLocalDiskProjects,
  loadLocalDiskProject,
  readLocalDiskSaveBase,
  rememberLocalDiskSaveBase,
  saveLocalDiskProject,
  type LocalDiskProjectManifest,
} from '../../services/local-project-api';

const LazyBuilding3DCustomizer = lazy(() => import('./Building3DCustomizer'));
const BimStudio = lazy(() => import('./BimStudio'));
const ProjectSetupWizard = lazy(async () => ({ default: (await import('./ProjectSetupWizard')).ProjectSetupWizard }));
const StructuralCADWorkspace = lazy(async () => ({ default: (await import('./StructuralCADWorkspace')).StructuralCADWorkspace }));
const ExportCenterWorkspace = lazy(async () => ({ default: (await import('./ExportCenterWorkspace')).ExportCenterWorkspace }));

export type ArgonWorkspaceId =
  | 'setup'
  | 'concepts'
  | 'library'
  | 'cad_2d'
  | 'edit_plan'
  | 'isometric'
  | 'building_3d'
  | 'bim'
  | 'structural_cad'
  | 'engineering'
  | 'export';

const workspaceTitles: Record<ArgonWorkspaceId, string> = {
  setup: 'Project Brief',
  concepts: 'Massing Studies',
  library: 'Recent Projects',
  cad_2d: '2D Architectural CAD',
  edit_plan: 'Wall & Room Editor',
  isometric: 'Floor Cutaway 3D',
  building_3d: 'Tower 3D',
  bim: 'BIM Studio',
  structural_cad: 'Structural Framing',
  engineering: 'Code Compliance',
  export: 'Drawings & BIM Exports',
};

function layoutSignature(building: Building) {
  const floor = representativeFloor(building);
  if (!floor) return '';
  const points = (polygon: Building['floors'][number]['boundary']) => polygon.points
    .map(({ x, y }) => [Math.round(x / 10), Math.round(y / 10)].join(','))
    .sort()
    .join(';');
  const rooms = floor.rooms.map(room => `${room.type}:${points(room.boundary)}`).sort();
  return JSON.stringify([points(floor.boundary), rooms]);
}

function assessComplianceRepair(source: Building, candidate: Building) {
  const baseline = evaluateUDCPRCompliance(source);
  const audit = evaluateUDCPRCompliance(candidate);
  const original = evaluateStudioLayoutScore(source, baseline);
  const next = evaluateStudioLayoutScore(candidate, audit);
  const failed = (report: typeof audit) => report.rulesChecked.filter(rule => rule.status === 'VIOLATION').length;
  const unresolved = (report: typeof audit) => report.rulesChecked.filter(rule => rule.status === 'NOT_VERIFIED' || rule.status === 'WARNING').length;
  const nonRegressing = next.criteria.every((row, index) =>
    row.earned >= original.criteria[index]!.earned && row.findings.length <= original.criteria[index]!.findings.length);
  return {
    next, audit,
    improved: nonRegressing && unresolved(audit) <= unresolved(baseline) && failed(audit) <= failed(baseline) &&
      validateApartmentClosure(candidate).hardErrors <= validateApartmentClosure(source).hardErrors &&
      (next.score > original.score || failed(audit) < failed(baseline) ||
        next.criteria.some((row, index) => row.findings.length < original.criteria[index]!.findings.length)),
  };
}

type GenerationTarget = 'edit' | 'intake' | 'compare' | 'repair' | 'building_3d';
interface GenerationAttempt {
  readonly data: ProjectSetupWizardData;
  readonly seed: number;
  readonly rejectedHashes: readonly string[];
  readonly target: GenerationTarget;
  readonly projectId: string;
}

interface ArgonStudioShellProps {
  onBackToProjects?: () => void;
}

export const ArgonStudioShell: React.FC<ArgonStudioShellProps> = ({
  onBackToProjects,
}) => {
  const editor = useEditorStore();
  const studio = useStudioStore();
  const [precisionFromBim, setPrecisionFromBim] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<ArgonWorkspaceId>('setup');
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineStageProgressEvent | null>(null);
  const [concepts, setConcepts] = useState<readonly GeneratedConcept[]>([]);
  const [conceptNotice, setConceptNotice] = useState('');
  const [autoFixStatus, setAutoFixStatus] = useState('');
  const [cadImportOpen, setCadImportOpen] = useState(false);
  const [diskProjects, setDiskProjects] = useState<LocalDiskProjectManifest[]>([]);
  const [isSavingDisk, setIsSavingDisk] = useState(false);
  const [saveToast, setSaveToast] = useState('');
  const pendingSourceCad = useRef(new Map<string, NonNullable<CadImportCommittedPayload['sourceCadAttachment']>>());

  const projectList = projectStorage.list();

  const refreshDiskProjects = async () => {
    try {
      const items = await listLocalDiskProjects();
      setDiskProjects(items);
    } catch {
      // Backend disk library unavailable (e.g. offline static preview)
    }
  };

  useEffect(() => {
    void refreshDiskProjects();
  }, []);

  useEffect(() => {
    if (activeWorkspace === 'library' || isProjectSwitcherOpen) {
      void refreshDiskProjects();
    }
  }, [activeWorkspace, isProjectSwitcherOpen]);

  const handleCadImportLoaded = (payload: CadImportCommittedPayload) => {
    const nextBuilding = payload.building;
    if (payload.sourceCadAttachment) pendingSourceCad.current.set(nextBuilding.projectId, payload.sourceCadAttachment);
    editor.setBuilding(nextBuilding, payload.projectName, {}, 'residential');
    const floor = representativeFloor(nextBuilding);
    if (floor) editor.switchFloor(floor.id);
    if (typeof window !== 'undefined') sessionStorage.setItem('rh_welcome_dismissed', 'true');
    setShowWelcome(false);
    setConcepts([{ building: nextBuilding, seed: 1 }]);
    setActiveWorkspace('cad_2d');
    setSaveToast(`Imported ${payload.projectName} (${payload.importMode === 'floor_plan' ? 'CAD Floor Plan' : 'CAD Plot Boundary'})`);
    setTimeout(() => setSaveToast(''), 4000);
  };

  const handleSaveToLocalDisk = async () => {
    if (isSavingDisk) return;
    setIsSavingDisk(true);
    setSaveWarning('');
    try {
      editor.saveProject();
      const current = editor.engine.getBuilding();
      const saved = await saveLocalDiskProject({
        projectId: current.projectId,
        name: editor.projectName || current.name,
        building: current,
        expected: readLocalDiskSaveBase(current.projectId),
        note: `Studio save (${current.metadata.generationBrief?.buildingMassingShape ?? 'layout'})`,
        sourceCad: pendingSourceCad.current.get(current.projectId),
      });
      rememberLocalDiskSaveBase(current.projectId, saved);
      pendingSourceCad.current.delete(current.projectId);
      if (editor.engine.getBuilding().projectId === current.projectId) {
        setSaveToast(`Saved "${saved.manifest.name}" · Disk snapshot ${saved.revision} to local disk`);
      }
      void refreshDiskProjects();
    } catch (err) {
      setSaveWarning(err instanceof Error ? `Local disk save failed: ${err.message}` : 'Local disk save failed.');
    } finally {
      setIsSavingDisk(false);
    }
  };

  const handleOpenDiskProject = async (projectId: string, revision?: number) => {
    try {
      const before = editor.engine.getBuilding();
      const loaded = await loadLocalDiskProject(projectId, revision);
      const local = projectStorage.load(projectId);
      if (local && JSON.stringify(local.building) !== JSON.stringify(loaded.building)) {
        await projectStorage.archiveRevision(projectId, local.building.version);
      }
      if (editor.engine.getBuilding() !== before) throw new Error('The active project changed while opening the disk copy. Try again.');
      const syncedBuilding = loaded.building;
      editor.setBuilding(syncedBuilding, loaded.manifest.name, {}, 'residential');
      rememberLocalDiskSaveBase(projectId, loaded);
      const floor = representativeFloor(syncedBuilding);
      if (floor) editor.switchFloor(floor.id);
      if (typeof window !== 'undefined') sessionStorage.setItem('rh_welcome_dismissed', 'true');
      setShowWelcome(false);
      setConcepts([{ building: syncedBuilding, seed: 1 }]);
      regenerationBrief.current = null;
      setActiveWorkspace(current => (current === 'library' ? 'cad_2d' : current));
      setSaveToast(`Loaded "${loaded.manifest.name}" (Rev. ${loaded.revision}) from local disk`);
      setTimeout(() => setSaveToast(''), 3500);
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : 'Could not load project from local disk.');
    }
  };

  const handleDeleteDiskProject = async (projectId: string) => {
    try {
      await deleteLocalDiskProject(projectId);
      rememberLocalDiskSaveBase(projectId);
      await refreshDiskProjects();
    } catch (err) {
      setSaveWarning(err instanceof Error ? err.message : 'Could not delete project from local disk.');
    }
  };

  const complianceSummary = useMemo(() => {
    try {
      return evaluateStudioLayoutScore(editor.building);
    } catch {
      return null;
    }
  }, [editor.building]);

  const workspaces: Array<{
    id: ArgonWorkspaceId;
    label: string;
    modeGroup: 'Design' | 'Drafting' | 'BIM Coordination' | 'Structural';
    icon: React.ReactNode;
  }> = [
    { id: 'setup', label: 'Brief', modeGroup: 'Design', icon: <Compass className="w-3.5 h-3.5" /> },
    { id: 'concepts', label: 'Massing', modeGroup: 'Design', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'isometric', label: 'Floor 3D', modeGroup: 'Design', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'building_3d', label: 'Tower 3D', modeGroup: 'Design', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'cad_2d', label: '2D CAD', modeGroup: 'Drafting', icon: <DraftingCompass className="w-3.5 h-3.5" /> },
    { id: 'edit_plan', label: 'Edit Plan', modeGroup: 'Drafting', icon: <Edit3 className="w-3.5 h-3.5" /> },
    { id: 'bim', label: 'BIM Studio', modeGroup: 'BIM Coordination', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'engineering', label: 'Compliance', modeGroup: 'BIM Coordination', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'export', label: 'Exports', modeGroup: 'BIM Coordination', icon: <Download className="w-3.5 h-3.5" /> },
    { id: 'structural_cad', label: 'Structural', modeGroup: 'Structural', icon: <Building2 className="w-3.5 h-3.5" /> },
  ];

  const activeRun = useRef<AbortController | null>(null);
  const lastAttempt = useRef<GenerationAttempt | null>(null);
  const regenerationBrief = useRef<{ projectId: string; data: ProjectSetupWizardData } | null>(null);
  const rejectedTopologyHashes = useRef<string[]>([]);
  const usedShapeIds = useRef<string[]>([]);
  const usedArchetypeIds = useRef<string[]>([]);
  const shapeExplicitlyLocked = useRef<boolean>(false);
  const [generationSeed, setGenerationSeed] = useState(1);
  const [generationError, setGenerationError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const canOpenReview = activeWorkspace === 'cad_2d' || activeWorkspace === 'edit_plan';
  const [saveWarning, setSaveWarning] = useState('');
  const [generationFindings, setGenerationFindings] = useState<readonly string[]>([]);

  useEffect(() => () => {
    activeRun.current?.abort();
    activeRun.current = null;
  }, []);

  const projectBrief = regenerationBrief.current?.projectId === editor.projectId
    ? regenerationBrief.current.data : undefined;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `RH Planner — ${workspaceTitles[activeWorkspace]}`;
    }
  }, [activeWorkspace]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const applyGeneratedRevision = async (before: Building, generated: Building, description: string, signal?: AbortSignal) => {
    const history = projectStorage.load(before.projectId)?.revisionHistory ?? [];
    const lastRevision = Math.max(before.version, ...history.map(revision => revision.version));
    const next = generatedRevision(before, generated, lastRevision);
    try {
      await projectStorage.archiveRevision(before.projectId, before.version);
    } catch (error) {
      throw new Error(`Could not archive the current revision. Your current design is still open. Free browser storage and retry. ${error instanceof Error ? error.message : ''}`);
    }
    signal?.throwIfAborted();
    if (editor.engine.getBuilding() !== before) throw new Error('The project changed while saving the previous revision. Try again.');
    const control = editor.getGenerationControl?.() ?? editor.generationControl;
    if (control.lockedFloorIds.length || control.lockedEntityIds.length || control.protectedCoreIds.length) {
      throw new Error('Unlock the protected floors, rooms and cores before replacing the layout.');
    }
    editor.applyRefinement(next, description, true);
    return next;
  };

  const runGeneration = async (
    data: ProjectSetupWizardData,
    seed: number,
    rejectedHashes: readonly string[],
    target: GenerationTarget = 'edit',
    retryProjectId?: string,
  ) => {
    activeRun.current?.abort();
    const controller = new AbortController();
    activeRun.current = controller;
    const before = editor.engine.getBuilding();
    setIsGenerating(true);
    setPipelineProgress(null);
    setGenerationError('');
    setGenerationFindings([]);
    setConceptNotice('');
    try {
      const projectId = target === 'intake' ? retryProjectId ?? crypto.randomUUID() : before.projectId;
      lastAttempt.current = { data, seed, rejectedHashes, target, projectId };
      const assertUnlocked = () => {
        const control = editor.getGenerationControl?.() ?? editor.generationControl;
        if (control.lockedFloorIds.length || control.lockedEntityIds.length || control.protectedCoreIds.length) {
          throw new Error('Unlock the protected floors, rooms and cores before replacing the layout.');
        }
      };
      if (target !== 'intake' && target !== 'compare') assertUnlocked();
      const result = await planInWorker({
        generationRunId: crypto.randomUUID(),
        config: {
          ...createArgonRequest(data, projectId),
          generationSeed: seed,
          rejectedTopologyHashes: [...rejectedHashes],
        },
      }, controller.signal, setPipelineProgress);
      if (activeRun.current !== controller) return;
      if (editor.engine.getBuilding() !== before) {
        throw new Error('The active project changed during generation. Run generation again from the current revision.');
      }
      if (target !== 'intake' && target !== 'compare') assertUnlocked();

      const generated = result.building;
      if (target === 'repair') {
        const next = { ...generated, regulatoryContext: before.regulatoryContext };
        const assessment = assessComplianceRepair(before, next);
        if (assessment.improved) {
          await applyGeneratedRevision(before, next, 'Compliance-guided regeneration', controller.signal);
          setAutoFixStatus(`Applied improved revision. Layout score ${assessment.next.score}/100. Code review status ${assessment.audit.status}.`);
        } else {
          setAutoFixStatus('Regeneration returned no verified improvement. The current revision is still active.');
        }
        return;
      }

      const report = generated.metadata.generationReport;
      const brief = generated.metadata.generationBrief;
      const shape = report?.selectedShapeId ?? brief?.buildingMassingShape;
      const archetype = brief?.archetype;
      if (shape && !usedShapeIds.current.includes(shape)) usedShapeIds.current = [...usedShapeIds.current, shape];
      if (archetype && !usedArchetypeIds.current.includes(archetype)) usedArchetypeIds.current = [...usedArchetypeIds.current, archetype];
      studioStoreActions.recordGeneratedHistory(shape, archetype);

      if (target === 'compare') {
        const prior = concepts.filter(concept => concept.building.projectId === projectId);
        if (prior.length === 0) prior.push({ building: before, seed: generationSeed });
        const duplicateMatch = prior.find(
          entry =>
            layoutSignature(entry.building) === layoutSignature(generated) ||
            !compareCanonicalBuildingAlternatives(entry.building, generated).meaningful,
        );
        if (duplicateMatch) {
          setConceptNotice(
            buildAlternativeExhaustionExplanation(prior.length, prior.length + 1, {
              preserveExteriorFootprint: Boolean(data.buildingMassingShape && data.buildingMassingShape !== 'AUTO'),
            }),
          );
        } else {
          setConcepts([...prior.slice(-3), { building: generated, seed, sourceRevision: before }]);
        }
        setActiveWorkspace('concepts');
        return;
      }

      let design: Building;
      if (target === 'intake') {
        editor.setBuilding(generated, data.projectName, {}, 'residential');
        design = generated;
      } else {
        design = await applyGeneratedRevision(before, generated, 'Regenerate layout', controller.signal);
      }
      setConcepts([{ building: design, seed }]);
      regenerationBrief.current = { projectId, data };
      const floor = representativeFloor(design);
      if (floor) editor.switchFloor(floor.id);
      setGenerationFindings(report?.violations.map(v => `${v.rank}. ${v.severity}: ${v.description}`) ?? []);
      setActiveWorkspace(target === 'intake' ? 'concepts' : target === 'building_3d' ? 'building_3d' : 'cad_2d');
      setSaveWarning('');
    } catch (error) {
      if (activeRun.current !== controller) return;
      setGenerationError(error instanceof Error ? error.message : 'Generation failed. Review the plot and program.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setIsGenerating(false);
      }
    }
  };

  const handleGenerate = (data: ProjectSetupWizardData) => {
    rejectedTopologyHashes.current = [];
    const currentShapes = usedShapeIds.current;
    shapeExplicitlyLocked.current = Boolean(data.buildingMassingShape && data.buildingMassingShape !== 'AUTO' && !data.autoExploreNovelShape);
    setGenerationSeed(1);
    runGeneration(
      {
        ...data,
        usedShapeIds: currentShapes,
        usedArchetypeIds: usedArchetypeIds.current,
      },
      1,
      [],
      'intake',
    );
  };

  const handleRegenerateVariant = (
    target: 'edit' | 'compare' = 'edit',
    controls?: AlternativeExplorationControls,
  ) => {
    const brief = projectBrief ?? studioStoreActions.getProjectSetupWizardData();
    const currentBrief = editor.building.metadata.generationBrief;
    const currentShape = editor.building.metadata.generationBrief?.buildingMassingShape;
    const currentArch = editor.building.metadata.generationBrief?.archetype;
    rejectedTopologyHashes.current = [...new Set([...rejectedTopologyHashes.current,
      currentBrief?.topologyHash, currentBrief?.physicalLayoutHash].filter((hash): hash is string => Boolean(hash)))];
    if (currentShape && !usedShapeIds.current.includes(currentShape)) {
      usedShapeIds.current = [...usedShapeIds.current, currentShape];
    }
    if (currentArch && !usedArchetypeIds.current.includes(currentArch)) {
      usedArchetypeIds.current = [...usedArchetypeIds.current, currentArch];
    }
    const nextSeed = generationSeed + 1;
    setGenerationSeed(nextSeed);
    const lockFootprint = Boolean(controls?.preserveExteriorFootprint);
    const shouldExploreNovel = !lockFootprint && (
      controls?.exploreAlternativeMassing !== undefined
        ? Boolean(controls.exploreAlternativeMassing)
        : !shapeExplicitlyLocked.current || Boolean(brief.autoExploreNovelShape)
    );
    const extraClauses: string[] = [];
    if (controls?.optimizeCarpetArea) extraClauses.push('Prioritize compact efficiency and proper space utilization.');
    if (controls?.improveCirculation) extraClauses.push('Prioritize privacy and circulation with minimal corridors.');
    if (controls?.improveDaylight) extraClauses.push('Prioritize daylight and cross-ventilation.');
    const nextPrompt = extraClauses.length
      ? `${brief.aiPrompt ?? ''} ${extraClauses.join(' ')}`.trim()
      : brief.aiPrompt;
    runGeneration(
      {
        ...brief,
        aiPrompt: nextPrompt,
        ...(lockFootprint && currentShape
          ? { buildingMassingShape: currentShape as BuildingMassingShape, autoExploreNovelShape: false }
          : shouldExploreNovel
            ? { buildingMassingShape: 'AUTO' as const, autoExploreNovelShape: true }
            : {}),
        usedShapeIds: usedShapeIds.current,
        usedArchetypeIds: usedArchetypeIds.current,
      },
      nextSeed,
      rejectedTopologyHashes.current,
      target,
    );
  };

  const handleAutoFix = () => {
    const control = editor.generationControl;
    if (control.lockedFloorIds.length || control.lockedEntityIds.length || control.protectedCoreIds.length) {
      setAutoFixStatus('Unlock the protected floors, rooms and cores before regenerating the full project.'); return;
    }
    const before = editor.building;
    let repaired: Building = { ...before, floors: before.floors.map(fitFloorOpeningsInsideWalls) };
    const findings = evaluateStudioLayoutScore(repaired).criteria.flatMap(criterion => criterion.findings);
    for (const finding of findings.filter(item => item.id === 'INTER_FLAT_OTS' && item.elementIds.length === 3)) {
      try {
        const [candidate] = generateTargetedRefinements({ building: repaired, control,
          selectedRoomIds: finding.elementIds.slice(1), intent: 'carve_interflat_ots' });
        if (candidate) repaired = candidate.building;
      } catch (error) {
        if (!(error instanceof RefinementError)) {
          setAutoFixStatus(error instanceof Error ? error.message : 'Could not evaluate the requested duct repair.');
          return;
        }
      }
    }
    if (assessComplianceRepair(before, repaired).improved) {
      const framed = synthesizeStructuralFraming({ ...repaired, version: before.version + 1,
        metadata: { ...repaired.metadata, generationReport: undefined } });
      const assessment = assessComplianceRepair(before, framed);
      if (assessment.improved) {
        editor.applyRefinement(framed, 'Compliance action plan repairs');
        setAutoFixStatus(`Applied improved revision. Layout score ${assessment.next.score}/100. Code review status ${assessment.audit.status}.`);
        return;
      }
    }
    const brief = regenerationBrief.current;
    if (brief?.projectId !== before.projectId) {
      setAutoFixStatus('No verified local improvement. Full regeneration requires the original brief in this session.');
      return;
    }
    const nextSeed = generationSeed + 1;
    const generated = editor.building.metadata.generationBrief;
    rejectedTopologyHashes.current = [generated?.topologyHash, generated?.physicalLayoutHash]
      .filter((hash): hash is string => Boolean(hash));
    setAutoFixStatus('');
    setGenerationSeed(nextSeed);
    runGeneration(brief.data, nextSeed, rejectedTopologyHashes.current, 'repair');
  };

  const handleSelectMassingVariant = (shape: BuildingMassingShape) => {
    studioStoreActions.updateWizard({ buildingMassingShape: shape, autoExploreNovelShape: false });
    shapeExplicitlyLocked.current = true;
    const briefBase = projectBrief ?? studioStoreActions.getProjectSetupWizardData();
    const updatedBrief: ProjectSetupWizardData = {
      ...briefBase,
      buildingMassingShape: shape,
      autoExploreNovelShape: false,
      usedShapeIds: usedShapeIds.current,
      usedArchetypeIds: usedArchetypeIds.current,
    };
    rejectedTopologyHashes.current = [];
    setGenerationSeed(1);
    runGeneration(updatedBrief, 1, []);
  };

  const handleSelectPlanCategory = (category: PlanCategory) => {
    studioStoreActions.updateWizard({ planCategory: category });
    const briefBase = projectBrief ?? studioStoreActions.getProjectSetupWizardData();
    const updatedBrief: ProjectSetupWizardData = {
      ...briefBase,
      planCategory: category,
      ...(category === 'LUXURY_VILLA_BUNGALOW'
        ? {
          flatsPerFloor: 1,
          hasStiltParking: false,
          floorsCount: 2,
          bhkMix: [{ unitType: '4BHK', carpetAreaSqFt: 1800, count: 1 }],
        }
        : {}),
      usedShapeIds: usedShapeIds.current,
      usedArchetypeIds: usedArchetypeIds.current,
    };
    rejectedTopologyHashes.current = [];
    setGenerationSeed(1);
    runGeneration(updatedBrief, 1, []);
  };

  const handleToggleAutoExplore = (enabled: boolean) => {
    studioStoreActions.updateWizard({
      autoExploreNovelShape: enabled,
      ...(enabled ? { buildingMassingShape: 'AUTO' } : {}),
    });
    shapeExplicitlyLocked.current = !enabled;
  };

  const cancelGeneration = () => {
    activeRun.current?.abort();
    activeRun.current = null;
    setIsGenerating(false);
    setGenerationError('');
    setPipelineProgress(null);
  };

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem('rh_welcome_dismissed') !== 'true';
  });
  const [welcomeMountKey, setWelcomeMountKey] = useState(0);

  const openWelcomeHome = () => {
    setWelcomeMountKey(k => k + 1);
    setShowWelcome(true);
  };

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('rh_welcome_dismissed', 'true');
    }
    setShowWelcome(false);
  };

  const handleStartFromWelcome = (
    projectType: 'new_construction' | 'redevelopment' = 'new_construction',
    initialStep: 1 | 2 | 3 | 4 = 1,
  ) => {
    studioStoreActions.setProjectType(projectType);
    studioStoreActions.setStep(initialStep);
    dismissWelcome();
    setActiveWorkspace('setup');
  };

  const paletteCommands = useMemo<WorkspaceCommand[]>(
    () => [
      {
        id: 'open-welcome',
        label: 'Return to RH Planner Welcome Experience',
        group: 'Views',
        keywords: ['welcome', 'home', 'intro'],
        run: () => openWelcomeHome(),
      },
      ...workspaces.map(ws => ({
        id: `ws-${ws.id}`,
        label: `Open ${ws.label}`,
        group: 'Views' as const,
        keywords: [ws.id, ws.label],
        run: () => {
          dismissWelcome();
          setActiveWorkspace(ws.id);
        },
      })),
      {
        id: 'toggle-theme',
        label: `Switch Studio Theme (${studio.studioTheme === 'day' ? 'Cinematic Night' : 'Daylight'})`,
        group: 'Views',
        keywords: ['theme', 'daylight', 'night'],
        run: () => studioStoreActions.setStudioTheme(studio.studioTheme === 'day' ? 'night' : 'day'),
      },
      {
        id: 'new-redev',
        label: 'Start Society Redevelopment Project Setup',
        group: 'Project',
        keywords: ['redevelopment', 'new', 'wizard'],
        run: () => handleStartFromWelcome('redevelopment'),
      },
    ],
    [studio.studioTheme],
  );

  const complianceScore = complianceSummary?.score;
  const compliancePassing = complianceSummary?.passed;

  return (
      <div
        data-theme="obsidian"
        data-studio-surface={studio.studioTheme === 'day' ? 'warm-paper' : 'obsidian'}
        data-lighting={studio.lightingMode}
        data-unit={studio.displayUnit}
        className="argon-shell rh-portfolio-shell rh-atelier-studio rh-obsidian-shell flex flex-col h-screen w-screen overflow-hidden relative"
      >
      {showWelcome && (
        <RHWelcomeScreen
          key={welcomeMountKey}
          onStartNewProject={(type) => handleStartFromWelcome(type, 1)}
          onImportReference={() => {
            dismissWelcome();
            setCadImportOpen(true);
          }}
          onOpenExisting={() => {
            dismissWelcome();
            setActiveWorkspace('library');
          }}
          lightingMode={studio.lightingMode}
          onToggleLightingMode={(mode) => studioStoreActions.setLightingMode(mode)}
        />
      )}

        {/* SINGLE SLEEK 56px UNIFIED ARCHITECTURAL TOP NAVIGATION BAR */}
        {!showWelcome && <header className="rh-studio-header rh-obsidian-topbar z-50 flex-shrink-0">
          {/* Left: RH PLANNER Monogram + Active Project Selector */}
          <div className="rh-topbar-left">
            <button
              type="button"
              data-testid="nav-welcome-home"
              onClick={openWelcomeHome}
              className="rh-topbar-brand"
              title="Return to Architectural Showcase"
            >
              <span className="rh-monogram-mark" aria-hidden="true">RH</span>
              <span className="rh-monogram-word">PLANNER</span>
            </button>

            <div className="rh-topbar-divider" aria-hidden="true" />

            <div className="relative">
              <button
                type="button"
                data-testid="project-switcher-trigger"
                onClick={() => setIsProjectSwitcherOpen(!isProjectSwitcherOpen)}
                className="rh-project-pill"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="rh-project-pill-name truncate">
                  {editor.projectName || 'Manu Residences Towers'}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isProjectSwitcherOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {isProjectSwitcherOpen && (
                <div className="rh-obsidian-popover absolute top-full left-0 mt-2 w-72 rounded-xl shadow-2xl z-[100] overflow-hidden">
                  <div className="p-3 border-b border-white/10 flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-widest">
                      Projects ({projectList.length})
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsProjectSwitcherOpen(false);
                          setActiveWorkspace('library');
                        }}
                        className="text-[10px] font-mono text-sky-400 hover:text-sky-300 cursor-pointer"
                      >
                        LIBRARY
                      </button>
                      <button
                        type="button"
                        data-testid="btn-new-project-from-switcher"
                        onClick={() => {
                          studioStoreActions.resetWizard();
                          setIsProjectSwitcherOpen(false);
                          setActiveWorkspace('setup');
                        }}
                        className="text-[10px] font-mono font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> NEW
                      </button>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto argon-scrollbar p-1.5">
                    {projectList.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400 text-center">
                        No saved projects yet — click NEW to initialize a brief.
                      </div>
                    ) : (
                      projectList.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            editor.loadProject(p.id);
                            setConcepts([]);
                            setIsProjectSwitcherOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-lg transition-colors mb-1 text-left cursor-pointer ${p.id === editor.projectId
                            ? 'bg-amber-500/15 border border-amber-400/35'
                            : 'hover:bg-white/5 border border-transparent'
                            }`}
                        >
                          <div className="min-w-0">
                            <div
                              className={`text-xs font-semibold truncate ${p.id === editor.projectId ? 'text-amber-300' : 'text-slate-100'
                                }`}
                            >
                              {p.name}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5 tabular-nums">
                              {p.floorCount} FLOORS · {p.roomCount} ROOMS
                            </div>
                          </div>
                          {p.id === editor.projectId && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="flex border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        editor.saveProject();
                        setIsProjectSwitcherOpen(false);
                      }}
                      className="flex-1 py-2.5 text-center text-[11px] font-mono text-slate-300 hover:text-white hover:bg-white/5 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5 text-sky-400" /> Save Revision
                    </button>
                    {onBackToProjects && (
                      <button
                        type="button"
                        onClick={onBackToProjects}
                        className="flex-1 py-2.5 text-center text-[11px] font-mono text-slate-400 hover:text-slate-200 hover:bg-white/5 border-l border-white/10 cursor-pointer"
                      >
                        Reset Session
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center: 4 Architectural Studio Workflow Mode Groups */}
          <nav aria-label="Studio Workspaces" className="rh-topbar-nav">
            {workspaces.map((ws, idx) => {
              const prevGroup = idx > 0 ? workspaces[idx - 1]?.modeGroup : ws.modeGroup;
              return (
                <React.Fragment key={ws.id}>
                  {idx > 0 && prevGroup !== ws.modeGroup && (
                    <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-white/15 shrink-0 hidden xl:inline-block" />
                  )}
                  <button
                    type="button"
                    data-testid={`nav-${ws.id}`}
                    data-mode-group={ws.modeGroup}
                    title={`${ws.modeGroup} · ${ws.label}`}
                    aria-current={activeWorkspace === ws.id ? 'page' : undefined}
                    onClick={() => {
                      if (ws.id !== 'cad_2d') setPrecisionFromBim(false);
                      setActiveWorkspace(ws.id);
                    }}
                    className="rh-topbar-tab"
                  >
                    {ws.icon}
                    <span className="whitespace-nowrap">{ws.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Right: Canonical Sync Pill + Import CAD + Save + Library + FT/M Toggle + Surface & Lighting Switch + Compliance Pill */}
          <div className="rh-topbar-right">
            <span
              data-testid="topbar-canonical-sync-pill"
              title={`Unified Canonical Revision ${editor.building.version} · ${editor.activeFloor?.name ?? 'Storey'}${editor.selection ? ` · Selected ${editor.selection.entityType}` : ''}`}
              className="hidden 2xl:inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-300 tabular-nums"
            >
              <span>Rev #{editor.building.version}</span>
              <span aria-hidden="true">·</span>
              <span className="max-w-[90px] truncate">{editor.activeFloor?.name ?? 'Floor'}</span>
              {editor.selection && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="uppercase">{editor.selection.entityType}</span>
                </>
              )}
            </span>
            <button
              type="button"
              data-testid="studio-surface-theme-toggle"
              aria-pressed={studio.studioTheme === 'day'}
              title="Toggle Warm Architectural Paper / Obsidian Studio Surface"
              onClick={() => studioStoreActions.setStudioTheme(studio.studioTheme === 'day' ? 'night' : 'day')}
              className="rh-topbar-tab hidden xl:inline-flex"
            >
              <span className="font-mono text-[10px]">{studio.studioTheme === 'day' ? 'Warm Paper' : 'Obsidian'}</span>
            </button>
            {canOpenReview && <button type="button" aria-label="Architectural design review" aria-expanded={reviewOpen}
              title="Architectural design review" className="rh-topbar-tab"
              onClick={() => setReviewOpen(open => !open)}>
              <Sparkles className="w-3.5 h-3.5" />
            </button>}
            <button
              type="button"
              data-testid="topbar-import-cad"
              onClick={() => setCadImportOpen(true)}
              className="rh-topbar-tab rh-topbar-action-cad"
              title="Import local .DXF, .DWG, or .PDF plot or floor plan"
            >
              <FileUp className="w-3.5 h-3.5 text-sky-400" />
              <span className="rh-topbar-action-label whitespace-nowrap">Import CAD</span>
            </button>

            <button
              type="button"
              data-testid="topbar-save-local"
              disabled={isSavingDisk}
              onClick={() => void handleSaveToLocalDisk()}
              className="rh-topbar-tab rh-topbar-action-save"
              title="Save active revision to local disk library"
            >
              <Save className="w-3.5 h-3.5 text-amber-400" />
              <span className="rh-topbar-action-label whitespace-nowrap">{isSavingDisk ? 'Saving…' : 'Save'}</span>
            </button>

            <button
              type="button"
              data-testid="nav-library"
              aria-current={activeWorkspace === 'library' ? 'page' : undefined}
              onClick={() => setActiveWorkspace('library')}
              className="rh-topbar-tab rh-topbar-action-library"
              title="Open Local Disk Project Library"
            >
              <Library className="w-3.5 h-3.5" />
              <span className="rh-topbar-action-label whitespace-nowrap">Library</span>
            </button>

            <div className="rh-segmented-pill" role="group" aria-label="Measurement Units">
              <button
                type="button"
                data-testid="unit-toggle-ft"
                aria-pressed={studio.displayUnit === 'ft'}
                onClick={() => studioStoreActions.setDisplayUnit('ft')}
              >
                FT
              </button>
              <button
                type="button"
                data-testid="unit-toggle-m"
                aria-pressed={studio.displayUnit === 'm'}
                onClick={() => studioStoreActions.setDisplayUnit('m')}
              >
                M
              </button>
            </div>

            {activeWorkspace !== 'building_3d' && (
              <div className="rh-segmented-pill rh-lighting-pill" role="group" aria-label="Viewport Lighting">
                <button
                  type="button"
                  data-testid="shell-light-day"
                  aria-pressed={studio.lightingMode === 'day'}
                  title="Morning Daylight"
                  onClick={() => studioStoreActions.setLightingMode('day')}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span className="hidden 2xl:inline">Day</span>
                </button>
                <button
                  type="button"
                  data-testid="shell-light-golden"
                  aria-pressed={studio.lightingMode === 'golden'}
                  title="Golden Sunset"
                  onClick={() => studioStoreActions.setLightingMode('golden')}
                >
                  <Sunset className="w-3.5 h-3.5" />
                  <span className="hidden 2xl:inline">Sunset</span>
                </button>
                <button
                  type="button"
                  data-testid="shell-theme-toggle"
                  aria-pressed={studio.lightingMode === 'night'}
                  title="Night Illumination"
                  onClick={() => studioStoreActions.setLightingMode('night')}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span className="hidden 2xl:inline">Night</span>
                </button>
              </div>
            )}

            <button
              type="button"
              data-testid="topbar-compliance-pill"
              onClick={() => setActiveWorkspace('engineering')}
              className={`rh-compliance-pill ${compliancePassing ? 'is-pass' : 'is-warn'}`}
              title="Open Code Compliance rule breakdown"
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="tabular-nums">{complianceScore === undefined ? 'Unverified' : `${complianceScore}/100`}</span>
            </button>
          </div>
        </header>}

        {!showWelcome && <main className="rh-portfolio-main min-h-0 flex-1 flex flex-col overflow-hidden">
          <div
            key={activeWorkspace}
            className="rh-portfolio-body rh-tab-transition relative flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {activeWorkspace === 'library' && (
              <ProjectLibrary
                projects={projectList}
                diskProjects={diskProjects}
                onCreate={() => handleStartFromWelcome()}
                onImportCad={() => setCadImportOpen(true)}
                onOpen={id => {
                  editor.loadProject(id);
                  setConcepts([]);
                  regenerationBrief.current = null;
                  setActiveWorkspace('cad_2d');
                }}
                onOpenDiskProject={(id, rev) => void handleOpenDiskProject(id, rev)}
                onDeleteDiskProject={(id) => void handleDeleteDiskProject(id)}
              />
            )}
            {activeWorkspace === 'concepts' && (
              <ConceptReviewWorkspace activeBuilding={editor.building} concepts={concepts}
                canGenerate={Boolean(projectBrief) && !isGenerating} notice={conceptNotice}
                onGenerate={(ctrls) => handleRegenerateVariant('compare', ctrls)} onOpen={async ({ building, sourceRevision }) => {
                  try {
                    const before = editor.engine.getBuilding();
                    let design = before;
                    if (sourceRevision && building.metadata.generationRunId !== before.metadata.generationRunId) {
                      if (sourceRevision !== before) throw new Error('The project has changed. Generate an alternative for the current revision.');
                      const control = editor.getGenerationControl?.() ?? editor.generationControl;
                      if (control.lockedFloorIds.length || control.lockedEntityIds.length || control.protectedCoreIds.length) {
                        throw new Error('Unlock protected elements before applying this alternative.');
                      }
                      design = await applyGeneratedRevision(before, building, 'Apply massing alternative');
                      setConcepts([{ building: design, seed: generationSeed }]);
                    }
                    const floor = representativeFloor(design);
                    if (floor) editor.switchFloor(floor.id);
                    setActiveWorkspace('cad_2d');
                  } catch (error) {
                    setConceptNotice(error instanceof Error ? error.message : 'Could not apply this alternative.');
                  }
                }} />
            )}
            {activeWorkspace === 'setup' && (
              <Suspense fallback={<p role="status" className="p-4">Opening project setup…</p>}>
                <ProjectSetupWizard onGenerate={handleGenerate} onCancel={() => setActiveWorkspace('cad_2d')}
                  onBackToWelcome={openWelcomeHome} onOpenCadImport={() => setCadImportOpen(true)} />
              </Suspense>
            )}
            {activeWorkspace === 'cad_2d' && (
              <ArchitecturalCADWorkspace
                initialPrecisionCadOpen={precisionFromBim}
                editor={editor}
                onRegeneratePlan={() => handleRegenerateVariant()}
                onSelectMassingVariant={handleSelectMassingVariant}
                onSelectPlanCategory={handleSelectPlanCategory}
                onToggleAutoExplore={handleToggleAutoExplore}
                autoExploreEnabled={Boolean(studio.wizard.autoExploreNovelShape)}
                onOpenEditPlan={() => setActiveWorkspace('edit_plan')}
                generationSeed={generationSeed}
                isGenerating={isGenerating}
                canRegenerate={Boolean(projectBrief) || Boolean(studio.isBhkMixValid)}
              />
            )}
            {activeWorkspace === 'edit_plan' && (
              <InteractivePlanEditorPage
                editor={editor}
                onBackToCad={() => setActiveWorkspace('cad_2d')}
              />
            )}
            {activeWorkspace === 'isometric' && <FloorIsometricEditor editor={editor} lightingMode={studio.lightingMode} />}
            {activeWorkspace === 'building_3d' && (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-sm font-mono text-slate-400">
                    Loading Tower 3D PBR Engine...
                  </div>
                }
              >
                <LazyBuilding3DCustomizer
                  editor={editor}
                  lightingMode={studio.lightingMode}
                  onLightingModeChange={studioStoreActions.setLightingMode}
                  onGalleryCoordinationModeChange={(mode: GalleryCoordinationMode) => {
                    studioStoreActions.updateWizard({
                      galleryCoordinationMode: mode,
                      staggeredBalconies: mode === 'DOUBLE_HEIGHT_STAGGER',
                    });
                    const brief = projectBrief;
                    if (brief) {
                      const nextBrief: ProjectSetupWizardData = {
                        ...brief,
                        galleryCoordinationMode: mode,
                        staggeredBalconies: mode === 'DOUBLE_HEIGHT_STAGGER',
                        buildingMassingShape:
                          (editor.building.metadata?.generationBrief?.buildingMassingShape as BuildingMassingShape | undefined) ??
                          brief.buildingMassingShape,
                      };
                      runGeneration(nextBrief, generationSeed, rejectedTopologyHashes.current, 'building_3d');
                    } else {
                      const coordinated = coordinateBuildingFacade(editor.building, {
                        galleryCoordinationMode: mode,
                      });
                      editor.applyRefinement(
                        { ...coordinated, version: editor.building.version + 1 },
                        `Switch gallery rhythm to ${mode}`,
                      );
                    }
                  }}
                />
              </Suspense>
            )}
            {activeWorkspace === 'bim' && (
              <Suspense fallback={<p role="status" className="p-4">Opening BIM Studio…</p>}>
                {editor.activeFloor ? <BimStudio key={editor.building.projectId} editor={editor}
                  onOpenCad={() => { setPrecisionFromBim(true); setActiveWorkspace('cad_2d'); }} />
                  : <p>Open an accepted building to inspect BIM quantities.</p>}
              </Suspense>
            )}
            {activeWorkspace === 'structural_cad' && (
              <Suspense fallback={<p role="status" className="p-4">Opening structural drawings…</p>}>
                <StructuralCADWorkspace editor={editor} />
              </Suspense>
            )}
            {activeWorkspace === 'engineering' && (
              <UdcprEtabsAnalysis editor={editor} onHighlight={() => setActiveWorkspace('cad_2d')}
                onAutoFix={!isGenerating ? handleAutoFix : undefined} autoFixStatus={autoFixStatus} />
            )}
            {activeWorkspace === 'export' && (
              <Suspense fallback={<p role="status" className="p-4">Opening exports…</p>}>
                <ExportCenterWorkspace editor={editor} />
              </Suspense>
            )}

            {generationFindings.length > 0 &&
              (activeWorkspace === 'cad_2d' || activeWorkspace === 'engineering' || activeWorkspace === 'concepts') && (
                <details className="fixed bottom-4 right-4 z-30 max-w-md max-h-60 overflow-auto rounded-lg border border-amber-300 bg-amber-50/95 p-3 text-xs text-amber-950 shadow-lg backdrop-blur">
                  <summary>
                    {generationFindings.length} generation findings · Professional review required
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {generationFindings.map((finding, i) => (
                      <li key={i}>{finding}</li>
                    ))}
                  </ol>
                </details>
              )}
            {(saveWarning || (editor.persistence.projectId === editor.projectId &&
              (editor.persistence.state === 'FAILED' || editor.persistence.state === 'UNAVAILABLE'))) && (
              <div
                role="status"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl px-4 py-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm shadow-lg flex items-start gap-3"
              >
                <span className="font-bold shrink-0">NOT SAVED</span>
                <span className="flex-1">{saveWarning || `Browser save failed: ${editor.persistence.reason ?? editor.persistence.state}. Your work is still open.`}</span>
                {!saveWarning && <>
                  <button type="button" onClick={editor.saveProject} className="shrink-0 font-bold underline">Retry browser save</button>
                  <button type="button" className="shrink-0 font-bold underline" onClick={() => {
                    const project = projectStorage.load(editor.projectId);
                    if (project) exportProjectAsJsonFile(project);
                  }}>Export project</button>
                </>}
                {saveWarning && <button
                  onClick={() => setSaveWarning('')}
                  className="shrink-0 font-bold text-amber-700 hover:text-amber-900"
                  aria-label="Dismiss the storage warning"
                >
                  ×
                </button>}
              </div>
            )}

            {canOpenReview && reviewOpen && <DesignAssistant key={editor.projectId} editor={editor}
              onClose={() => setReviewOpen(false)} onEdit={() => { setReviewOpen(false); setActiveWorkspace('edit_plan'); }} />}
            <GenerationProgressModal
              isOpen={isGenerating}
              progress={pipelineProgress}
              error={generationError}
              draft={studio.wizard}
              onRetry={() => {
                const attempt = lastAttempt.current;
                if (attempt) void runGeneration(attempt.data, attempt.seed, attempt.rejectedHashes, attempt.target, attempt.projectId);
              }}
              onCancel={cancelGeneration}
            />
          </div>
        </main>}

        <CommandPalette
          open={paletteOpen}
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />

        <CadImportModal
          isOpen={cadImportOpen}
          onClose={() => setCadImportOpen(false)}
          onLoaded={handleCadImportLoaded}
        />

        {saveToast && (
          <div
            role="status"
            data-testid="local-save-toast"
            className="fixed bottom-5 right-5 z-[180] px-4 py-2.5 rounded-xl text-xs font-mono flex items-center gap-2 shadow-2xl"
            style={{
              background: 'rgba(13, 17, 25, 0.94)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#FDE68A',
              backdropFilter: 'blur(16px)',
            }}
          >
            <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{saveToast}</span>
            <button type="button" className="px-1" aria-label="Dismiss project status" onClick={() => setSaveToast('')}>×</button>
          </div>
        )}
      </div>
      );
};
