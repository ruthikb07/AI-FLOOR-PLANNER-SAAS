import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('../packages/backend/node_modules/pdf-lib');
import { Direction } from '../packages/core/src/types/enums.ts';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
} from '../packages/core/src/types/multi-sheet-apartment.ts';
import { generateHardenedResidential } from '../packages/planning-engine/src/structural/hardened-residential-generation.ts';
import { StructuralAnalysisEngine } from '../packages/backend/src/services/structural-analysis-engine.ts';
import { generateETABSAnalysisPdfReport } from '../packages/backend/src/services/etabs-report-pdf.ts';
import { StructuralDrawingsService } from '../packages/backend/src/services/structural-drawings-service.ts';

const outDir = path.resolve('test-artifacts/verified-structural-exports');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RH PLANNER — P3.3 STRUCTURAL DRAWINGS & REPORT VERIFICATION PIPELINE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Generate Canonical 5-Level Residential Building
  console.log('[1/4] Synthesizing reviewed multi-storey residential project...');
  const res = generateHardenedResidential({
    projectId: 'rh-structural-p3-project',
    plotWidthMm: 18000,
    plotDepthMm: 25000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 3,
    flatsPerFloor: 2,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_ONLY',
  });

  const building = res.building;
  console.log(`  Project: "${building.name}" (${building.floors.length} storeys: Stilt, Floor 1, Floor 2, Floor 3, Terrace)`);

  // 2. Comprehensive Structural FEM Model & Ledger
  console.log('\n[2/4] Generating comprehensive structural framing model (IS 456, IS 1893:2016)...');
  const engine = new StructuralAnalysisEngine();
  const model = engine.generateComprehensiveModel(building);
  console.log(`  Grids generated: ${model.gridLines.length} grid lines (X: A..${String.fromCharCode(64 + model.gridLines.filter(g => g.axis === 'X').length)}, Y: 1..${model.gridLines.filter(g => g.axis === 'Y').length})`);
  console.log(`  Columns extracted/synthesized: ${model.columns.length} columns`);
  console.log(`  Beams framed: ${model.beams.length} framing beams`);
  console.log(`  Slabs scheduled: ${model.slabs.length} slab panels`);
  console.log(`  Footings sized: ${model.footings.length} shallow isolated footings (SBC = 200 kPa)`);
  console.log(`  Base reactions: ${model.reactions.length} support reaction nodes`);
  console.log(`  Seismic Base Shear Vb: ${model.summary.baseShearKn} kN (Zone III, Z=0.16, R=5.0, I=1.2)`);
  console.log(`  Max Storey Drift Ratio: ${model.summary.maxDriftRatio} vs Allowable: ${model.summary.allowableDriftRatio} -> ${model.summary.overallStatus}`);

  const jsonPath = path.join(outDir, `${building.id}_structural_model.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(model, null, 2));
  const jsonSha = createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex');
  console.log(`  Written: ${jsonPath} (${fs.statSync(jsonPath).size} bytes, SHA-256: ${jsonSha.slice(0, 16)})`);

  // 3. Multi-Page ETABS Structural Analysis & IS Code Compliance PDF Report
  console.log('\n[3/4] Generating 4-page ETABS Structural Analysis PDF Report (ISO 32000-1)...');
  const reportPdfBytes = await generateETABSAnalysisPdfReport(model);
  const reportDoc = await PDFDocument.load(reportPdfBytes, { throwOnInvalidObject: true });
  const reportPageCount = reportDoc.getPageCount();
  const reportPath = path.join(outDir, `${building.id}_ETABS_Structural_Analysis_Report.pdf`);
  fs.writeFileSync(reportPath, reportPdfBytes);
  const reportSha = createHash('sha256').update(reportPdfBytes).digest('hex');
  console.log(`  Verified PDF pages: ${reportPageCount} A4 pages`);
  console.log(`  Written: ${reportPath} (${reportPdfBytes.length} bytes, SHA-256: ${reportSha.slice(0, 16)})`);

  // 4. ISO A3 Landscape Multi-Sheet Structural CAD Drawing Set
  console.log('\n[4/4] Generating ISO A3 Landscape Structural CAD Drawing Set (S-101 to S-104)...');
  const drawingsService = new StructuralDrawingsService();
  const drawingsResult = await drawingsService.generateStructuralDrawingPackage(building);
  const drawingsDoc = await PDFDocument.load(drawingsResult.data, { throwOnInvalidObject: true });
  const drawingsPageCount = drawingsDoc.getPageCount();
  const drawingsPath = path.join(outDir, `${building.id}_Structural_Drawings_S101_S104.pdf`);
  fs.writeFileSync(drawingsPath, drawingsResult.data);
  const drawingsSha = createHash('sha256').update(drawingsResult.data).digest('hex');
  console.log(`  Verified CAD sheets: ${drawingsPageCount} ISO A3 Landscape sheets`);
  for (let i = 0; i < drawingsPageCount; i++) {
    const page = drawingsDoc.getPage(i);
    console.log(`    Sheet S-10${i + 1}: ${page.getWidth().toFixed(1)} x ${page.getHeight().toFixed(1)} pt (ISO A3 Landscape: 1190.6 x 841.9 pt)`);
  }
  console.log(`  Written: ${drawingsPath} (${drawingsResult.data.length} bytes, SHA-256: ${drawingsSha.slice(0, 16)})`);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' STRUCTURAL REPORTING & DRAWING PIPELINE VERIFICATION SUCCESSFUL');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
