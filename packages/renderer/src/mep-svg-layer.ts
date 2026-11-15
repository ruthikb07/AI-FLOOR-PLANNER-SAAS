/**
 * Phase 3 SVG Engineering Discipline Overlay & Road Access Renderer.
 *
 * Pure projection layer rendering coordinated MEP systems (`M-ELEC`, `M-PLUMB`,
 * `A-CEIL`, `F-FIRE`), cantilever balcony beams (`S-BEAM-CANTILEVER`), and
 * external road / Entry (`IN`) & Exit (`OUT`) gate arrows on site/stilt views.
 */

import type {
  Building,
  Floor,
  Point,
  ViewTransform,
  EngineeringOverlay,
  FloorMepEngineeringPlan,
  MepSymbol,
  MepRun,
  CeilingZone,
  CantileverBeam,
} from '@ai-floor-planner/core';
import { worldToScreen, scaleToScreen } from './coordinate-transform';
import type { RenderConfig } from './render-config';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPlotBbox(building: Building): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts = building.site?.plotBoundary?.points;
  if (pts && pts.length >= 3) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  return {
    minX: 0,
    minY: 0,
    maxX: building.site?.plotWidth ?? 20000,
    maxY: building.site?.plotDepth ?? 20000,
  };
}

/**
 * Renders an external approach road strip + directional `IN` (Entry) and
 * `OUT` (Exit) gate arrows along the road-facing boundary of Site Plan (`A-101`)
 * and Stilt Parking (`A-102`) sheets.
 */
