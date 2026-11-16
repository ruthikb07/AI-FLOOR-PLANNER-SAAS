import { isPhysicalBoundary, architecturalSpaceRole } from '@ai-floor-planner/core';
import { canonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
/**
 * SVG Renderer — generates architectural floor plan SVG from Building Model.
 *
 * This is a pure projection: model in → SVG string out.
 * Implements the Renderer interface from core.
 */

import type {
  Building,
  Floor,
  ViewTransform,
  ExportOptions,
  Polygon,
  Wall,
  Point,
} from '@ai-floor-planner/core';
import { RoomType, WallType, RenderLayer, DoorType, SwingDirection, type SiteZoneKind } from '@ai-floor-planner/core';
import { getFloorContentBounds, computeStairSolids, canonicalStairSolids, polygonBoundingBox, AnnotationLayout, roomAnnotation, polygonCentroid, pointInPolygon } from '@ai-floor-planner/geometry-engine';
import { worldToScreen, fitToView, scaleToScreen } from './coordinate-transform';
import { resolveConfig } from './render-config';
import type { DeepPartial, RenderConfig } from './render-config';
import { PLANCRAFT_SVG_SYMBOLS } from './plancraft-symbols';
import { renderRoadAccessOverlay, renderMepOverlays } from './mep-svg-layer';

// ─── Room Colors ────────────────────────────────────────────────────────────

const ROOM_COLORS: Record<string, string> = {
  [RoomType.Bedroom]: '#E3F2FD',
  [RoomType.Bathroom]: '#E8F5E9',
  [RoomType.Kitchen]: '#FFF3E0',
  [RoomType.Living]: '#F3E5F5',
  [RoomType.Dining]: '#FFFDE7',
  [RoomType.Corridor]: '#ECEFF1',
  [RoomType.Staircase]: '#EFEBE9',
  [RoomType.Lift]: '#E1F5FE',
  [RoomType.Balcony]: '#E0F7FA',
  [RoomType.Parking]: '#F5F5F5',
  [RoomType.Pooja]: '#FCE4EC',
  [RoomType.Utility]: '#FAFAFA',
  [RoomType.Foyer]: '#E8EAF6',
  [RoomType.Study]: '#E0F2F1',
  [RoomType.Storage]: '#F5F5F5',
  [RoomType.ServantQuarter]: '#FBE9E7',
  [RoomType.Drawing]: '#EDE7F6',
  [RoomType.FamilyLiving]: '#F3E5F5',
  [RoomType.Terrace]: '#E0F7FA',
  [RoomType.Garden]: '#E8F5E9',
  [RoomType.OTS]: '#E0F7FA',
  [RoomType.Porch]: '#EDE7F6',
  [RoomType.Dressing]: '#FCE4EC',
  [RoomType.Custom]: '#F5F5F5',
};

// ─── Wall Styles ────────────────────────────────────────────────────────────

const WALL_STYLES: Record<string, { fill: string }> = {
  [WallType.External]: { fill: '#956b3e' },
  [WallType.Internal]: { fill: '#aa8256' },
  [WallType.Partition]: { fill: '#c1a07a' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mmToFtDisplay(mm: number): string {
  return (mm / 304.8).toFixed(1);
}

export function mmToFeetInches(mm: number): string {
  const totalInches = Math.round(mm / 25.4);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'-${inches}"`;
}

function polygonToSvgPoints(polygon: Polygon, transform: ViewTransform): string {
  return polygon.points
    .map(p => {
      const sp = worldToScreen(p, transform);
      return `${sp.x.toFixed(1)},${sp.y.toFixed(1)}`;
    })
    .join(' ');
}

// ─── Render Functions ───────────────────────────────────────────────────────

function renderGrid(
  viewportWidth: number,
  viewportHeight: number,
  transform: ViewTransform,
  gridSpacing: number = 1000,
): string {
  const lines: string[] = [];
  const scaledSpacing = gridSpacing * transform.scale;

  if (scaledSpacing < 5) return ''; // Don't render grid if too dense

  // Vertical lines
  const startX = transform.offsetX % scaledSpacing;
  for (let x = startX; x < viewportWidth; x += scaledSpacing) {
    lines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${viewportHeight}" stroke="#f0f0f0" stroke-width="0.5"/>`);
  }

  // Horizontal lines
  const startY = transform.offsetY % scaledSpacing;
  for (let y = startY; y < viewportHeight; y += scaledSpacing) {
    lines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${viewportWidth}" y2="${y.toFixed(1)}" stroke="#f0f0f0" stroke-width="0.5"/>`);
  }

  return `<g class="layer-grid" data-layer="${RenderLayer.Grid}">\n${lines.join('\n')}\n</g>`;
}

function renderPlotBoundary(building: Building, transform: ViewTransform): string {
  const site = building.site;
  const points = polygonToSvgPoints(site.plotBoundary, transform);

  // Setback area
  const setbackPoly: Polygon = {
    points: [
      { x: site.setbacks.left, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.plotDepth - site.setbacks.rear },
      { x: site.setbacks.left, y: site.plotDepth - site.setbacks.rear },
    ],
  };
  const setbackPoints = polygonToSvgPoints(setbackPoly, transform);

  return `<g class="layer-plot" data-layer="${RenderLayer.Plot}">
  <polygon points="${points}" fill="none" stroke="#999" stroke-width="1" stroke-dasharray="8,4"/>
  <polygon points="${setbackPoints}" fill="none" stroke="#cc6600" stroke-width="0.5" stroke-dasharray="4,4"/>
</g>`;
}

const SITE_ZONE_STYLES: Record<
  SiteZoneKind,
  { fill: string; fillOpacity: number; stroke: string; strokeWidth: number; strokeDasharray?: string; patternId?: string }
> = {
  setback: {
    fill: '#f1f5f9',
    fillOpacity: 0.55,
    stroke: '#94a3b8',
    strokeWidth: 0.75,
    strokeDasharray: '4,3',
    patternId: 'site-setback-hatch',
  },
  parking: {
    fill: '#f8fafc',
    fillOpacity: 0.85,
    stroke: '#64748b',
    strokeWidth: 0.8,
    patternId: 'site-parking-pattern',
  },
  garden: {
    fill: '#ecfdf5',
    fillOpacity: 0.75,
    stroke: '#86efac',
    strokeWidth: 0.8,
    patternId: 'site-garden-pattern',
  },
  pedestrian_circulation: {
    fill: '#fffbeb',
    fillOpacity: 0.75,
    stroke: '#cbd5e1',
    strokeWidth: 0.75,
    strokeDasharray: '4,2',
    patternId: 'site-pedestrian-pattern',
  },
  vehicle_circulation: {
    fill: '#f1f5f9',
    fillOpacity: 0.8,
    stroke: '#94a3b8',
    strokeWidth: 0.8,
  },
  service: {
    fill: '#fff7ed',
    fillOpacity: 0.7,
    stroke: '#fdba74',
    strokeWidth: 0.8,
    strokeDasharray: '3,3',
    patternId: 'site-service-pattern',
  },
  future_expansion: {
    fill: '#faf5ff',
    fillOpacity: 0.6,
    stroke: '#c084fc',
    strokeWidth: 0.8,
    strokeDasharray: '5,3',
  },
};

function renderSiteZones(building: Building, transform: ViewTransform): string {
  const siteZones = building.site?.siteZones ?? (building as any).siteZones;
  if (!siteZones || siteZones.length === 0) return '';

  const elements: string[] = [];

  for (const zone of siteZones) {
    const rawPoly = (zone as any).polygon ?? zone.boundary;
    const poly: Polygon | null = rawPoly?.points
      ? rawPoly
      : Array.isArray(rawPoly)
        ? { points: rawPoly }
        : null;

    if (!poly || !poly.points || poly.points.length < 3) continue;
    const style = (SITE_ZONE_STYLES as Record<string, any>)[zone.kind] ?? {
      fill: '#f8fafc',
      fillOpacity: 0.5,
      stroke: '#94a3b8',
      strokeWidth: 0.5,
    };
    const points = polygonToSvgPoints(poly, transform);
    const strokeDash = style.strokeDasharray ? ` stroke-dasharray="${style.strokeDasharray}"` : '';

    // Main colored polygon with title for rationale
    const titleAttr = zone.rationale ? `<title>${escapeXml(zone.rationale)}</title>` : '';
    elements.push(
      `<polygon points="${points}" fill="${style.fill}" fill-opacity="${style.fillOpacity}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"${strokeDash} data-entity-type="site-zone" data-site-zone-id="${escapeXml(zone.id)}" data-site-zone-kind="${escapeXml(zone.kind)}">${titleAttr}</polygon>`,
    );

    // Architectural pattern overlay if available
    if (style.patternId) {
      elements.push(
        `<polygon points="${points}" fill="url(#${style.patternId})" stroke="none" pointer-events="none"/>`,
      );
    }

    // Label and Area
    const bbox = polygonBoundingBox(poly);
    const center = polygonCentroid(poly);
    const sCenter = worldToScreen(center, transform);
    const sWidth = scaleToScreen(bbox.width, transform);
    const sHeight = scaleToScreen(bbox.height, transform);

    if (sWidth > 0 && sHeight > 0) {
      const name = zone.name.replace(/6000 MM TWO.WAY PAVED ACCESS/i, '6.0M DRIVEWAY').replace(/MAIN ENTRY GATEWAY PAVED APRON/i, 'MAIN ENTRY GATE');
      const h = Math.min(scaleToScreen(80, transform), sWidth * 0.75 / (name.length * 0.7), sHeight / 3);
      elements.push(`<text x="${sCenter.x}" y="${sCenter.y}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${h}" fill="#0f172a">${escapeXml(name)}</text>`);
    }
  }

  if (elements.length === 0) return '';
  return `<g class="layer-site-zones" data-layer="${RenderLayer.SiteZones}">\n${elements.join('\n')}\n</g>`;
}

function renderFloorBoundary(floor: Floor, transform: ViewTransform): string {
  if (floor.boundary.points.length < 3) return '';
  const hasPerimeterRecess = floor.rooms.some(r => r.tags?.includes('recess:perimeter'));
  const points = polygonToSvgPoints(floor.boundary, transform);

  return `<g class="layer-floor" data-layer="${RenderLayer.Floor}">
  <polygon points="${points}" fill="${hasPerimeterRecess ? 'none' : '#ffffff'}" stroke="${hasPerimeterRecess ? 'none' : '#333'}" stroke-width="${hasPerimeterRecess ? '0' : '0.5'}"/>
</g>`;
}

export function cleanRoomDisplayName(name: string): string {
  if (!name) return '';
  // 1. Strip redundant flat prefix: "Flat 01 Living Room" -> "Living Room", "Flat 01 - Foyer" -> "Foyer"
  let clean = name.replace(/^(?:Flat|FLAT|Unit|UNIT)\s*\d+\s*[-:·]?\s*/i, '').trim();
  // 2. Normalize verbose compound room titles to concise architectural labels
  clean = clean
    .replace(/^Living\s*&\s*Dining\s*Room$/i, 'Living & Dining')
    .replace(/^Living\s*and\s*Dining(\s*Room)?$/i, 'Living & Dining')
    .replace(/^Master\s*Toilet\s*\(En-suite\)$/i, 'Master Bath')
    .replace(/^Master\s*En-suite\s*Toilet$/i, 'Master Bath')
    .replace(/^Master\s*Bathroom$/i, 'Master Bath')
    .replace(/^Common\s*Toilet\s*\/\s*Powder(\s*Room)?$/i, 'Common Bath')
    .replace(/^Common\s*Toilet$/i, 'Common Bath')
    .replace(/^Dry\s*Balcony\s*\/\s*Utility$/i, 'Utility')
    .replace(/^Dry\s*Balcony$/i, 'Utility')
    .replace(/^Bedroom\s*3\s*\/\s*Guest\s*Room$/i, 'Bedroom 3')
    .replace(/^Toilet\s*2\s*\(Attached\)$/i, 'Bath 2')
    .replace(/^Attached\s*Toilet\s*2$/i, 'Bath 2')
    .replace(/^Attached\s*Toilet$/i, 'Bath')
    .replace(/^Private\s*Suite\s*Access$/i, 'Passage')
    .replace(/^Sit-out\s*Balcony$/i, 'Balcony')
    .replace(/^Living\s*Balcony$/i, 'Balcony')
    .replace(/^Master\s*Balcony$/i, 'Balcony')
    .replace(/^Entrance\s*Foyer(\s*&\s*Vestibule)?$/i, 'Foyer')
    .replace(/^Common\s*Core\s*\/\s*Lift\s*Lobby$/i, 'Lift Lobby')
    .replace(/^Lift\s*Lobby\s*&\s*Corridor$/i, 'Lift Lobby')
    .replace(/^Passenger\s*Lift\s*\d*$/i, 'Lift')
    .replace(/^Service\s*Lift\s*\/\s*Stretcher$/i, 'Service Lift')
    .replace(/^Main\s*Fire\s*Escape\s*Staircase$/i, 'Staircase')
    .replace(/^OTS\s*Daylight\s*(&\s*Ventilation\s*)?Shaft$/i, 'OTS Shaft')
    .replace(/^Electrical\s*&\s*Plumbing\s*Shaft$/i, 'Service Shaft');
  return clean || name;
}

function renderRooms(
  floor: Floor,
  transform: ViewTransform,
  showLabels: boolean = true,
  showAreas: boolean = true,
  labelsOnly = false,
  _withFurniture = false,
): string {
  const elements: string[] = [];

  for (const room of floor.rooms) {
    if (room.tags?.includes('recess:perimeter')) continue;
    const color = ROOM_COLORS[room.type] ?? '#F5F5F5';
    const points = polygonToSvgPoints(room.boundary, transform);

    // Room fill
    if (!labelsOnly) elements.push(
      `<polygon points="${points}" fill="${color}" fill-opacity="0.35" stroke="none" data-entity-type="room" data-entity-id="${room.id}" data-architectural-role="${architecturalSpaceRole(room)}"/>`,
    );
    const hatch = room.type === RoomType.Bathroom ? 'wet-hatch'
      : room.type === RoomType.ServiceShaft || room.type === RoomType.OTS ? 'outdoor-hatch'
        : [RoomType.Balcony, RoomType.Terrace, RoomType.Utility].includes(room.type) ? 'outdoor-hatch' : 'tile-hatch';
    if (!labelsOnly && ![RoomType.Staircase, RoomType.Lift].includes(room.type)) elements.push(`<polygon points="${points}" fill="url(#${hatch})" pointer-events="none"/>`);

    const isStair = room.type === RoomType.Staircase || /stair/i.test(room.name);
    const isLift = room.type === RoomType.Lift || /lift/i.test(room.name);
    if (!labelsOnly && isStair && !floor.canonicalStaircases?.length) {
      const rTopLeft = worldToScreen({ x: room.x, y: room.y }, transform);
      const rw = scaleToScreen(room.width, transform);
      const rh = scaleToScreen(room.height, transform);
      const isVertical = room.height >= room.width;
      if (isVertical) {
        const wellW = Math.max(3, scaleToScreen(150, transform));
        const flightW = (rw - wellW) / 2;
        const landingH = Math.min(scaleToScreen(1200, transform), rh * 0.28);
        const flightL = rh - landingH * 2;
        const startY = rTopLeft.y + landingH;
        const treadCount = Math.max(8, Math.min(12, Math.floor((room.height * 0.5) / 250)));
        const stepY = flightL / treadCount;
        for (let i = 0; i <= treadCount; i++) {
          const ty = startY + i * stepY;
          elements.push(
            `<line x1="${rTopLeft.x.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(rTopLeft.x + flightW).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>`,
            `<line x1="${(rTopLeft.x + flightW + wellW).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(rTopLeft.x + rw).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>`,
          );
        }
        const f1Cx = rTopLeft.x + flightW / 2;
        const f2Cx = rTopLeft.x + flightW + wellW + flightW / 2;
        elements.push(
          `<rect x="${(rTopLeft.x + flightW).toFixed(1)}" y="${startY.toFixed(1)}" width="${wellW.toFixed(1)}" height="${flightL.toFixed(1)}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.6"/>`,
          `<line class="stair-up-route" x1="${f1Cx.toFixed(1)}" y1="${(startY + flightL * 0.85).toFixed(1)}" x2="${f1Cx.toFixed(1)}" y2="${(startY + flightL * 0.15).toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
          `<line class="stair-dn-route" x1="${f2Cx.toFixed(1)}" y1="${(startY + flightL * 0.15).toFixed(1)}" x2="${f2Cx.toFixed(1)}" y2="${(startY + flightL * 0.85).toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
        );
      } else {
        const wellH = Math.max(3, scaleToScreen(150, transform));
        const flightH = (rh - wellH) / 2;
        const landingW = Math.min(scaleToScreen(1200, transform), rw * 0.25);
        const flightL = rw - landingW * 2;
        const startX = rTopLeft.x + landingW;
        const treadCount = Math.max(8, Math.min(12, Math.floor((room.width * 0.55) / 250)));
        const stepX = flightL / treadCount;
        for (let i = 0; i <= treadCount; i++) {
          const tx = startX + i * stepX;
          elements.push(
            `<line x1="${tx.toFixed(1)}" y1="${rTopLeft.y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(rTopLeft.y + flightH).toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>`,
            `<line x1="${tx.toFixed(1)}" y1="${(rTopLeft.y + flightH + wellH).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(rTopLeft.y + rh).toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>`,
          );
        }
        const f1Cy = rTopLeft.y + flightH / 2;
        const f2Cy = rTopLeft.y + flightH + wellH + flightH / 2;
        elements.push(
          `<rect x="${startX.toFixed(1)}" y="${(rTopLeft.y + flightH).toFixed(1)}" width="${flightL.toFixed(1)}" height="${wellH.toFixed(1)}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.6"/>`,
          `<line class="stair-up-route" x1="${(startX + flightL * 0.15).toFixed(1)}" y1="${f1Cy.toFixed(1)}" x2="${(startX + flightL * 0.85).toFixed(1)}" y2="${f1Cy.toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
          `<line class="stair-dn-route" x1="${(startX + flightL * 0.85).toFixed(1)}" y1="${f2Cy.toFixed(1)}" x2="${(startX + flightL * 0.15).toFixed(1)}" y2="${f2Cy.toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
        );
      }
    }
    if (!labelsOnly && isLift) {
      const rTopLeft = worldToScreen({ x: room.x, y: room.y }, transform);
      const rw = scaleToScreen(room.width, transform);
      const rh = scaleToScreen(room.height, transform);
      elements.push(
        `<line x1="${rTopLeft.x.toFixed(1)}" y1="${rTopLeft.y.toFixed(1)}" x2="${(rTopLeft.x + rw).toFixed(1)}" y2="${(rTopLeft.y + rh).toFixed(1)}" stroke="#cbd5e1" stroke-width="0.6"/>`,
        `<line x1="${rTopLeft.x.toFixed(1)}" y1="${(rTopLeft.y + rh).toFixed(1)}" x2="${(rTopLeft.x + rw).toFixed(1)}" y2="${rTopLeft.y.toFixed(1)}" stroke="#cbd5e1" stroke-width="0.6"/>`,
      );
      const inset = Math.max(3, scaleToScreen(150, transform));
      if (rw > inset * 2 && rh > inset * 2) {
        elements.push(
          `<rect x="${(rTopLeft.x + inset).toFixed(1)}" y="${(rTopLeft.y + inset).toFixed(1)}" width="${(rw - inset * 2).toFixed(1)}" height="${(rh - inset * 2).toFixed(1)}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.75"/>`,
        );
      }
    }

    if (labelsOnly && (showLabels || showAreas)) {
      const annotation = roomAnnotation(room);
      let labelCenter = { x: annotation.center.x, y: annotation.center.y };
      const roomFurn = (floor.furniture ?? []).filter(
        f => f.roomId === room.id && ['bed', 'king_bed', 'queen_bed', 'single_bed', 'sectional_sofa', 'l_sofa', 'sofa', 'dining_table'].includes(f.type),
      );
      if (roomFurn.length > 0 && room.width >= 2600 && room.height >= 2600) {
        const labelHalfW = Math.min(room.width * 0.35, 950);
        const labelHalfH = annotation.height * 2.5;
        const overlapsFurn = (pt: Point) =>
          roomFurn.some(f => {
            const isOrth = f.rotationDeg === 90 || f.rotationDeg === 270;
            const fw = isOrth ? f.depthMm : f.widthMm;
            const fd = isOrth ? f.widthMm : f.depthMm;
            return (
              pt.x + labelHalfW > f.xMm + 80 &&
              pt.x - labelHalfW < f.xMm + fw - 80 &&
              pt.y + labelHalfH > f.yMm + 80 &&
              pt.y - labelHalfH < f.yMm + fd - 80
            );
          });
        if (overlapsFurn(labelCenter)) {
          const candidates: Point[] = [
            { x: room.x + room.width * 0.50, y: room.y + room.height * 0.72 },
            { x: room.x + room.width * 0.50, y: room.y + room.height * 0.28 },
            { x: room.x + room.width * 0.68, y: room.y + room.height * 0.50 },
            { x: room.x + room.width * 0.32, y: room.y + room.height * 0.50 },
            { x: room.x + room.width * 0.66, y: room.y + room.height * 0.68 },
            { x: room.x + room.width * 0.34, y: room.y + room.height * 0.68 },
          ];
          const clearCand = candidates.find(c => !overlapsFurn(c));
          if (clearCand) labelCenter = clearCand;
        }
      }
      annotation.lines.forEach((line, i) => {
        if ((i === 0 && !showLabels) || (i === 2 && !showAreas)) return;
        const point = worldToScreen(
          { x: labelCenter.x, y: labelCenter.y + (i - (annotation.lines.length - 1) / 2) * 1.65 * annotation.height },
          transform,
        );
        const height = scaleToScreen(annotation.height, transform);
        elements.push(
          `<text x="${point.x}" y="${point.y}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${height}" fill="#0f172a" paint-order="stroke" stroke="#ffffff" stroke-width="2.2" stroke-opacity="0.88" stroke-linejoin="round" data-room-name="${escapeXml(room.name)}">${escapeXml(line)}</text>`,
        );
      });
    }
  }

  return `<g class="layer-rooms" data-layer="${RenderLayer.Rooms}">\n${elements.join('\n')}\n</g>`;
}

function renderWalls(floor: Floor, transform: ViewTransform): string {
  const elements: string[] = [];

  for (const wall of floor.walls.filter(isPhysicalBoundary)) {
    const start = worldToScreen(wall.startPoint, transform);
    if (wall.boundaryRole === 'PARAPET' || wall.boundaryRole === 'GUARDRAIL') {
      const end = worldToScreen(wall.endPoint, transform);
      elements.push(`<line data-entity-type="wall" data-entity-id="${wall.id}" data-boundary-role="${wall.boundaryRole}" data-height-mm="${wall.heightMm ?? 1100}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#80644D" stroke-width="1.5" />`);
      continue;
    }
    const end = worldToScreen(wall.endPoint, transform);
    const style = WALL_STYLES[wall.type] ?? WALL_STYLES[WallType.Internal]!;
    const frame = wallFrame(wall);
    if (!frame || !Number.isFinite(wall.thickness) || wall.thickness <= 0) continue;
    const openings = [...floor.doors, ...floor.windows].filter(opening => opening.wallId === wall.id)
      .flatMap(opening => {
        const interval = openingInterval(wall, opening.position, opening.width);
        return interval ? [interval] : [];
      }).sort((a, b) => a[0] - b[0]);
    const solids: [number, number][] = [];
    let cursor = 0;
    for (const [low, high] of openings) {
      if (low > cursor) solids.push([cursor, low]);
      cursor = Math.max(cursor, high);
    }
    if (cursor < frame.length) solids.push([cursor, frame.length]);
    const polygons = solids.map(([low, high]) => {
      const corners = [[low, -1], [high, -1], [high, 1], [low, 1]].map(([distance, side]) => ({
        x: wall.startPoint.x + frame.ux * distance! - frame.uy * side! * wall.thickness / 2,
        y: wall.startPoint.y + frame.uy * distance! + frame.ux * side! * wall.thickness / 2,
      }));
      return `<polygon class="wall-solid" data-start-mm="${low.toFixed(3)}" data-end-mm="${high.toFixed(3)}" points="${polygonToSvgPoints({ points: corners }, transform)}" fill="${style.fill}" stroke="#30251a" stroke-width="0.45" pointer-events="none"/>`;
    }).join('\n');

    elements.push(
      `<g data-entity-type="wall" data-entity-id="${wall.id}" data-thickness-mm="${wall.thickness}">
  <line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="transparent" stroke-width="14" pointer-events="stroke"/>
  ${polygons}
</g>`,
    );
  }

  return `<g class="layer-walls" data-layer="${RenderLayer.Walls}">\n${elements.join('\n')}\n</g>`;
}

function wallFrame(wall: Wall) {
  const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
  const length = Math.hypot(dx, dy);
  return Number.isFinite(length) && length > 0 ? { length, ux: dx / length, uy: dy / length } : undefined;
}

/** Never cut a fictitious gap for an off-host or overhanging opening. */
function openingInterval(wall: Wall, position: Point, width: number): [number, number] | undefined {
  const frame = wallFrame(wall);
  if (!frame || !Number.isFinite(width) || width <= 0) return undefined;
  const dx = position.x - wall.startPoint.x, dy = position.y - wall.startPoint.y;
  const offHost = Math.abs(dx * frame.uy - dy * frame.ux);
  if (!Number.isFinite(offHost) || offHost > 35) return undefined;
  const t = dx * frame.ux + dy * frame.uy;
  let low: number, high: number;
  if (t >= -25 && t + width <= frame.length + 25) {
    low = t;
    high = t + width;
  } else if (t - width / 2 >= -25 && t + width / 2 <= frame.length + 25) {
    low = t - width / 2;
    high = t + width / 2;
  } else {
    return undefined;
  }
  low = Math.max(0, Math.min(frame.length, low));
  high = Math.max(0, Math.min(frame.length, high));
  if (high - low < 1) return undefined;
  return [low, high];
}

function openingTransform(wall: Wall, position: Point, width: number, transform: ViewTransform): string {
  const frame = wallFrame(wall)!;
  const dx = position.x - wall.startPoint.x, dy = position.y - wall.startPoint.y;
  const t = dx * frame.ux + dy * frame.uy;
  let centerT: number;
  if (t >= -25 && t + width <= frame.length + 25) {
    centerT = t + width / 2;
  } else {
    centerT = t;
  }
  centerT = Math.max(width / 2, Math.min(frame.length - width / 2, centerT));
  const center = worldToScreen({
    x: wall.startPoint.x + frame.ux * centerT,
    y: wall.startPoint.y + frame.uy * centerT,
  }, transform);
  const startSc = worldToScreen(wall.startPoint, transform), endSc = worldToScreen(wall.endPoint, transform);
  const angle = Math.atan2(endSc.y - startSc.y, endSc.x - startSc.x) * 180 / Math.PI;
  return `translate(${center.x.toFixed(3)} ${center.y.toFixed(3)}) rotate(${angle.toFixed(3)})`;
}

function renderDoors(floor: Floor, transform: ViewTransform): string {
  const elements: string[] = [];

  for (const door of floor.doors) {
    if (floor.walls.find(w => w.id === door.wallId)?.boundaryRole === 'OPEN_BOUNDARY') continue;
    let wall = floor.walls.find(w => w.id === door.wallId);
    let frame = wall ? wallFrame(wall) : undefined;
    let interval = wall ? openingInterval(wall, door.position, door.width) : undefined;

    if (!wall || !frame || !interval) {
      let bestDist = 200;
      for (const candidate of floor.walls) {
        const cFrame = wallFrame(candidate);
        if (!cFrame) continue;
        const cInt = openingInterval(candidate, door.position, door.width);
        if (cInt) {
          const dx = door.position.x - candidate.startPoint.x;
          const dy = door.position.y - candidate.startPoint.y;
          const dist = Math.abs(dx * cFrame.uy - dy * cFrame.ux);
          if (dist < bestDist) {
            bestDist = dist;
            wall = candidate;
            frame = cFrame;
            interval = cInt;
          }
        }
      }
    }

    const pos = worldToScreen(door.position, transform);
    const scaledWidth = scaleToScreen(door.width, transform);
    if (!wall || !frame || !interval) {
      elements.push(`<g data-entity-type="door" data-entity-id="${door.id}" data-invalid-host="true"><circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="3" fill="#0066cc" opacity="0.6"/><title>Opening ${door.id} (${door.width}mm)</title></g>`);
      continue;
    }
    const tr = openingTransform(wall, door.position, door.width, transform);
    const swingSign = door.swingDirection === SwingDirection.Outward ? -1 : 1;
    const halfW = scaledWidth / 2;

    if (door.type === DoorType.OpenPassage) {
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="open_passage" transform="${tr}">
  <title>Open passage - no door leaf</title>
  <line x1="${(-halfW).toFixed(1)}" y1="0" x2="${halfW.toFixed(1)}" y2="0" stroke="#94a3b8" stroke-width="0.75" stroke-dasharray="3,3"/>
</g>`,
      );
    } else if (door.type === DoorType.Sliding) {
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="sliding" transform="${tr}" class="door-group" style="cursor: pointer;">
  <title>Sliding Door ${door.id}</title>
  <line x1="${(-halfW).toFixed(1)}" y1="-2" x2="0" y2="-2" stroke="#0066cc" stroke-width="1.2"/>
  <line x1="0" y1="2" x2="${halfW.toFixed(1)}" y2="2" stroke="#0066cc" stroke-width="1.2"/>
</g>`,
      );
    } else if (door.type === DoorType.Double) {
      const leafW = scaledWidth / 2;
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="${door.type}" transform="${tr}" class="door-group" style="--hinge-x: ${(-halfW).toFixed(1)}px; --hinge-y: 0px; --swing-sign: ${swingSign}; cursor: pointer;">
  <title>Double Door ${door.id} (click to toggle)</title>
  <line class="door-leaf" x1="${(-halfW).toFixed(1)}" y1="0" x2="${(-halfW).toFixed(1)}" y2="${(swingSign * leafW).toFixed(1)}" stroke="#0066cc" stroke-width="0.8"/>
  <line class="door-leaf" x1="${halfW.toFixed(1)}" y1="0" x2="${halfW.toFixed(1)}" y2="${(swingSign * leafW).toFixed(1)}" stroke="#0066cc" stroke-width="0.8"/>
  <path class="door-swing-arc" d="M ${(-halfW).toFixed(1)} ${(swingSign * leafW).toFixed(1)} A ${leafW.toFixed(1)} ${leafW.toFixed(1)} 0 0 ${swingSign > 0 ? 0 : 1} 0 0" fill="none" stroke="#0066cc" stroke-width="0.5" stroke-dasharray="2,2"/>
  <path class="door-swing-arc" d="M ${halfW.toFixed(1)} ${(swingSign * leafW).toFixed(1)} A ${leafW.toFixed(1)} ${leafW.toFixed(1)} 0 0 ${swingSign > 0 ? 1 : 0} 0 0" fill="none" stroke="#0066cc" stroke-width="0.5" stroke-dasharray="2,2"/>
</g>`,
      );
    } else if (door.type === DoorType.Folding) {
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="${door.type}" transform="${tr}" class="door-group" style="cursor: pointer;">
  <title>Folding Door ${door.id}</title>
  <polyline points="${(-halfW).toFixed(1)},0 ${(-halfW / 2).toFixed(1)},${(swingSign * 6).toFixed(1)} 0,0 ${(halfW / 2).toFixed(1)},${(swingSign * 6).toFixed(1)} ${halfW.toFixed(1)},0" fill="none" stroke="#0066cc" stroke-width="0.8"/>
</g>`,
      );
    } else {
      // DoorType.Single
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="${door.type}" transform="${tr}" class="door-group" style="--hinge-x: ${(-halfW).toFixed(1)}px; --hinge-y: 0px; --swing-sign: ${swingSign}; cursor: pointer;">
  <title>Single Door ${door.id} (click to toggle open/closed)</title>
  <path class="door-leaf" d="M ${(-halfW).toFixed(0)} 0 L ${(-halfW).toFixed(0)} ${(swingSign * scaledWidth).toFixed(0)}" stroke="#0066cc" stroke-width="0.8"/>
  <path class="door-swing-arc" d="M ${(-halfW).toFixed(1)} ${(swingSign * scaledWidth).toFixed(1)} A ${scaledWidth.toFixed(1)} ${scaledWidth.toFixed(1)} 0 0 ${swingSign > 0 ? 0 : 1} ${halfW.toFixed(1)} 0" fill="none" stroke="#0066cc" stroke-width="0.5" stroke-dasharray="2,2"/>
</g>`,
      );
    }
  }

  return `<g class="layer-openings" data-layer="${RenderLayer.Openings}">\n${elements.join('\n')}\n</g>`;
}

function renderWindows(floor: Floor, transform: ViewTransform, includeChajjas = true): string {
  const elements: string[] = [];

  for (const win of floor.windows) {
    let wall = floor.walls.find(w => w.id === win.wallId);
    let frame = wall ? wallFrame(wall) : undefined;
    let interval = wall ? openingInterval(wall, win.position, win.width) : undefined;

    if (!wall || !frame || !interval) {
      let bestDist = 200;
      for (const candidate of floor.walls) {
        const cFrame = wallFrame(candidate);
        if (!cFrame) continue;
        const cInt = openingInterval(candidate, win.position, win.width);
        if (cInt) {
          const dx = win.position.x - candidate.startPoint.x;
          const dy = win.position.y - candidate.startPoint.y;
          const dist = Math.abs(dx * cFrame.uy - dy * cFrame.ux);
          if (dist < bestDist) {
            bestDist = dist;
            wall = candidate;
            frame = cFrame;
            interval = cInt;
          }
        }
      }
    }

    const pos = worldToScreen(win.position, transform);
    const scaledWidth = scaleToScreen(win.width, transform);
    if (!wall || !frame || !interval) {
      elements.push(`<g data-entity-type="window" data-entity-id="${win.id}" data-invalid-host="true"><circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="2.5" fill="#4488cc" opacity="0.6"/><title>Window ${win.id} (${win.width}mm)</title></g>`);
      continue;
    }

    if (includeChajjas) {
      const dx = win.position.x - wall.startPoint.x;
      const dy = win.position.y - wall.startPoint.y;
      const t = dx * frame.ux + dy * frame.uy;
      let centerT = (t >= -25 && t + win.width <= frame.length + 25) ? t + win.width / 2 : t;
      centerT = Math.max(win.width / 2, Math.min(frame.length - win.width / 2, centerT));
      const cx = wall.startPoint.x + frame.ux * centerT;
      const cy = wall.startPoint.y + frame.uy * centerT;
      const wallThick = wall.thickness || 150;
      const probeDist = wallThick / 2 + 120;
      const nA = { x: -frame.uy, y: frame.ux };
      const nB = { x: frame.uy, y: -frame.ux };
      const isOutsideBuilt = (pt: Point) =>
        !floor.rooms.some((r) => architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID' && !r.tags?.includes('recess:perimeter') && pointInPolygon(pt, r.boundary));
      const probeA = { x: cx + nA.x * probeDist, y: cy + nA.y * probeDist };
      const probeB = { x: cx + nB.x * probeDist, y: cy + nB.y * probeDist };
      const outA = isOutsideBuilt(probeA) || !pointInPolygon(probeA, floor.boundary);
      const outB = isOutsideBuilt(probeB) || !pointInPolygon(probeB, floor.boundary);
      const isExtOrShaft =
        wall.wallUse === 'EXTERNAL' ||
        wall.wallUse === 'SHAFT' ||
        wall.type === WallType.External ||
        wall.roomIds.length <= 1 ||
        outA !== outB;
      if (isExtOrShaft && (outA || outB)) {
        const outN = !pointInPolygon(probeA, floor.boundary)
          ? nA
          : !pointInPolygon(probeB, floor.boundary)
            ? nB
            : outA && !outB
              ? nA
              : nB;
        const halfChajjaW = win.width / 2 + 150;
        const innerOff = wallThick / 2;
        const outerOff = innerOff + 600;
        const t0 = centerT - halfChajjaW;
        const t1 = centerT + halfChajjaW;
        const chajjaWorld: Polygon = {
          points: [
            { x: wall.startPoint.x + frame.ux * t0 + outN.x * innerOff, y: wall.startPoint.y + frame.uy * t0 + outN.y * innerOff },
            { x: wall.startPoint.x + frame.ux * t1 + outN.x * innerOff, y: wall.startPoint.y + frame.uy * t1 + outN.y * innerOff },
            { x: wall.startPoint.x + frame.ux * t1 + outN.x * outerOff, y: wall.startPoint.y + frame.uy * t1 + outN.y * outerOff },
            { x: wall.startPoint.x + frame.ux * t0 + outN.x * outerOff, y: wall.startPoint.y + frame.uy * t0 + outN.y * outerOff },
          ],
        };
        elements.push(
          `<polygon class="window-chajja" data-cad-layer="A-CHAJJA" data-entity-id="${win.id}-chajja" points="${polygonToSvgPoints(chajjaWorld, transform)}" fill="#94a3b8" fill-opacity="0.12" stroke="#475569" stroke-width="0.7" stroke-dasharray="4,2"/>`,
        );
      }
    }

    const tr = openingTransform(wall, win.position, win.width, transform);
    const halfW = scaledWidth / 2;
    const wallThickScaled = Math.max(3, scaleToScreen(wall.thickness || 115, transform));
    const halfThick = wallThickScaled / 2;
    const glassOffset = Math.max(1, halfThick * 0.45);

    elements.push(
      `<g data-entity-type="window" data-entity-id="${win.id}" transform="${tr}">
  <!-- Plancraft End Jamb Frame Lines -->
  <line x1="${(-halfW).toFixed(1)}" y1="${(-halfThick).toFixed(1)}" x2="${(-halfW).toFixed(1)}" y2="${halfThick.toFixed(1)}" stroke="#1e293b" stroke-width="0.8"/>
  <line x1="${halfW.toFixed(1)}" y1="${(-halfThick).toFixed(1)}" x2="${halfW.toFixed(1)}" y2="${halfThick.toFixed(1)}" stroke="#1e293b" stroke-width="0.8"/>
  <!-- Plancraft Multi-Line Glazing Panes -->
  <line x1="${(-halfW).toFixed(1)}" y1="${(-glassOffset).toFixed(1)}" x2="${halfW.toFixed(1)}" y2="${(-glassOffset).toFixed(1)}" stroke="#38bdf8" stroke-width="0.9"/>
  <line x1="${(-halfW).toFixed(1)}" y1="0" x2="${halfW.toFixed(1)}" y2="0" stroke="#0284c7" stroke-width="0.65" stroke-dasharray="3,2"/>
  <line x1="${(-halfW).toFixed(1)}" y1="${glassOffset.toFixed(1)}" x2="${halfW.toFixed(1)}" y2="${glassOffset.toFixed(1)}" stroke="#38bdf8" stroke-width="0.9"/>
</g>`,
    );
  }

  return `<g class="layer-windows" data-layer="${RenderLayer.Openings}">\n${elements.join('\n')}\n</g>`;
}

function renderStairs(floor: Floor, transform: ViewTransform): string {
  const elements: string[] = [];
  if (floor.canonicalStaircases?.length) {
    for (const stair of floor.canonicalStaircases) {
      const parts = canonicalStairSolids(stair, floor.floorHeight, floor.slabThicknessMm);
      for (const part of parts.filter(p => floor.floorUse !== 'ROOF' || p.top === 0)) {
        elements.push(`<polygon points="${polygonToSvgPoints(part.boundary, transform)}" fill="none" stroke="#64748b" stroke-width="0.8" data-entity-type="stair" data-stair-part="${part.kind}" data-entity-id="${escapeXml(stair.id)}"/>`);
      }
      if (floor.floorUse !== 'ROOF') {
        const midC = polygonCentroid(stair.midLanding);
        const flC = stair.floorLanding ? polygonCentroid(stair.floorLanding) : polygonCentroid(stair.polygon);
        const f1C = polygonCentroid(stair.flight1);
        const f2C = polygonCentroid(stair.flight2);
        const dx = midC.x - flC.x;
        const dy = midC.y - flC.y;
        const len = Math.hypot(dx, dy);
        if (len > 100) {
          const ux = dx / len;
          const uy = dy / len;
          const px = -uy;
          const py = ux;
          const f1Box = polygonBoundingBox(stair.flight1);
          const flightSpan = Math.abs(ux) > Math.abs(uy) ? f1Box.width : f1Box.height;
          const runHalf = Math.max(150, flightSpan * 0.34);
          const divHalf = Math.max(200, flightSpan * 0.48);
          const divC = { x: (f1C.x + f2C.x) / 2, y: (f1C.y + f2C.y) / 2 };
          const railHalfW = 22;
          const balPoly: Polygon = {
            points: [
              { x: divC.x - ux * divHalf + px * railHalfW, y: divC.y - uy * divHalf + py * railHalfW },
              { x: divC.x + ux * divHalf + px * railHalfW, y: divC.y + uy * divHalf + py * railHalfW },
              { x: divC.x + ux * divHalf - px * railHalfW, y: divC.y + uy * divHalf - py * railHalfW },
              { x: divC.x - ux * divHalf - px * railHalfW, y: divC.y - uy * divHalf - py * railHalfW },
            ],
          };
          const upStart = worldToScreen({ x: f1C.x - ux * runHalf, y: f1C.y - uy * runHalf }, transform);
          const upEnd = worldToScreen({ x: f1C.x + ux * runHalf, y: f1C.y + uy * runHalf }, transform);
          const dnStart = worldToScreen({ x: f2C.x + ux * runHalf, y: f2C.y + uy * runHalf }, transform);
          const dnEnd = worldToScreen({ x: f2C.x - ux * runHalf, y: f2C.y - uy * runHalf }, transform);
          elements.push(
            `<polygon class="stair-balustrade" points="${polygonToSvgPoints(balPoly, transform)}" fill="#f8fafc" stroke="#334155" stroke-width="0.7" data-entity-type="stair" data-stair-part="balustrade" data-entity-id="${escapeXml(stair.id)}"/>`,
            `<line class="stair-up-route" x1="${upStart.x.toFixed(1)}" y1="${upStart.y.toFixed(1)}" x2="${upEnd.x.toFixed(1)}" y2="${upEnd.y.toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
            `<line class="stair-dn-route" x1="${dnStart.x.toFixed(1)}" y1="${dnStart.y.toFixed(1)}" x2="${dnEnd.x.toFixed(1)}" y2="${dnEnd.y.toFixed(1)}" stroke="#334155" stroke-width="1.1" marker-end="url(#arrow)"/>`,
            `<text x="${upStart.x.toFixed(1)}" y="${(upStart.y - 3).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" fill="#1e293b">UP</text>`,
            `<text x="${dnStart.x.toFixed(1)}" y="${(dnStart.y - 3).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" fill="#475569">DN</text>`,
          );
        }
      }
    }
    return `<g class="layer-stairs" data-layer="stairs">${elements.join('')}</g>`;
  }


  for (const stair of floor.stairs) {
    const solids = computeStairSolids(stair, 3000);
    const diagram = `${stair.type.toLowerCase().replace(/_/g, '-')}-${stair.direction.toLowerCase()}`;
    const topLeft = worldToScreen({ x: stair.x, y: stair.y }, transform);
    const w = scaleToScreen(stair.width, transform);
    const h = scaleToScreen(stair.length, transform);
    const dir = String(stair.direction ?? '').toUpperCase();
    const isHorizontalRun = dir === 'EAST' || dir === 'WEST';

    elements.push(`<g data-entity-type="stair" data-entity-id="${stair.id}" data-stair-diagram="${diagram}">`);
    elements.push(`  <rect x="${topLeft.x.toFixed(1)}" y="${topLeft.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f0ebe5" stroke="#999" stroke-width="0.8"/>`);

    if (solids.solids.length > 0) {
      for (const solid of solids.solids) {
        const poly = polygonToSvgPoints(solid.boundary, transform);
        elements.push(`  <polygon points="${poly}" fill="${solid.kind === 'landing' ? '#e2d9cf' : '#f5f0eb'}" stroke="#a89f91" stroke-width="0.5"/>`);
      }
    } else {
      const treadCount = Math.min(stair.riserCount, 20);
      if (isHorizontalRun) {
        const treadW = w / Math.max(1, treadCount);
        for (let i = 1; i < treadCount; i++) {
          const x = topLeft.x + i * treadW;
          elements.push(`  <line x1="${x.toFixed(1)}" y1="${topLeft.y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(topLeft.y + h).toFixed(1)}" stroke="#999" stroke-width="0.5"/>`);
        }
      } else {
        const treadH = h / Math.max(1, treadCount);
        for (let i = 1; i < treadCount; i++) {
          const y = topLeft.y + i * treadH;
          elements.push(`  <line x1="${topLeft.x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(topLeft.x + w).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#999" stroke-width="0.5"/>`);
        }
      }
    }

    // Direction arrow / route perpendicular to treads
    if (isHorizontalRun) {
      const arrowY = topLeft.y + h / 2;
      const arrowX1 = dir === 'WEST' ? topLeft.x + w * 0.8 : topLeft.x + w * 0.2;
      const arrowX2 = dir === 'WEST' ? topLeft.x + w * 0.2 : topLeft.x + w * 0.8;
      elements.push(`  <line class="stair-up-route" x1="${arrowX1.toFixed(1)}" y1="${arrowY.toFixed(1)}" x2="${arrowX2.toFixed(1)}" y2="${arrowY.toFixed(1)}" stroke="#666" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    } else {
      const arrowX = topLeft.x + w / 2;
      const arrowY1 = dir === 'SOUTH' ? topLeft.y + h * 0.2 : topLeft.y + h * 0.8;
      const arrowY2 = dir === 'SOUTH' ? topLeft.y + h * 0.8 : topLeft.y + h * 0.2;
      elements.push(`  <line class="stair-up-route" x1="${arrowX.toFixed(1)}" y1="${arrowY1.toFixed(1)}" x2="${arrowX.toFixed(1)}" y2="${arrowY2.toFixed(1)}" stroke="#666" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    }
    elements.push(`</g>`);
  }

  return `<g class="layer-stairs" data-layer="${RenderLayer.Stairs}">\n${elements.join('\n')}\n</g>`;
}

