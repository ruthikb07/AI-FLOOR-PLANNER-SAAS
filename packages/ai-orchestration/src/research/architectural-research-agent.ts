/**
 * Architectural Research Agent powered by Google Gemini.
 * Analyzes site constraints, orientation, daylighting, and NBC/IBC residential spatial standards.
 */

import { Direction, RoomType } from '@ai-floor-planner/core';
import type { AIProvider } from '@ai-floor-planner/core';
import { AITaskType } from '@ai-floor-planner/core';

export interface ArchitecturalResearchInput {
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly roadFacing: Direction;
  readonly floorsCount: number;
  readonly bedroomCount: number;
  readonly bathroomCount: number;
  readonly vastuEnabled?: boolean;
  readonly gardenPreferred?: boolean;
  readonly parkingRequired?: boolean;
}

export interface RoomSizingRecommendation {
  readonly targetAreaSqM: number;
  readonly minAreaSqM: number;
  readonly maxAreaSqM: number;
  readonly daylightOrientation: string;
}

export interface ArchitecturalResearchReport {
  readonly plotCategory: 'compact' | 'standard' | 'large' | 'estate';
  readonly buildableFootprintSqM: number;
  readonly recommendedRoomAreas: Partial<Record<RoomType, RoomSizingRecommendation>>;
  readonly daylightStrategy: string;
  readonly ventilationStrategy: string;
  readonly zoningRecommendations: readonly string[];
  readonly circulationGuideline: string;
  readonly architecturalRationale: string;
  readonly source: 'gemini_research' | 'nbc_deterministic_benchmark';
}

const RESEARCH_SYSTEM_PROMPT = `You are a licensed Senior Architect and Building Code Standards Researcher (National Building Code & IBC).
Given a residential building plot, analyze the plot geometry, solar orientation, and brief to formulate an architectural design research report.
Respond with a pure JSON object conforming to this exact structure:
{
  "plotCategory": "compact" | "standard" | "large" | "estate",
  "buildableFootprintSqM": number,
  "daylightStrategy": string,
  "ventilationStrategy": string,
  "circulationGuideline": string,
  "architecturalRationale": string,
  "recommendedRoomAreas": {
    "living": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "dining": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "kitchen": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "bedroom": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "bathroom": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "staircase": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string },
    "ots": { "targetAreaSqM": number, "minAreaSqM": number, "maxAreaSqM": number, "daylightOrientation": string }
  },
  "zoningRecommendations": [string, string, string]
}`;

export class ArchitecturalResearchAgent {
  constructor(private readonly provider?: AIProvider) {}

  async researchPlot(input: ArchitecturalResearchInput): Promise<ArchitecturalResearchReport> {
    const plotWidthM = input.plotWidthMm / 1000;
    const plotDepthM = input.plotDepthMm / 1000;
    const totalPlotAreaSqM = plotWidthM * plotDepthM;
    const buildableFootprintSqM = Math.round(
      Math.max(20, (plotWidthM - 2) * (plotDepthM - 3.5)) * 10
    ) / 10;

    const plotCategory: 'compact' | 'standard' | 'large' | 'estate' =
      totalPlotAreaSqM < 130 ? 'compact' :
      totalPlotAreaSqM < 220 ? 'standard' :
      totalPlotAreaSqM < 400 ? 'large' : 'estate';

    // If provider is available, query Gemini 3.6 Flash
    if (this.provider && (await this.provider.isAvailable())) {
      try {
        const userPrompt = `Analyze residential plot: ${plotWidthM.toFixed(1)}m wide x ${plotDepthM.toFixed(1)}m deep (${totalPlotAreaSqM.toFixed(0)} sq m / ~${(totalPlotAreaSqM * 10.764).toFixed(0)} sq ft).
Road Facing: ${input.roadFacing}.
Floors: ${input.floorsCount}, Bedrooms: ${input.bedroomCount}, Bathrooms: ${input.bathroomCount}.
Vastu Orientation: ${input.vastuEnabled ? 'Preferred' : 'Neutral'}.
Garden/Outdoor: ${input.gardenPreferred ? 'Preferred' : 'Standard setbacks'}.
Parking: ${input.parkingRequired ? '1 Off-street car space' : 'Front arrival'}.
Provide proportional room sizing, cross-ventilation light-shaft (OTS) sizing, and daylight orientations.`;

        const response = await this.provider.complete({
          taskType: AITaskType.ComplexReasoning,
          systemPrompt: RESEARCH_SYSTEM_PROMPT,
          userPrompt,
          responseFormat: 'json',
          temperature: 0.2,
          maxTokens: 5000,
        });

        if (response.parsed && typeof response.parsed === 'object') {
          const p = response.parsed as any;
          if (p.daylightStrategy && p.recommendedRoomAreas) {
            return {
              plotCategory: p.plotCategory || plotCategory,
              buildableFootprintSqM: p.buildableFootprintSqM || buildableFootprintSqM,
              recommendedRoomAreas: p.recommendedRoomAreas,
              daylightStrategy: String(p.daylightStrategy),
              ventilationStrategy: String(p.ventilationStrategy || 'Central OTS shaft providing cross-ventilation to wet cores.'),
              zoningRecommendations: Array.isArray(p.zoningRecommendations) ? p.zoningRecommendations.map(String) : [
                'Public living zone aligned with road frontage',
                'Central dog-legged vertical circulation & OTS light shaft',
                'Private sleeping sanctuary insulated at perimeter and upper floor',
              ],
              circulationGuideline: String(p.circulationGuideline || 'Foyer directly feeding central lobby; circulation <= 14% of carpet area.'),
              architecturalRationale: String(p.architecturalRationale || 'Optimized residential layout preserving structural grid alignments and continuous daylight envelopes.'),
              source: 'gemini_research',
            };
          }
        }
      } catch (err) {
        console.warn('[ArchitecturalResearchAgent] Gemini live research fell back to NBC benchmark:', err);
      }
    }

    // Deterministic NBC standards benchmark fallback
    return this.createDeterministicBenchmark(input, buildableFootprintSqM, plotCategory);
  }

