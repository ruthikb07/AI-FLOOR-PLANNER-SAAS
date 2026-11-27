/**
 * Mountable Lifecycle Controller for OpenBIM Studio (`mountOpenBimStudio`).
 *
 * Coordinates canonical BIM model projection, IFC4 / IFC4X3 semantic inspection &
 * fidelity reports, 3D BVH/GJK clash runs, BCF 2.1 issue management, IDS 1.0
 * specification audits, Uniclass/OmniClass/UniFormat classification, 5D QTO
 * calculations, and COBie 2.4 facility handover exports within ARGON Studio.
 */
import type { Building, CanonicalExchangeRevision } from '@ai-floor-planner/core';
import {
  bcfGuid,
  exportBcf21Archive,
  importBcf21Archive,
  type OpenBimBcfIssue,
} from '../bcf/bcf-archive';
import type { ClashMethod, ClashRules, ElementClash } from '../clash/clash-core';
import { buildInteropReport, type IfcInteropReport } from '../ifc-semantics/interop-report';
import { buildImportFidelityReport, type ImportFidelityReport } from '../ifc-semantics/per-entity-report';
import { buildSemanticModel } from '../ifc-semantics/semantic-model';
import { validateSemanticModel, type Finding as IfcSemanticFinding } from '../ifc-semantics/validate';
import {
  DEFAULT_RESIDENTIAL_IDS_XML,
  parseIdsXml,
  validateElementsAgainstIds,
  type IdsAuditReport,
} from '../ids/ids-engine';
import {
  BUILTIN_CLASSIFICATION_SYSTEMS,
  DEFAULT_ARCHITECTURAL_QTO_RULES,
  DEFAULT_QTO_RATE_BOOK,
  buildCanonicalCobieDataset,
  exportCobieCsvZip,
  exportCobieHtmlWorkbook,
  type CobieExportBundle,
} from '../schedules/cobie-exporter';
import { evaluateQtoRules, type QtoRule, type QtoRun } from '../schedules/qto-rules';
import type { ScheduleAssignmentLike } from '../schedules/schedule-classification';
import {
  projectCanonicalBuildingToOpenBim,
  proposeOpenBimCanonicalEdit,
  runFederatedOpenBimClashCheck,
  type BimCanonicalEditInput,
  type BimCanonicalEditResult,
  type FederatedBoxPrismInput,
  type ProjectedOpenBimModel,
} from '../adapter/openbim-canonical-adapter';

export interface OpenBimIfcDiagnosticBundle {
  readonly fileName: string;
  readonly interop: IfcInteropReport | null;
  readonly fidelity: ImportFidelityReport | null;
  readonly findings: readonly IfcSemanticFinding[];
}

export interface OpenBimSessionSnapshot {
  readonly projectId: string;
  readonly buildingId: string;
  readonly source: CanonicalExchangeRevision;
  readonly elementCount: number;
  readonly classificationAssignments: readonly ScheduleAssignmentLike[];
  readonly customProperties: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly bcfIssues: readonly OpenBimBcfIssue[];
  readonly lastIdsReport: IdsAuditReport | null;
  readonly lastQtoRun: QtoRun;
  readonly lastIfcDiagnostics: OpenBimIfcDiagnosticBundle | null;
  readonly lastFederatedClashes: readonly ElementClash[];
}

export interface MountOpenBimStudioOptions {
  readonly container?: HTMLElement | null;
  readonly projectId: string;
  readonly buildingId: string;
  readonly revision: number;
  readonly building: Building;
  readonly theme?: 'day' | 'night';
  readonly initialClassifications?: readonly ScheduleAssignmentLike[];
  readonly initialCustomProperties?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly initialBcfIssues?: readonly OpenBimBcfIssue[];
  readonly onStateChange?: (snapshot: OpenBimSessionSnapshot) => void;
  readonly onError?: (message: string) => void;
}