function renderColumns(floor: Floor, transform: ViewTransform): string {
  if (!floor.columns || floor.columns.length === 0) return '';
  const elements: string[] = [];
  const showTags = floor.name === 'COLUMN_SCHEDULE_PLAN' || floor.id.includes('col_schedule');
  for (const col of floor.columns) {
    const sc = worldToScreen(col.position, transform);
    const sw = Math.max(4, scaleToScreen(col.width || 450, transform));
    const sd = Math.max(4, scaleToScreen(col.depth || 450, transform));
    const x = sc.x - sw / 2;
    const y = sc.y - sd / 2;
    elements.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${sw.toFixed(1)}" height="${sd.toFixed(1)}" fill="#475569" fill-opacity="0.88" stroke="#0f172a" stroke-width="0.8" data-entity-type="column" data-entity-id="${escapeXml(col.id)}"><title>${escapeXml(col.gridReference || 'Structural Column')} (${col.width}x${col.depth}mm)</title></rect>`,
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + sw).toFixed(1)}" y2="${(y + sd).toFixed(1)}" stroke="#ffffff" stroke-width="0.6" pointer-events="none"/>`,
      `<line x1="${(x + sw).toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + sd).toFixed(1)}" stroke="#ffffff" stroke-width="0.6" pointer-events="none"/>`,
    );
    if (showTags && col.gridReference) {
      elements.push(
        `<text x="${sc.x.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="700" fill="#dc2626">${escapeXml(col.gridReference)}</text>`,
      );
    }
  }
  return `<g class="layer-columns" data-layer="${RenderLayer.Columns}">\n${elements.join('\n')}\n</g>`;
}

