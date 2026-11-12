import type { Building } from '@ai-floor-planner/core';
import { ExportError } from './export-selection.js';

export class StructuralDrawingsService {
  public async generateStructuralDrawingPackage(_building: Building): Promise<{
    filename: string; mimeType: string; data: Uint8Array; pageCount: number;
  }> {
    throw new ExportError('REVIEWED_STRUCTURAL_MODEL_REQUIRED',
      'NOT_VERIFIED: architectural geometry cannot supply approved structural sections, foundations or reinforcement.', 409);
  }
}
