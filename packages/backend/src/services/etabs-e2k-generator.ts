/**
 * Pure TypeScript CSI ETABS (.e2k) Model Generator.
 *
 * Emits an ASCII `.e2k` text model scaled in meters (kN, m, C) for direct
 * File -> Import -> ETABS .e2k Text File inside CSI ETABS 18–22 without
 * requiring a live Windows COM session during export.
 */

import type { Building, Floor, StructuralProject } from '@ai-floor-planner/core';

function toMeters(mm: number): number {
  return Number((mm * 0.001).toFixed(4));
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function safeId(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return cleaned.length > 0 ? cleaned : fallback;
}

interface DerivedPoint {
  readonly id: string;
  readonly xM: number;
  readonly yM: number;
}

interface DerivedBeam {
  readonly id: string;
  readonly p1: string;
  readonly p2: string;
  readonly section: string;
}

interface DerivedColumn {
  readonly id: string;
  readonly p: string;
  readonly section: string;
}

interface DerivedFloorFrame {
  readonly storyName: string;
  readonly elevationM: number;
  readonly heightM: number;
  readonly points: readonly DerivedPoint[];
  readonly columns: readonly DerivedColumn[];
  readonly beams: readonly DerivedBeam[];
  readonly slabBoundaryPointIds: readonly string[];
}

function extractFloorBoundsM(floor: Floor, building: Building): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const pts: ReadonlyArray<{ readonly x: number; readonly y: number }> = floor.boundary?.points?.length
    ? floor.boundary.points
    : building.site.plotBoundary?.points?.length
      ? building.site.plotBoundary.points
      : [
          { x: 0, y: 0 },
          { x: building.site.plotWidth || 20_000, y: 0 },
          { x: building.site.plotWidth || 20_000, y: building.site.plotDepth || 20_000 },
          { x: 0, y: building.site.plotDepth || 20_000 },
        ];
  const xs = pts.map((p) => toMeters(p.x));
  const ys = pts.map((p) => toMeters(p.y));
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function buildFloorFrames(building: Building): {
  frames: DerivedFloorFrame[];
  xGrids: number[];
  yGrids: number[];
  sections: Set<string>;
} {
  const sortedFloors = [...building.floors].sort((a, b) => a.level - b.level);
  const sections = new Set<string>(['COL300X600', 'COL450X450', 'BEAM230X450']);
  const xGridSet = new Set<number>();
  const yGridSet = new Set<number>();
  const frames: DerivedFloorFrame[] = [];

  let runningElevM = 0;
  for (let fIdx = 0; fIdx < sortedFloors.length; fIdx++) {
    const floor = sortedFloors[fIdx]!;
    const heightM = toMeters(floor.floorHeight || 3000);
    runningElevM = Number((runningElevM + heightM).toFixed(4));
    const storyName = safeId(floor.name || `STORY_${fIdx + 1}`, `STORY_${fIdx + 1}`);
    const bounds = extractFloorBoundsM(floor, building);

    const pointByCoord = new Map<string, DerivedPoint>();
    const ensurePoint = (xM: number, yM: number): string => {
      const rx = Number(xM.toFixed(3));
      const ry = Number(yM.toFixed(3));
      const key = `${rx}:${ry}`;
      const existing = pointByCoord.get(key);
      if (existing) return existing.id;
      const id = `P_${fIdx + 1}_${pointByCoord.size + 1}`;
      pointByCoord.set(key, { id, xM: rx, yM: ry });
      xGridSet.add(rx);
      yGridSet.add(ry);
      return id;
    };

    const columns: DerivedColumn[] = [];
    const beams: DerivedBeam[] = [];

    if (floor.columns && floor.columns.length > 0) {
      floor.columns.forEach((col, cIdx) => {
        const p = ensurePoint(toMeters(col.position.x), toMeters(col.position.y));
        const sec = `COL${Math.round(col.width || 300)}X${Math.round(col.depth || 600)}`;
        sections.add(sec);
        columns.push({ id: `C_${fIdx + 1}_${cIdx + 1}`, p, section: sec });
      });
    } else {
      // Auto-derive corner + intermediate perimeter grid points when structural columns were deferred
      const xSpan = Math.max(4, bounds.maxX - bounds.minX);
      const ySpan = Math.max(4, bounds.maxY - bounds.minY);
      const nx = Math.max(2, Math.min(6, Math.round(xSpan / 4.5) + 1));
      const ny = Math.max(2, Math.min(6, Math.round(ySpan / 4.5) + 1));
      const xs = Array.from({ length: nx }, (_, i) => bounds.minX + (xSpan * i) / (nx - 1));
      const ys = Array.from({ length: ny }, (_, j) => bounds.minY + (ySpan * j) / (ny - 1));
      let colCount = 0;
      const gridIds: string[][] = [];
      for (let ix = 0; ix < xs.length; ix++) {
        gridIds[ix] = [];
        for (let iy = 0; iy < ys.length; iy++) {
          const pid = ensurePoint(xs[ix]!, ys[iy]!);
          gridIds[ix]![iy] = pid;
          colCount++;
          columns.push({ id: `C_${fIdx + 1}_${colCount}`, p: pid, section: 'COL450X450' });
        }
      }
      let beamCount = 0;
      for (let ix = 0; ix < xs.length; ix++) {
        for (let iy = 0; iy < ys.length; iy++) {
          if (ix + 1 < xs.length) {
            beamCount++;
            beams.push({
              id: `B_${fIdx + 1}_${beamCount}`,
              p1: gridIds[ix]![iy]!,
              p2: gridIds[ix + 1]![iy]!,
              section: 'BEAM230X450',
            });
          }
          if (iy + 1 < ys.length) {
            beamCount++;
            beams.push({
              id: `B_${fIdx + 1}_${beamCount}`,
              p1: gridIds[ix]![iy]!,
              p2: gridIds[ix]![iy + 1]!,
              section: 'BEAM230X450',
            });
          }
        }
      }
    }

    if (floor.beams && floor.beams.length > 0 && beams.length === 0) {
      floor.beams.forEach((beam, bIdx) => {
        const p1 = ensurePoint(toMeters(beam.startPoint.x), toMeters(beam.startPoint.y));
        const p2 = ensurePoint(toMeters(beam.endPoint.x), toMeters(beam.endPoint.y));
        const sec = `BEAM${Math.round(beam.widthMm || 230)}X${Math.round(beam.depthMm || 450)}`;
        sections.add(sec);
        if (p1 !== p2) {
          beams.push({ id: `B_${fIdx + 1}_${bIdx + 1}`, p1, p2, section: sec });
        }
      });
    }

    const s1 = ensurePoint(bounds.minX, bounds.minY);
    const s2 = ensurePoint(bounds.maxX, bounds.minY);
    const s3 = ensurePoint(bounds.maxX, bounds.maxY);
    const s4 = ensurePoint(bounds.minX, bounds.maxY);

    frames.push({
      storyName,
      elevationM: runningElevM,
      heightM,
      points: Array.from(pointByCoord.values()),
      columns,
      beams,
      slabBoundaryPointIds: [s1, s2, s3, s4],
    });
  }

  return {
    frames,
    xGrids: Array.from(xGridSet).sort((a, b) => a - b),
    yGrids: Array.from(yGridSet).sort((a, b) => a - b),
    sections,
  };
}

export function generateETABSE2KFromBuilding(building: Building): string {
  const { frames, xGrids, yGrids, sections } = buildFloorFrames(building);
  const lines: string[] = [];

  lines.push(`$ File exported by RH Planner / AI Floor Planner Studio`);
  lines.push(`$ Model: ${building.name || building.id} (rev ${building.version})`);
  lines.push('');
  lines.push('$ PROGRAM INFORMATION');
  lines.push('  PROGRAM  "ETABS"  VERSION "21.2.0"');
  lines.push('');
  lines.push('$ CONTROLS');
  lines.push('  UNITS  "KN"  "M"  "C"');
  lines.push('  TITLE1  "' + (building.name || 'RH Apartment Tower').replace(/"/g, "'") + '"');
  lines.push('');
  lines.push('$ STORIES - IN SEQUENCE FROM TOP');
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    lines.push(`  STORY "${f.storyName}"  HEIGHT ${fmt(f.heightM)}`);
  }
  lines.push('  STORY "BASE"  ELEV 0');
  lines.push('');
  lines.push('$ GRIDS');
  lines.push('  GRIDSYSTEM "G1"  TYPE "CARTESIAN"  BUBBLESIZE 1.2');
  xGrids.forEach((x, idx) => {
    lines.push(`  GRID "G1"  LABEL "X${idx + 1}"  DIR "X"  COORD ${fmt(x)}  VISIBLE "Yes"  BUBBLELOC "End"`);
  });
  yGrids.forEach((y, idx) => {
    lines.push(`  GRID "G1"  LABEL "Y${idx + 1}"  DIR "Y"  COORD ${fmt(y)}  VISIBLE "Yes"  BUBBLELOC "Start"`);
  });
  lines.push('');
  lines.push('$ MATERIAL PROPERTIES');
  lines.push('  MATERIAL  "M25"  TYPE "Concrete"  WEIGHTPERVOLUME 25  E 25000000  U 0.2  A 1E-05  FC 25000');
  lines.push('  MATERIAL  "M30"  TYPE "Concrete"  WEIGHTPERVOLUME 25  E 27386128  U 0.2  A 1E-05  FC 30000');
  lines.push('  MATERIAL  "FE500"  TYPE "Rebar"  WEIGHTPERVOLUME 78.5  E 200000000  FY 500000  FU 545000');
  lines.push('');
  lines.push('$ FRAME SECTIONS');
  for (const sec of sections) {
    const dims = sec.match(/(\d+)X(\d+)/i);
    const wM = dims ? Number(dims[1]) * 0.001 : 0.3;
    const dM = dims ? Number(dims[2]) * 0.001 : 0.45;
    lines.push(`  FRAMESECTION  "${sec}"  MATERIAL "M25"  SHAPE "Concrete Rectangular"  D ${fmt(dM)}  B ${fmt(wM)}`);
  }
  lines.push('');
  lines.push('$ SLAB PROPERTIES');
  lines.push('  SHELLPROP  "SLAB150"  PROPTYPE "Slab"  MATERIAL "M25"  MODELINGTYPE "ShellThin"  SLABTHICKNESS 0.15');
  lines.push('');
  lines.push('$ POINT COORDINATES');
  const seenPoints = new Set<string>();
  const bottomPoints = frames[0]?.points ?? [];
  for (const frame of frames) {
    for (const pt of frame.points) {
      if (!seenPoints.has(pt.id)) {
        seenPoints.add(pt.id);
        lines.push(`  POINT "${pt.id}"  ${fmt(pt.xM)} ${fmt(pt.yM)}`);
      }
    }
  }
  lines.push('');
  lines.push('$ LINE CONNECTIVITIES');
  for (const frame of frames) {
    for (const col of frame.columns) {
      lines.push(`  LINE  "${col.id}"  COLUMN  "${col.p}"  "${col.p}"  1`);
    }
    for (const beam of frame.beams) {
      lines.push(`  LINE  "${beam.id}"  BEAM  "${beam.p1}"  "${beam.p2}"  0`);
    }
  }
  lines.push('');
  lines.push('$ AREA CONNECTIVITIES');
  frames.forEach((frame, fIdx) => {
    const [p1, p2, p3, p4] = frame.slabBoundaryPointIds;
    lines.push(`  AREA  "SLAB_${fIdx + 1}"  FLOOR  4  "${p1}"  "${p2}"  "${p3}"  "${p4}"`);
  });
  lines.push('');
  lines.push('$ POINT ASSIGNS');
  for (const pt of bottomPoints) {
    lines.push(`  POINTASSIGN  "${pt.id}"  "BASE"  RESTRAINT "UX UY UZ RX RY RZ"`);
  }
  lines.push('');
  lines.push('$ LINE ASSIGNS');
  for (const frame of frames) {
    for (const col of frame.columns) {
      lines.push(`  LINEASSIGN  "${col.id}"  "${frame.storyName}"  SECTION "${col.section}"`);
    }
    for (const beam of frame.beams) {
      lines.push(`  LINEASSIGN  "${beam.id}"  "${frame.storyName}"  SECTION "${beam.section}"`);
    }
  }
  lines.push('');
  lines.push('$ AREA ASSIGNS');
  frames.forEach((frame, fIdx) => {
    lines.push(`  AREAASSIGN  "SLAB_${fIdx + 1}"  "${frame.storyName}"  SECTION "SLAB150"  OBJMESH "DEFAULT"`);
  });
  lines.push('');
  lines.push('$ LOAD PATTERNS');
  lines.push('  LOADPATTERN "DEAD"  TYPE "Dead"  SELFWEIGHT 1');
  lines.push('  LOADPATTERN "SIDL"  TYPE "Super Dead"  SELFWEIGHT 0');
  lines.push('  LOADPATTERN "LIVE"  TYPE "Live"  SELFWEIGHT 0');
  lines.push('  LOADPATTERN "EQX"   TYPE "Seismic"  SELFWEIGHT 0');
  lines.push('  LOADPATTERN "EQY"   TYPE "Seismic"  SELFWEIGHT 0');
  lines.push('');
  lines.push('$ LOAD CASES');
  lines.push('  LOADCASE "DEAD"  TYPE "Linear Static"  INITCOND "ZERO"  LOADPAT "DEAD"  SF 1');
  lines.push('  LOADCASE "SIDL"  TYPE "Linear Static"  INITCOND "ZERO"  LOADPAT "SIDL"  SF 1');
  lines.push('  LOADCASE "LIVE"  TYPE "Linear Static"  INITCOND "ZERO"  LOADPAT "LIVE"  SF 1');
  lines.push('');
  lines.push('$ LOAD COMBINATIONS');
  lines.push('  COMBO "IS456_1.5(DL+LL)"  TYPE "Linear Add"  LOAD "DEAD" SF 1.5  LOAD "SIDL" SF 1.5  LOAD "LIVE" SF 1.5');
  lines.push('  COMBO "IS456_1.2(DL+LL+EQX)"  TYPE "Linear Add"  LOAD "DEAD" SF 1.2  LOAD "SIDL" SF 1.2  LOAD "LIVE" SF 1.2  LOAD "EQX" SF 1.2');
  lines.push('  COMBO "IS456_1.2(DL+LL+EQY)"  TYPE "Linear Add"  LOAD "DEAD" SF 1.2  LOAD "SIDL" SF 1.2  LOAD "LIVE" SF 1.2  LOAD "EQY" SF 1.2');
  lines.push('');
  lines.push('$ END OF MODEL FILE');

  return `${lines.join('\n')}\n`;
}

export function generateETABSE2KFromStructuralProject(
  project: StructuralProject,
  buildingName = 'Structural Project',
): string {
  const lines: string[] = [];
  const levels = [...project.levels].sort((a, b) => a.elevationMm - b.elevationMm);
  const levelById = new Map(levels.map((lvl) => [lvl.id, lvl]));
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));

  lines.push(`$ File exported from RH Planner StructuralProject (${project.id})`);
  lines.push('');
  lines.push('$ PROGRAM INFORMATION');
  lines.push('  PROGRAM  "ETABS"  VERSION "21.2.0"');
  lines.push('');
  lines.push('$ CONTROLS');
  lines.push('  UNITS  "KN"  "M"  "C"');
  lines.push(`  TITLE1  "${buildingName.replace(/"/g, "'")}"`);
  lines.push('');
  lines.push('$ STORIES - IN SEQUENCE FROM TOP');
  if (levels.length > 0) {
    for (let i = levels.length - 1; i >= 0; i--) {
      const cur = levels[i]!;
      const prevElev = i > 0 ? levels[i - 1]!.elevationMm : 0;
      const hM = Math.max(0.5, toMeters(cur.elevationMm - prevElev));
      lines.push(`  STORY "${safeId(cur.name, cur.id)}"  HEIGHT ${fmt(hM)}`);
    }
  } else {
    lines.push('  STORY "STORY1"  HEIGHT 3');
  }
  lines.push('  STORY "BASE"  ELEV 0');
  lines.push('');
  lines.push('$ GRIDS');
  lines.push('  GRIDSYSTEM "G1"  TYPE "CARTESIAN"  BUBBLESIZE 1.2');
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const node of project.nodes) {
    xs.add(toMeters(node.xMm));
    ys.add(toMeters(node.yMm));
  }
  if (xs.size === 0) xs.add(0);
  if (ys.size === 0) ys.add(0);
  [...xs].sort((a, b) => a - b).forEach((x, i) => {
    lines.push(`  GRID "G1"  LABEL "X${i + 1}"  DIR "X"  COORD ${fmt(x)}  VISIBLE "Yes"`);
  });
  [...ys].sort((a, b) => a - b).forEach((y, i) => {
    lines.push(`  GRID "G1"  LABEL "Y${i + 1}"  DIR "Y"  COORD ${fmt(y)}  VISIBLE "Yes"`);
  });
  lines.push('');
  lines.push('$ MATERIAL PROPERTIES');
  lines.push('  MATERIAL  "M25"  TYPE "Concrete"  WEIGHTPERVOLUME 25  E 25000000  U 0.2  A 1E-05  FC 25000');
  lines.push('  MATERIAL  "FE500"  TYPE "Rebar"  WEIGHTPERVOLUME 78.5  E 200000000  FY 500000  FU 545000');
  lines.push('');
  lines.push('$ FRAME SECTIONS');
  const sectionMap = new Map<string, { wM: number; dM: number }>();
  for (const member of [...project.columns, ...project.beams]) {
    const wMm = Math.round(member.section.widthMm);
    const dMm = Math.round(member.section.depthMm);
    const secName = `SEC_${wMm}X${dMm}`;
    if (!sectionMap.has(secName)) {
      sectionMap.set(secName, { wM: toMeters(wMm), dM: toMeters(dMm) });
    }
  }
  if (sectionMap.size === 0) {
    sectionMap.set('COL_DEFAULT', { wM: 0.3, dM: 0.45 });
  }
  for (const [secName, dims] of sectionMap.entries()) {
    lines.push(`  FRAMESECTION  "${secName}"  MATERIAL "M25"  SHAPE "Concrete Rectangular"  D ${fmt(dims.dM)}  B ${fmt(dims.wM)}`);
  }
  lines.push('');
  lines.push('$ SLAB PROPERTIES');
  const slabThicknessMm = project.slabs[0]?.thicknessMm ?? 150;
  lines.push(`  SHELLPROP  "SLAB_DEFAULT"  PROPTYPE "Slab"  MATERIAL "M25"  MODELINGTYPE "ShellThin"  SLABTHICKNESS ${fmt(toMeters(slabThicknessMm))}`);
  lines.push('');
  lines.push('$ POINT COORDINATES');
  const coordKeyToPointId = new Map<string, string>();
  const nodeIdToPointId = new Map<string, string>();
  const baseRestraintAssigns: string[] = [];
  for (const node of project.nodes) {
    const xM = toMeters(node.xMm);
    const yM = toMeters(node.yMm);
    const key = `${xM.toFixed(3)}:${yM.toFixed(3)}`;
    let pid = coordKeyToPointId.get(key);
    if (!pid) {
      pid = `PT_${coordKeyToPointId.size + 1}`;
      coordKeyToPointId.set(key, pid);
      lines.push(`  POINT "${pid}"  ${fmt(xM)} ${fmt(yM)}`);
    }
    nodeIdToPointId.set(node.id, pid);
    const flags = ['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ']
      .filter((_, idx) => node.restraints[idx])
      .join(' ');
    if (flags) {
      const lvl = levelById.get(node.levelId);
      const story = lvl ? safeId(lvl.name, lvl.id) : 'BASE';
      baseRestraintAssigns.push(`  POINTASSIGN  "${pid}"  "${story}"  RESTRAINT "${flags}"`);
    }
  }

  const colLines: string[] = [];
  const colAssigns: string[] = [];
  project.columns.forEach((col, i) => {
    const pStart = nodeIdToPointId.get(col.startNodeId);
    const pEnd = nodeIdToPointId.get(col.endNodeId);
    const endNode = nodeById.get(col.endNodeId);
    if (!pStart || !pEnd) return;
    const id = safeId(col.id, `C_${i + 1}`);
    const sec = `SEC_${Math.round(col.section.widthMm)}X${Math.round(col.section.depthMm)}`;
    const storyLvl = endNode ? levelById.get(endNode.levelId) : levels[0];
    const story = storyLvl ? safeId(storyLvl.name, storyLvl.id) : 'STORY1';
    colLines.push(`  LINE  "${id}"  COLUMN  "${pStart}"  "${pEnd}"  1`);
    colAssigns.push(`  LINEASSIGN  "${id}"  "${story}"  SECTION "${sec}"`);
  });

  const beamLines: string[] = [];
  const beamAssigns: string[] = [];
  project.beams.forEach((b, i) => {
    const p1 = nodeIdToPointId.get(b.startNodeId);
    const p2 = nodeIdToPointId.get(b.endNodeId);
    const startNode = nodeById.get(b.startNodeId);
    if (!p1 || !p2 || p1 === p2) return;
    const id = safeId(b.id, `B_${i + 1}`);
    const sec = `SEC_${Math.round(b.section.widthMm)}X${Math.round(b.section.depthMm)}`;
    const storyLvl = startNode ? levelById.get(startNode.levelId) : levels[0];
    const story = storyLvl ? safeId(storyLvl.name, storyLvl.id) : 'STORY1';
    beamLines.push(`  LINE  "${id}"  BEAM  "${p1}"  "${p2}"  0`);
    beamAssigns.push(`  LINEASSIGN  "${id}"  "${story}"  SECTION "${sec}"`);
  });

  const slabLines: string[] = [];
  const slabAssigns: string[] = [];
  project.slabs.forEach((s, i) => {
    const pIds = s.boundaryNodeIds
      .map((nid) => nodeIdToPointId.get(nid))
      .filter((pid): pid is string => Boolean(pid));
    if (pIds.length < 3) return;
    const id = safeId(s.id, `S_${i + 1}`);
    const lvl = levelById.get(s.levelId);
    const story = lvl ? safeId(lvl.name, lvl.id) : 'STORY1';
    slabLines.push(`  AREA  "${id}"  FLOOR  ${pIds.length}  ${pIds.map((p) => `"${p}"`).join('  ')}`);
    slabAssigns.push(`  AREAASSIGN  "${id}"  "${story}"  SECTION "SLAB_DEFAULT"  OBJMESH "DEFAULT"`);
  });

  lines.push('');
  lines.push('$ LINE CONNECTIVITIES');
  lines.push(...colLines, ...beamLines);
  lines.push('');
  lines.push('$ AREA CONNECTIVITIES');
  lines.push(...slabLines);
  lines.push('');
  lines.push('$ POINT ASSIGNS');
  lines.push(...baseRestraintAssigns);
  lines.push('');
  lines.push('$ LINE ASSIGNS');
  lines.push(...colAssigns, ...beamAssigns);
  lines.push('');
  lines.push('$ AREA ASSIGNS');
  lines.push(...slabAssigns);
  lines.push('');
  lines.push('$ LOAD PATTERNS');
  lines.push('  LOADPATTERN "DEAD"  TYPE "Dead"  SELFWEIGHT 1');
  lines.push('  LOADPATTERN "LIVE"  TYPE "Live"  SELFWEIGHT 0');
  lines.push('  LOADPATTERN "EQX"   TYPE "Seismic"  SELFWEIGHT 0');
  lines.push('  LOADPATTERN "EQY"   TYPE "Seismic"  SELFWEIGHT 0');
  lines.push('');
  lines.push('$ LOAD CASES');
  lines.push('  LOADCASE "DEAD"  TYPE "Linear Static"  INITCOND "ZERO"  LOADPAT "DEAD"  SF 1');
  lines.push('  LOADCASE "LIVE"  TYPE "Linear Static"  INITCOND "ZERO"  LOADPAT "LIVE"  SF 1');
  lines.push('');
  lines.push('$ LOAD COMBINATIONS');
  lines.push('  COMBO "IS456_1.5(DL+LL)"  TYPE "Linear Add"  LOAD "DEAD" SF 1.5  LOAD "LIVE" SF 1.5');
  lines.push('');
  lines.push('$ END OF MODEL FILE');

  return `${lines.join('\n')}\n`;
}