export function renderRoadAccessOverlay(
  building: Building,
  floor: Floor,
  transform: ViewTransform,
): string {
  const isStiltOrGround =
    floor.floorUse === 'STILT_PARKING' ||
    /STILT/i.test(floor.name) ||
    floor.level === 0;
  if (!isStiltOrGround) return '';

  const bbox = getPlotBbox(building);
  const roadW = 3600;
  const facing = String(building.site?.roadFacing ?? 'SOUTH').toUpperCase();
  const plotW = Math.max(1000, bbox.maxX - bbox.minX);
  const plotH = Math.max(1000, bbox.maxY - bbox.minY);
  const midX = bbox.minX + plotW * 0.5;
  const midY = bbox.minY + plotH * 0.5;

  // Determine road polygon & IN/OUT gate anchors in world coordinates (mm)
  let roadPoly: Point[];
  let roadMidA: Point;
  let roadMidB: Point;
  let roadLabelPt: Point;
  let inStart: Point;
  let inEnd: Point;
  let outStart: Point;
  let outEnd: Point;
  let labelAngle = 0;

  if (facing === 'NORTH') {
    const y0 = bbox.minY - roadW - 300;
    const y1 = bbox.minY - 300;
    roadPoly = [
      { x: bbox.minX, y: y0 },
      { x: bbox.maxX, y: y0 },
      { x: bbox.maxX, y: y1 },
      { x: bbox.minX, y: y1 },
    ];
    roadMidA = { x: bbox.minX + 400, y: (y0 + y1) / 2 };
    roadMidB = { x: bbox.maxX - 400, y: (y0 + y1) / 2 };
    roadLabelPt = { x: midX, y: (y0 + y1) / 2 };
    inStart = { x: bbox.minX + plotW * 0.28, y: y1 - 300 };
    inEnd = { x: bbox.minX + plotW * 0.28, y: bbox.minY + 1800 };
    outStart = { x: bbox.minX + plotW * 0.72, y: bbox.minY + 1800 };
    outEnd = { x: bbox.minX + plotW * 0.72, y: y1 - 300 };
  } else if (facing === 'EAST') {
    const x0 = bbox.maxX + 300;
    const x1 = bbox.maxX + roadW + 300;
    roadPoly = [
      { x: x0, y: bbox.minY },
      { x: x1, y: bbox.minY },
      { x: x1, y: bbox.maxY },
      { x: x0, y: bbox.maxY },
    ];
    roadMidA = { x: (x0 + x1) / 2, y: bbox.minY + 400 };
    roadMidB = { x: (x0 + x1) / 2, y: bbox.maxY - 400 };
    roadLabelPt = { x: (x0 + x1) / 2, y: midY };
    inStart = { x: x0 + 300, y: bbox.minY + plotH * 0.28 };
    inEnd = { x: bbox.maxX - 1800, y: bbox.minY + plotH * 0.28 };
    outStart = { x: bbox.maxX - 1800, y: bbox.minY + plotH * 0.72 };
    outEnd = { x: x0 + 300, y: bbox.minY + plotH * 0.72 };
    labelAngle = -90;
  } else if (facing === 'WEST') {
    const x0 = bbox.minX - roadW - 300;
    const x1 = bbox.minX - 300;
    roadPoly = [
      { x: x0, y: bbox.minY },
      { x: x1, y: bbox.minY },
      { x: x1, y: bbox.maxY },
      { x: x0, y: bbox.maxY },
    ];
    roadMidA = { x: (x0 + x1) / 2, y: bbox.minY + 400 };
    roadMidB = { x: (x0 + x1) / 2, y: bbox.maxY - 400 };
    roadLabelPt = { x: (x0 + x1) / 2, y: midY };
    inStart = { x: x1 - 300, y: bbox.minY + plotH * 0.72 };
    inEnd = { x: bbox.minX + 1800, y: bbox.minY + plotH * 0.72 };
    outStart = { x: bbox.minX + 1800, y: bbox.minY + plotH * 0.28 };
    outEnd = { x: x1 - 300, y: bbox.minY + plotH * 0.28 };
    labelAngle = -90;
  } else {
    // SOUTH default (bottom edge)
    const y0 = bbox.maxY + 300;
    const y1 = bbox.maxY + roadW + 300;
    roadPoly = [
      { x: bbox.minX, y: y0 },
      { x: bbox.maxX, y: y0 },
      { x: bbox.maxX, y: y1 },
      { x: bbox.minX, y: y1 },
    ];
    roadMidA = { x: bbox.minX + 400, y: (y0 + y1) / 2 };
    roadMidB = { x: bbox.maxX - 400, y: (y0 + y1) / 2 };
    roadLabelPt = { x: midX, y: (y0 + y1) / 2 };
    inStart = { x: bbox.minX + plotW * 0.28, y: y0 + 300 };
    inEnd = { x: bbox.minX + plotW * 0.28, y: bbox.maxY - 1800 };
    outStart = { x: bbox.minX + plotW * 0.72, y: bbox.maxY - 1800 };
    outEnd = { x: bbox.minX + plotW * 0.72, y: y0 + 300 };
  }

  const ptsStr = roadPoly
    .map((p) => {
      const sp = worldToScreen(p, transform);
      return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
    })
    .join(' ');
  const sMidA = worldToScreen(roadMidA, transform);
  const sMidB = worldToScreen(roadMidB, transform);
  const sLabel = worldToScreen(roadLabelPt, transform);

  const renderGateArrow = (a: Point, b: Point, tag: 'IN' | 'OUT', color: string): string => {
    const sa = worldToScreen(a, transform);
    const sb = worldToScreen(b, transform);
    const dx = sb.x - sa.x;
    const dy = sb.y - sa.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.max(5, Math.min(9, len * 0.32));
    const p1x = sb.x - ux * head - uy * (head * 0.55);
    const p1y = sb.y - uy * head + ux * (head * 0.55);
    const p2x = sb.x - ux * head + uy * (head * 0.55);
    const p2y = sb.y - uy * head - ux * (head * 0.55);
    const mx = (sa.x + sb.x) / 2;
    const my = (sa.y + sb.y) / 2;
    return [
      `<line x1="${sa.x.toFixed(1)}" y1="${sa.y.toFixed(1)}" x2="${sb.x.toFixed(1)}" y2="${sb.y.toFixed(1)}" stroke="${color}" stroke-width="2" data-gate-arrow="${tag}"/>`,
      `<polygon points="${sb.x.toFixed(1)},${sb.y.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}" fill="${color}"/>`,
      `<rect x="${(mx - 14).toFixed(1)}" y="${(my - 7).toFixed(1)}" width="28" height="14" rx="3" fill="#ffffff" fill-opacity="0.92" stroke="${color}" stroke-width="0.9"/>`,
      `<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="${color}">${tag}</text>`,
    ].join('');
  };

  return `<g class="cad-layer-A-SITE-ROAD layer-road-access" data-layer="A-SITE-ROAD" pointer-events="none">
    <polygon points="${ptsStr}" fill="#e2e8f0" fill-opacity="0.6" stroke="#94a3b8" stroke-width="1"/>
    <line x1="${sMidA.x.toFixed(1)}" y1="${sMidA.y.toFixed(1)}" x2="${sMidB.x.toFixed(1)}" y2="${sMidB.y.toFixed(1)}" stroke="#64748b" stroke-width="1" stroke-dasharray="6,6"/>
    <text x="${sLabel.x.toFixed(1)}" y="${(sLabel.y + 3).toFixed(1)}" transform="rotate(${labelAngle} ${sLabel.x.toFixed(1)} ${sLabel.y.toFixed(1)})" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="9" font-weight="700" fill="#475569" letter-spacing="1">APPROACH ROAD (${escapeXml(facing)})</text>
    ${renderGateArrow(inStart, inEnd, 'IN', '#15803d')}
    ${renderGateArrow(outStart, outEnd, 'OUT', '#b91c1c')}
  </g>`;
}

