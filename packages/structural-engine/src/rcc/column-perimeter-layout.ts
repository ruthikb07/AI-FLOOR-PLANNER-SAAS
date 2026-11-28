export interface ExplicitBarCoordinateMm {
  readonly barIndex: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly diaMm: number;
  readonly areaMm2: number;
  readonly locationRole: 'CORNER' | 'TOP_FACE' | 'BOTTOM_FACE' | 'LEFT_FACE' | 'RIGHT_FACE';
}

export interface ColumnPerimeterBarLayout {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearCoverMm: number;
  readonly tieDiaMm: number;
  readonly barDiaMm: number;
  /** Unique physical bar count around the perimeter (corners counted ONCE!). */
  readonly uniqueBarCount: number;
  readonly cornerBarCount: 4;
  /** Total bars along each horizontal width face (`x` in `[0, widthMm]`), INCLUDING the 2 corners on that face. */
  readonly barsPerWidthFaceIncludingCorners: number;
  /** Intermediate (non-corner) bars on each horizontal width face. */
  readonly intermediateBarsPerWidthFace: number;
  /** Total bars along each vertical depth face (`y` in `[0, depthMm]`), INCLUDING the 2 corners on that face. */
  readonly barsPerDepthFaceIncludingCorners: number;
  /** Intermediate (non-corner) bars on each vertical depth face. */
  readonly intermediateBarsPerDepthFace: number;
  readonly totalSteelAreaMm2: number;
  readonly minClearSpacingMm: number;
  readonly maxCenterPitchMm: number;
  readonly maxUnrestrainedSpacingMm: number;
  readonly spacingCompliantIS456: boolean;
  readonly bars: readonly ExplicitBarCoordinateMm[];
}

/**
 * Generates exact 2D `(xMm, yMm)` bar coordinates on `[0, widthMm] x [0, depthMm]` matching
 * RH Planner's symmetric perimeter optimization, with zero corner double-counting!
 * Note:
 * - `x` runs across `widthMm` (`b`)
 * - `y` runs across `depthMm` (`D`)
 * - Bending `Mux` (about horizontal X-axis) varies `y` across `depthMm` (`D`)
 * - Bending `Muy` (about vertical Y-axis) varies `x` across `widthMm` (`b`)
 */
