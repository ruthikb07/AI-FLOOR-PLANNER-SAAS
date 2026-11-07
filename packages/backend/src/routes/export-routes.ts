/**
 * Export Routes Module.
 * Provides Fastify / HTTP request handlers and controllers for AutoCAD DWG, DXF, and 1:100 ISO A3 Vector PDF exports.
 */

import type { Building } from '@ai-floor-planner/core';
import { CadExportService, type CadExportOptions, type CadExportResult } from '../services/cad-export-service.js';
import { PdfExportService, type PdfExportOptions, type PdfExportResult } from '../services/pdf-export-service.js';

export interface CadExportRequestBody {
  readonly building: Building;
  readonly options?: CadExportOptions;
}

export interface PdfExportRequestBody {
  readonly building: Building;
  readonly options?: PdfExportOptions;
}

export class ExportController {
  private readonly cadService = new CadExportService();
  private readonly pdfService = new PdfExportService();

  public handleDwgExport(building: Building, options: CadExportOptions = {}): CadExportResult {
    return this.cadService.exportCad(building, 'dwg', options);
  }

  public handleDxfExport(building: Building, options: CadExportOptions = {}): CadExportResult {
    return this.cadService.exportCad(building, 'dxf', options);
  }

  public handlePdfExport(building: Building, options: PdfExportOptions = {}): PdfExportResult {
    return this.pdfService.exportPdf(building, options);
  }
}

export { CadExportService, type CadExportOptions, type CadExportResult };
export { PdfExportService, type PdfExportOptions, type PdfExportResult };
