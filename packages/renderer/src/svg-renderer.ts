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
import { getFloorContentBounds, computeStairSolids, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';
import { worldToScreen, fitToView, scaleToScreen } from './coordinate-transform';
import { resolveConfig } from './render-config';
import type { DeepPartial, RenderConfig } from './render-config';
import { furniturePlacement, renderReferenceFurniture } from './reference-furniture';
import { PLANCRAFT_SVG_SYMBOLS } from './plancraft-symbols';

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

function sqMmToSqM(sqMm: number): string {
  return (sqMm / 1_000_000).toFixed(1);
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
    const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    const sCenter = worldToScreen(center, transform);
    const sWidth = scaleToScreen(bbox.width, transform);
    const sHeight = scaleToScreen(bbox.height, transform);

    // Only render text if the screen rectangle is large enough
    if (sWidth >= 36 && sHeight >= 20) {
      const areaMm2 = zone.area > 10_000 ? zone.area : zone.area * 1_000_000;
      const areaM2 = (areaMm2 / 1_000_000).toFixed(1);
      const areaSqFt = Math.round(Number(areaM2) * 10.7639);
      const isCompact = sWidth < 65 || sHeight < 36;
      const dimLabel = `${Math.round(bbox.width)} × ${Math.round(bbox.height)} mm`;

      const pillWidth = Math.min(sWidth * 0.95, Math.max(zone.name.length * (isCompact ? 5.8 : 7.2), 110));
      const pillHeight = isCompact ? 30 : 44;
      const pillX = sCenter.x - pillWidth / 2;
      const pillY = sCenter.y - pillHeight / 2;

      elements.push(
        `<g class="site-zone-label" pointer-events="none">`,
        `  <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillWidth.toFixed(1)}" height="${pillHeight.toFixed(1)}" rx="4" fill="#ffffff" fill-opacity="0.90" stroke="#cbd5e1" stroke-width="0.75"/>`,
        `  <text x="${sCenter.x.toFixed(1)}" y="${(sCenter.y - (isCompact ? 1 : 8)).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${isCompact ? 8 : 10}" font-weight="700" fill="#0f172a" style="text-transform:uppercase;paint-order:stroke fill;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round;">${escapeXml(zone.name)}</text>`,
        `  <text x="${sCenter.x.toFixed(1)}" y="${(sCenter.y + (isCompact ? 9 : 4)).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${isCompact ? 7 : 8.5}" font-weight="600" fill="#334155" style="paint-order:stroke fill;stroke:#ffffff;stroke-width:2.5px;stroke-linejoin:round;">${areaM2} m² (${areaM2} sq m | ${areaSqFt} sq ft)</text>`,
        !isCompact ? `  <text x="${sCenter.x.toFixed(1)}" y="${(sCenter.y + 16).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="7.5" font-weight="500" fill="#0284c7" style="paint-order:stroke fill;stroke:#ffffff;stroke-width:2px;stroke-linejoin:round;">${dimLabel} (${mmToFeetInches(bbox.width)} × ${mmToFeetInches(bbox.height)})</text>` : '',
        `</g>`,
      );
    }
  }

  if (elements.length === 0) return '';
  return `<g class="layer-site-zones" data-layer="${RenderLayer.SiteZones}">\n${elements.join('\n')}\n</g>`;
}