export interface MountedOpenBimStudioController {
  getSnapshot(): OpenBimSessionSnapshot;
  getProjectedModel(): ProjectedOpenBimModel;
  updateBuilding(building: Building): void;
  assignClassification(elementId: string, systemId: string, code: string): void;
  setCustomProperty(elementId: string, key: string, value: string): void;
  runIdsAudit(idsXml?: string): IdsAuditReport;
  runQtoEvaluation(customRules?: readonly QtoRule[]): QtoRun;
  inspectIfcStepBytes(fileName: string, bytes: Uint8Array): OpenBimIfcDiagnosticBundle;
  run3DClashDetection(
    federatedPrisms: readonly FederatedBoxPrismInput[],
    method?: ClashMethod,
    rules?: Partial<ClashRules>,
  ): Promise<ElementClash[]>;
  addBcfIssue(draft: {
    readonly title: string;
    readonly topicType?: string;
    readonly priority?: string;
    readonly assignedTo?: string;
    readonly description?: string;
    readonly ifcGuid?: string;
  }): OpenBimBcfIssue;
  updateBcfIssueStatus(guid: string, status: string): void;
  addBcfComment(guid: string, author: string, text: string): void;
  exportBcfZip(projectName?: string): Uint8Array;
  importBcfZip(bytes: Uint8Array): OpenBimBcfIssue[];
  buildCobieDataset(): CobieExportBundle;
  exportCobie(format: 'xls' | 'zip'): Uint8Array;
  proposeCanonicalEdit(
    params: Omit<BimCanonicalEditInput, 'currentBuilding' | 'expectedSource'>,
  ): BimCanonicalEditResult;
  resize(): void;
  unmount(): void;
}

