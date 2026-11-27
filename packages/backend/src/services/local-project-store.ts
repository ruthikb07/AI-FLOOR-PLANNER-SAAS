import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalBuildingHash } from '@ai-floor-planner/core';
import type { Building, IrregularPlotBoundary } from '@ai-floor-planner/core';

export interface LocalRevisionSummary {
  readonly version: number;
  readonly savedAt: string;
  readonly note?: string;
  readonly complianceScore?: number;
}

export interface LocalProjectManifest {
  readonly projectId: string;
  readonly name: string;
  readonly shapeId: string;
  readonly planCategory?: string;
  readonly floorCount: number;
  readonly roomCount: number;
  readonly structuralColumnsCount: number;
  readonly structuralBeamsCount: number;
  readonly latestRevision: number;
  readonly complianceScore?: number;
  readonly irregularPlotBoundary?: IrregularPlotBoundary;
  readonly hasSourceCad: boolean;
  readonly sourceCadFileName?: string;
  readonly sourceCadStorageName?: string;
  readonly latestDigest?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly LocalRevisionSummary[];
}

export interface SaveLocalProjectInput {
  readonly projectId?: string;
  readonly name?: string;
  readonly building: Building;
  readonly expected?: { readonly revision: number; readonly digest: string };
  readonly note?: string;
  readonly sourceCad?: {
    readonly fileName: string;
    readonly contentBase64?: string;
    readonly contentText?: string;
  };
}

export interface LoadedLocalProject {
  readonly manifest: LocalProjectManifest;
  readonly building: Building;
  readonly revision: number;
  readonly digest: string;
}

export class LocalProjectRevisionConflict extends Error {}

export function isLocalProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,96}$/i.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

function resolveProjectDir(root: string, projectId: string): { projectId: string; projDir: string } {
  if (!isLocalProjectId(projectId)) throw new Error('Invalid local project id.');
  const absRoot = path.resolve(root);
  const projDir = path.resolve(absRoot, projectId);
  if (!projDir.startsWith(absRoot + path.sep)) {
    throw new Error('Invalid local project directory.');
  }
  return { projectId, projDir };
}

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw || 'source.dxf');
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 128);
  return safe || 'source.dxf';
}