function renderBeams(floor: Floor, transform: ViewTransform): string {
  if (!floor.beams || floor.beams.length === 0) return '';
  const elements: string[] = [];
  for (const beam of floor.beams) {
    const sp = worldToScreen(beam.startPoint, transform);
    const ep = worldToScreen(beam.endPoint, transform);
    const strokeColor = beam.type === 'CANTILEVER' ? '#ef4444' : beam.type === 'SECONDARY' ? '#0284c7' : '#d97706';
    const strokeWidth = beam.type === 'PRIMARY' ? 1.5 : 1.0;
    elements.push(
      `<line x1="${sp.x.toFixed(1)}" y1="${sp.y.toFixed(1)}" x2="${ep.x.toFixed(1)}" y2="${ep.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="4,2" data-entity-type="beam" data-entity-id="${escapeXml(beam.id)}"><title>${escapeXml(beam.id)} (${beam.widthMm}x${beam.depthMm}mm ${beam.type})</title></line>`,
    );
  }
  return `<g class="layer-beams" data-layer="beams">\n${elements.join('\n')}\n</g>`;
}

function renderDimensions(floor: Floor, building: Building, transform: ViewTransform): string {
  const elements: string[] = [];
  const dimOffset = 38; // px offset from the edge into dedicated margin track
  const site = building.site;

  // Plot width dimension (top)
  const topLeft = worldToScreen({ x: 0, y: 0 }, transform);
  const topRight = worldToScreen({ x: site.plotWidth, y: 0 }, transform);

  elements.push(renderDimensionLine(
    topLeft.x, topLeft.y - dimOffset,
    topRight.x, topRight.y - dimOffset,
    `${mmToFtDisplay(site.plotWidth)}' (${(site.plotWidth / 1000).toFixed(1)}m)`,
    'horizontal',
  ));

  // Plot depth dimension (left)
  const bottomLeft = worldToScreen({ x: 0, y: site.plotDepth }, transform);
  elements.push(renderDimensionLine(
    topLeft.x - dimOffset, topLeft.y,
    bottomLeft.x - dimOffset, bottomLeft.y,
    `${mmToFtDisplay(site.plotDepth)}' (${(site.plotDepth / 1000).toFixed(1)}m)`,
    'vertical',
  ));

  // Room dimensions (placed inside each room near its lower inner margin so they never spill into adjacent rooms)
  for (const room of floor.rooms) {
    if (room.tags?.includes('recess:perimeter')) continue;
    const sWidth = scaleToScreen(room.width, transform);
    const sHeight = scaleToScreen(room.height, transform);
    if (sWidth < 56 || sHeight < 48) continue;

    const roomBottomLeft = worldToScreen({ x: room.x, y: room.y + room.height }, transform);
    const roomBottomRight = worldToScreen({ x: room.x + room.width, y: room.y + room.height }, transform);

    const fontSize = Math.max(6, Math.min(8.5, scaleToScreen(220, transform)));
    const midX = (roomBottomLeft.x + roomBottomRight.x) / 2;
    const dimY = roomBottomLeft.y - Math.max(5, scaleToScreen(220, transform));

    elements.push(
      `<text x="${midX.toFixed(1)}" y="${dimY.toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize.toFixed(1)}" fill="#0066cc" paint-order="stroke" stroke="#ffffff" stroke-width="2" stroke-opacity="0.85">${mmToFtDisplay(room.width)}' × ${mmToFtDisplay(room.height)}'</text>`,
    );
  }

  return `<g class="layer-annotations" data-layer="${RenderLayer.Annotations}">\n${elements.join('\n')}\n</g>`;
}

