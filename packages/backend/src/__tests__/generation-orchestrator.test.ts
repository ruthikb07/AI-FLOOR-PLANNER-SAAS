import { describe, expect, it, vi } from 'vitest';
import { Direction } from '@ai-floor-planner/core';
import {
  GenerationOrchestrator,
  type GenerationOrchestratorInput,
  type GenerationOrchestratorDeps,
} from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';
import { LocalStubImageProvider } from '../services/local-stub-image-provider.js';
import { synthesizeInterpretation } from '../services/local-stub-plan-interpreter.js';
import { checkProviderHealth } from '../server.js';
import { resolveImageServiceConfig } from '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function createTempStore(): { store: ImageArtifactStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-orchestrator-test-'));
  return {
    store: new ImageArtifactStore(dir),
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    },
  };
}

describe('Two-AI Generation Orchestrator', () => {
  it('runs complete 8-step pipeline to produce an accepted candidate with raw image and Gemini score', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const mockGemini = {
        name: 'gemini',
        complete: vi.fn(async (req) => {
          if (req.taskType === 'image_interpretation') {
            return {
              content: '{}',
              parsed: {
                boundary: { points: [{ x: 50, y: 50 }, { x: 450, y: 50 }, { x: 450, y: 450 }, { x: 50, y: 450 }] },
                rooms: [
                  { id: 'living', name: 'Living Room', type: 'living', x: 60, y: 60, width: 180, height: 180 },
                  { id: 'bed1', name: 'Master Bedroom', type: 'bedroom', x: 250, y: 60, width: 180, height: 180 },
                  { id: 'bath1', name: 'Attached Bath', type: 'bathroom', x: 60, y: 250, width: 120, height: 120 },
                  { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 250, y: 250, width: 180, height: 180 },
                ],
                doors: [
                  { id: 'd1', x: 100, y: 60, width: 30, height: 10, type: 'single', adjacentRoomId: 'living' },
                ],
                windows: [
                  { id: 'w1', x: 120, y: 50, width: 40, height: 10, adjacentRoomId: 'living' },
                ],
                stairs: [],
                parking: [],
              },
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              model: 'gemini-3.6-flash',
              latencyMs: 120,
            };
          }
          // Architectural evaluation
          return {
            content: '{}',
            parsed: {
              overallScore: 88,
              requirementSatisfaction: 90,
              spatialQuality: 87,
              circulation: 86,
              adjacency: 89,
              zoning: 88,
              privacy: 85,
              daylight: 90,
              efficiency: 87,
              roomProportions: 88,
              orientation: 92,
              strengths: ['Direct kitchen to dining adjacency', 'Good daylight orientation in living room'],
              concerns: ['Consider wider master bath entry'],
              rationale: 'Well-zoned functional residential floor plan.',
            },
            usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
            model: 'gemini-3.6-flash',
            latencyMs: 110,
          };
        }),
        isAvailable: vi.fn(async () => true),
        getModelInfo: () => ({ model: 'gemini-3.6-flash', provider: 'gemini' }),
      };

      const deps: GenerationOrchestratorDeps = {
        provider: new LocalStubImageProvider(),
        store,
        gemini: mockGemini as any,
        interpreterKind: 'local-stub',
      };

      const orchestrator = new GenerationOrchestrator(deps);
      const input: GenerationOrchestratorInput = {
        projectId: 'test-proj-1',
        projectName: 'Test Home 10x10',
        site: {
          plotWidth: 10240,
          plotDepth: 10240,
          roadFacing: Direction.North,
          setbacks: { front: 0, rear: 0, left: 0, right: 0 },
        },
        roomCounts: {
          bedrooms: 2,
          bathrooms: 1,
          living: 1,
          dining: 0,
          kitchen: 1,
        },
        preferences: {
          parking: false,
          fullPlotCoverage: true,
        },
        seed: 42,
        candidateCount: 1,
      };

      const result = await orchestrator.run(input);

      expect(result.success).toBe(true);
      expect(result.feasibility.isFeasible).toBe(true);
      expect(result.candidates.length).toBe(1);

      const candidate = result.candidates[0]!;
      expect(candidate.status).toBe('ACCEPTED');
      expect(candidate.building).not.toBeNull();
      expect(candidate.validation.isValid).toBe(true);
      expect(candidate.artifact.generationId).toMatch(/^gen_/);
      expect(candidate.artifact.imageBase64.length).toBeGreaterThan(0);
      expect(candidate.evaluation).not.toBeNull();
      expect(candidate.evaluation?.overallScore).toBe(88);
    } finally {
      cleanup();
    }
  });

  it('stops at Step 2 Feasibility when requirements are physically impossible and does NOT call Cloudflare or Gemini Vision', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const mockCloudflare = {
        name: 'cloudflare',
        generateFloorPlan: vi.fn(),
        isAvailable: vi.fn(async () => true),
      };
      const mockGemini = {
        name: 'gemini',
        complete: vi.fn(),
        isAvailable: vi.fn(async () => true),
      };

      const deps: GenerationOrchestratorDeps = {
        provider: mockCloudflare as any,
        store,
        gemini: mockGemini as any,
        interpreterKind: 'gemini',
      };

      const orchestrator = new GenerationOrchestrator(deps);

      // Over-constrained request: tiny 3m x 3m plot with 8 bedrooms, 6 bathrooms, living, dining, parking
      const input: GenerationOrchestratorInput = {
        projectId: 'infeasible-test',
        site: {
          plotWidth: 3500,
          plotDepth: 3500,
          roadFacing: Direction.North,
          setbacks: { front: 1000, rear: 1000, left: 1000, right: 1000 },
        },
        roomCounts: {
          bedrooms: 8,
          bathrooms: 6,
          living: 2,
          dining: 1,
          kitchen: 1,
        },
      };

      const result = await orchestrator.run(input);

      expect(result.success).toBe(false);
      expect(result.feasibility.isFeasible).toBe(false);
      expect(result.error?.code).toBe('FEASIBILITY_ERROR');
      expect(result.error?.stage).toBe('feasibility');
      expect(result.error?.reasons?.length).toBeGreaterThan(0);

      // Cloudflare FLUX and Gemini Vision MUST NOT be called!
      expect(mockCloudflare.generateFloorPlan).not.toHaveBeenCalled();
      expect(mockGemini.complete).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('rejects candidate when extracted geometry fails hard deterministic validation and skips Gemini score', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const mockGemini = {
        name: 'gemini',
        complete: vi.fn(async (req) => {
          if (req.taskType === 'image_interpretation') {
            // Intentionally invalid extraction: rooms out of boundary and overlapping
            return {
              content: '{}',
              parsed: {
                boundary: { points: [{ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }] },
                rooms: [
                  { id: 'r1', name: 'Overlap 1', type: 'bedroom', x: 0, y: 0, width: 300, height: 300 },
                  { id: 'r2', name: 'Overlap 2', type: 'bedroom', x: 10, y: 10, width: 300, height: 300 },
                ],
                doors: [],
                windows: [],
                stairs: [],
                parking: [],
              },
              usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
              model: 'gemini-3.6-flash',
              latencyMs: 80,
            };
          }
          return { content: '{}', parsed: {} };
        }),
        isAvailable: vi.fn(async () => true),
        getModelInfo: () => ({ model: 'gemini-3.6-flash', provider: 'gemini' }),
      };

      const deps: GenerationOrchestratorDeps = {
        provider: new LocalStubImageProvider(),
        store,
        gemini: mockGemini as any,
        interpreterKind: 'gemini',
      };

      const orchestrator = new GenerationOrchestrator(deps);
      const input: GenerationOrchestratorInput = {
        projectId: 'invalid-geom-test',
        site: {
          plotWidth: 9144,
          plotDepth: 15240,
          roadFacing: Direction.North,
        },
        roomCounts: { bedrooms: 2, bathrooms: 1 },
      };

      const result = await orchestrator.run(input);

      expect(result.success).toBe(false);
      expect(result.candidates.length).toBe(1);
      const cand = result.candidates[0]!;
      expect(cand.status).toBe('REJECTED');
      expect(cand.building).toBeNull();
      expect(cand.validation.isValid).toBe(false);
      // Gemini evaluation MUST NOT be called on rejected candidate!
      expect(cand.evaluation).toBeNull();
      // Original image artifact preserved!
      expect(cand.artifact.imageBase64).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it('verifies server health check diagnostics correctly distinguish status', async () => {
    const config = resolveImageServiceConfig();
    const mockDeps = {
      provider: new LocalStubImageProvider(),
      gemini: null,
      interpreterKind: 'local-stub' as const,
    };

    const health = await checkProviderHealth(config, mockDeps);
    expect(health.cloudflare.reachable).toBe(true);
    expect(health.cloudflare.status).toBe('REACHABLE');
    expect(health.gemini.status).toBe('REACHABLE'); // local-stub active
  });

  it('Image persistence: FLUX success -> Gemini 503 failure -> original image still preserved in store', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const mockGemini = {
        name: 'gemini',
        complete: vi.fn(async () => {
          throw new Error('HTTP 503 This model is currently experiencing high demand.');
        }),
        isAvailable: vi.fn(async () => true),
        getModelInfo: () => ({ model: 'gemini-3.6-flash', provider: 'gemini' }),
      };

      const deps: GenerationOrchestratorDeps = {
        provider: new LocalStubImageProvider(),
        store,
        gemini: mockGemini as any,
        interpreterKind: 'gemini',
      };

      const orchestrator = new GenerationOrchestrator(deps);
      const input: GenerationOrchestratorInput = {
        projectId: 'persist-test-1',
        site: {
          plotWidth: 12000,
          plotDepth: 15000,
          roadFacing: Direction.North,
        },
        roomCounts: { bedrooms: 2, bathrooms: 2 },
      };

      const result = await orchestrator.run(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_UNAVAILABLE');
      expect(result.error?.isTransient).toBe(true);
      expect(result.savedArtifact).toBeDefined();
      expect(result.error?.artifactId).toBeDefined();

      // Verify the image was saved to the store and is still available
      const stored = await store.get(result.error!.artifactId!);
      expect(stored).not.toBeNull();
      expect(stored!.imageBase64).toBeDefined();
      expect(stored!.projectId).toBe('persist-test-1');
    } finally {
      cleanup();
    }
  });

  it('Resume: Image generated -> interpretation fails -> resumeFromArtifact succeeds with NO new FLUX call', async () => {
    const { store, cleanup } = createTempStore();
    try {
      let geminiCallCount = 0;
      let savedSpec: any = null;
      const mockGemini = {
        name: 'gemini',
        complete: vi.fn(async (req) => {
          geminiCallCount++;
          if (geminiCallCount === 1) {
            throw new Error('HTTP 503 This model is currently experiencing high demand.');
          }
          if (req.taskType === 'image_interpretation') {
            const synth = synthesizeInterpretation(savedSpec);
            return {
              content: JSON.stringify(synth.payload),
              parsed: synth.payload,
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              model: 'gemini-3.6-flash',
              latencyMs: 120,
            };
          }
          return {
            content: '{}',
            parsed: { overallScore: 85, rationale: 'Good plan.' },
            usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
            model: 'gemini-3.6-flash',
            latencyMs: 100,
          };
        }),
        isAvailable: vi.fn(async () => true),
        getModelInfo: () => ({ model: 'gemini-3.6-flash', provider: 'gemini' }),
      };

      const stubProvider = new LocalStubImageProvider();
      const generateFloorPlanSpy = vi.spyOn(stubProvider, 'generateFloorPlan');

      const deps: GenerationOrchestratorDeps = {
        provider: stubProvider,
        store,
        gemini: mockGemini as any,
        interpreterKind: 'gemini',
      };

      const orchestrator = new GenerationOrchestrator(deps);
      const input: GenerationOrchestratorInput = {
        projectId: 'resume-test-1',
        site: {
          plotWidth: 10240,
          plotDepth: 10240,
          roadFacing: Direction.North,
        },
        roomCounts: { bedrooms: 1, bathrooms: 1 },
        preferences: { parking: false, fullPlotCoverage: true },
      };

      // Step 1: Initial run fails on interpretation
      const initialResult = await orchestrator.run(input);
      expect(initialResult.success).toBe(false);
      expect(generateFloorPlanSpy).toHaveBeenCalledTimes(1); // 1 FLUX generation
      const savedArtifactId = initialResult.error?.artifactId;
      expect(savedArtifactId).toBeDefined();

      savedSpec = initialResult.requirements;

      // Step 2: Resume from saved artifact
      const resumeResult = await orchestrator.resumeFromArtifact({
        artifactId: savedArtifactId!,
        projectId: 'resume-test-1',
        requirements: initialResult.requirements,
      });

      // Crucial: FLUX was NOT called again during resume!
      expect(generateFloorPlanSpy).toHaveBeenCalledTimes(1);
      expect(resumeResult.error).toBeUndefined();
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.candidates.length).toBe(1);
      expect(resumeResult.candidates[0]!.building).not.toBeNull();
      expect(resumeResult.candidates[0]!.artifact.generationId).toBe(savedArtifactId);
    } finally {
      cleanup();
    }
  });

  describe('Phase 1 recovery — arbitrary flat counts reach FLUX (P1 acceptance gate)', () => {
    function buildApartmentInput(flatsPerFloor: number): GenerationOrchestratorInput {
      return {
        projectId: `apartment-${flatsPerFloor}-flats`,
        projectType: 'apartment',
        site: {
          plotWidth: 45000,
          plotDepth: 50000,
          roadFacing: Direction.North,
          setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
        },
        apartmentConfig: {
          projectType: 'apartment',
          jurisdiction: 'pune_pmc',
          floorCount: 4,
          flatsPerFloor,
          unitMix: [{ unitType: '2BHK', count: flatsPerFloor, carpetAreaSqFt: 750 }],
          commonCore: {
            passengerLifts: 1,
            serviceLifts: 0,
            staircaseCount: 1,
            fireStaircaseRequired: false,
            commonLobby: true,
          },
          parking: { residentParkingCount: flatsPerFloor, visitorParkingCount: 1 },
          amenities: { groundSiteAmenities: [], buildingAmenities: [] },
        },
        seed: 42,
        candidateCount: 1,
      };
    }

    it.each([1, 2, 3, 4, 5, 6])(
      'apartment with %d flat(s): schematic.units.length === flatsPerFloor === manifest.units.exactCount, and the request reaches FLUX (no schematic_validation stop)',
      async (flatsPerFloor) => {
        const { store, cleanup } = createTempStore();
        try {
          const stubProvider = new LocalStubImageProvider();
          const generateFloorPlanSpy = vi.spyOn(stubProvider, 'generateFloorPlan');

          const deps: GenerationOrchestratorDeps = {
            provider: stubProvider,
            store,
            gemini: null,
            interpreterKind: 'local-stub',
          };

          const orchestrator = new GenerationOrchestrator(deps);
          const result = await orchestrator.run(buildApartmentInput(flatsPerFloor));

          // Never rejected at the schematic/manifest gate (Phase 1 recovery, P1).
          expect(result.error?.stage).not.toBe('schematic_validation');

          expect(result.apartmentSchematic).toBeDefined();
          expect(result.apartmentManifest).toBeDefined();
          expect(result.apartmentSchematic!.units.length).toBe(flatsPerFloor);
          expect(result.apartmentManifest!.units.exactCount).toBe(flatsPerFloor);
          expect(result.apartmentSchematic!.units.length).toBe(result.apartmentManifest!.units.exactCount);

          // FLUX was actually invoked — the request reached the image provider.
          expect(generateFloorPlanSpy).toHaveBeenCalled();
        } finally {
          cleanup();
        }
      },
    );

    it('villa path (residential_independent) reaches FLUX without going through the apartment schematic gate', async () => {
      const { store, cleanup } = createTempStore();
      try {
        const stubProvider = new LocalStubImageProvider();
        const generateFloorPlanSpy = vi.spyOn(stubProvider, 'generateFloorPlan');

        const deps: GenerationOrchestratorDeps = {
          provider: stubProvider,
          store,
          gemini: null,
          interpreterKind: 'local-stub',
        };

        const orchestrator = new GenerationOrchestrator(deps);
        const input: GenerationOrchestratorInput = {
          projectId: 'villa-test',
          projectType: 'residential_independent',
          site: {
            plotWidth: 12000,
            plotDepth: 15000,
            roadFacing: Direction.North,
            setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
          },
          roomCounts: { bedrooms: 3, bathrooms: 2, living: 1, dining: 1, kitchen: 1 },
          preferences: { parking: true },
          seed: 42,
          candidateCount: 1,
        };

        const result = await orchestrator.run(input);

        expect(result.error?.stage).not.toBe('schematic_validation');
        expect(result.apartmentSchematic).toBeUndefined();
        expect(generateFloorPlanSpy).toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });
  });
});
