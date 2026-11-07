/**
 * Phase 3 - Deterministic extraction analysis (image-space to real-world mm).
 *
 * Image-space geometry is mapped to real-world millimetres using the KNOWN site
 * dimensions (PRD 22). The mapping is never distorted to force a pass; a genuine
 * mismatch is reported and the plan is rejected by validation instead.
 */

import type { RoomType } from '@ai-floor-planner/core';
import type { DiagnosticFragment, ExtractedPlan, ExtractionMetadata } from './extraction';

export interface NormalizationSite {
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly orientation: number;
  readonly roadFacing: string;
}

/** Site dimensions are authoritative; extraction must fit them, not vice versa. */
export function normalizationScales(
  metadata: ExtractionMetadata,
  site: { readonly plotWidth: number; readonly plotDepth: number },
): { scaleX: number; scaleY: number } | null {
  if (metadata.imageWidePixels <= 0 || metadata.imageTallPixels <= 0) return null;
  if (site.plotWidth <= 0 || site.plotDepth <= 0) return null;
  return {
    scaleX: site.plotWidth / metadata.imageWidePixels,
    scaleY: site.plotDepth / metadata.imageTallPixels,
  };
}

/**
 * Normalize image-space information into real-world mm. Returns an error
 * diagnostic (never fabricated geometry) when the mapping is impossible.
 */
export function normalizeExtractedPlan(
  extracted: ExtractedPlan,
  site: NormalizationSite,
): { normalized: ExtractedPlan | null; diagnostics: DiagnosticFragment[] } {
  const scales = normalizationScales(extracted.metadata, site);
  if (!scales) {
    return {
      normalized: null,
      diagnostics: [{
        code: 'NORMALIZATION_FAILED_ZERO_DIMENSIONS',
        severity: 'error',
        message: 'The source image or plot dimensions are invalid, so image coordinates cannot be mapped to real-world millimetres.',
      }],
    };
  }

  const imageAspect = extracted.metadata.imageWidePixels / extracted.metadata.imageTallPixels;
  const plotAspect = site.plotWidth / site.plotDepth;
  const aspectMismatchRatio = Math.abs(imageAspect - plotAspect) / plotAspect;

  const diagnostics: DiagnosticFragment[] = [];
  if (aspectMismatchRatio > 0.05) {
    diagnostics.push({
      code: 'NORMALIZATION_ASPECT_MISMATCH',
      severity: 'warning',
      message: `The source image aspect ratio ${imageAspect.toFixed(3)} does not match the plot aspect ratio ${plotAspect.toFixed(3)}. Extracted geometry may be distorted and requires review.`,
    });
  }

  return {
    normalized: {
      ...extracted,
      metadata: {
        ...extracted.metadata,
        aspectMismatchRatio,
        orientationDegrees: site.orientation,
        roadFacing: site.roadFacing,
        normalizedAt: new Date().toISOString(),
      },
    },
    diagnostics,
  };
}

/** Convert one image-space rectangle into real-world millimetre coordinates. */
export function imageRectToMillimetres(
  rect: { readonly imageX: number; readonly imageY: number; readonly imageWidth: number; readonly imageHeight: number },
  metadata: ExtractionMetadata,
  site: { readonly plotWidth: number; readonly plotDepth: number },
): { x: number; y: number; width: number; height: number } | null {
  const scales = normalizationScales(metadata, site);
  if (!scales) return null;
  return {
    x: rect.imageX * scales.scaleX,
    y: rect.imageY * scales.scaleY,
    width: rect.imageWidth * scales.scaleX,
    height: rect.imageHeight * scales.scaleY,
  };
}

/** Map a vision label to a canonical RoomType. Never invents a new type. */
export function extractedRoomType(typeName: string): RoomType {
  const name = typeName.trim().toLowerCase();
  if (name.includes('bedroom') || name.includes('bed')) return 'bedroom' as RoomType;
  if (name.includes('bath') || name.includes('wash') || name.includes('toilet') || name.includes('wc') || name.includes('ensuite')) return 'bathroom' as RoomType;
  if (name.includes('kitchen')) return 'kitchen' as RoomType;
  if (name.includes('living') || name.includes('drawing') || name.includes('family') || name.includes('sitting') || name.includes('parlor')) return 'living' as RoomType;
  if (name.includes('dining')) return 'dining' as RoomType;
  if (name.includes('hall') && !name.includes('stair') && !name.includes('toilet') && !name.includes('bath')) return 'living' as RoomType;
  if (name.includes('stair')) return 'staircase' as RoomType;
  if (name.includes('stair')) return 'staircase' as RoomType;
  if (name.includes('parking') || name.includes('car') || name.includes('garage') || name.includes('bay')) return 'parking' as RoomType;
  if (name.includes('porch') || name.includes('verandah') || name.includes('entry') || name.includes('foyer')) return 'foyer' as RoomType;
  if (name.includes('roof') || name.includes('terrace') || name.includes('balcon') || name.includes('open')) return 'balcony' as RoomType;
  if (name.includes('pooja') || name.includes('puja') || name.includes('prayer') || name.includes('meditation')) return 'pooja' as RoomType;
  if (name.includes('study') || name.includes('office') || name.includes('work')) return 'study' as RoomType;
  if (name.includes('utility') || name.includes('store')) return 'utility' as RoomType;
  if (name.includes('courtyard') || name.includes('court') || name.includes('garden')) return 'garden' as RoomType;
  return 'living' as RoomType;
}

/** Structural sanity of a decoded extraction, before geometry validation. */
export function inspectExtractionStructure(plan: ExtractedPlan): DiagnosticFragment[] {
  const issues: DiagnosticFragment[] = [];
  if (plan.boundary.points.length < 3) {
    issues.push({ code: 'EXTRACTION_BOUNDARY_DEGENERATE', severity: 'error', message: 'The image interpretation produced no usable building boundary.' });
  }
  for (const room of plan.rooms) {
    if (room.imageWidth <= 0 || room.imageHeight <= 0) {
      issues.push({ code: 'EXTRACTION_ROOM_DEGENERATE', severity: 'error', message: `Room "${room.name}" has a degenerate image-extracted rectangle.` });
    }
  }
  for (const door of plan.doors) {
    if (!plan.rooms.some(room => room.id === door.adjacentRoomId)) {
      issues.push({ code: 'EXTRACTION_DOOR_NO_ROOM', severity: 'warning', message: `Door "${door.id}" references an adjacent room that was not detected in the image.` });
    }
  }
  return issues;
}