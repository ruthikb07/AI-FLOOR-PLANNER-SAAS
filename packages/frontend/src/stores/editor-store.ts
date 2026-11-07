/**
 * Editor Store & React Hooks.
 * Provides subscription to EditorEngine events without duplicating domain geometry.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Building, Floor, GenerationControlState, RoomType } from '@ai-floor-planner/core';
import {
  EditorEngine,
  SelectEntityCommand,
  ClearSelectionCommand,
  SwitchFloorCommand,
  SetToolCommand,
  DeleteEntityCommand,
  IEditorCommand,
  EditorTool,
  EditorSelection,
  SetSelectionsCommand,
  ReplaceBuildingCommand,
  UpdateSiteCommand,
  type UpdateSiteParams,
  createGenerationControlState,
  updateGenerationControl,
  validateGenerationControl,
  type DesignDiagnostics,
} from '@ai-floor-planner/core';
import { evaluateDesign, diagnosticsToValidation, type ValidationSummary } from '@ai-floor-planner/planning-engine';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  projectStorage,
  ProjectEnvelope,
  BuildingCategory,
  ProjectLifecycleStatus,
  createCanonical30x50_2BHK,
} from '../services/storage';

export interface EditorContextValue {
  engine: EditorEngine;
  building: Building;
  activeFloor: Floor;
  selection: EditorSelection | null;
  selections: readonly EditorSelection[];
  generationControl: GenerationControlState;
  activeTool: EditorTool;
  canUndo: boolean;
  canRedo: boolean;
  validationSummary: ValidationSummary;
  diagnostics: DesignDiagnostics;
  projectName: string;
  projectId: string;
  projectCategory: BuildingCategory;
  projectStatus: ProjectLifecycleStatus;
  requiredRoomCounts: Partial<Record<RoomType, number>>;
  executeCommand: (cmd: IEditorCommand) => void;
  undo: () => void;
  redo: () => void;
  selectEntity: (entityType: string, entityId: string, floorId?: string) => void;
  toggleRoomSelection: (entityId: string, floorId?: string) => void;
  clearSelection: () => void;
  switchFloor: (floorId: string) => void;
  setTool: (tool: EditorTool) => void;
  deleteSelected: () => void;
  saveProject: () => void;
  revalidate: () => void;
  setRoomLocks: (roomIds: readonly string[], locked: boolean) => void;
  setFloorLock: (floorId: string, locked: boolean) => void;
  setCoreLock: (coreId: string, locked: boolean) => void;
  applyRefinement: (building: Building, description?: string) => void;
  loadProject: (projectId: string) => void;
  setBuilding: (
    building: Building,
    name?: string,
    requiredRoomCounts?: Partial<Record<RoomType, number>>,
    category?: BuildingCategory,
  ) => void;
  updateSite: (params: UpdateSiteParams) => void;
  setRequiredRoomCounts: (counts: Partial<Record<RoomType, number>>) => void;
  addFloor: (name?: string, floorHeight?: number) => void;
  removeFloor: (floorId: string) => void;
}

export function useEditorStore() {
  // Initialize from active project or default 30x50
  const initialEnvelope = useMemo<ProjectEnvelope>(() => {
    const activeId = projectStorage.getActiveProjectId();
    if (activeId) {
      const loaded = projectStorage.load(activeId);
      if (loaded) {
        const isLegacyCanonical = loaded.projectId === 'proj_30x50_2bhk'
          && loaded.schemaVersion < CURRENT_PROJECT_SCHEMA_VERSION;
        if (!isLegacyCanonical) return loaded;
      }
    }
    const defaultBuilding = createCanonical30x50_2BHK();
    const env: ProjectEnvelope = {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId: defaultBuilding.projectId,
      name: defaultBuilding.name,
      createdAt: defaultBuilding.createdAt,
      updatedAt: defaultBuilding.updatedAt,
      building: defaultBuilding,
      requiredRoomCounts: {
        living: 1,
        dining: 1,
        kitchen: 1,
        bedroom: 2,
        bathroom: 1,
      },
      category: 'residential',
      status: 'CONCEPT',
    };
    projectStorage.save(env);
    return env;
  }, []);

  const [projectName, setProjectName] = useState(initialEnvelope.name);
  const [projectId, setProjectId] = useState(initialEnvelope.projectId);
  const [projectCategory, setProjectCategory] = useState<BuildingCategory>(initialEnvelope.category ?? 'residential');
  const [projectStatus, setProjectStatus] = useState<ProjectLifecycleStatus>(initialEnvelope.status ?? 'CONCEPT');
  const projectIdentityRef = useRef({
    id: initialEnvelope.projectId,
    name: initialEnvelope.name,
    category: initialEnvelope.category ?? 'residential' as BuildingCategory,
    status: initialEnvelope.status ?? 'CONCEPT' as ProjectLifecycleStatus,
  });

  // Single EditorEngine instance
  const engine = useMemo(() => {
    return new EditorEngine(initialEnvelope.building);
  }, [initialEnvelope.building]);

  // Reactive state synced with EditorEngine
  const [building, setBuildingState] = useState<Building>(() => engine.getBuilding());
  const [editorState, setEditorState] = useState(() => engine.getState());
  const initialControl = validateGenerationControl(
    initialEnvelope.generationControl ?? createGenerationControlState(),
    initialEnvelope.building,
  ).state;
  const [generationControl, setGenerationControlState] = useState<GenerationControlState>(initialControl);
  const generationControlRef = useRef(initialControl);
  const requiredRoomCountsRef = useRef<Partial<Record<RoomType, number>>>(
    initialEnvelope.requiredRoomCounts ?? {},
  );

  // Real-time non-blocking design diagnostics & legacy-compatible validation summary
  const [diagnostics, setDiagnostics] = useState<DesignDiagnostics>(() => {
    return evaluateDesign(engine.getBuilding());
  });
  const [validationSummary, setValidationSummary] = useState<ValidationSummary>(() => {
    return diagnosticsToValidation(engine.getBuilding(), {
      requiredRoomCounts: requiredRoomCountsRef.current,
    });
  });

  // Subscribe to engine events
  useEffect(() => {
    const unsubscribe = engine.subscribe((event) => {
      const b = engine.getBuilding();
      const s = engine.getState();

      setBuildingState(b);
      setEditorState(s);

      if (event.type === 'building_changed' || event.type === 'history_changed') {
        const diag = evaluateDesign(b);
        const report = diagnosticsToValidation(b, {
          requiredRoomCounts: requiredRoomCountsRef.current,
        });
        setDiagnostics(diag);
        setValidationSummary(report);

        // Auto-save to LocalStorage on mutations
        try {
          projectStorage.save({
            schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
            projectId: projectIdentityRef.current.id,
            name: projectIdentityRef.current.name,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            building: b,
            requiredRoomCounts: requiredRoomCountsRef.current,
            category: projectIdentityRef.current.category,
            status: projectIdentityRef.current.status,
            generationControl: validateGenerationControl(generationControlRef.current, b).state,
          });
        } catch (e) {
          console.warn('Autosave warning:', e);
        }
      }
    });

    return () => unsubscribe();
  }, [engine]);

  const activeFloor = useMemo(() => {
    const currentFloor = building.floors.find(f => f.id === editorState.activeFloorId);
    return currentFloor ?? building.floors[0]!;
  }, [building, editorState.activeFloorId]);

  const executeCommand = useCallback((cmd: IEditorCommand) => {
    engine.execute(cmd);
  }, [engine]);

  const undo = useCallback(() => {
    engine.undo();
  }, [engine]);

  const redo = useCallback(() => {
    engine.redo();
  }, [engine]);

  const selectEntity = useCallback((entityType: string, entityId: string, floorId?: string) => {
    engine.execute(new SelectEntityCommand({
      entityType: entityType as any,
      entityId,
      floorId: floorId ?? activeFloor.id,
    }));
  }, [engine, activeFloor.id]);

  const toggleRoomSelection = useCallback((entityId: string, floorId?: string) => {
    const selection: EditorSelection = { entityType: 'room', entityId, floorId: floorId ?? activeFloor.id };
    const current = engine.getState().selections ?? [];
    const exists = current.some(item => item.entityType === 'room' && item.entityId === entityId);
    engine.execute(new SetSelectionsCommand(exists ? current.filter(item => item.entityId !== entityId) : [...current, selection]));
  }, [engine, activeFloor.id]);

  const clearSelection = useCallback(() => {
    engine.execute(new ClearSelectionCommand());
  }, [engine]);

  const switchFloor = useCallback((floorId: string) => {
    engine.execute(new SwitchFloorCommand(floorId));
  }, [engine]);

  const setTool = useCallback((tool: EditorTool) => {
    engine.execute(new SetToolCommand(tool));
  }, [engine]);

  const deleteSelected = useCallback(() => {
    if (!editorState.selection) return;
    engine.execute(new DeleteEntityCommand(editorState.selection.entityType, editorState.selection.entityId));
  }, [engine, editorState.selection]);

  const saveProject = useCallback(() => {
    projectStorage.save({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId,
      name: projectName,
      createdAt: building.createdAt,
      updatedAt: new Date().toISOString(),
      building,
      requiredRoomCounts: requiredRoomCountsRef.current,
      category: projectCategory,
      status: projectStatus,
      generationControl,
    });
  }, [projectId, projectName, building, projectCategory, projectStatus, generationControl]);

  const persistControl = useCallback((next: GenerationControlState) => {
    const validated = validateGenerationControl(next, engine.getBuilding()).state;
    generationControlRef.current = validated;
    setGenerationControlState(validated);
    projectStorage.save({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId: projectIdentityRef.current.id,
      name: projectIdentityRef.current.name,
      createdAt: engine.getBuilding().createdAt,
      updatedAt: new Date().toISOString(),
      building: engine.getBuilding(),
      requiredRoomCounts: requiredRoomCountsRef.current,
      category: projectIdentityRef.current.category,
      status: projectIdentityRef.current.status,
      generationControl: validated,
    });
  }, [engine]);

  const setRoomLocks = useCallback((roomIds: readonly string[], locked: boolean) => {
    const current = new Set(generationControlRef.current.lockedEntityIds);
    roomIds.forEach(id => locked ? current.add(id) : current.delete(id));
    persistControl(updateGenerationControl(generationControlRef.current, { lockedEntityIds: [...current] }));
  }, [persistControl]);

  const setFloorLock = useCallback((floorId: string, locked: boolean) => {
    const current = new Set(generationControlRef.current.lockedFloorIds);
    if (locked) current.add(floorId); else current.delete(floorId);
    persistControl(updateGenerationControl(generationControlRef.current, { lockedFloorIds: [...current] }));
  }, [persistControl]);

  const setCoreLock = useCallback((coreId: string, locked: boolean) => {
    const current = new Set(generationControlRef.current.protectedCoreIds);
    if (locked) current.add(coreId); else current.delete(coreId);
    persistControl(updateGenerationControl(generationControlRef.current, { protectedCoreIds: [...current] }));
  }, [persistControl]);

  const applyRefinement = useCallback((nextBuilding: Building, description = 'Targeted regeneration') => {
    engine.execute(new ReplaceBuildingCommand(engine.getBuilding(), nextBuilding, description));
  }, [engine]);

  const revalidate = useCallback(() => {
    setDiagnostics(evaluateDesign(building));
    setValidationSummary(diagnosticsToValidation(building, {
      requiredRoomCounts: requiredRoomCountsRef.current,
    }));
  }, [building]);

  const loadProject = useCallback((newProjectId: string) => {
    const loaded = projectStorage.load(newProjectId);
    if (!loaded) return;
    setProjectId(loaded.projectId);
    setProjectName(loaded.name);
    setProjectCategory(loaded.category ?? 'residential');
    setProjectStatus(loaded.status ?? 'CONCEPT');
    projectIdentityRef.current = {
      id: loaded.projectId,
      name: loaded.name,
      category: loaded.category ?? 'residential',
      status: loaded.status ?? 'CONCEPT',
    };
    requiredRoomCountsRef.current = loaded.requiredRoomCounts ?? {};
    const loadedControl = validateGenerationControl(loaded.generationControl, loaded.building).state;
    generationControlRef.current = loadedControl;
    setGenerationControlState(loadedControl);
    engine.setBuilding(loaded.building);
  }, [engine]);

  const setBuilding = useCallback((
    newBuilding: Building,
    newName?: string,
    requiredRoomCounts: Partial<Record<RoomType, number>> = {},
    category: BuildingCategory = 'residential',
  ) => {
    const resolvedName = newName || newBuilding.name;
    if (newName) setProjectName(newName);
    setProjectId(newBuilding.projectId);
    setProjectCategory(category);
    setProjectStatus('CONCEPT');
    projectIdentityRef.current = {
      id: newBuilding.projectId,
      name: resolvedName,
      category,
      status: 'CONCEPT',
    };
    requiredRoomCountsRef.current = requiredRoomCounts;
    const nextControl = createGenerationControlState();
    generationControlRef.current = nextControl;
    setGenerationControlState(nextControl);
    projectStorage.save({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId: newBuilding.projectId,
      name: resolvedName,
      createdAt: newBuilding.createdAt,
      updatedAt: new Date().toISOString(),
      building: newBuilding,
      requiredRoomCounts,
      category,
      status: 'CONCEPT',
      generationControl: nextControl,
    });
    engine.setBuilding(newBuilding);
  }, [engine]);

  const updateSite = useCallback((params: UpdateSiteParams) => {
    engine.execute(new UpdateSiteCommand(engine.getBuilding(), params));
  }, [engine]);

  const setRequiredRoomCounts = useCallback((counts: Partial<Record<RoomType, number>>) => {
    requiredRoomCountsRef.current = counts;
    const b = engine.getBuilding();
    projectStorage.save({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      projectId: projectIdentityRef.current.id,
      name: projectIdentityRef.current.name,
      createdAt: b.createdAt,
      updatedAt: new Date().toISOString(),
      building: b,
      requiredRoomCounts: counts,
      category: projectIdentityRef.current.category,
      status: projectIdentityRef.current.status,
      generationControl: generationControlRef.current,
    });
  }, [engine]);

  const addFloor = useCallback((name?: string, floorHeight?: number) => {
    engine.addFloor(name, floorHeight);
  }, [engine]);

  const removeFloor = useCallback((floorId: string) => {
    engine.removeFloor(floorId);
  }, [engine]);

  return {
    engine,
    building,
    activeFloor,
    selection: editorState.selection,
    selections: editorState.selections ?? (editorState.selection ? [editorState.selection] : []),
    generationControl,
    activeTool: editorState.activeTool,
    canUndo: editorState.historySummary.canUndo,
    canRedo: editorState.historySummary.canRedo,
    validationSummary,
    diagnostics,
    projectName,
    projectId,
    projectCategory,
    projectStatus,
    requiredRoomCounts: requiredRoomCountsRef.current,
    executeCommand,
    undo,
    redo,
    selectEntity,
    toggleRoomSelection,
    clearSelection,
    switchFloor,
    setTool,
    deleteSelected,
    saveProject,
    revalidate,
    setRoomLocks,
    setFloorLock,
    setCoreLock,
    applyRefinement,
    loadProject,
    setBuilding,
    updateSite,
    setRequiredRoomCounts,
    addFloor,
    removeFloor,
  };
}