function renderDimensionLine(
  x1: number, y1: number,
  x2: number, y2: number,
  label: string,
  orientation: 'horizontal' | 'vertical',
): string {
  const tickSize = 4;
  const overshoot = 3;
  const lines: string[] = [];

  // Main dimension line
  lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0066cc" stroke-width="0.6"/>`);

  if (orientation === 'horizontal') {
    // Stepped extension overshoot lines
    lines.push(`<line x1="${x1.toFixed(1)}" y1="${(y1 - overshoot).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y1 + overshoot).toFixed(1)}" stroke="#0066cc" stroke-width="0.5"/>`);
    lines.push(`<line x1="${x2.toFixed(1)}" y1="${(y2 - overshoot).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2 + overshoot).toFixed(1)}" stroke="#0066cc" stroke-width="0.5"/>`);
    // Plancraft 45° architectural tick marks
    lines.push(`<line x1="${(x1 - tickSize).toFixed(1)}" y1="${(y1 + tickSize).toFixed(1)}" x2="${(x1 + tickSize).toFixed(1)}" y2="${(y1 - tickSize).toFixed(1)}" stroke="#0066cc" stroke-width="0.9"/>`);
    lines.push(`<line x1="${(x2 - tickSize).toFixed(1)}" y1="${(y2 + tickSize).toFixed(1)}" x2="${(x2 + tickSize).toFixed(1)}" y2="${(y2 - tickSize).toFixed(1)}" stroke="#0066cc" stroke-width="0.9"/>`);
    // Label with halo pill background
    const mx = (x1 + x2) / 2;
    const labelW = Math.max(30, label.length * 5.8 + 8);
    lines.push(`<rect x="${(mx - labelW / 2).toFixed(1)}" y="${(y1 - 13).toFixed(1)}" width="${labelW.toFixed(1)}" height="13" rx="2" fill="#ffffff" fill-opacity="0.92" stroke="#bae6fd" stroke-width="0.5"/>`);
    lines.push(`<text x="${mx.toFixed(1)}" y="${(y1 - 3).toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="9" fill="#0066cc" font-weight="600">${escapeXml(label)}</text>`);
  } else {
    // Stepped extension overshoot lines
    lines.push(`<line x1="${(x1 - overshoot).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 + overshoot).toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#0066cc" stroke-width="0.5"/>`);
    lines.push(`<line x1="${(x2 - overshoot).toFixed(1)}" y1="${(y2 - overshoot).toFixed(1)}" x2="${(x2 + overshoot).toFixed(1)}" y2="${(y2 + overshoot).toFixed(1)}" stroke="#0066cc" stroke-width="0.5"/>`);
    // Plancraft 45° architectural tick marks
    lines.push(`<line x1="${(x1 - tickSize).toFixed(1)}" y1="${(y1 + tickSize).toFixed(1)}" x2="${(x1 + tickSize).toFixed(1)}" y2="${(y1 - tickSize).toFixed(1)}" stroke="#0066cc" stroke-width="0.9"/>`);
    lines.push(`<line x1="${(x2 - tickSize).toFixed(1)}" y1="${(y2 + tickSize).toFixed(1)}" x2="${(x2 + tickSize).toFixed(1)}" y2="${(y2 - tickSize).toFixed(1)}" stroke="#0066cc" stroke-width="0.9"/>`);
    const my = (y1 + y2) / 2;
    const labelW = Math.max(30, label.length * 5.8 + 8);
    lines.push(`<rect x="${(x1 - 15).toFixed(1)}" y="${(my - labelW / 2).toFixed(1)}" width="14" height="${labelW.toFixed(1)}" rx="2" fill="#ffffff" fill-opacity="0.92" stroke="#bae6fd" stroke-width="0.5"/>`);
    lines.push(`<text x="${(x1 - 5).toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="9" fill="#0066cc" font-weight="600" transform="rotate(-90 ${(x1 - 5).toFixed(1)} ${my.toFixed(1)})">${escapeXml(label)}</text>`);
  }

  return lines.join('\n');
}