function renderFloorBoundary(floor: Floor, transform: ViewTransform): string {
  if (floor.boundary.points.length < 3) return '';
  const points = polygonToSvgPoints(floor.boundary, transform);

  return `<g class="layer-floor" data-layer="${RenderLayer.Floor}">
  <polygon points="${points}" fill="#ffffff" stroke="#333" stroke-width="0.5"/>
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
  withFurniture = false,
): string {
  const elements: string[] = [];

  for (const room of floor.rooms) {
    const color = ROOM_COLORS[room.type] ?? '#F5F5F5';
    const points = polygonToSvgPoints(room.boundary, transform);

    // Room fill
    if (!labelsOnly) elements.push(
      `<polygon points="${points}" fill="${color}" fill-opacity="0.35" stroke="none" data-entity-type="room" data-entity-id="${room.id}"/>`,
    );
    const hatch = room.type === RoomType.Bathroom ? 'wet-hatch'
      : room.type === RoomType.ServiceShaft ? 'outdoor-hatch'
      : [RoomType.Balcony, RoomType.Terrace, RoomType.Utility].includes(room.type) ? 'outdoor-hatch' : 'tile-hatch';
    if (!labelsOnly && ![RoomType.Staircase, RoomType.Lift].includes(room.type)) elements.push(`<polygon points="${points}" fill="url(#${hatch})" pointer-events="none"/>`);

    const isStair = room.type === RoomType.Staircase || /stair/i.test(room.name);
    const isLift = room.type === RoomType.Lift || /lift/i.test(room.name);
    if (!labelsOnly && isStair) {
      const rTopLeft = worldToScreen({ x: room.x, y: room.y }, transform);
      const rw = scaleToScreen(room.width, transform);
      const rh = scaleToScreen(room.height, transform);
      const isVertical = room.height >= room.width;
      if (isVertical) {
        const wellW = Math.max(3, scaleToScreen(150, transform));
        const flightW = (rw - wellW) / 2;
        const landingH = Math.min(scaleToScreen(1200, transform), rh * 0.35);
        const flightL = rh - landingH;
        const treadCount = Math.max(8, Math.min(12, Math.floor(room.height / 250)));
        const stepY = flightL / treadCount;
        for (let i = 1; i < treadCount; i++) {
          const ty = rTopLeft.y + i * stepY;
          elements.push(
            `<line x1="${rTopLeft.x.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(rTopLeft.x + flightW).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#94a3b8" stroke-width="0.6"/>`,
            `<line x1="${(rTopLeft.x + flightW + wellW).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(rTopLeft.x + rw).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#94a3b8" stroke-width="0.6"/>`,
          );
        }
        elements.push(
          `<rect x="${(rTopLeft.x + flightW).toFixed(1)}" y="${rTopLeft.y.toFixed(1)}" width="${wellW.toFixed(1)}" height="${flightL.toFixed(1)}" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.5"/>`,
          `<line x1="${rTopLeft.x.toFixed(1)}" y1="${(rTopLeft.y + flightL).toFixed(1)}" x2="${(rTopLeft.x + rw).toFixed(1)}" y2="${(rTopLeft.y + flightL).toFixed(1)}" stroke="#94a3b8" stroke-width="0.75"/>`,
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

    // Room label with clean display name, adaptive font sizing, and collision prevention
    const sWidth = scaleToScreen(room.width, transform);
    const sHeight = scaleToScreen(room.height, transform);
    const showText = sWidth >= 28 && sHeight >= 16;
    const showAreaText = showAreas && sWidth >= 55 && sHeight >= 30;

    if (showText && (showLabels || showAreaText)) {
      const furniture = withFurniture ? furniturePlacement(room, floor) : undefined;
      const labelY = furniture
        ? (furniture.y > room.y + room.height / 2 ? room.y + 500 : room.y + room.height - 400)
        : room.y + room.height / 2;
      const cx = worldToScreen(
        { x: room.x + (room.type === RoomType.Staircase ? Math.min(500, room.width / 2) : room.width / 2), y: labelY },
        transform,
      );

      const displayName = cleanRoomDisplayName(room.name);
      const isNarrow = sWidth < 85;
      const words = displayName.split(/\s+/);
      const canSplit = isNarrow && words.length >= 2 && displayName.length > 8;

      let lines: string[];
      if (canSplit) {
        const mid = Math.ceil(words.length / 2);
        lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
      } else {
        lines = [displayName];
      }

      const longestLine = Math.max(...lines.map(l => l.length));
      const minRoomDimMm = Math.min(room.width, room.height);
      const minRoomDimScreen = scaleToScreen(minRoomDimMm, transform);
      const maxFontByMinDim = Math.max(5.5, minRoomDimScreen * 0.12);
      const maxFontForWidth = Math.max(5.5, (sWidth * 0.78) / Math.max(1, longestLine * 0.58));
      const maxFontForHeight = Math.max(5.5, (sHeight * 0.60) / (lines.length + (showAreaText ? 1.5 : 0)));
      const baseFontSize = scaleToScreen(330, transform);
      const fontSize = Math.max(5.5, Math.min(12.5, baseFontSize, maxFontForWidth, maxFontForHeight, maxFontByMinDim));
      const areaFontSize = Math.max(5.0, fontSize - 1.8);
      const lineHeight = fontSize * 1.15;
      const haloWidth = Math.max(1.8, Math.min(3.6, fontSize * 0.28));

      const rotateLabel = [RoomType.Corridor, RoomType.Staircase].includes(room.type) && room.height > room.width;
      elements.push(`<g${rotateLabel ? ` transform="rotate(-90 ${cx.x} ${cx.y})"` : ''} data-room-name="${escapeXml(room.name)}" pointer-events="none">`);

      const areaM2 = sqMmToSqM(room.area);
      const areaSqFt = Math.round((room.area / 1_000_000) * 10.7639);
      const dimText = `${Math.round(room.width)} × ${Math.round(room.height)} mm | ${mmToFeetInches(room.width)} × ${mmToFeetInches(room.height)}`;
      const showDims = sWidth >= 75 && sHeight >= 45;

      if (showLabels) {
        const extraLines = (showAreaText ? 1 : 0) + (showDims ? 1 : 0);
        const totalTextHeight = lines.length * lineHeight + extraLines * areaFontSize * 1.2;
        const startY = cx.y - totalTextHeight / 2 + fontSize * 0.8;

        const maxChars = Math.max(...lines.map(l => l.length), showDims ? Math.floor(dimText.length * 0.75) : 0, showAreaText ? 20 : 0);
        const pillW = Math.min(sWidth - 4, Math.max(48, maxChars * fontSize * 0.62 + 14));
        const pillH = totalTextHeight + 8;
        const pillX = cx.x - pillW / 2;
        const pillY = startY - fontSize * 0.8 - 4;

        elements.push(
          `  <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="4" fill="#ffffff" fill-opacity="0.88" stroke="#cbd5e1" stroke-width="0.5"/>`,
        );

        lines.forEach((line, lineIdx) => {
          const lineY = startY + lineIdx * lineHeight;
          elements.push(
            `<text x="${cx.x.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${fontSize.toFixed(1)}" fill="#0f172a" font-weight="700" letter-spacing="0.02em" style="text-transform:uppercase;paint-order:stroke fill;stroke:#ffffff;stroke-width:${haloWidth.toFixed(1)}px;stroke-linejoin:round;stroke-linecap:round">${escapeXml(line)}</text>`,
          );
        });

        let currentY = startY + lines.length * lineHeight;
        if (showDims) {
          elements.push(
            `<text x="${cx.x.toFixed(1)}" y="${currentY.toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${(areaFontSize * 0.95).toFixed(1)}" fill="#0284c7" font-weight="600" style="paint-order:stroke fill;stroke:#ffffff;stroke-width:${Math.max(1.5, haloWidth - 0.5).toFixed(1)}px;stroke-linejoin:round;stroke-linecap:round">${dimText}</text>`,
          );
          currentY += areaFontSize * 1.15;
        }

        if (showAreaText) {
          elements.push(
            `<text x="${cx.x.toFixed(1)}" y="${currentY.toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${areaFontSize.toFixed(1)}" fill="#475569" font-weight="500" style="paint-order:stroke fill;stroke:#ffffff;stroke-width:${Math.max(1.5, haloWidth - 0.5).toFixed(1)}px;stroke-linejoin:round;stroke-linecap:round">${areaM2} sq m (${areaM2} m² | ${areaSqFt} sq ft)</text>`,
          );
        }
      } else if (showAreaText) {
        const pillW = Math.min(sWidth - 4, 110);
        const pillH = areaFontSize * 1.5 + 6;
        elements.push(
          `  <rect x="${(cx.x - pillW / 2).toFixed(1)}" y="${(cx.y - pillH / 2).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" fill="#ffffff" fill-opacity="0.88" stroke="#cbd5e1" stroke-width="0.5"/>`,
          `  <text x="${cx.x.toFixed(1)}" y="${(cx.y + areaFontSize * 0.35).toFixed(1)}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${areaFontSize.toFixed(1)}" fill="#475569" font-weight="500" style="paint-order:stroke fill;stroke:#ffffff;stroke-width:2px;stroke-linejoin:round;stroke-linecap:round">${areaM2} sq m (${areaM2} m² | ${areaSqFt} sq ft)</text>`,
        );
      }
      elements.push('</g>');
    }
  }

  return `<g class="layer-rooms" data-layer="${RenderLayer.Rooms}">\n${elements.join('\n')}\n</g>`;
}