function renderCantileverBeams(
  beams: readonly CantileverBeam[],
  transform: ViewTransform,
): string {
  if (!beams || beams.length === 0) return '';
  const items = beams.map((b) => {
    const s = worldToScreen(b.start, transform);
    const e = worldToScreen(b.end, transform);
    const wPx = Math.max(2.5, scaleToScreen(b.widthMm, transform));
    const mx = (s.x + e.x) / 2;
    const my = (s.y + e.y) / 2;
    return [
      `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="#a21caf" stroke-width="${wPx.toFixed(1)}" stroke-opacity="0.45" stroke-dasharray="5,3" data-entity-type="cantilever-beam" data-beam-id="${escapeXml(b.id)}"/>`,
      `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="#86198f" stroke-width="1.2" stroke-dasharray="5,3"/>`,
      `<text x="${mx.toFixed(1)}" y="${(my - 4).toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="7" font-weight="700" fill="#86198f">CB</text>`,
    ].join('');
  });
  return `<g class="cad-layer-S-BEAM-CANTILEVER" data-layer="S-BEAM-CANTILEVER" pointer-events="none">${items.join('\n')}</g>`;
}

function renderMepRuns(
  runs: readonly MepRun[],
  transform: ViewTransform,
  disciplineFilter: 'ELECTRICAL' | 'PLUMBING',
): string {
  const matched = runs.filter((r) => r.discipline === disciplineFilter && r.points.length >= 2);
  if (matched.length === 0) return '';

  const colorByKind: Record<MepRun['kind'], { stroke: string; dash: string; width: number }> = {
    WIRING_LOOP: { stroke: '#d97706', dash: '4,3', width: 1.1 },
    CWS: { stroke: '#0284c7', dash: '', width: 1.3 },
    HWS: { stroke: '#ea580c', dash: '5,2', width: 1.3 },
    SP: { stroke: '#7c2d12', dash: '', width: 2.0 },
    WP: { stroke: '#0d9488', dash: '3,2', width: 1.4 },
  };

  const elements = matched.map((run) => {
    const st = colorByKind[run.kind];
    const pts = run.points
      .map((p) => {
        const sp = worldToScreen(p, transform);
        return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
      })
      .join(' ');
    const dashAttr = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
    return `<polyline points="${pts}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dashAttr} stroke-opacity="0.88" data-layer="${escapeXml(run.layer)}" data-pipe-kind="${escapeXml(run.kind)}"/>`;
  });

  const layerName = disciplineFilter === 'ELECTRICAL' ? 'M-ELEC-WIRE' : 'M-PLUMB-PIPE';
  return `<g class="cad-layer-${layerName}" data-layer="${layerName}" pointer-events="none">${elements.join('\n')}</g>`;
}

