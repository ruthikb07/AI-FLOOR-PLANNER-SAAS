import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBuilding, createEmptySpaceProgram, createProgramItem, getSpaceDefinition, Direction } from '@ai-floor-planner/core';
import { AiConceptImagePanel } from '../components/generation/AiConceptImagePanel';
import { CURRENT_PROJECT_SCHEMA_VERSION, LocalStorageProjectStorage, type FloorPlanImageSession, type ProjectEnvelope } from '../services/storage';

const mockStore: Record<string, string> = {};
beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
  globalThis.localStorage = {
    getItem: (key: string) => mockStore[key] ?? null,
    setItem: (key: string, value: string) => { mockStore[key] = value; },
    removeItem: (key: string) => { delete mockStore[key]; },
    clear: () => { for (const key of Object.keys(mockStore)) delete mockStore[key]; },
    key: (index: number) => Object.keys(mockStore)[index] ?? null,
    length: 0,
  } as Storage;
});

function envelope(): ProjectEnvelope {
  const building = createBuilding({
    projectId: 'panel-2',
    name: 'Panel Phase 2',
    site: { plotWidth: 9144, plotDepth: 15240, plannedFloorCount: 1, roadFacing: Direction.North, setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 } },
    floors: [{ buildingId: '', level: 0 }],
  });
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId: 'panel-2',
    name: 'Panel Phase 2',
    createdAt: '2026-09-19T00:00:00Z',
    updatedAt: '2026-09-19T00:00:00Z',
    building,
    spaceProgram: {
      ...createEmptySpaceProgram('residential'),
      items: [
        createProgramItem(getSpaceDefinition('living')!, 'living', { quantity: 1 }),
        createProgramItem(getSpaceDefinition('bedroom')!, 'bedroom', { quantity: 2 }),
      ],
    },
  };
}

function render(value: ProjectEnvelope): string {
  return renderToStaticMarkup(createElement(AiConceptImagePanel, { projectId: value.projectId, envelope: value }));
}

describe('Phase 2 — AI concept image panel honesty', () => {
  it('offers generation and discloses that no image exists yet', () => {
    const html = render(envelope());
    expect(html).toContain('Generate concept image');
    expect(html).toContain('No concept image generated yet');
  });

  it('never labels the AI image as a validated plan', () => {
    const html = render(envelope());
    expect(html).toContain('NOT A VALIDATED PLAN');
  });

  it('requires a reviewed Space Program instead of inventing a brief', () => {
    const value = envelope();
    const html = render({ ...value, spaceProgram: undefined });
    expect(html).toContain('reviewed Space Program is required');
  });

  it('displays the persisted original image with its reproduction metadata', () => {
    const value = envelope();
    const session: FloorPlanImageSession = {
      schemaVersion: 1,
      generationId: 'gen_20260904_x',
      seed: 20260904,
      attempt: 0,
      generatedAt: '2026-09-19T00:00:00Z',
      promptVersion: 1,
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      provider: 'cloudflare-workers-ai',
      mimeType: 'image/png',
      imageBase64: 'QUJD',
      request: { schemaVersion: 1, promptVersion: 1, prompt: 'top-down plan', negativePrompt: 'perspective', seed: 20260904, width: 1024, height: 1024, metadata: { projectName: 'Panel Phase 2', plotWidthMm: 9144, plotDepthMm: 15240, floorsCount: 1, roadFacing: 'north' } },
      contextSignature: `${value.building.id}:${value.building.version}:9144x15240`,
    };
    const stored: ProjectEnvelope = { ...value, floorPlanImage: session };
    new LocalStorageProjectStorage().save(stored);
    const html = render(stored);
    expect(html).toContain('data:image/png;base64,QUJD');
    expect(html).toContain('gen_20260904_x');
    expect(html).toContain('Regenerate alternative');
    expect(html).toContain('Original generation prompt');
    expect(html).not.toContain('This image was generated from an earlier revision');
  });

  it('flags a stale image after the canonical revision changes', () => {
    const value = envelope();
    const session: FloorPlanImageSession = {
      schemaVersion: 1,
      generationId: 'gen_old',
      seed: 1,
      attempt: 0,
      generatedAt: '2026-09-19T00:00:00Z',
      promptVersion: 1,
      model: 'm',
      provider: 'p',
      mimeType: 'image/png',
      imageBase64: 'QUJD',
      request: { schemaVersion: 1, promptVersion: 1, prompt: 'p', negativePrompt: 'n', seed: 1, width: 1024, height: 1024, metadata: { projectName: 'x', plotWidthMm: 1, plotDepthMm: 1, floorsCount: 1, roadFacing: 'north' } },
      contextSignature: 'stale-signature',
    };
    const stored: ProjectEnvelope = { ...value, floorPlanImage: session };
    new LocalStorageProjectStorage().save(stored);
    expect(render(stored)).toContain('generated from an earlier revision');
  });
});