export function resolveLocalProjectsRoot(): string {
  if (process.env.RH_LOCAL_PROJECTS_DIR) {
    return path.resolve(process.env.RH_LOCAL_PROJECTS_DIR);
  }
  // Locate packages/backend/data/local-projects regardless of cwd (repo root or packages/backend)
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'packages', 'backend', 'data', 'local-projects'),
    path.join(cwd, 'data', 'local-projects'),
  ];
  const backendDir = path.join(cwd, 'packages', 'backend');
  const root = fs.existsSync(backendDir) ? candidates[0]! : candidates[1]!;
  return path.resolve(root);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeAtomically(target: string, data: string | Buffer): void {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function listLocalProjects(): LocalProjectManifest[] {
  const root = resolveLocalProjectsRoot();
  if (!fs.existsSync(root)) return [];
  const manifests: LocalProjectManifest[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'project.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
      if (parsed && parsed.projectId) manifests.push(parsed);
    } catch {
      // Skip malformed manifest entries cleanly
    }
  }
  return manifests.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function saveLocalProject(input: SaveLocalProjectInput): LoadedLocalProject {
  const root = resolveLocalProjectsRoot();
  ensureDir(root);
  const { projectId, projDir } = resolveProjectDir(root, input.projectId || input.building.projectId || input.building.id);
  const revDir = path.join(projDir, 'revisions');
  ensureDir(revDir);

  const manifestPath = path.join(projDir, 'project.json');
  let existing: LocalProjectManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
  }

  const name = input.name || input.building.name || projectId;
  const buildingToStore: Building = projectId === input.building.projectId && name === input.building.name
    ? input.building
    : { ...input.building, projectId, name, metadata: { ...input.building.metadata, projectId } };
  const digest = canonicalBuildingHash(buildingToStore);
  const sourceBytes = input.sourceCad?.contentBase64
    ? Buffer.from(input.sourceCad.contentBase64, 'base64')
    : input.sourceCad?.contentText !== undefined ? Buffer.from(input.sourceCad.contentText) : undefined;
  const requestedSourceName = sourceBytes && input.sourceCad ? sanitizeFileName(input.sourceCad.fileName) : undefined;
  const requestedSourceStorageName = sourceBytes && requestedSourceName
    ? `${createHash('sha256').update(sourceBytes).digest('hex')}-${requestedSourceName}` : undefined;

  // The synchronous compare and publish execute in one backend turn. The manifest is
  // the commit point and is the only authority on which snapshots are readable.
  if (existing) {
    const latestPath = path.join(revDir, `rev-${existing.latestRevision}.json`);
    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as Building;
    const latestDigest = canonicalBuildingHash(latest);
    const latestNote = existing.revisions.find(entry => entry.version === existing.latestRevision)?.note;
    const sameSource = !requestedSourceStorageName || requestedSourceStorageName === existing.sourceCadStorageName;
    if (digest === latestDigest && sameSource && (input.note || undefined) === latestNote) {
      return { manifest: existing, building: latest, revision: existing.latestRevision, digest };
    }
    if (input.expected?.revision !== existing.latestRevision || input.expected.digest !== latestDigest) {
      throw new LocalProjectRevisionConflict('The disk project changed. Open the latest disk revision before saving over it.');
    }
  } else if (input.expected) {
    throw new LocalProjectRevisionConflict('The disk project no longer exists. Save a separate project to keep this copy.');
  }

  const now = new Date().toISOString();
  const nextRevision = (existing?.latestRevision ?? 0) + 1;
  let sourceCadFileName = existing?.sourceCadFileName ?? buildingToStore.metadata.sourceCadUnderlay?.fileName;
  let sourceCadStorageName = existing?.sourceCadStorageName;
  let hasSourceCad = Boolean(existing?.hasSourceCad);
  if (sourceBytes && requestedSourceName && requestedSourceStorageName) {
    const cadDir = path.join(projDir, 'source-cad');
    ensureDir(cadDir);
    writeAtomically(path.join(cadDir, requestedSourceStorageName), sourceBytes);
    sourceCadFileName = requestedSourceName;
    sourceCadStorageName = requestedSourceStorageName;
    hasSourceCad = true;
  }

  const revFile = path.join(revDir, `rev-${nextRevision}.json`);
  writeAtomically(revFile, JSON.stringify(buildingToStore, null, 2));

  const repFloor =
    buildingToStore.floors.find(f => f.floorUse === 'RESIDENTIAL' && (f.apartmentUnits?.length ?? 0) > 0) ??
    buildingToStore.floors[0];
  const roomCount = buildingToStore.floors.reduce((sum, f) => sum + f.rooms.length, 0);
  const structuralColumnsCount = repFloor?.columns?.length ?? 0;
  const structuralBeamsCount = repFloor?.beams?.length ?? buildingToStore.beams?.length ?? 0;
  const shapeId =
    buildingToStore.metadata.generationBrief?.buildingMassingShape ??
    buildingToStore.metadata.generationBrief?.requestedMassingShape ??
    'COMPACT_DOUBLE_LOADED';
  const complianceScore = buildingToStore.complianceRating?.score;

  const revisions: LocalRevisionSummary[] = [
    ...(existing?.revisions ?? []).filter(r => r.version !== nextRevision),
    {
      version: nextRevision,
      savedAt: now,
      ...(input.note ? { note: input.note } : {}),
      ...(complianceScore !== undefined ? { complianceScore } : {}),
    },
  ].sort((a, b) => a.version - b.version);

  const manifest: LocalProjectManifest = {
    projectId,
    name: buildingToStore.name,
    shapeId,
    planCategory: buildingToStore.metadata.generationBrief?.planCategory,
    floorCount: buildingToStore.floors.length,
    roomCount,
    structuralColumnsCount,
    structuralBeamsCount,
    latestRevision: nextRevision,
    latestDigest: digest,
    ...(complianceScore !== undefined ? { complianceScore } : {}),
    ...(buildingToStore.metadata.irregularPlotBoundary
      ? { irregularPlotBoundary: buildingToStore.metadata.irregularPlotBoundary }
      : existing?.irregularPlotBoundary
        ? { irregularPlotBoundary: existing.irregularPlotBoundary }
        : {}),
    hasSourceCad,
    ...(sourceCadFileName ? { sourceCadFileName } : {}),
    ...(sourceCadStorageName ? { sourceCadStorageName } : {}),
    createdAt: existing?.createdAt ?? buildingToStore.createdAt ?? now,
    updatedAt: now,
    revisions,
  };

  writeAtomically(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, building: buildingToStore, revision: nextRevision, digest };
}

