/**
 * Pure-TypeScript COBie 2.4 Dataset Builder, Excel HTML Workbook Writer (`.xls`),
 * and Multi-CSV Archive Writer (`.zip` via `fflate`), plus Built-In Industry
 * Classification Systems (Uniclass 2015, OmniClass Table 21, UniFormat II) and
 * Default 5D QTO Rules.
 *
 * Adapted from OpenBIMStudio 0.74.0 (`src/modules/export/cobie.ts`, MIT).
 */
import { strToU8, zipSync } from 'fflate';
import type { Building } from '@ai-floor-planner/core';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import type { OpenBimBcfIssue } from '../bcf/bcf-archive';
import type { ScheduleAssignmentLike, ScheduleSystemLike } from './schedule-classification';
import { resolveElementClassification } from './schedule-classification';
import type { QtoRateEntry, QtoRule } from './qto-rules';

export const BUILTIN_CLASSIFICATION_SYSTEMS: readonly ScheduleSystemLike[] = [
  {
    id: 'uniclass2015',
    name: 'Uniclass 2015 (EF)',
    codes: [
      { code: 'EF_25_10', title: 'Walls and barriers' },
      { code: 'EF_25_10_25', title: 'External walls' },
      { code: 'EF_25_10_40', title: 'Internal partition walls' },
      { code: 'EF_25_30_25', title: 'Doors' },
      { code: 'EF_25_30_95', title: 'Windows' },
      { code: 'EF_20_10', title: 'Superstructure frames (Columns & Beams)' },
      { code: 'EF_30_20', title: 'Suspended floor slabs' },
      { code: 'EF_35_10', title: 'Stairs and ramps' },
    ],
  },
  {
    id: 'uniformat2',
    name: 'UniFormat II',
    codes: [
      { code: 'B1010', title: 'Floor Construction (Slabs, Columns, Beams)' },
      { code: 'B2010', title: 'Exterior Walls' },
      { code: 'B2020', title: 'Exterior Windows' },
      { code: 'B2030', title: 'Exterior Doors' },
      { code: 'C1010', title: 'Interior Partitions' },
      { code: 'C1020', title: 'Interior Doors' },
      { code: 'C2010', title: 'Stair Construction' },
    ],
  },
  {
    id: 'omniclass21',
    name: 'OmniClass Table 21',
    codes: [
      { code: '21-02 10 10', title: 'Exterior Wall Construction' },
      { code: '21-02 10 20', title: 'Exterior Windows' },
      { code: '21-03 10 10', title: 'Interior Partitions' },
      { code: '21-03 10 30', title: 'Interior Doors' },
      { code: '21-02 20 10', title: 'Structural Floor Framing & Slabs' },
      { code: '21-03 20 10', title: 'Stair Assemblies' },
    ],
  },
];

export const DEFAULT_ARCHITECTURAL_QTO_RULES: readonly QtoRule[] = [
  {
    id: 'qto-masonry-walls',
    name: 'Brickwork / Blockwork Masonry Volume',
    classification: 'EF_25_10 Walls and barriers',
    filter: { matchAny: ['wall'] },
    formula: 'Volume',
    unit: 'm3',
    wasteFactorPct: 5,
    costCode: 'MAS-01',
  },
  {
    id: 'qto-wall-plaster',
    name: 'Internal & External Wall Plaster Area (Both Faces)',
    classification: 'EF_25_10 Walls and barriers',
    filter: { matchAny: ['wall'] },
    formula: 'Area * 2',
    unit: 'm2',
    wasteFactorPct: 3,
    costCode: 'FIN-01',
  },
  {
    id: 'qto-rcc-slab-concrete',
    name: 'RCC Suspended Slab Concrete',
    classification: 'EF_30_20 Suspended floor slabs',
    filter: { matchAny: ['slab'] },
    formula: 'Volume',
    unit: 'm3',
    wasteFactorPct: 2.5,
    costCode: 'RCC-01',
  },
  {
    id: 'qto-rcc-slab-rebar',
    name: 'Preliminary Slab Steel Allowance (95 kg/m³)',
    classification: 'EF_30_20 Suspended floor slabs',
    filter: { matchAny: ['slab'] },
    formula: 'Volume * 95',
    unit: 'kg',
    wasteFactorPct: 4,
    costCode: 'STL-01',
  },
  {
    id: 'qto-doors-schedule',
    name: 'Door Leaf & Frame Units',
    classification: 'EF_25_30_25 Doors',
    filter: { matchAny: ['door'] },
    formula: 'Count',
    unit: 'pcs',
    wasteFactorPct: 0,
    costCode: 'DR-01',
  },
  {
    id: 'qto-glazing-area',
    name: 'Window Glazing Area',
    classification: 'EF_25_30_95 Windows',
    filter: { matchAny: ['window'] },
    formula: 'Area',
    unit: 'm2',
    wasteFactorPct: 2,
    costCode: 'WIN-01',
  },
];

