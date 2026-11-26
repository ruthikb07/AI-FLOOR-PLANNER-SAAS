/**
 * Mountable Lifecycle Controller for Cota CAD inside ARGON Studio (`mountCotaCad`).
 *
 * Manages an isolated Cota `DocumentModel`, `LayerService`, `CommandEngine` (all 240+ CAD
 * commands), and 1–4 Three.js `Viewport` instances inside a caller-owned DOM container
 * with zero global React roots, zero competing application routers, and complete WebGL,
 * listener, and worker disposal on `unmount()`.
 */
import type { Building, CanonicalExchangeRevision } from '@ai-floor-planner/core';
import { CommandEngine } from '../core/commands/CommandEngine';
import { suggestCommands, type CommandSuggestion } from '../core/commands/complete';
import { registerDefaultCommands, VARIABLE_COMMANDS } from '../core/commands/registry';
import { parseScript } from '../core/commands/script';
import type { AppHooks, Command } from '../core/commands/types';
import { DocumentModel, MODEL_TAB } from '../core/document/DocumentModel';
import type { BlockDef, DocumentData, Entity, EntityInput, Layer } from '../core/document/types';
import { expandEntities } from '../core/editing/block';
import { entitiesInScreenBox } from '../core/editing/bounds';
import { applyGrip, type Grip } from '../core/editing/grips';
import { mergeSelection } from '../core/editing/selection';
import { dwgVersion, dxfTextToDwg, importCadInWorker } from '../core/io/dwg';
import { exportDxf, importDxf, type DxfEntitySpec } from '../core/io/dxf';
import { plotLayouts } from '../core/io/layoutPlot';
import { exportObj, importObj } from '../core/io/obj';
import { readCadFileWithReport } from '../core/io/occt';
import { modelPlotPage, PAGE_SIZES, pdfDocument } from '../core/io/pdf';
import { exportStl, parseStl } from '../core/io/stl';
import { LayerService } from '../core/layers/LayerService';
import type { Pt, Vec3 } from '../core/math';
import type { PreviewShape } from '../core/preview';
import { DEFAULT_OSNAP, type OsnapConfig } from '../core/snap/osnap';
import { WORLD_UCS, type Ucs } from '../core/ucs';
import type { CameraMode, ViewName, VisualStyle } from '../core/view';
import { exactSolidVolume, solidMesh } from '../render/csg';
import { Viewport, type ViewportData } from '../render/Viewport';
import {
  buildCanonicalWritebackPreview,
  projectCanonicalBuildingToCotaDoc,
  type CanonicalWritebackPreview,
  type CotaCanonicalEntityLink,
  type CotaProjectDrawingRecord,
} from '../adapter/cota-canonical-adapter';

export interface CotaCommandCatalogueEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly isSystemVariable: boolean;
}

export type CotaCadExportFormat = 'cota' | 'dxf' | 'dwg' | 'obj' | 'stl' | 'pdf';

export interface CotaExportPayload {
  readonly format: CotaCadExportFormat;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly revision: number;
}

export interface CotaImportReport {
  readonly fileName: string;
  readonly format: string;
  readonly importedEntities: number;
  readonly warnings: readonly string[];
}

export interface CotaWorkspaceSnapshot {
  readonly projectId: string;
  readonly drawingId: string;
  readonly floorId: string;
  readonly docRevision: number;
  readonly canonicalSource: CanonicalExchangeRevision;
  readonly currentLayerId: string;
  readonly layers: readonly Layer[];
  readonly activeTab: string;
  readonly layouts: ReadonlyArray<{ id: string; name: string }>;
  readonly selection: readonly string[];
  readonly picked: readonly string[];
  readonly prompt: string;
  readonly output: readonly string[];
  readonly cursor: Pt;
  readonly ortho: boolean;
  readonly polar: boolean;
  readonly gridOn: boolean;
  readonly gridSnap: boolean;
  readonly esnap: boolean;
  readonly otrack: boolean;
  readonly dynInput: boolean;
  readonly osnap: OsnapConfig;
  readonly visualStyle: VisualStyle;
  readonly cameraMode: CameraMode;
  readonly viewportCount: 1 | 2 | 3 | 4;
  readonly ucsName: string;
  readonly entityCount: number;
  readonly mappedCanonicalCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly activeCommand: string | null;
}

export interface MountCotaCadOptions {
  readonly container: HTMLElement;
  readonly projectId: string;
  readonly buildingId: string;
  readonly drawingId: string;
  readonly revision: number;
  readonly building: Building;
  readonly floorId?: string;
  readonly initialDrawingRecord?: CotaProjectDrawingRecord | null;
  readonly theme?: 'day' | 'night';
  readonly headless?: boolean;
  readonly onStateChange?: (snapshot: CotaWorkspaceSnapshot) => void;
  readonly onCanonicalEntitySelected?: (link: CotaCanonicalEntityLink | null) => void;
  readonly onError?: (message: string) => void;
}