export function loadLocalProject(rawId: string, requestedRevision?: number): LoadedLocalProject | null {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  const manifestPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
  const rev = requestedRevision && Number.isFinite(requestedRevision) ? requestedRevision : manifest.latestRevision;
  if (!manifest.revisions.some(entry => entry.version === rev)) return null;
  const revFile = path.join(projDir, 'revisions', `rev-${rev}.json`);
  if (!fs.existsSync(revFile)) return null;

  const building = JSON.parse(fs.readFileSync(revFile, 'utf8')) as Building;
  return { manifest, building, revision: rev, digest: canonicalBuildingHash(building) };
}

export function readLocalProjectSourceCad(rawId: string): { fileName: string; bytes: Buffer } | null {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  const manifestPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
  if (!manifest.sourceCadFileName) return null;
  const storedName = manifest.sourceCadStorageName;
  const cadFile = path.join(projDir, 'source-cad', storedName && /^[a-f0-9]{64}-[a-zA-Z0-9._-]{1,128}$/.test(storedName)
    ? storedName : sanitizeFileName(manifest.sourceCadFileName));
  if (!fs.existsSync(cadFile)) return null;
  return { fileName: sanitizeFileName(manifest.sourceCadFileName), bytes: fs.readFileSync(cadFile) };
}

export function deleteLocalProject(rawId: string): boolean {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  if (!fs.existsSync(projDir)) return false;
  fs.rmSync(projDir, { recursive: true, force: true });
  return true;
}

export type ProjectEngineeringDocKind =
  | 'cota_drawing'
  | 'openbim_session'
  | 'bcf_archive'
  | 'ids_report'
  | 'cobie_package'
  | 'cad_reference'
  | 'bim_reference'
  | 'plot_pdf';

export type ProjectEngineeringDocProvenance =
  | 'authored_cota'
  | 'authored_openbim'
  | 'imported_external'
  | 'exported_deliverable';