/**
 * Renders authentic Plancraft CAD furniture items on layer A-FURN.
 */
function renderPlancraftFurniture(floor: Floor, transform: ViewTransform): string {
  const items = floor.furniture && floor.furniture.length > 0 ? floor.furniture : [];
  if (items.length === 0) {
    return '';
  }

  const elements: string[] = [];

  for (const item of items) {
    const room = floor.rooms.find(r => r.id === item.roomId);
    if (room && /utility|balcony/i.test(`${room.type} ${room.name}`) && ['stove', 'oven'].includes(item.type)) continue;
    const symbol = PLANCRAFT_SVG_SYMBOLS[item.type];
    if (!symbol) continue;

    const cx = item.xMm + item.widthMm / 2;
    const cy = item.yMm + item.depthMm / 2;
    const sCenter = worldToScreen({ x: cx, y: cy }, transform);

    const isOrthogonal = item.rotationDeg === 90 || item.rotationDeg === 270;
    const baseW = isOrthogonal ? item.depthMm : item.widthMm;
    const baseD = isOrthogonal ? item.widthMm : item.depthMm;

    const sx = scaleToScreen(baseW, transform) / symbol.viewBoxWidth;
    const sy = scaleToScreen(baseD, transform) / symbol.viewBoxHeight;

    const tr = `translate(${sCenter.x.toFixed(2)} ${sCenter.y.toFixed(2)}) rotate(${item.rotationDeg}) scale(${sx.toFixed(5)} ${sy.toFixed(5)}) translate(${(-symbol.viewBoxWidth / 2).toFixed(2)} ${(-symbol.viewBoxHeight / 2).toFixed(2)})`;

    elements.push(
      `<g class="cad-furniture-item" data-entity-type="furniture" data-furniture-id="${escapeXml(item.id)}" data-entity-id="${escapeXml(item.id)}" data-furniture-type="${escapeXml(item.type)}" transform="${tr}" opacity="0.85" pointer-events="visiblePainted">` +
      `<title>${escapeXml(item.type)} (${item.widthMm} × ${item.depthMm} mm)</title>` +
      symbol.inner +
      `</g>`,
    );
  }

  return `<g class="cad-layer-A-FURN layer-furniture" data-layer="${RenderLayer.Furniture}" pointer-events="none">\n${elements.join('\n')}\n</g>`;
}