export function buildColumnPerimeterBarCoordinates(params: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearCoverMm?: number;
  readonly tieDiaMm?: number;
  readonly barDiaMm: number;
  readonly totalBarCount: number;
}): ColumnPerimeterBarLayout {
  const b = params.widthMm;
  const d = params.depthMm;
  const clearCover = params.clearCoverMm ?? 40;
  const tieDia = params.tieDiaMm ?? (params.barDiaMm > 24 ? 10 : 8);
  const dia = params.barDiaMm;
  const count = Math.max(4, Math.floor(params.totalBarCount / 2) * 2); // symmetric even count >= 4
  const areaOne = (Math.PI * dia * dia) / 4;

  const centerOffset = clearCover + tieDia + dia / 2;
  const innerB = Math.max(20, b - 2 * centerOffset);
  const innerD = Math.max(20, d - 2 * centerOffset);

  const extraPairs = Math.max(0, Math.floor((count - 4) / 2));
  let interDepth = 0;
  let smallestPitch = Infinity;
  for (let n = 0; n <= extraPairs; n++) {
    const pitch = Math.max(innerB / (extraPairs - n + 1), innerD / (n + 1));
    if (pitch < smallestPitch || (pitch === smallestPitch && d > b)) {
      smallestPitch = pitch;
      interDepth = n;
    }
  }
  const interWidth = extraPairs - interDepth;

  const xLeft = centerOffset;
  const xRight = b - centerOffset;
  const yBot = centerOffset;
  const yTop = d - centerOffset;

  const bars: ExplicitBarCoordinateMm[] = [
    { barIndex: 0, xMm: Number(xLeft.toFixed(2)), yMm: Number(yBot.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 1, xMm: Number(xRight.toFixed(2)), yMm: Number(yBot.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 2, xMm: Number(xRight.toFixed(2)), yMm: Number(yTop.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
    { barIndex: 3, xMm: Number(xLeft.toFixed(2)), yMm: Number(yTop.toFixed(2)), diaMm: dia, areaMm2: areaOne, locationRole: 'CORNER' },
  ];

  for (let i = 1; i <= interWidth; i++) {
    const x = xLeft + (innerB * i) / (interWidth + 1);
    bars.push({
      barIndex: bars.length,
      xMm: Number(x.toFixed(2)),
      yMm: Number(yBot.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'BOTTOM_FACE',
    });
    bars.push({
      barIndex: bars.length,
      xMm: Number(x.toFixed(2)),
      yMm: Number(yTop.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'TOP_FACE',
    });
  }

  for (let j = 1; j <= interDepth; j++) {
    const y = yBot + (innerD * j) / (interDepth + 1);
    bars.push({
      barIndex: bars.length,
      xMm: Number(xLeft.toFixed(2)),
      yMm: Number(y.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'LEFT_FACE',
    });
    bars.push({
      barIndex: bars.length,
      xMm: Number(xRight.toFixed(2)),
      yMm: Number(y.toFixed(2)),
      diaMm: dia,
      areaMm2: areaOne,
      locationRole: 'RIGHT_FACE',
    });
  }

  const pitchWidth = innerB / (interWidth + 1);
  const pitchDepth = innerD / (interDepth + 1);
  const minPitch = Math.min(pitchWidth, pitchDepth);
  const maxPitch = Math.max(pitchWidth, pitchDepth);
  const minClear = minPitch - dia;
  // IS 456 Cl. 26.5.3.1(g): max c/c spacing along perimeter <= 300 mm; min clear spacing >= max(dia, 40mm aggregate+5 or 35mm)
  const spacingCompliant = count === params.totalBarCount && dia > 0 && b > 2 * centerOffset && d > 2 * centerOffset && minClear >= Math.max(dia, 35) && maxPitch <= 300;

  return {
    widthMm: b,
    depthMm: d,
    clearCoverMm: clearCover,
    tieDiaMm: tieDia,
    barDiaMm: dia,
    uniqueBarCount: bars.length,
    cornerBarCount: 4,
    barsPerWidthFaceIncludingCorners: interWidth + 2,
    intermediateBarsPerWidthFace: interWidth,
    barsPerDepthFaceIncludingCorners: interDepth + 2,
    intermediateBarsPerDepthFace: interDepth,
    totalSteelAreaMm2: Number((bars.length * areaOne).toFixed(2)),
    minClearSpacingMm: Number(minClear.toFixed(2)),
    maxCenterPitchMm: Number(maxPitch.toFixed(2)),
    maxUnrestrainedSpacingMm: Number(maxPitch.toFixed(2)),
    spacingCompliantIS456: spacingCompliant,
    bars,
  };
}

/** One proposed straight cross-tie between each opposing pair of intermediate bars. */
export function columnCrossTiePairs(layout:ColumnPerimeterBarLayout) {
  const pairs:{axis:"WIDTH"|"DEPTH";firstBarIndex:number;secondBarIndex:number;straightMm:number}[]=[];
  for(const bar of layout.bars){
    const acrossWidth=bar.locationRole==="LEFT_FACE";
    if(!acrossWidth && bar.locationRole!=="BOTTOM_FACE") continue;
    const opposite=layout.bars.find(other=>acrossWidth
      ? other.locationRole==="RIGHT_FACE" && other.yMm===bar.yMm
      : other.locationRole==="TOP_FACE" && other.xMm===bar.xMm);
    if(!opposite) throw new Error("Unpaired intermediate column bar in symmetric cage");
    pairs.push({axis:acrossWidth?"WIDTH":"DEPTH",firstBarIndex:bar.barIndex,secondBarIndex:opposite.barIndex,
      straightMm:(acrossWidth?layout.widthMm:layout.depthMm)-2*layout.clearCoverMm-layout.tieDiaMm});
  }
  return pairs;
}