export interface ProjectEngineeringDocumentMeta {
  readonly docId: string;
  readonly projectId: string;
  readonly buildingId: string;
  readonly floorId?: string;
  readonly kind: ProjectEngineeringDocKind;
  readonly name: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly canonicalRevision: number;
  readonly canonicalDigest?: string;
  readonly provenance: ProjectEngineeringDocProvenance;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveProjectEngineeringDocumentInput {
  readonly docId?: string;
  readonly buildingId: string;
  readonly floorId?: string;
  readonly kind: ProjectEngineeringDocKind;
  readonly name: string;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly canonicalRevision: number;
  readonly canonicalDigest?: string;
  readonly provenance: ProjectEngineeringDocProvenance;
  readonly contentText?: string;
  readonly contentBase64?: string;
}

const VALID_DOC_KINDS = new Set<ProjectEngineeringDocKind>([
  'cota_drawing',
  'openbim_session',
  'bcf_archive',
  'ids_report',
  'cobie_package',
  'cad_reference',
  'bim_reference',
  'plot_pdf',
]);

export function isValidEngineeringDocKind(v: unknown): v is ProjectEngineeringDocKind {
  return typeof v === 'string' && VALID_DOC_KINDS.has(v as ProjectEngineeringDocKind);
}

export function listProjectEngineeringDocuments(rawProjectId: string): ProjectEngineeringDocumentMeta[] {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawProjectId);
  const indexFile = path.join(projDir, 'documents', 'index.json');
  if (!fs.existsSync(indexFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as ProjectEngineeringDocumentMeta[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      : [];
  } catch {
    return [];
  }
}

export function saveProjectEngineeringDocument(
  rawProjectId: string,
  input: SaveProjectEngineeringDocumentInput,
): ProjectEngineeringDocumentMeta {
  const root = resolveLocalProjectsRoot();
  ensureDir(root);
  const { projectId, projDir } = resolveProjectDir(root, rawProjectId);
  const docId = input.docId && isLocalProjectId(input.docId) ? input.docId : `doc-${randomUUID().slice(0, 12)}`;
  if (!isLocalProjectId(docId)) throw new Error('Invalid engineering document id.');

  const docsDir = path.join(projDir, 'documents');
  ensureDir(docsDir);

  const bytes =
    input.contentBase64 !== undefined
      ? Buffer.from(input.contentBase64, 'base64')
      : Buffer.from(input.contentText ?? '', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const now = new Date().toISOString();

  const existingList = listProjectEngineeringDocuments(projectId);
  const prev = existingList.find(d => d.docId === docId);

  const meta: ProjectEngineeringDocumentMeta = {
    docId,
    projectId,
    buildingId: input.buildingId || projectId,
    ...(input.floorId ? { floorId: input.floorId } : {}),
    kind: input.kind,
    name: (input.name || input.fileName || docId).slice(0, 200),
    fileName: sanitizeFileName(input.fileName || `${docId}.dat`),
    mimeType: input.mimeType || 'application/octet-stream',
    canonicalRevision: Number.isFinite(input.canonicalRevision) ? input.canonicalRevision : 1,
    ...(input.canonicalDigest ? { canonicalDigest: input.canonicalDigest } : {}),
    provenance: input.provenance,
    byteSize: bytes.byteLength,
    sha256,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  writeAtomically(path.join(docsDir, `${docId}.bin`), bytes);
  const nextList = [meta, ...existingList.filter(d => d.docId !== docId)];
  writeAtomically(path.join(docsDir, 'index.json'), JSON.stringify(nextList, null, 2));
  return meta;
}

export function loadProjectEngineeringDocument(
  rawProjectId: string,
  rawDocId: string,
): { meta: ProjectEngineeringDocumentMeta; bytes: Buffer } | null {
  if (!isLocalProjectId(rawDocId)) return null;
  const root = resolveLocalProjectsRoot();
  const { projectId, projDir } = resolveProjectDir(root, rawProjectId);
  const list = listProjectEngineeringDocuments(projectId);
  const meta = list.find(d => d.docId === rawDocId);
  if (!meta) return null;
  const binPath = path.join(projDir, 'documents', `${meta.docId}.bin`);
  if (!fs.existsSync(binPath)) return null;
  return { meta, bytes: fs.readFileSync(binPath) };
}

export function deleteProjectEngineeringDocument(rawProjectId: string, rawDocId: string): boolean {
  if (!isLocalProjectId(rawDocId)) return false;
  const root = resolveLocalProjectsRoot();
  const { projectId, projDir } = resolveProjectDir(root, rawProjectId);
  const docsDir = path.join(projDir, 'documents');
  const existing = listProjectEngineeringDocuments(projectId);
  if (!existing.some(d => d.docId === rawDocId)) return false;
  const next = existing.filter(d => d.docId !== rawDocId);
  ensureDir(docsDir);
  writeAtomically(path.join(docsDir, 'index.json'), JSON.stringify(next, null, 2));
  fs.rmSync(path.join(docsDir, `${rawDocId}.bin`), { force: true });
  return true;
}