export interface MountedCotaCadController {
  getSnapshot(): CotaWorkspaceSnapshot;
  getDocument(): DocumentModel;
  getEntityLinks(): readonly CotaCanonicalEntityLink[];
  submitCommandText(text: string): void;
  runScriptText(scriptText: string): Promise<void>;
  cancelActiveCommand(): void;
  autocomplete(prefix: string, limit?: number): CommandSuggestion[];
  searchCommands(query: string): CotaCommandCatalogueEntry[];
  undo(): void;
  redo(): void;
  setCurrentLayer(layerId: string): void;
  toggleLayerVisibility(layerId: string): void;
  toggleLayerLock(layerId: string): void;
  toggleLayerFreeze(layerId: string): void;
  addLayer(name: string, color?: string): Layer;
  setVisualStyle(style: VisualStyle): void;
  setCameraProjection(mode: CameraMode): void;
  setStandardView(view: ViewName): void;
  zoomExtents(): void;
  setViewportCount(count: 1 | 2 | 3 | 4): void;
  setActiveTab(tabId: string): void;
  setDraftingOption(patch: Partial<{
    ortho: boolean;
    polar: boolean;
    gridOn: boolean;
    gridSnap: boolean;
    esnap: boolean;
    otrack: boolean;
    dynInput: boolean;
    osnap: Partial<OsnapConfig>;
  }>): void;
  syncFromCanonicalBuilding(building: Building, floorId?: string, include3DSolids?: boolean): void;
  previewCanonicalWriteback(currentBuilding: Building, promoteSelectedLines?: boolean): CanonicalWritebackPreview;
  exportDrawing(format: CotaCadExportFormat): Promise<CotaExportPayload>;
  importCadFile(file: { name: string; bytes: ArrayBuffer }): Promise<CotaImportReport>;
  serializeProjectDrawing(name?: string): CotaProjectDrawingRecord;
  resize(): void;
  unmount(): void;
}

const MAX_UNDO_SNAPSHOTS = 80;
const VIEW_ONLY_CMDS = new Set(['ZOOM', 'PAN', 'REDRAW', 'REGEN', 'LIST', 'ID', 'DIST', 'HELP', 'VIEW', 'VSCURRENT', 'SHADEMODE']);

export function getAllCotaCommands(): CotaCommandCatalogueEntry[] {
  const dummyDoc = DocumentModel.createDefault();
  const dummyEngine = new CommandEngine({
    doc: dummyDoc,
    currentLayerId: () => '0',
    isOrtho: () => false,
    currentCursor: () => ({ x: 0, y: 0, z: 0 }),
    currentUcs: () => WORLD_UCS,
    currentSelection: () => [],
    onSelectionChange: () => {},
    app: new Proxy({} as AppHooks, { get: () => () => undefined }),
    onPrompt: () => {},
    onPrint: () => {},
    onChange: () => {},
    onOpenHelp: () => {},
    onBeforeCommand: () => {},
    onAfterCommand: () => {},
  });
  registerDefaultCommands(dummyEngine);
  return dummyEngine.getCommands().map((cmd: Command) => ({
    name: cmd.name,
    aliases: cmd.aliases,
    description: cmd.description,
    isSystemVariable: VARIABLE_COMMANDS.has(cmd.name),
  }));
}

