import fs from 'node:fs';
import path from 'node:path';
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
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly LocalRevisionSummary[];
}

export interface SaveLocalProjectInput {
  readonly projectId?: string;
  readonly name?: string;
  readonly building: Building;
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
}

function sanitizeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return cleaned || `proj_${Date.now()}`;
}

function resolveProjectDir(root: string, rawId: string): { projectId: string; projDir: string } {
  const projectId = sanitizeId(rawId);
  const absRoot = path.resolve(root);
  const projDir = path.resolve(absRoot, projectId);
  if (!projDir.startsWith(absRoot + path.sep)) {
    throw new Error(`Invalid local project id "${rawId}".`);
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
    try {
      existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
    } catch {
      existing = null;
    }
  }

  const now = new Date().toISOString();
  const nextRevision = Math.max(
    (existing?.latestRevision ?? 0) + 1,
    input.building.version ?? 1,
  );

  // Persist optional original source CAD attachment under source-cad/
  let sourceCadFileName = existing?.sourceCadFileName ?? input.building.metadata.sourceCadUnderlay?.fileName;
  let hasSourceCad = Boolean(existing?.hasSourceCad);
  if (input.sourceCad && (input.sourceCad.contentBase64 || input.sourceCad.contentText)) {
    const cadDir = path.join(projDir, 'source-cad');
    ensureDir(cadDir);
    const safeName = sanitizeFileName(input.sourceCad.fileName);
    const targetPath = path.join(cadDir, safeName);
    if (input.sourceCad.contentBase64) {
      fs.writeFileSync(targetPath, Buffer.from(input.sourceCad.contentBase64, 'base64'));
    } else if (input.sourceCad.contentText !== undefined) {
      fs.writeFileSync(targetPath, input.sourceCad.contentText, 'utf8');
    }
    sourceCadFileName = safeName;
    hasSourceCad = true;
  }

  const buildingToStore: Building = {
    ...input.building,
    projectId,
    name: input.name || input.building.name || projectId,
    version: nextRevision,
    updatedAt: now,
  };

  // Write canonical Building JSON to revisions/rev-{n}.json
  const revFile = path.join(revDir, `rev-${nextRevision}.json`);
  fs.writeFileSync(revFile, JSON.stringify(buildingToStore, null, 2), 'utf8');

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
    ...(complianceScore !== undefined ? { complianceScore } : {}),
    ...(buildingToStore.metadata.irregularPlotBoundary
      ? { irregularPlotBoundary: buildingToStore.metadata.irregularPlotBoundary }
      : existing?.irregularPlotBoundary
        ? { irregularPlotBoundary: existing.irregularPlotBoundary }
        : {}),
    hasSourceCad,
    ...(sourceCadFileName ? { sourceCadFileName } : {}),
    createdAt: existing?.createdAt ?? buildingToStore.createdAt ?? now,
    updatedAt: now,
    revisions,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest, building: buildingToStore, revision: nextRevision };
}

export function loadLocalProject(rawId: string, requestedRevision?: number): LoadedLocalProject | null {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  const manifestPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
  const rev = requestedRevision && Number.isFinite(requestedRevision) ? requestedRevision : manifest.latestRevision;
  const revFile = path.join(projDir, 'revisions', `rev-${rev}.json`);
  if (!fs.existsSync(revFile)) return null;

  const building = JSON.parse(fs.readFileSync(revFile, 'utf8')) as Building;
  return { manifest, building, revision: rev };
}

export function readLocalProjectSourceCad(rawId: string): { fileName: string; bytes: Buffer } | null {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  const manifestPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProjectManifest;
  if (!manifest.sourceCadFileName) return null;
  const cadFile = path.join(projDir, 'source-cad', sanitizeFileName(manifest.sourceCadFileName));
  if (!fs.existsSync(cadFile)) return null;
  return { fileName: manifest.sourceCadFileName, bytes: fs.readFileSync(cadFile) };
}

export function deleteLocalProject(rawId: string): boolean {
  const root = resolveLocalProjectsRoot();
  const { projDir } = resolveProjectDir(root, rawId);
  if (!fs.existsSync(projDir)) return false;
  fs.rmSync(projDir, { recursive: true, force: true });
  return true;
}