export function mountOpenBimStudio(options: MountOpenBimStudioOptions): MountedOpenBimStudioController {
  let currentBuilding = options.building;
  let classifications: ScheduleAssignmentLike[] = [...(options.initialClassifications ?? [])];
  let customProperties: Record<string, Record<string, string>> = structuredClone(
    (options.initialCustomProperties as Record<string, Record<string, string>> | undefined) ?? {},
  );
  let bcfIssues: OpenBimBcfIssue[] = [...(options.initialBcfIssues ?? [])];
  let projected = projectCanonicalBuildingToOpenBim(currentBuilding, {
    assignments: classifications,
    customProperties,
  });
  let lastIdsReport: IdsAuditReport | null = validateElementsAgainstIds(
    parseIdsXml(DEFAULT_RESIDENTIAL_IDS_XML),
    projected.elements,
  );
  let lastQtoRun: QtoRun = evaluateQtoRules(
    [...projected.takeoffRows],
    [...DEFAULT_ARCHITECTURAL_QTO_RULES],
    { rates: DEFAULT_QTO_RATE_BOOK },
  );
  let lastIfcDiagnostics: OpenBimIfcDiagnosticBundle | null = null;
  let lastFederatedClashes: ElementClash[] = [];
  let disposed = false;

  const resizeObserver =
    options.container && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          /* Container resize hook for hosted views */
        })
      : null;
  if (options.container) {
    options.container.dataset.openbimMounted = 'true';
    resizeObserver?.observe(options.container);
  }

  function recomputeModel() {
    projected = projectCanonicalBuildingToOpenBim(currentBuilding, {
      assignments: classifications,
      customProperties,
    });
    lastQtoRun = evaluateQtoRules(
      [...projected.takeoffRows],
      [...DEFAULT_ARCHITECTURAL_QTO_RULES],
      { rates: DEFAULT_QTO_RATE_BOOK },
    );
    if (lastIdsReport) {
      lastIdsReport = validateElementsAgainstIds(lastIdsReport.document, projected.elements);
    }
  }

  function snapshot(): OpenBimSessionSnapshot {
    return {
      projectId: currentBuilding.projectId,
      buildingId: currentBuilding.id,
      source: projected.source,
      elementCount: projected.elements.length,
      classificationAssignments: [...classifications],
      customProperties: structuredClone(customProperties),
      bcfIssues: [...bcfIssues],
      lastIdsReport,
      lastQtoRun,
      lastIfcDiagnostics,
      lastFederatedClashes: [...lastFederatedClashes],
    };
  }

  function emit() {
    if (!disposed) options.onStateChange?.(snapshot());
  }

  emit();

  return {
    getSnapshot: snapshot,
    getProjectedModel: () => projected,
    updateBuilding(building: Building) {
      currentBuilding = building;
      recomputeModel();
      emit();
    },
    assignClassification(elementId: string, systemId: string, code: string) {
      classifications = [
        ...classifications.filter(a => !(a.elementId === elementId && a.systemId === systemId)),
        ...(code.trim() ? [{ elementId, systemId, code: code.trim() }] : []),
      ];
      recomputeModel();
      emit();
    },
    setCustomProperty(elementId: string, key: string, value: string) {
      const bag = { ...(customProperties[elementId] ?? {}) };
      if (value.trim()) bag[key.trim()] = value.trim();
      else delete bag[key.trim()];
      customProperties = { ...customProperties, [elementId]: bag };
      recomputeModel();
      emit();
    },
    runIdsAudit(idsXml = DEFAULT_RESIDENTIAL_IDS_XML) {
      try {
        const parsed = parseIdsXml(idsXml);
        lastIdsReport = validateElementsAgainstIds(parsed, projected.elements);
        emit();
        return lastIdsReport;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'IDS XML parse failure.';
        options.onError?.(msg);
        throw err;
      }
    },
    runQtoEvaluation(customRules = DEFAULT_ARCHITECTURAL_QTO_RULES) {
      lastQtoRun = evaluateQtoRules([...projected.takeoffRows], [...customRules], {
        rates: DEFAULT_QTO_RATE_BOOK,
      });
      emit();
      return lastQtoRun;
    },
    inspectIfcStepBytes(fileName: string, bytes: Uint8Array) {
      const text = new TextDecoder('latin1').decode(bytes);
      const semantic = buildSemanticModel(text);
      const findings = validateSemanticModel(semantic);
      const interop = buildInteropReport(fileName, bytes);
      const fidelity = buildImportFidelityReport(fileName, bytes);
      lastIfcDiagnostics = {
        fileName,
        interop: interop && fidelity ? { ...interop, fidelity } : interop,
        fidelity,
        findings,
      };
      emit();
      return lastIfcDiagnostics;
    },
    async run3DClashDetection(federatedPrisms, method = 'hard-triangle', rules = {}) {
      lastFederatedClashes = await runFederatedOpenBimClashCheck({
        projected,
        federatedPrisms,
        method,
        rules,
      });
      emit();
      return lastFederatedClashes;
    },
    addBcfIssue(draft) {
      const issue: OpenBimBcfIssue = {
        guid: bcfGuid(),
        projectId: currentBuilding.projectId,
        canonicalRevision: currentBuilding.version,
        topicType: draft.topicType ?? 'Clash',
        topicStatus: 'Open',
        priority: draft.priority ?? 'Normal',
        title: draft.title.trim() || 'Coordination Issue',
        assignedTo: draft.assignedTo,
        description: draft.description,
        createdAt: Date.now(),
        createdBy: 'BIM Coordinator',
        labels: ['openbim', `rev-${currentBuilding.version}`],
        ...(draft.ifcGuid
          ? { components: [{ ifcGuid: draft.ifcGuid, originatingSystem: 'RH Planner BIM Studio' }] }
          : {}),
      };
      bcfIssues = [issue, ...bcfIssues];
      emit();
      return issue;
    },
    updateBcfIssueStatus(guid: string, status: string) {
      bcfIssues = bcfIssues.map(iss =>
        iss.guid === guid ? { ...iss, topicStatus: status, modifiedAt: Date.now() } : iss,
      );
      emit();
    },
    addBcfComment(guid: string, author: string, text: string) {
      bcfIssues = bcfIssues.map(iss =>
        iss.guid === guid
          ? {
              ...iss,
              modifiedAt: Date.now(),
              comments: [
                ...(iss.comments ?? []),
                { guid: bcfGuid(), author: author || 'Coordinator', date: Date.now(), text },
              ],
            }
          : iss,
      );
      emit();
    },
    exportBcfZip(projectName?: string) {
      return exportBcf21Archive({
        projectId: currentBuilding.projectId,
        projectName: projectName ?? currentBuilding.name ?? currentBuilding.projectId,
        issues: bcfIssues,
      });
    },
    importBcfZip(bytes: Uint8Array) {
      const imported = importBcf21Archive(bytes, currentBuilding.projectId, currentBuilding.version);
      const existingGuids = new Set(bcfIssues.map(i => i.guid));
      bcfIssues = [...imported.filter(i => !existingGuids.has(i.guid)), ...bcfIssues];
      emit();
      return imported;
    },
    buildCobieDataset() {
      return buildCanonicalCobieDataset({
        building: currentBuilding,
        assignments: classifications,
        issues: bcfIssues,
      });
    },
    exportCobie(format: 'xls' | 'zip') {
      const ds = buildCanonicalCobieDataset({
        building: currentBuilding,
        assignments: classifications,
        issues: bcfIssues,
      });
      return format === 'xls' ? exportCobieHtmlWorkbook(ds) : exportCobieCsvZip(ds);
    },
    proposeCanonicalEdit(params) {
      return proposeOpenBimCanonicalEdit({
        ...params,
        currentBuilding,
        expectedSource: projected.source,
      });
    },
    resize() {
      // Handled via ResizeObserver when container is supplied
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      if (options.container) {
        delete options.container.dataset.openbimMounted;
      }
    },
  };
}

export { BUILTIN_CLASSIFICATION_SYSTEMS, DEFAULT_ARCHITECTURAL_QTO_RULES, DEFAULT_RESIDENTIAL_IDS_XML };