export function searchCotaCommands(query: string): CotaCommandCatalogueEntry[] {
  const all = getAllCotaCommands();
  const q = query.trim().toUpperCase();
  if (!q) return all.filter(c => !c.isSystemVariable);
  return all
    .filter(
      c =>
        c.name.toUpperCase().includes(q) ||
        c.aliases.some(a => a.toUpperCase().includes(q)) ||
        c.description.toUpperCase().includes(q),
    )
    .sort((a, b) => {
      const aStarts = a.name.toUpperCase().startsWith(q) ? 0 : a.aliases.some(al => al.toUpperCase() === q) ? 1 : 2;
      const bStarts = b.name.toUpperCase().startsWith(q) ? 0 : b.aliases.some(al => al.toUpperCase() === q) ? 1 : 2;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
}

export function mountCotaCad(options: MountCotaCadOptions): MountedCotaCadController {
  const projected = projectCanonicalBuildingToCotaDoc(options.building, { floorId: options.floorId });
  const doc: DocumentModel = options.initialDrawingRecord
    ? new DocumentModel(structuredClone(options.initialDrawingRecord.documentData))
    : projected.doc;
  let links: CotaCanonicalEntityLink[] = options.initialDrawingRecord
    ? [...options.initialDrawingRecord.entityLinks]
    : [...projected.links];
  let canonicalSource: CanonicalExchangeRevision = options.initialDrawingRecord
    ? options.initialDrawingRecord.source
    : projected.source;
  let activeFloorId = options.initialDrawingRecord?.floorId ?? projected.floor.id;
  const layerSvc = new LayerService(doc);
  const importWarnings: string[] = options.initialDrawingRecord ? [...options.initialDrawingRecord.importWarnings] : [];

  let currentLayerId = doc.layers.some(l => l.id === 'C-DRAFT') ? 'C-DRAFT' : '0';
  let selection: string[] = [];
  let picked: string[] = [];
  let prompt = '';
  let output: string[] = [
    `RH Planner Professional CAD Engine ready — Canonical Rev ${canonicalSource.revision} (${links.length} mapped entities, mm).`,
    'Type any CAD command (LINE, PLINE, CIRCLE, ARC, OFFSET, TRIM, EXTEND, DIMLINEAR, HATCH, BOX, EXTRUDE, UNION, SUBTRACT, LAYOUT, PLOT) or press HELP.',
  ];
  let cursor: Pt = { x: 0, y: 0, z: 0 };
  let ortho = false;
  let polar = false;
  let gridOn = true;
  let gridSnap = false;
  const gridStep = 100;
  let esnap = true;
  let otrack = true;
  let dynInput = false;
  let osnap: OsnapConfig = { ...DEFAULT_OSNAP };
  let visualStyle: VisualStyle = '2dwireframe';
  let cameraMode: CameraMode = 'ortho';
  let viewportCount: 1 | 2 | 3 | 4 = 1;
  let ucs: Ucs = { ...WORLD_UCS };
  let ucsName = 'World';
  let activeTab = MODEL_TAB;
  let activeGrip: { entityId: string; grip: Grip } | null = null;
  let lastPreview: PreviewShape[] = [];
  let disposed = false;

  const undoStack: DocumentData[] = [];
  const redoStack: DocumentData[] = [];
  let preCommandSnapshot: DocumentData | null = null;

  const gridHost = !options.headless && typeof document !== 'undefined' ? document.createElement('div') : null;
  if (gridHost) {
    gridHost.style.cssText = 'position:relative;width:100%;height:100%;display:grid;gap:2px;background:#0f172a;overflow:hidden;';
    options.container.innerHTML = '';
    options.container.appendChild(gridHost);
  }

  const panes: Array<{ el: HTMLDivElement; vp: Viewport }> = [];
  let activePaneIndex = 0;

  const activeVp = (): Viewport | undefined => panes[activePaneIndex]?.vp ?? panes[0]?.vp;

  const pushOutput = (line: string) => {
    output = [...output.slice(-150), line];
  };

  const buildViewportData = (): ViewportData => {
    const isModel = activeTab === MODEL_TAB;
    doc.setActiveTab(isModel ? MODEL_TAB : activeTab);
    return {
      revision: doc.revision,
      entities: doc.entities,
      blocks: doc.blocks,
      layers: doc.layers,
      selection: picked.length > 0 ? [...new Set([...selection, ...picked])] : selection,
      gridSnap,
      gridStep,
      gridOn: isModel && gridOn,
      esnap,
      ucs,
      osnap,
      osnapOverride: engine.osnapOverride(),
      snapBase: engine.snapBase(),
      pointPrompt: engine.awaitingPoint,
      noSnap: engine.pointNoSnap,
      previewColor: 0x38bdf8,
      otrack,
      polarAng: polar ? 45 : undefined,
      ortho,
      snapLive: engine.snapEntities(),
      linetypes: doc.linetypeContext(isModel ? 'model' : 'paper'),
    };
  };

  const syncViewports = () => {
    if (disposed) return;
    doc.setActiveTab(activeTab === MODEL_TAB ? MODEL_TAB : activeTab);
    for (const pane of panes) {
      pane.vp.forceRebuild();
    }
  };

  const notify = () => {
    if (disposed) return;
    syncViewports();
    options.onStateChange?.(buildSnapshot());
  };

  const recordUndoSnapshot = () => {
    undoStack.push(doc.toJSON());
    if (undoStack.length > MAX_UNDO_SNAPSHOTS) undoStack.shift();
    redoStack.length = 0;
  };

  const performUndo = () => {
    const prev = undoStack.pop();
    if (!prev) {
      pushOutput('Nothing to undo.');
      notify();
      return;
    }
    redoStack.push(doc.swap(prev, true));
    selection = [];
    notify();
  };

  const performRedo = () => {
    const next = redoStack.pop();
    if (!next) {
      pushOutput('Nothing to redo.');
      notify();
      return;
    }
    undoStack.push(doc.swap(next, true));
    selection = [];
    notify();
  };

  const appHooks = new Proxy({} as AppHooks, {
    get(_target, prop) {
      switch (prop) {
        case 'undo': return performUndo;
        case 'redo': return performRedo;
        case 'clearSelection': return () => { selection = []; notify(); };
        case 'preselection': return () => [...selection];
        case 'setCurrentLayer': return (id: string) => { if (layerSvc.get(id)) { currentLayerId = id; notify(); } };
        case 'visualStyle': return () => visualStyle;
        case 'setVisualStyle': return (s: VisualStyle) => {
          visualStyle = s;
          panes.forEach(p => p.vp.setVisualStyle(s));
          notify();
        };
        case 'setCameraMode': return (m: CameraMode) => {
          cameraMode = m;
          activeVp()?.setMode(m);
          notify();
        };
        case 'setView': return (v: ViewName) => { activeVp()?.setView(v); notify(); };
        case 'zoomExtents': return () => { activeVp()?.zoomExtents(); notify(); };
        case 'zoomWindow': return (a: Pt, b: Pt) => { activeVp()?.zoomWindow(a, b); notify(); };
        case 'zoomScale': return (f: number) => { activeVp()?.zoomScale(f); notify(); };
        case 'zoomCenter': return (c: Pt, h?: number) => {
          const vp = activeVp();
          if (vp) vp.zoomCenter(c, h ?? vp.viewHeight());
          notify();
        };
        case 'zoomPrevious': return () => activeVp()?.zoomPrevious() ?? false;
        case 'panBy': return (dx: number, dy: number) => { activeVp()?.panBy([dx, dy, 0]); notify(); };
        case 'getUcs': return () => ucs;
        case 'ucsName': return () => ucsName;
        case 'setUcs': return (u: Ucs, name?: string) => {
          ucs = u;
          ucsName = name ?? 'Custom';
          activeVp()?.setUcs(u);
          notify();
        };
        case 'planView': return (u: Ucs) => { activeVp()?.planView(u); notify(); };
        case 'constructionNormal': return () => [0, 0, 1] as Vec3;
        case 'solidMesh': return (e: Entity) => (e.type === 'SOLID3D' ? solidMesh(e.props) : e.type === 'MESH3D' ? e.props : null);
        case 'solidVolume': return (e: Entity) => (e.type === 'SOLID3D' ? exactSolidVolume(e.props) : null);
        case 'setGrid': return (on: boolean) => { gridOn = on; notify(); };
        case 'gridOn': return () => gridOn;
        case 'setVports': return (n: 1 | 2 | 3 | 4) => { rebuildPanes(n); notify(); };
        case 'activateLayout': return (id: string | null) => { activeTab = id ?? MODEL_TAB; notify(); };
        default: return () => undefined;
      }
    },
  });

  const engine = new CommandEngine({
    doc,
    currentLayerId: () => currentLayerId,
    isOrtho: () => ortho,
    isDynInput: () => dynInput,
    viewPlane: () => activeVp()?.viewPlane() ?? null,
    currentCursor: () => cursor,
    currentUcs: () => ucs,
    currentSelection: () => selection,
    onSelectionChange: ids => {
      selection = ids;
      const firstLink = ids.length === 1 ? links.find(l => l.cotaEntityId === ids[0]) ?? null : null;
      options.onCanonicalEntitySelected?.(firstLink);
      notify();
    },
    onPicked: ids => {
      picked = ids;
      notify();
    },
    app: appHooks,
    onPrompt: p => {
      prompt = p;
      lastPreview = engine.computePreview(cursor);
      notify();
    },
    onPrint: line => {
      pushOutput(line);
      notify();
    },
    onChange: () => {
      doc.updateAssociativeDims();
      doc.updateAssociativeHatches();
      lastPreview = engine.computePreview(cursor);
      notify();
    },
    onOpenHelp: () => {
      pushOutput('Use the searchable Command Reference drawer or type any command/alias.');
      notify();
    },
    onBeforeCommand: name => {
      preCommandSnapshot = VIEW_ONLY_CMDS.has(name.toUpperCase()) ? null : doc.toJSON();
    },
    onAfterCommand: (_name, discard) => {
      if (discard && preCommandSnapshot) {
        doc.load(preCommandSnapshot, true);
      } else if (preCommandSnapshot && JSON.stringify(preCommandSnapshot) !== JSON.stringify(doc.toJSON())) {
        undoStack.push(preCommandSnapshot);
        if (undoStack.length > MAX_UNDO_SNAPSHOTS) undoStack.shift();
        redoStack.length = 0;
      }
      preCommandSnapshot = null;
      picked = [];
      lastPreview = [];
      notify();
    },
  });
  registerDefaultCommands(engine);

  function createViewportCallbacks(paneIndex: number) {
    return {
      onActivate: () => {
        activePaneIndex = paneIndex;
      },
      onPointerMove: (world: Pt) => {
        cursor = world;
        if (activeGrip) {
          const ent = doc.getEntity(activeGrip.entityId);
          if (ent) {
            applyGrip(ent, activeGrip.grip, [world.x, world.y, world.z]);
            doc.touch();
          }
        }
        lastPreview = engine.computePreview(world);
        options.onStateChange?.(buildSnapshot());
      },
      onClick: (world: Pt, pickedId: string | null, snapped: boolean, shift: boolean, raw: Pt, deferred?: unknown, face?: Ucs) => {
        activePaneIndex = paneIndex;
        if (activeGrip) {
          const ent = doc.getEntity(activeGrip.entityId);
          if (ent) {
            applyGrip(ent, activeGrip.grip, [world.x, world.y, world.z]);
            doc.touch();
            doc.updateAssociativeDims();
          }
          activeGrip = null;
          notify();
          return;
        }
        if (engine.hasPending) {
          engine.submitClick(world, pickedId, snapped, shift, raw, deferred as never, face);
          return;
        }
        if (pickedId) {
          selection = mergeSelection(selection, [pickedId], shift);
        } else if (!shift) {
          selection = [];
        }
        const firstLink = selection.length === 1 ? links.find(l => l.cotaEntityId === selection[0]) ?? null : null;
        options.onCanonicalEntitySelected?.(firstLink);
        notify();
      },
      onBoxSelect: (rectPx: { minX: number; minY: number; maxX: number; maxY: number }, crossing: boolean, shift: boolean) => {
        const vp = panes[paneIndex]?.vp;
        if (!vp) return;
        const hits = entitiesInScreenBox(
          doc.entities,
          rectPx,
          crossing,
          p => vp.project(p),
          e => expandEntities([e], doc.blocks),
        );
        if (engine.isSelecting) {
          engine.completeArea(hits);
        } else {
          selection = mergeSelection(selection, hits, shift);
          notify();
        }
      },
      onGripActivate: (entityId: string, grip: Grip) => {
        recordUndoSnapshot();
        activeGrip = { entityId, grip };
      },
      onRightClickCommand: () => {
        if (engine.hasPending) {
          engine.submitText('');
          return true;
        }
        return false;
      },
      isCommandActive: () => engine.busy,
      isSelectMode: () => !engine.busy || engine.isSelecting,
      isPickOnly: () => !engine.hasPending,
      selectionArea: () => engine.selectionArea,
    };
  }

  function rebuildPanes(count: 1 | 2 | 3 | 4) {
    for (const p of panes) {
      try { p.vp.dispose(); } catch { /* ignore */ }
      p.el.remove();
    }
    panes.length = 0;
    viewportCount = count;
    activePaneIndex = 0;
    if (options.headless || !gridHost) return;

    gridHost.style.gridTemplateColumns = count === 1 ? '1fr' : '1fr 1fr';
    gridHost.style.gridTemplateRows = count <= 2 ? '1fr' : '1fr 1fr';

    const presetViews: ViewName[] = ['TOP', 'SWISO', 'FRONT', 'RIGHT'];
    for (let i = 0; i < count; i++) {
      const paneEl = document.createElement('div');
      paneEl.style.cssText = 'position:relative;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;';
      if (count === 3 && i === 0) paneEl.style.gridRow = '1 / span 2';
      gridHost.appendChild(paneEl);
      const vp = new Viewport(paneEl, createViewportCallbacks(i), 'model');
      vp.setProvider(buildViewportData);
      vp.setPreviewProvider(cur => (activePaneIndex === i ? lastPreview : engine.computePreview(cur)));
      vp.setVisualStyle(i === 1 && count > 1 ? 'shadedEdges' : visualStyle);
      if (i > 0) vp.setView(presetViews[i] ?? 'TOP');
      panes.push({ el: paneEl, vp });
    }
    syncViewports();
    panes.forEach(p => p.vp.zoomExtents());
  }

  function buildSnapshot(): CotaWorkspaceSnapshot {
    return {
      projectId: options.projectId,
      drawingId: options.drawingId,
      floorId: activeFloorId,
      docRevision: doc.revision,
      canonicalSource,
      currentLayerId,
      layers: doc.layers.map(l => ({ ...l })),
      activeTab,
      layouts: doc.layouts.map(l => ({ id: l.id, name: l.name })),
      selection: [...selection],
      picked: [...picked],
      prompt,
      output: [...output],
      cursor: { ...cursor },
      ortho,
      polar,
      gridOn,
      gridSnap,
      esnap,
      otrack,
      dynInput,
      osnap: { ...osnap },
      visualStyle,
      cameraMode,
      viewportCount,
      ucsName,
      entityCount: doc.entities.length,
      mappedCanonicalCount: links.length,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      activeCommand: engine.activeName,
    };
  }

  if (!options.headless) {
    try {
      rebuildPanes(1);
    } catch (err) {
      options.onError?.(err instanceof Error ? err.message : 'Failed to initialize Three.js CAD viewport.');
    }
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (disposed) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (ev.key === 'Escape') {
        activeGrip = null;
        engine.cancel();
        notify();
      }
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      activeGrip = null;
      engine.cancel();
      selection = [];
      notify();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      performUndo();
    } else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) {
      ev.preventDefault();
      performRedo();
    } else if (ev.key === 'Delete' && selection.length > 0 && !engine.busy) {
      ev.preventDefault();
      engine.submitText('ERASE');
    } else if (ev.key === 'F8') {
      ev.preventDefault();
      ortho = !ortho;
      notify();
    } else if (ev.key === 'F7') {
      ev.preventDefault();
      gridOn = !gridOn;
      notify();
    } else if (ev.key === 'F3') {
      ev.preventDefault();
      esnap = !esnap;
      notify();
    }
  };
  options.container.tabIndex = 0;
  options.container.addEventListener('keydown', onKeyDown);

  notify();

  return {
    getSnapshot: buildSnapshot,
    getDocument: () => doc,
    getEntityLinks: () => [...links],
    submitCommandText(text: string) {
      engine.submitText(text);
    },
    async runScriptText(scriptText: string) {
      const tokens = parseScript(scriptText);
      const res = await engine.runScript(tokens);
      if (!res.ok && res.error) pushOutput(`Script halted: ${res.error}`);
      notify();
    },
    cancelActiveCommand() {
      activeGrip = null;
      engine.cancel();
      notify();
    },
    autocomplete(prefix: string, limit = 10) {
      return suggestCommands(engine.getCommands(), prefix, limit);
    },
    searchCommands(query: string) {
      return searchCotaCommands(query);
    },
    undo: performUndo,
    redo: performRedo,
    setCurrentLayer(layerId: string) {
      const layer = layerSvc.get(layerId);
      if (layer && !layer.frozen) {
        currentLayerId = layerId;
        notify();
      }
    },
    toggleLayerVisibility(layerId: string) {
      const layer = layerSvc.get(layerId);
      if (layer) {
        layerSvc.setVisible(layerId, !layer.visible);
        notify();
      }
    },
    toggleLayerLock(layerId: string) {
      const layer = layerSvc.get(layerId);
      if (layer) {
        layerSvc.setLocked(layerId, !layer.locked);
        notify();
      }
    },
    toggleLayerFreeze(layerId: string) {
      const layer = layerSvc.get(layerId);
      if (layer && layerId !== currentLayerId) {
        layerSvc.setFrozen(layerId, !layer.frozen);
        notify();
      }
    },
    addLayer(name: string, color = '#38bdf8') {
      const created = layerSvc.create(name, { color });
      notify();
      return created;
    },
    setVisualStyle(style: VisualStyle) {
      visualStyle = style;
      panes.forEach(p => p.vp.setVisualStyle(style));
      notify();
    },
    setCameraProjection(mode: CameraMode) {
      cameraMode = mode;
      activeVp()?.setMode(mode);
      notify();
    },
    setStandardView(view: ViewName) {
      activeVp()?.setView(view);
      notify();
    },
    zoomExtents() {
      panes.forEach(p => p.vp.zoomExtents());
      notify();
    },
    setViewportCount(count: 1 | 2 | 3 | 4) {
      rebuildPanes(count);
      notify();
    },
    setActiveTab(tabId: string) {
      activeTab = tabId;
      doc.setActiveTab(tabId);
      notify();
      if (tabId === MODEL_TAB) {
        panes.forEach(p => p.vp.zoomExtents());
      }
    },
    setDraftingOption(patch) {
      if (patch.ortho !== undefined) ortho = patch.ortho;
      if (patch.polar !== undefined) polar = patch.polar;
      if (patch.gridOn !== undefined) gridOn = patch.gridOn;
      if (patch.gridSnap !== undefined) gridSnap = patch.gridSnap;
      if (patch.esnap !== undefined) esnap = patch.esnap;
      if (patch.otrack !== undefined) otrack = patch.otrack;
      if (patch.dynInput !== undefined) dynInput = patch.dynInput;
      if (patch.osnap) osnap = { ...osnap, ...patch.osnap };
      notify();
    },
    syncFromCanonicalBuilding(building: Building, floorId?: string, include3DSolids = false) {
      const nextProj = projectCanonicalBuildingToCotaDoc(building, {
        floorId: floorId ?? activeFloorId,
        include3DSolids,
        preserveNonCanonicalFrom: doc,
      });
      doc.load(nextProj.doc.toJSON(), false);
      links = nextProj.links;
      canonicalSource = nextProj.source;
      activeFloorId = nextProj.floor.id;
      if (include3DSolids) {
        layerSvc.setVisible('A-3D-SOLID', true);
      }
      pushOutput(`Synchronized canonical floor "${nextProj.floor.name}" (Rev ${canonicalSource.revision}, ${links.length} entities).`);
      notify();
      panes.forEach(p => p.vp.zoomExtents());
    },
    previewCanonicalWriteback(currentBuilding: Building, promoteSelectedLines = false) {
      return buildCanonicalWritebackPreview({
        currentBuilding,
        expectedSource: canonicalSource,
        doc,
        links,
        floorId: activeFloorId,
        explicitPromoteLineIds: promoteSelectedLines ? selection : [],
      });
    },
    async exportDrawing(format: CotaCadExportFormat): Promise<CotaExportPayload> {
      const baseName = `${options.projectId}-${activeFloorId}-r${canonicalSource.revision}`;
      if (format === 'cota') {
        const json = JSON.stringify(doc.toJSON(), null, 2);
        return {
          format,
          fileName: `${baseName}.cota`,
          mimeType: 'application/json',
          bytes: new TextEncoder().encode(json),
          revision: canonicalSource.revision,
        };
      }
      if (format === 'dxf') {
        const dxfText = exportDxf(doc.modelEntities, doc.layers, currentLayerId, doc.dimStyles, {
          linetypes: doc.linetypes,
          vars: doc.vars,
        });
        return {
          format,
          fileName: `${baseName}.dxf`,
          mimeType: 'application/dxf',
          bytes: new TextEncoder().encode(dxfText),
          revision: canonicalSource.revision,
        };
      }
      if (format === 'dwg') {
        const dxfText = exportDxf(doc.modelEntities, doc.layers, currentLayerId, doc.dimStyles, {
          linetypes: doc.linetypes,
          vars: doc.vars,
        });
        const dwgBuf = await dxfTextToDwg(dxfText);
        return {
          format,
          fileName: `${baseName}.dwg`,
          mimeType: 'application/acad',
          bytes: new Uint8Array(dwgBuf),
          revision: canonicalSource.revision,
        };
      }
      if (format === 'obj') {
        const meshes = doc.modelEntities.flatMap(e => {
          if (e.type === 'SOLID3D') {
            const m = solidMesh(e.props);
            return m ? [{ name: e.id, ...m }] : [];
          }
          if (e.type === 'MESH3D') return [{ name: e.id, ...e.props }];
          return [];
        });
        const objText = exportObj(meshes);
        return {
          format,
          fileName: `${baseName}.obj`,
          mimeType: 'text/plain',
          bytes: new TextEncoder().encode(objText),
          revision: canonicalSource.revision,
        };
      }
      if (format === 'stl') {
        const meshes = doc.modelEntities.flatMap(e => {
          if (e.type === 'SOLID3D') {
            const m = solidMesh(e.props);
            return m ? [{ name: e.id, ...m }] : [];
          }
          if (e.type === 'MESH3D') return [{ name: e.id, ...e.props }];
          return [];
        });
        const stlText = exportStl(meshes, baseName);
        return {
          format,
          fileName: `${baseName}.stl`,
          mimeType: 'model/stl',
          bytes: new TextEncoder().encode(stlText),
          revision: canonicalSource.revision,
        };
      }

      const activeLayout = activeTab !== MODEL_TAB ? doc.getLayout(activeTab) : undefined;
      let pdfBytes: Uint8Array;
      if (activeLayout) {
        pdfBytes = plotLayouts([
          {
            layout: activeLayout,
            paper: expandEntities(activeLayout.entities, doc.blocks),
            model: expandEntities(doc.modelEntities, doc.blocks),
            layers: doc.layers,
            units: doc.units,
            meshOf: e => (e.type === 'SOLID3D' ? solidMesh(e.props) : e.type === 'MESH3D' ? e.props : null),
            linetypes: doc.linetypeContext('paper'),
          },
        ]);
      } else {
        const plotted = modelPlotPage(expandEntities(doc.modelEntities, doc.blocks), doc.layers, {
          page: PAGE_SIZES.A3,
          center: true,
          linetypes: doc.linetypeContext('model'),
          style: { plotStyle: 'color', lineWeights: true },
        });
        pdfBytes = pdfDocument([plotted.page]);
      }
      return {
        format: 'pdf',
        fileName: `${baseName}-plot.pdf`,
        mimeType: 'application/pdf',
        bytes: pdfBytes,
        revision: canonicalSource.revision,
      };
    },
    async importCadFile(file: { name: string; bytes: ArrayBuffer }): Promise<CotaImportReport> {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      recordUndoSnapshot();
      const warnings: string[] = [];
      let importedEntities = 0;

      if (ext === 'cota' || ext === 'json') {
        const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(file.bytes))) as DocumentData;
        doc.load(parsed, false);
        importedEntities = doc.modelEntities.length;
      } else if (ext === 'dxf' || ext === 'dwg') {
        if (ext === 'dwg') {
          const ver = dwgVersion(file.bytes);
          if (ver) pushOutput(`Detected DWG version ${ver} (${file.name}).`);
        }
        const res =
          ext === 'dxf'
            ? importDxf(new TextDecoder().decode(new Uint8Array(file.bytes)))
            : await importCadInWorker('dwg', file.bytes);

        const layerIdByName = new Map(doc.layers.map(l => [l.name.toLowerCase(), l.id]));
        const ensureLayer = (name: string, spec?: { color?: string; lineWeight?: number; lineType?: string; visible?: boolean; locked?: boolean; printable?: boolean; frozen?: boolean }): string => {
          const existing = layerIdByName.get(name.toLowerCase());
          if (existing) return existing;
          const created = layerSvc.create(name, {
            color: spec?.color,
            lineWeight: spec?.lineWeight,
            lineType: spec?.lineType,
            visible: spec?.visible,
            locked: spec?.locked,
            printable: spec?.printable,
            frozen: spec?.frozen,
          });
          layerIdByName.set(name.toLowerCase(), created.id);
          return created.id;
        };

        for (const l of res.layers) {
          ensureLayer(l.name, l);
        }
        const toEntityInput = (spec: DxfEntitySpec): EntityInput => ({
          type: spec.type,
          layer: ensureLayer(spec.layerName || '0'),
          props: spec.props,
          ...(spec.color ? { color: spec.color } : {}),
          ...(spec.lineWeight !== undefined ? { lineWeight: spec.lineWeight } : {}),
          ...(spec.lineType ? { lineType: spec.lineType } : {}),
          ...(spec.ltScale !== undefined ? { ltScale: spec.ltScale } : {}),
        });
        for (const b of res.blocks ?? []) {
          if (!doc.getBlock(b.name)) {
            const blockDef: BlockDef = {
              name: b.name,
              entities: b.entities.map(s => ({ id: doc.nextEntityId(), ...toEntityInput(s) }) as Entity),
              ...(b.xref ? { xref: b.xref } : {}),
            };
            doc.setBlock(blockDef);
          }
        }
        for (const spec of res.entities) {
          doc.addEntity(toEntityInput(spec));
          importedEntities++;
        }
        if (res.unsupported.length > 0) {
          warnings.push(`Unsupported ${ext.toUpperCase()} entities skipped: ${res.unsupported.join(', ')} (original source file retained as reference).`);
        }
        if (res.simplified) {
          for (const [k, cnt] of Object.entries(res.simplified)) {
            warnings.push(`Simplified ${cnt} ${k} entity(ies) during ${ext.toUpperCase()} import.`);
          }
        }
      } else if (ext === 'obj') {
        const meshes = importObj(new TextDecoder().decode(new Uint8Array(file.bytes)));
        for (const m of meshes) {
          doc.addEntity({ type: 'MESH3D', layer: 'C-SOLID', props: { vertices: m.vertices, faces: m.faces } });
          importedEntities++;
        }
      } else if (ext === 'stl') {
        const mesh = parseStl(file.bytes);
        doc.addEntity({ type: 'MESH3D', layer: 'C-SOLID', props: mesh });
        importedEntities = 1;
      } else if (ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs') {
        const kind = ext.startsWith('ig') ? 'iges' : 'step';
        const rep = await readCadFileWithReport(file.bytes, kind);
        for (const m of rep.meshes) {
          doc.addEntity({ type: 'MESH3D', layer: 'C-SOLID', props: { vertices: m.vertices, faces: m.faces } });
          importedEntities++;
        }
        warnings.push(...rep.warnings);
      } else {
        throw new Error(`Unsupported CAD file extension ".${ext}". Supported: .cota, .dwg, .dxf, .obj, .stl, .step/.stp, .iges/.igs.`);
      }

      importWarnings.push(...warnings);
      pushOutput(`Imported ${importedEntities} entity(ies) from "${file.name}"${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
      notify();
      panes.forEach(p => p.vp.zoomExtents());
      return { fileName: file.name, format: ext.toUpperCase(), importedEntities, warnings };
    },
    serializeProjectDrawing(name?: string): CotaProjectDrawingRecord {
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        projectId: options.projectId,
        buildingId: options.buildingId,
        drawingId: options.drawingId,
        floorId: activeFloorId,
        name: name ?? `${options.building.name} — CAD (${activeFloorId})`,
        source: canonicalSource,
        units: 'mm',
        documentData: doc.toJSON(),
        entityLinks: [...links],
        importWarnings: [...importWarnings],
        createdAt: options.initialDrawingRecord?.createdAt ?? now,
        updatedAt: now,
      };
    },
    resize() {
      if (!disposed) panes.forEach(p => p.vp.forceRebuild());
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      engine.cancel();
      options.container.removeEventListener('keydown', onKeyDown);
      for (const p of panes) {
        try { p.vp.dispose(); } catch { /* ignore */ }
      }
      panes.length = 0;
      gridHost?.remove();
    },
  };
}