function renderNorthArrow(building: Building, _transform: ViewTransform, viewportWidth: number): string {
  const x = viewportWidth - 50;
  const y = 50;
  const orientation = building.site.orientation;

  return `<g class="north-arrow" transform="translate(${x},${y}) rotate(${orientation})">
  <polygon points="0,-20 -8,8 0,2 8,8" fill="#333" stroke="#333" stroke-width="1"/>
  <text x="0" y="-24" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#333" font-weight="bold">N</text>
</g>`;
}

function renderScaleBar(viewportHeight: number, scaleLabel: string): string {
  const y = viewportHeight - 54;
  return `<g class="scale-bar" aria-label="Drawing scale ${escapeXml(scaleLabel)}">
  <line x1="32" y1="${y}" x2="132" y2="${y}" stroke="#222" stroke-width="2"/>
  <line x1="32" y1="${y - 4}" x2="32" y2="${y + 4}" stroke="#222"/>
  <line x1="82" y1="${y - 4}" x2="82" y2="${y + 4}" stroke="#222"/>
  <line x1="132" y1="${y - 4}" x2="132" y2="${y + 4}" stroke="#222"/>
  <text x="32" y="${y + 15}" font-family="Inter, Arial, sans-serif" font-size="9" fill="#333">0</text>
  <text x="82" y="${y + 15}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="9" fill="#333">${escapeXml(scaleLabel)}</text>
</g>`;
}