export const DEFAULT_QTO_RATE_BOOK: Record<string, QtoRateEntry> = {
  'MAS-01': { code: 'MAS-01', name: 'AAC Blockwork Masonry', unit: 'm3', rate: 5800 },
  'FIN-01': { code: 'FIN-01', name: 'Cement Sand / Gypsum Plaster', unit: 'm2', rate: 420 },
  'RCC-01': { code: 'RCC-01', name: 'M25 Ready-Mix Concrete', unit: 'm3', rate: 7200 },
  'STL-01': { code: 'STL-01', name: 'Fe550D TMT Reinforcement', unit: 'kg', rate: 78 },
  'DR-01': { code: 'DR-01', name: 'Engineered Flush Door Set', unit: 'pcs', rate: 16500 },
  'WIN-01': { code: 'WIN-01', name: 'UPVC / Aluminium Powder-Coated Window', unit: 'm2', rate: 6400 },
};

export interface CobieWorksheet {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<readonly string[]>;
}

export interface CobieExportBundle {
  readonly version: '2.4';
  readonly projectName: string;
  readonly revision: number;
  readonly worksheets: readonly CobieWorksheet[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsvCell(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCanonicalCobieDataset(params: {
  readonly building: Building;
  readonly assignments?: readonly ScheduleAssignmentLike[];
  readonly issues?: readonly OpenBimBcfIssue[];
  readonly authorEmail?: string;
}): CobieExportBundle {
  const { building, assignments = [], issues = [], authorEmail = 'architect@rh-planner.local' } = params;
  const nowIso = new Date().toISOString();

  const facility: CobieWorksheet = {
    name: 'Facility',
    headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'ProjectName', 'SiteName', 'LinearUnits', 'AreaUnits', 'VolumeUnits', 'Phase'],
    rows: [[
      building.name || building.projectId,
      authorEmail,
      nowIso,
      'Residential Building',
      building.name || building.projectId,
      `${building.projectId}-Site`,
      'meters',
      'square meters',
      'cubic meters',
      `Canonical Rev ${building.version}`,
    ]],
  };

  const floorRows: string[][] = [];
  const spaceRows: string[][] = [];
  const zoneRows: string[][] = [];
  const typeMap = new Map<string, string[]>();
  const componentRows: string[][] = [];
  const coordRows: string[][] = [];
  const attrRows: string[][] = [];

  let elevationMm = 0;
  for (const floor of [...building.floors].sort((a, b) => a.level - b.level)) {
    const heightM = ((floor.floorHeight || 3000) / 1000).toFixed(3);
    const elevM = (elevationMm / 1000).toFixed(3);
    floorRows.push([floor.name, authorEmail, nowIso, floor.floorUse ?? 'RESIDENTIAL', elevM, heightM]);

    const unitRoomMap = new Map<string, string[]>();
    for (const room of floor.rooms) {
      const areaSqm = (Math.max(room.area || 0, polygonArea(room.boundary)) / 1e6).toFixed(3);
      spaceRows.push([
        `${floor.name}-${room.name}-${room.id.slice(-6)}`,
        authorEmail,
        nowIso,
        room.type,
        floor.name,
        room.name,
        heightM,
        areaSqm,
        areaSqm,
      ]);
      if (room.unitId) {
        const list = unitRoomMap.get(room.unitId) ?? [];
        list.push(room.name);
        unitRoomMap.set(room.unitId, list);
      }
    }
    for (const [unitId, rNames] of unitRoomMap.entries()) {
      zoneRows.push([`${floor.name}-${unitId}`, authorEmail, nowIso, 'Apartment Unit', rNames.join('; ')]);
    }

    for (const door of floor.doors) {
      const typeName = `Door_${door.type}_${door.width}x${door.height}`;
      const cls = resolveElementClassification(door.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      if (!typeMap.has(typeName)) {
        typeMap.set(typeName, [
          typeName,
          authorEmail,
          nowIso,
          cls ? `${cls.code} ${cls.title}` : 'EF_25_30_25 Doors',
          'Fixed',
          (door.width / 1000).toFixed(3),
          '0.100',
          (door.height / 1000).toFixed(3),
        ]);
      }
      const compName = `Door_${door.id}`;
      componentRows.push([compName, authorEmail, nowIso, typeName, floor.name, `Hosted on wall ${door.wallId}`]);
      // OpenBIM World coordinates: X = x/1000, Y = z/1000, Z = -y/1000
      coordRows.push([
        `${compName}_Loc`,
        'point',
        'Component',
        compName,
        (door.position.x / 1000).toFixed(3),
        (elevationMm / 1000).toFixed(3),
        (-door.position.y / 1000).toFixed(3),
      ]);
      attrRows.push([`${compName}_WidthMm`, 'Component', compName, String(door.width), 'mm']);
    }

    for (const win of floor.windows) {
      const typeName = `Window_${win.width}x${win.height}`;
      const cls = resolveElementClassification(win.id, assignments, BUILTIN_CLASSIFICATION_SYSTEMS);
      if (!typeMap.has(typeName)) {
        typeMap.set(typeName, [
          typeName,
          authorEmail,
          nowIso,
          cls ? `${cls.code} ${cls.title}` : 'EF_25_30_95 Windows',
          'Fixed',
          (win.width / 1000).toFixed(3),
          '0.100',
          (win.height / 1000).toFixed(3),
        ]);
      }
      const compName = `Window_${win.id}`;
      componentRows.push([compName, authorEmail, nowIso, typeName, floor.name, `Hosted on wall ${win.wallId}`]);
      coordRows.push([
        `${compName}_Loc`,
        'point',
        'Component',
        compName,
        (win.position.x / 1000).toFixed(3),
        ((elevationMm + (win.sillHeight ?? 900)) / 1000).toFixed(3),
        (-win.position.y / 1000).toFixed(3),
      ]);
      attrRows.push([`${compName}_SillMm`, 'Component', compName, String(win.sillHeight ?? 900), 'mm']);
    }

    elevationMm += floor.floorHeight || 3000;
  }

  const issueRows = issues.map(iss => [
    iss.title,
    iss.createdBy,
    new Date(iss.createdAt).toISOString(),
    iss.topicType,
    iss.priority ?? 'Normal',
    iss.topicStatus,
    iss.description ?? '',
  ]);

  const worksheets: CobieWorksheet[] = [
    facility,
    { name: 'Contact', headers: ['Email', 'CreatedBy', 'CreatedOn', 'Category', 'Company'], rows: [[authorEmail, authorEmail, nowIso, 'Architect', 'RH Planner Studio']] },
    { name: 'Floor', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'Elevation', 'Height'], rows: floorRows },
    { name: 'Space', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'FloorName', 'Description', 'UsableHeight', 'GrossArea', 'NetArea'], rows: spaceRows },
    { name: 'Zone', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'SpaceNames'], rows: zoneRows },
    { name: 'Type', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'AssetType', 'NominalLength', 'NominalWidth', 'NominalHeight'], rows: [...typeMap.values()] },
    { name: 'Component', headers: ['Name', 'CreatedBy', 'CreatedOn', 'TypeName', 'Space', 'Description'], rows: componentRows },
    { name: 'System', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'ComponentNames'], rows: [['Envelope_Openings', authorEmail, nowIso, 'Fenestration', componentRows.slice(0, 20).map(r => r[0]!).join('; ')]] },
    { name: 'Assembly', headers: ['Name', 'CreatedBy', 'CreatedOn', 'SheetName', 'ParentName', 'Description'], rows: [] },
    { name: 'Coordinate', headers: ['Name', 'Category', 'SheetName', 'RowName', 'CoordinateXAxis', 'CoordinateYAxis', 'CoordinateZAxis'], rows: coordRows },
    { name: 'Attribute', headers: ['Name', 'SheetName', 'RowName', 'Value', 'Unit'], rows: attrRows },
    { name: 'Issue', headers: ['Name', 'CreatedBy', 'CreatedOn', 'Type', 'Priority', 'Status', 'Description'], rows: issueRows },
  ];

  return {
    version: '2.4',
    projectName: building.name || building.projectId,
    revision: building.version,
    worksheets,
  };
}

export function exportCobieHtmlWorkbook(bundle: CobieExportBundle): Uint8Array {
  const sheetsXml = bundle.worksheets
    .map(ws => `<x:ExcelWorksheet><x:Name>${escapeHtml(ws.name)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>`)
    .join('');
  const tablesHtml = bundle.worksheets
    .map(ws => {
      const head = `<tr>${ws.headers.map(h => `<th style="background:#1e293b;color:#f8fafc;font-weight:bold;">${escapeHtml(h)}</th>`).join('')}</tr>`;
      const body = ws.rows
        .map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<table border="1" data-sheet="${escapeHtml(ws.name)}"><caption>${escapeHtml(ws.name)}</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
    })
    .join('\n');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>${sheetsXml}</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
${tablesHtml}
</body>
</html>`;
  return strToU8(html);
}

export function exportCobieCsvZip(bundle: CobieExportBundle): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const ws of bundle.worksheets) {
    const lines = [
      ws.headers.map(escapeCsvCell).join(','),
      ...ws.rows.map(row => row.map(escapeCsvCell).join(',')),
    ];
    files[`${ws.name}.csv`] = strToU8(lines.join('\n') + '\n');
  }
  return zipSync(files, { level: 6 });
}