function renderWalls(floor: Floor, transform: ViewTransform): string {
  const elements: string[] = [];

  for (const wall of floor.walls) {
    const start = worldToScreen(wall.startPoint, transform);
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

    const isStair =
      /stair/i.test(door.id || '') ||
      (door.connectsRooms || []).some(rid => {
        const rm = floor.rooms.find(r => r.id === rid);
        return rm && (rm.type === RoomType.Staircase || /stair/i.test(rm.name || ''));
      });
    const isLift =
      /lift|elevator/i.test(door.id || '') ||
      (door.connectsRooms || []).some(rid => {
        const rm = floor.rooms.find(r => r.id === rid);
        return rm && (rm.type === RoomType.Lift || /lift/i.test(rm.name || ''));
      });

    if (door.type === DoorType.OpenPassage || isStair) {
      elements.push(
        `<g data-entity-type="door" data-entity-id="${door.id}" data-door-type="open_passage" transform="${tr}">
  <title>Open passage - no door leaf</title>
  <line x1="${(-halfW).toFixed(1)}" y1="0" x2="${halfW.toFixed(1)}" y2="0" stroke="#94a3b8" stroke-width="0.75" stroke-dasharray="3,3"/>
</g>`,
      );
    } else if (door.type === DoorType.Sliding || isLift) {
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

function renderWindows(floor: Floor, transform: ViewTransform): string {
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

  for (const stair of floor.stairs) {
    const solids = computeStairSolids(stair, 3000);
    const diagram = `${stair.type.toLowerCase().replace(/_/g, '-')}-${stair.direction.toLowerCase()}`;
    const topLeft = worldToScreen({ x: stair.x, y: stair.y }, transform);
    const w = scaleToScreen(stair.width, transform);
    const h = scaleToScreen(stair.length, transform);

    elements.push(`<g data-entity-type="stair" data-entity-id="${stair.id}" data-stair-diagram="${diagram}">`);
    elements.push(`  <rect x="${topLeft.x.toFixed(1)}" y="${topLeft.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f0ebe5" stroke="#999" stroke-width="0.8"/>`);

    if (solids.solids.length > 0) {
      for (const solid of solids.solids) {
        const poly = polygonToSvgPoints(solid.boundary, transform);
        elements.push(`  <polygon points="${poly}" fill="${solid.kind === 'landing' ? '#e2d9cf' : '#f5f0eb'}" stroke="#a89f91" stroke-width="0.5"/>`);
      }
    } else {
      const treadCount = Math.min(stair.riserCount, 20);
      const treadH = h / treadCount;
      for (let i = 1; i < treadCount; i++) {
        const y = topLeft.y + i * treadH;
        elements.push(`  <line x1="${topLeft.x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(topLeft.x + w).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#999" stroke-width="0.5"/>`);
      }
    }

    // Direction arrow / route
    const arrowX = topLeft.x + w / 2;
    const arrowY1 = topLeft.y + h * 0.8;
    const arrowY2 = topLeft.y + h * 0.2;
    elements.push(`  <line class="stair-up-route" x1="${arrowX.toFixed(1)}" y1="${arrowY1.toFixed(1)}" x2="${arrowX.toFixed(1)}" y2="${arrowY2.toFixed(1)}" stroke="#666" stroke-width="1.5" marker-end="url(#arrow)"/>`);
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

  // Room dimensions
  for (const room of floor.rooms) {
    const sWidth = scaleToScreen(room.width, transform);
    const sHeight = scaleToScreen(room.height, transform);
    if (sWidth < 45 || sHeight < 32) continue;

    const roomTopLeft = worldToScreen({ x: room.x, y: room.y + room.height }, transform);
    const roomTopRight = worldToScreen({ x: room.x + room.width, y: room.y + room.height }, transform);

    const fontSize = Math.max(6, Math.min(9, scaleToScreen(250, transform)));
    const midX = (roomTopLeft.x + roomTopRight.x) / 2;
    const dimY = roomTopLeft.y + 12;

    elements.push(
      `<text x="${midX.toFixed(1)}" y="${dimY.toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize.toFixed(1)}" fill="#0066cc">${mmToFtDisplay(room.width)}' × ${mmToFtDisplay(room.height)}'</text>`,
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
    return renderReferenceFurniture(floor, transform);
  }

  const elements: string[] = [];

  for (const item of items) {
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
      `<g class="cad-furniture-item" data-entity-type="furniture" data-furniture-id="${escapeXml(item.id)}" data-furniture-type="${escapeXml(item.type)}" transform="${tr}" opacity="0.85" pointer-events="none">` +
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
  const resolved = resolveConfig(config);
  const layers = [
    resolved.layers[RenderLayer.Grid] && resolved.showGrid
      ? renderGrid(viewportWidth, viewportHeight, transform, resolved.gridSpacing) : '',
    resolved.layers[RenderLayer.Plot] ? renderPlotBoundary(building, transform) : '',
    resolved.layers[RenderLayer.SiteZones] ? renderSiteZones(building, transform) : '',
    resolved.layers[RenderLayer.Floor] ? renderFloorBoundary(floor, transform) : '',
    // 1. Site Zones & Room Fills
    resolved.layers[RenderLayer.Rooms]
      ? renderRooms(floor, transform, false, false) : '',
    // 2. A-FURN Furniture Layer
    resolved.layers[RenderLayer.Furniture] ? renderPlancraftFurniture(floor, transform) : '',
    // 3. Wall Polygons (230/150/115/100mm) & Structural Columns
    resolved.layers[RenderLayer.Walls] ? renderWalls(floor, transform) : '',
    resolved.layers[RenderLayer.Columns] ? renderColumns(floor, transform) : '',
    // 4. Doors & 90° Swing Arcs + Windows + Stairs
    resolved.layers[RenderLayer.Openings] ? renderDoors(floor, transform) : '',
    resolved.layers[RenderLayer.Openings] ? renderWindows(floor, transform) : '',
    resolved.layers[RenderLayer.Stairs] ? renderStairs(floor, transform) : '',
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewportWidth} ${viewportHeight}" class="floor-plan" width="${viewportWidth}" height="${viewportHeight}">
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
</svg>`;
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