function renderTitleBlock(
  building: Building,
  floor: Floor,
  viewportWidth: number,
  viewportHeight: number,
  options?: ExportOptions,
): string {
  const width = Math.min(360, viewportWidth * 0.42);
  const height = 84;
  const x = viewportWidth - width - 18;
  const y = viewportHeight - height - 18;
  return `<g class="title-block">
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff" stroke="#222" stroke-width="1"/>
  <line x1="${x}" y1="${y + 50}" x2="${x + width}" y2="${y + 50}" stroke="#555" stroke-width="0.6"/>
  <line x1="${x + width * 0.62}" y1="${y + 50}" x2="${x + width * 0.62}" y2="${y + height}" stroke="#555" stroke-width="0.6"/>
  <text x="${x + 10}" y="${y + 17}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#111">${escapeXml(building.name)}</text>
  <text x="${x + 10}" y="${y + 31}" font-family="Inter, Arial, sans-serif" font-size="9" fill="#555">${escapeXml(floor.name)} • Architectural floor plan</text>
  <text x="${x + 10}" y="${y + 44}" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="#b42318">CONCEPT / SCHEMATIC DESIGN • NOT FOR CONSTRUCTION</text>
  <text x="${x + 10}" y="${y + 65}" font-family="Inter, Arial, sans-serif" font-size="8" fill="#555">DRAWN BY</text>
  <text x="${x + 10}" y="${y + 78}" font-family="Inter, Arial, sans-serif" font-size="9" fill="#111">${escapeXml(options?.drawnBy ?? 'FORMA AI Planner')}</text>
  <text x="${x + width * 0.65}" y="${y + 65}" font-family="Inter, Arial, sans-serif" font-size="8" fill="#555">SCALE / REV</text>
  <text x="${x + width * 0.65}" y="${y + 78}" font-family="Inter, Arial, sans-serif" font-size="9" fill="#111">${escapeXml(options?.scale ?? 'NTS')} / ${escapeXml(options?.revision ?? '01')}</text>
</g>`;
}

// ─── Main Renderer ──────────────────────────────────────────────────────────

const DEFAULT_VIEWPORT_WIDTH = 1000;
const DEFAULT_VIEWPORT_HEIGHT = 800;

/**
 * Render a single floor as SVG.
 */