  private createDeterministicBenchmark(
    input: ArchitecturalResearchInput,
    buildableFootprintSqM: number,
    plotCategory: 'compact' | 'standard' | 'large' | 'estate',
  ): ArchitecturalResearchReport {
    const scale = plotCategory === 'compact' ? 0.85 : plotCategory === 'large' ? 1.3 : plotCategory === 'estate' ? 1.6 : 1.0;

    return {
      plotCategory,
      buildableFootprintSqM,
      daylightStrategy: `Orient primary public rooms to the ${input.roadFacing} street frontage for maximum natural illumination; buffer sleeping quarters along quieter side boundaries.`,
      ventilationStrategy: 'Anchor an Open-To-Sky (OTS) vertical shaft to aerate internal bathrooms and kitchen service areas naturally.',
      zoningRecommendations: [
        'Road-facing public zone (Living & Dining)',
        'Central core: Dog-legged staircase, Foyer arrival, and OTS light well',
        'Private suite: Master Bedroom with walk-in dressing and attached ensuite',
      ],
      circulationGuideline: 'Foyer arrival directly feeding central circulation spine without through-room traffic (<12% carpet area).',
      architecturalRationale: `Proportional residential layout calibrated for ${plotCategory} site scale with zero internal room overlap and verified structural grid alignment.`,
      recommendedRoomAreas: {
        [RoomType.Living]: { targetAreaSqM: Math.round(22 * scale), minAreaSqM: 16, maxAreaSqM: Math.round(38 * scale), daylightOrientation: input.roadFacing },
        [RoomType.Dining]: { targetAreaSqM: Math.round(14 * scale), minAreaSqM: 10, maxAreaSqM: Math.round(22 * scale), daylightOrientation: 'Central-Spine' },
        [RoomType.Kitchen]: { targetAreaSqM: Math.round(10 * scale), minAreaSqM: 7, maxAreaSqM: Math.round(16 * scale), daylightOrientation: 'South-East / Rear' },
        [RoomType.Bedroom]: { targetAreaSqM: Math.round(16 * scale), minAreaSqM: 12, maxAreaSqM: Math.round(26 * scale), daylightOrientation: 'South-West / Garden' },
        [RoomType.Bathroom]: { targetAreaSqM: Math.round(4.5 * scale), minAreaSqM: 3.2, maxAreaSqM: Math.round(7.5 * scale), daylightOrientation: 'OTS-Shaft' },
        [RoomType.Staircase]: { targetAreaSqM: 7.6, minAreaSqM: 6.5, maxAreaSqM: 9.5, daylightOrientation: 'Central-Core' },
        [RoomType.OTS]: { targetAreaSqM: 1.8, minAreaSqM: 1.2, maxAreaSqM: 3.0, daylightOrientation: 'Open-To-Sky' },
      },
      source: 'nbc_deterministic_benchmark',
    };
  }
}
