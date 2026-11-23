import { useId, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { WizardState } from '../../stores/useStudioStore';

type SiteInputs = Pick<WizardState, 'plotWidthM' | 'plotDepthM' | 'roadFacing' | 'roadWidthM' |
  'frontSetbackM' | 'rearSetbackM' | 'sideSetbackM' | 'floorsCount' | 'flatsPerFloor' | 'projectType' | 'redevelopment'>;
type Point3 = readonly [number, number, number];

export function ParcelStudy({ draft, mode, activeLevels = [], interactive = true }: {
  draft: SiteInputs;
  mode: 'site' | 'massing' | 'existing';
  activeLevels?: readonly number[];
  interactive?: boolean;
}) {
  const [angle, setAngle] = useState(-Math.PI / 5);
  const gridId = useId();
  const width = Math.max(1, draft.plotWidthM || 0);
  const depth = Math.max(1, draft.plotDepthM || 0);
  const side = Math.max(0, draft.sideSetbackM || 0);
  const front = Math.max(0, draft.frontSetbackM || 0);
  const rear = Math.max(0, draft.rearSetbackM || 0);
  const road = Math.max(0, draft.roadWidthM || 0);
  const floors = mode === 'site' ? 0 : Math.min(70, Math.max(0, Math.floor(
    mode === 'existing' ? draft.redevelopment?.existingStoreys ?? 0 : draft.floorsCount || 0)));
  const length = Math.max(1, width + depth + road, floors * 5.3);
  const scale = 425 / length;
  const eastWest = draft.roadFacing === 'East' || draft.roadFacing === 'West';
  const low = draft.roadFacing === 'West' || draft.roadFacing === 'North';
  const footprint = [
    eastWest ? low ? front : rear : side,
    eastWest ? side : low ? front : rear,
    width - (eastWest ? low ? rear : front : side),
    depth - (eastWest ? side : low ? rear : front),
  ] as const;
  const roadRect = eastWest ? (low ? [-road, 0, 0, depth] : [width, 0, width + road, depth])
    : (low ? [0, -road, width, 0] : [0, depth, width, depth + road]);

  function project([x, y, z]: Point3): readonly [number, number] {
    const u = x - width / 2;
    const v = z - depth / 2;
    return [300 + (Math.cos(angle) * u - Math.sin(angle) * v) * scale,
      252 + ((Math.sin(angle) * u + Math.cos(angle) * v) * .49 - y) * scale];
  }
  function polygon(points: Point3[]) {
    return points.map(point => project(point).map(value => value.toFixed(2)).join(',')).join(' ');
  }
  function plane(a: number, b: number, c: number, d: number, y = 0) {
    return polygon([[a,y,b],[c,y,b],[c,y,d],[a,y,d]]);
  }
  const [a,b,c,d] = footprint;
  const hasEnvelope = a < c && b < d;
  const visibleX = Math.sin(angle) >= 0 ? c : a;
  const visibleZ = Math.cos(angle) >= 0 ? d : b;
  const [labelX, labelY] = project([width / 2, 0, depth + Math.min(road * .37, 3) + 1.5]);
  const [roadX, roadY] = project([(roadRect[0]! + roadRect[2]!) / 2, 0, (roadRect[1]! + roadRect[3]!) / 2]);
  return <figure className="rh-parcel" aria-label="Live plot diagram" data-testid="parcel-study">
    <svg viewBox="0 0 600 405" role="img" aria-label={`Schematic ${width} by ${depth} metre site, ${draft.roadFacing} road, ${floors} storeys shown`}>
      <defs><pattern id={gridId} width="26" height="26" patternUnits="userSpaceOnUse"><path d="M 26 0 H 0 V 26" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs>
      <rect x="0" y="0" width="600" height="405" fill={`url(#${gridId})`} />
      <polygon points={plane(roadRect[0]!,roadRect[1]!,roadRect[2]!,roadRect[3]!)} fill="#7a8b87" fillOpacity=".52" />
      <polygon points={plane(0,0,width,depth)} fill="#d6e9e4" fillOpacity=".15" stroke="#dceae4" strokeWidth="2" />
      {hasEnvelope && <polygon points={plane(a,b,c,d)} fill="#b1e0d0" fillOpacity=".10" stroke="#94cfbd" strokeDasharray="5 4" />}
      {hasEnvelope && Array.from({ length: floors }, (_, index) => {
        const y = index * 3.15 + 2.7;
        const base = index * 3.15;
        const marked = activeLevels.includes(index + 1);
        return <g key={index} className="rh-parcel-storey" data-marked={marked}>
          <polygon points={polygon([[a,base,visibleZ],[c,base,visibleZ],[c,y,visibleZ],[a,y,visibleZ]])} fill={marked ? '#dcb381' : '#42645e'} stroke="#c2d6ca" strokeWidth=".65" />
          <polygon points={polygon([[visibleX,base,d],[visibleX,base,b],[visibleX,y,b],[visibleX,y,d]])} fill={marked ? '#ac8154' : '#2e4b46'} stroke="#c2d6ca" strokeWidth=".65" />
          <polygon points={plane(a,b,c,d,y)} fill={marked ? '#f3d4a7' : '#93b6a9'} stroke="#d9ede1" strokeWidth=".8" />
        </g>;
      })}
      {road > 0 && <text x={roadX} y={roadY} textAnchor="middle">{draft.roadFacing} road · {draft.roadWidthM} m</text>}
      <text x={labelX} y={labelY + 24} textAnchor="middle">{draft.plotWidthM} × {draft.plotDepthM} m</text>
    </svg>
    <figcaption>
      <span>{mode === 'site' ? 'Plot and setback envelope' : mode === 'existing' ? 'Existing massing study' : 'Proposed massing study'}{floors > 0 && ` · ${floors} levels`}</span>
      {interactive && <div>
        <button type="button" aria-label="Rotate plot left" onClick={() => setAngle(current => current - Math.PI / 9)}><RotateCcw size={16} /></button>
        <button type="button" aria-label="Rotate plot right" onClick={() => setAngle(current => current + Math.PI / 9)}><RotateCw size={16} /></button>
      </div>}
    </figcaption>
  </figure>;
}