export function renderFloor(
  floor: Floor,
  building: Building,
  transform: ViewTransform,
  viewportWidth: number = DEFAULT_VIEWPORT_WIDTH,
  viewportHeight: number = DEFAULT_VIEWPORT_HEIGHT,
  config?: Readonly<RenderConfig> | DeepPartial<RenderConfig>,
  exportOptions?: ExportOptions,
): string {
  const viewOpening = <T extends Floor['doors'][number] | Floor['windows'][number]>(o: T): T => {
    if (o.openingGeometryVersion !== 1) return o;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) return o;
    try {
      return { ...o, position: canonicalOpeningGeometry(o, wall).startPoint, openingGeometryVersion: undefined, positionReference: undefined };
    } catch {
      return o;
    }
  };
  floor = { ...floor, doors: floor.doors.map(viewOpening), windows: floor.windows.map(viewOpening) };
  const resolved = resolveConfig(config);
  const layers = [
    resolved.layers[RenderLayer.Grid] && resolved.showGrid
      ? renderGrid(viewportWidth, viewportHeight, transform, resolved.gridSpacing) : '',
    resolved.layers[RenderLayer.Plot] ? renderPlotBoundary(building, transform) : '',
    resolved.layers[RenderLayer.SiteZones] ? renderSiteZones(building, transform) : '',
    (resolved.layers[RenderLayer.SiteZones] || floor.floorUse === 'STILT_PARKING' || /STILT/i.test(floor.name))
      ? renderRoadAccessOverlay(building, floor, transform) : '',
    resolved.layers[RenderLayer.Floor] ? renderFloorBoundary(floor, transform) : '',
    // 1. Site Zones & Room Fills
    resolved.layers[RenderLayer.Rooms]
      ? renderRooms(floor, transform, false, false) : '',
    // 2. A-FURN Furniture Layer
    resolved.layers[RenderLayer.Furniture] ? renderPlancraftFurniture(floor, transform) : '',
    // 3. Wall Polygons (230/150/115/100mm) & Structural Columns
    resolved.layers[RenderLayer.Walls] ? renderWalls(floor, transform) : '',
    (resolved.layers[RenderLayer.Columns] || resolved.disciplines?.STRUCTURAL)
      ? renderColumns(floor, transform) : '',
    (resolved.layers[RenderLayer.Beams] || resolved.disciplines?.STRUCTURAL)
      ? renderBeams(floor, transform) : '',
    // 4. Doors & 90° Swing Arcs + Windows + Stairs
    resolved.layers[RenderLayer.Openings] ? renderDoors(floor, transform) : '',
    resolved.layers[RenderLayer.Openings] ? renderWindows(floor, transform, building.metadata?.generationBrief?.includeWindowChajjas !== false) : '',
    resolved.layers[RenderLayer.Stairs] ? renderStairs(floor, transform) : '',
    // 4b. Phase 3 Engineering Discipline Overlays (MEP / Ceiling / Fire / Cantilevers)
    renderMepOverlays(floor, building, transform, resolved),
    // 5. Stepped Dimension Lines
    resolved.layers[RenderLayer.Annotations] && resolved.showDimensions
      ? renderDimensions(floor, building, transform) : '',
    // 6. Centered Room Label Halo Pills (Topmost)
    resolved.layers[RenderLayer.Rooms]
      ? renderRooms(floor, transform, resolved.showRoomLabels, resolved.showRoomAreas, true, resolved.layers[RenderLayer.Furniture]) : '',
    resolved.showNorthArrow ? renderNorthArrow(building, transform, viewportWidth) : '',
    resolved.showScaleBar ? renderScaleBar(viewportHeight, exportOptions?.scale ?? 'NTS') : '',
    resolved.showTitleBlock
      ? renderTitleBlock(building, floor, viewportWidth, viewportHeight, exportOptions) : '',
  ].filter(Boolean);

  return resolveSvgAnnotations(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewportWidth} ${viewportHeight}" class="floor-plan" width="${viewportWidth}" height="${viewportHeight}">
  <defs>
    <pattern id="tile-hatch" width="${scaleToScreen(600, transform)}" height="${scaleToScreen(600, transform)}" patternUnits="userSpaceOnUse"><path d="M ${scaleToScreen(600, transform)} 0 H 0 V ${scaleToScreen(600, transform)}" fill="none" stroke="#bd9d76" stroke-width="0.4"/></pattern>
    <pattern id="wet-hatch" width="${scaleToScreen(300, transform)}" height="${scaleToScreen(300, transform)}" patternUnits="userSpaceOnUse"><path d="M0 0V${scaleToScreen(220, transform)}H${scaleToScreen(220, transform)}" fill="none" stroke="#6f86c0" stroke-width="0.55"/></pattern>
    <pattern id="outdoor-hatch" width="${scaleToScreen(400, transform)}" height="${scaleToScreen(400, transform)}" patternUnits="userSpaceOnUse"><path d="M0 0L${scaleToScreen(400, transform)} ${scaleToScreen(400, transform)} M${scaleToScreen(200, transform)} 0L${scaleToScreen(400, transform)} ${scaleToScreen(200, transform)}" fill="none" stroke="#b2b5b5" stroke-width="0.5"/></pattern>
    <pattern id="quilt-hatch" width="140" height="140" patternUnits="userSpaceOnUse"><rect width="140" height="140" fill="#f5f2eb"/><path d="M0 0L140 140M140 0L0 140" stroke="#a29382" stroke-width="10"/></pattern>
    <pattern id="site-setback-hatch" width="${scaleToScreen(1000, transform)}" height="${scaleToScreen(1000, transform)}" patternUnits="userSpaceOnUse"><path d="M 0 ${scaleToScreen(1000, transform)} L ${scaleToScreen(1000, transform)} 0" fill="none" stroke="#cbd5e1" stroke-width="0.5" stroke-dasharray="2,2"/></pattern>
    <pattern id="site-garden-pattern" width="${scaleToScreen(800, transform)}" height="${scaleToScreen(800, transform)}" patternUnits="userSpaceOnUse"><circle cx="${scaleToScreen(200, transform)}" cy="${scaleToScreen(200, transform)}" r="1.2" fill="#86efac" opacity="0.6"/><circle cx="${scaleToScreen(600, transform)}" cy="${scaleToScreen(600, transform)}" r="1.5" fill="#4ade80" opacity="0.5"/></pattern>
    <pattern id="site-parking-pattern" width="${scaleToScreen(2500, transform)}" height="${scaleToScreen(5000, transform)}" patternUnits="userSpaceOnUse"><rect width="${scaleToScreen(2500, transform)}" height="${scaleToScreen(5000, transform)}" fill="none" stroke="#cbd5e1" stroke-width="0.4"/></pattern>
    <pattern id="site-pedestrian-pattern" width="${scaleToScreen(600, transform)}" height="${scaleToScreen(600, transform)}" patternUnits="userSpaceOnUse"><path d="M 0 0 H ${scaleToScreen(600, transform)} V ${scaleToScreen(600, transform)}" fill="none" stroke="#e2e8f0" stroke-width="0.4"/></pattern>
    <pattern id="site-service-pattern" width="${scaleToScreen(600, transform)}" height="${scaleToScreen(600, transform)}" patternUnits="userSpaceOnUse"><path d="M 0 0 L ${scaleToScreen(600, transform)} ${scaleToScreen(600, transform)} M ${scaleToScreen(600, transform)} 0 L 0 ${scaleToScreen(600, transform)}" fill="none" stroke="#fed7aa" stroke-width="0.4"/></pattern>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
    </marker>
    <style>
      .door-group { pointer-events: all; cursor: pointer; }
      .door-group .door-leaf {
        transform-origin: var(--hinge-x, 0) var(--hinge-y, 0);
        transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .door-group.is-closed .door-leaf {
        transform: rotate(calc(-90deg * var(--swing-sign, 1)));
      }
      .door-group.is-closed .door-swing-arc {
        opacity: 0.15;
        transition: opacity 0.28s ease;
      }
      @media (prefers-reduced-motion: reduce) {
        .door-group .door-leaf, .door-group.is-closed .door-swing-arc {
          transition: none;
        }
      }
    </style>
  </defs>
  ${layers.join('\n  ')}
</svg>`);
}

/**
 * Render a building (specific floor level) as SVG.
 */
export function renderBuilding(
  building: Building,
  floorLevel: number = 0,
  viewportWidth: number = DEFAULT_VIEWPORT_WIDTH,
  viewportHeight: number = DEFAULT_VIEWPORT_HEIGHT,
  config?: Readonly<RenderConfig> | DeepPartial<RenderConfig>,
): string {
  const floor = building.floors.find(f => f.level === floorLevel);
  if (!floor) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  const bounds = getFloorContentBounds(floor);
  const transform = fitToView(bounds, viewportWidth, viewportHeight);

  return renderFloor(floor, building, transform, viewportWidth, viewportHeight, config);
}

/**
 * Export a building as clean SVG (no interactive elements).
 */
export function exportSVG(
  building: Building,
  options: ExportOptions,
): string {
  const floor = building.floors.find(candidate => candidate.id === options.floorId)
    ?? building.floors[0];
  if (!floor) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  const paperSizes: Record<string, { width: number; height: number }> = {
    A4: { width: 842, height: 595 },
    A3: { width: 1191, height: 842 },
    A2: { width: 1684, height: 1191 },
    A1: { width: 2384, height: 1684 },
    A0: { width: 3370, height: 2384 },
    letter: { width: 792, height: 612 },
    tabloid: { width: 1224, height: 792 },
  };

  const paper = paperSizes[options.paperSize] ?? paperSizes['A4']!;
  const w = options.orientation === 'landscape' ? paper.width : paper.height;
  const h = options.orientation === 'landscape' ? paper.height : paper.width;

  const bounds = getFloorContentBounds(floor);
  const transform = fitToView(bounds, w, h, options.includeTitleBlock ? 90 : 50);
  return renderFloor(
    floor,
    building,
    transform,
    w,
    h,
    {
      showGrid: options.includeGrid,
      showDimensions: options.includeDimensions,
      showRoomLabels: options.includeRoomLabels,
      showRoomAreas: options.includeRoomAreas ?? true,
      showNorthArrow: options.includeNorthArrow,
      showScaleBar: options.includeScaleBar,
      showTitleBlock: options.includeTitleBlock,
      layers: {
        [RenderLayer.Grid]: options.includeGrid,
        [RenderLayer.Plot]: true,
        [RenderLayer.SiteZones]: true,
        [RenderLayer.Annotations]: options.includeDimensions,
        [RenderLayer.Openings]: options.includeOpenings ?? true,
      },
    },
    options,
  );
}

/** Resolve conservative text envelopes after layer composition, in drawing pixels. */
export function resolveSvgAnnotations(svg: string): string {
  const layout = new AnnotationLayout();
  return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (original, attributes: string, content: string) => {
    const x = Number(attributes.match(/\bx="([^"]+)"/)?.[1]);
    const y = Number(attributes.match(/\by="([^"]+)"/)?.[1]);
    const h = Number(attributes.match(/font-size="([^"]+)"/)?.[1] ?? 10);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(h) || h <= 0) return original;
    const text = content.replace(/&[^;]+;/g, 'X');
    const middle = attributes.includes('text-anchor="middle"');
    const centerX = middle ? x : x + text.length * h * 0.35;
    const box = layout.place(text, centerX, y, h, undefined, /rotate\(-?90/.test(attributes));
    const updated = attributes.replace(/\by="[^"]+"/, `y="${box.y}"`).replace(/rotate\((-?90) [^)]*\)/g, (_m: string, angle: string) => `rotate(${angle} ${x} ${box.y})`);
    return `<text${updated} data-text-box="${box.x},${box.y},${box.width},${box.height}">${content}</text>`;
  });
}