function renderMepSymbols(
  symbols: readonly MepSymbol[],
  transform: ViewTransform,
  disciplineFilter: 'ELECTRICAL' | 'PLUMBING' | 'FIRE',
): string {
  const matched = symbols.filter((s) => s.discipline === disciplineFilter);
  if (matched.length === 0) return '';

  const items = matched.map((sym) => {
    const sp = worldToScreen(sym.position, transform);
    const x = sp.x;
    const y = sp.y;

    switch (sym.kind) {
      case 'DB':
        return `<g data-mep-kind="DB" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="-7" y="-4" width="14" height="8" fill="#fef3c7" stroke="#b45309" stroke-width="1.2"/>
          <line x1="-7" y1="-4" x2="7" y2="4" stroke="#b45309" stroke-width="0.9"/>
          <text x="0" y="-7" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="7" font-weight="700" fill="#92400e">DB</text>
        </g>`;
      case 'FAN':
        return `<g data-mep-kind="FAN" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="6" fill="none" stroke="#d97706" stroke-width="1.1"/>
          <line x1="-5" y1="0" x2="5" y2="0" stroke="#d97706" stroke-width="1.1"/>
          <line x1="0" y1="-5" x2="0" y2="5" stroke="#d97706" stroke-width="1.1"/>
          <text x="0" y="13" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6.5" font-weight="700" fill="#b45309">FAN</text>
        </g>`;
      case 'DL':
        return `<g data-mep-kind="DL" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="3" fill="#fde68a" stroke="#d97706" stroke-width="1"/>
        </g>`;
      case 'SB':
      case 'SB_2WAY':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="2.8" fill="#ffffff" stroke="#b45309" stroke-width="1.1"/>
          <line x1="0" y1="-2.8" x2="4" y2="-5.5" stroke="#b45309" stroke-width="1"/>
        </g>`;
      case 'SOCKET_16A':
      case 'GY':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="-3.5" y="-3.5" width="7" height="7" fill="#fffbeb" stroke="#b45309" stroke-width="1"/>
          <text x="0" y="10" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6" font-weight="700" fill="#92400e">${sym.kind === 'GY' ? 'GY' : '16A'}</text>
        </g>`;
      case 'AC_IDU':
      case 'AC_ODU':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="-6" y="-3" width="12" height="6" fill="#e0f2fe" stroke="#0369a1" stroke-width="1"/>
          <text x="0" y="-5" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6" font-weight="700" fill="#0369a1">${sym.kind === 'AC_IDU' ? 'AC' : 'ODU'}</text>
        </g>`;
      case 'PLUMB_SHAFT': {
        const wPx = Math.max(8, scaleToScreen(sym.widthMm ?? 600, transform));
        const dPx = Math.max(10, scaleToScreen(sym.depthMm ?? 900, transform));
        return `<g data-mep-kind="PLUMB_SHAFT" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="${(-wPx / 2).toFixed(1)}" y="${(-dPx / 2).toFixed(1)}" width="${wPx.toFixed(1)}" height="${dPx.toFixed(1)}" fill="#e0f2fe" fill-opacity="0.7" stroke="#0369a1" stroke-width="1.3"/>
          <line x1="${(-wPx / 2).toFixed(1)}" y1="${(-dPx / 2).toFixed(1)}" x2="${(wPx / 2).toFixed(1)}" y2="${(dPx / 2).toFixed(1)}" stroke="#0369a1" stroke-width="0.9"/>
          <line x1="${(wPx / 2).toFixed(1)}" y1="${(-dPx / 2).toFixed(1)}" x2="${(-wPx / 2).toFixed(1)}" y2="${(dPx / 2).toFixed(1)}" stroke="#0369a1" stroke-width="0.9"/>
        </g>`;
      }
      case 'FT':
      case 'NT':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="3.2" fill="#f0fdfa" stroke="#0d9488" stroke-width="1.1"/>
          <line x1="-2.2" y1="-2.2" x2="2.2" y2="2.2" stroke="#0d9488" stroke-width="0.8"/>
        </g>`;
      case 'FHR':
      case 'FHR_HR':
      case 'FACP':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="-6" y="-5" width="12" height="10" fill="#fee2e2" stroke="#dc2626" stroke-width="1.3"/>
          <text x="0" y="2.5" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6" font-weight="700" fill="#991b1b">${sym.kind === 'FACP' ? 'FACP' : sym.kind}</text>
        </g>`;
      case 'SD':
      case 'HD':
        return `<g data-mep-kind="${sym.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="4" fill="#fef2f2" stroke="#dc2626" stroke-width="1.1"/>
          <text x="0" y="2" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="5.5" font-weight="700" fill="#991b1b">${sym.kind}</text>
        </g>`;
      case 'EXIT_SIGN':
        return `<g data-mep-kind="EXIT_SIGN" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <rect x="-11" y="-5" width="22" height="10" rx="2" fill="#15803d" stroke="#14532d" stroke-width="0.9"/>
          <text x="0" y="2.5" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6.5" font-weight="700" fill="#ffffff">EXIT</text>
        </g>`;
      case 'SPRINKLER':
        return `<g data-mep-kind="SPRINKLER" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle cx="0" cy="0" r="3" fill="none" stroke="#dc2626" stroke-width="1.1"/>
          <circle cx="0" cy="0" r="1.1" fill="#dc2626"/>
        </g>`;
    }
  });

  const layerName =
    disciplineFilter === 'ELECTRICAL'
      ? 'M-ELEC-SYMB'
      : disciplineFilter === 'PLUMBING'
        ? 'M-PLUMB-FIXT'
        : 'F-FIRE-SYMB';
  return `<g class="cad-layer-${layerName}" data-layer="${layerName}" pointer-events="none">${items.join('\n')}</g>`;
}

function renderFalseCeilingZones(
  ceilings: readonly CeilingZone[],
  transform: ViewTransform,
): string {
  if (!ceilings || ceilings.length === 0) return '';
  const items: string[] = [];

  for (const cz of ceilings) {
    if (cz.outline.length >= 3) {
      const pts = cz.outline
        .map((p) => {
          const sp = worldToScreen(p, transform);
          return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
        })
        .join(' ');
      const dash = cz.kind === 'PELMET' ? '3,2' : '6,3';
      const stroke = cz.kind === 'GRID_600' ? '#475569' : '#6366f1';
      items.push(
        `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="${dash}" stroke-opacity="0.75" data-ceiling-kind="${escapeXml(cz.kind)}"/>`,
      );
    }
    if (cz.gridLines) {
      for (const [a, b] of cz.gridLines) {
        const sa = worldToScreen(a, transform);
        const sb = worldToScreen(b, transform);
        items.push(
          `<line x1="${sa.x.toFixed(1)}" y1="${sa.y.toFixed(1)}" x2="${sb.x.toFixed(1)}" y2="${sb.y.toFixed(1)}" stroke="#94a3b8" stroke-width="0.6" stroke-opacity="0.7"/>`,
        );
      }
    }
  }

  return `<g class="cad-layer-A-CEIL-GRID" data-layer="A-CEIL-GRID" pointer-events="none">${items.join('\n')}</g>`;
}

/**
 * Renders all enabled Phase 3 engineering discipline overlays for a single floor.
 */
export function renderMepOverlays(
  floor: Floor,
  building: Building,
  transform: ViewTransform,
  config: Readonly<RenderConfig>,
): string {
  const disciplines: Partial<Record<EngineeringOverlay, boolean>> = config.disciplines ?? {};
  const floorMep: FloorMepEngineeringPlan | undefined =
    building.mepEngineering?.floors.find((f) => f.floorId === floor.id);
  if (!floorMep) return '';

  const chunks: string[] = [];
  if (disciplines.FALSE_CEILING) {
    chunks.push(renderFalseCeilingZones(floorMep.ceilings, transform));
  }
  if (disciplines.STRUCTURAL) {
    chunks.push(renderCantileverBeams(floorMep.cantileverBeams, transform));
  }
  if (disciplines.ELECTRICAL) {
    chunks.push(renderMepRuns(floorMep.runs, transform, 'ELECTRICAL'));
    chunks.push(renderMepSymbols(floorMep.symbols, transform, 'ELECTRICAL'));
  }
  if (disciplines.PLUMBING) {
    chunks.push(renderMepRuns(floorMep.runs, transform, 'PLUMBING'));
    chunks.push(renderMepSymbols(floorMep.symbols, transform, 'PLUMBING'));
  }
  if (disciplines.FIRE_SAFETY) {
    chunks.push(renderMepSymbols(floorMep.symbols, transform, 'FIRE'));
  }

  return chunks.filter(Boolean).join('\n');
}
