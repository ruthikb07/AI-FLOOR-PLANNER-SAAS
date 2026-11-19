import { lazy, Suspense, useId, useRef, useState, type PointerEvent } from 'react';
import { Box, Hand, Maximize2, Minus, PenLine, Plus, Redo2, Scan, Undo2 } from 'lucide-react';
import type { Point } from '@ai-floor-planner/core';
import { pointAlongSurveyEdge, polygonArea, polygonBoundingBox, type SurveyEdge } from '@ai-floor-planner/geometry-engine';
import { showMeasure, surveyLabel } from '../../../services/survey-draft';
import type { SurveyEditor } from './useSurveyEditor';

const SurveySitePreview = lazy(() => import('./SurveySitePreview'));
const W = 600;
const H = 440;
const TAU = 2 * Math.PI;
const fmt = (p: Point) => `${p.x} ${p.y}`;

function tangent(edge: SurveyEdge, atEnd: boolean) {
  if (!edge.arc) return (edge.bearingDeg - 90) * Math.PI / 180;
  return edge.arc.startRad + (atEnd ? edge.arc.sweepRad : 0) + Math.sign(edge.arc.sweepRad) * Math.PI / 2;
}

function arcPath(start: Point, end: Point, radius: number, sweep: number) {
  return `M ${fmt(start)} A ${radius} ${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${fmt(end)}`;
}

export function SurveyDrawing({ survey, interactive, roadWidthM }: { survey: SurveyEditor; interactive: boolean; roadWidthM: number }) {
  const { draft, boundary, envelope, selected, width, depth } = survey;
  const { metrics, points, edges, issues, closingPoint } = boundary;
  const gridId = useId();
  const lampId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const lamp = useRef<SVGRadialGradientElement>(null);
  const [view, setView] = useState<'plan' | 'site'>('plan');
  const [tool, setTool] = useState<'select' | 'draw' | 'pan'>('select');
  const coordinateEditing = interactive && draft.mode === 'coordinates';
  const activeTool = tool === 'draw' && !coordinateEditing ? 'select' : tool;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const visiblePoints = closingPoint ? [...points, closingPoint] : points;
  const usePresetBounds = visiblePoints.length < 2 || activeTool === 'draw';
  const dynamicBounds = metrics?.bounds ?? polygonBoundingBox({ points: visiblePoints });
  const bounds = usePresetBounds ? { x: 0, y: 0, width, height: depth } : dynamicBounds;
  const gesture = useRef<{ index?: number; start: Point; origin: Point; fit: typeof bounds } | null>(null);
  const [frozenBounds, setFrozenBounds] = useState<typeof bounds>();
  const fit = frozenBounds ?? bounds;
  const ratio = zoom * Math.min((W - 134) / Math.max(1, fit.width), (H - 140) / Math.max(1, fit.height));
  const center = { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 };
  const screen = (point: Point): Point => ({
    x: W / 2 + pan.x + (point.x - center.x) * ratio,
    y: H / 2 + pan.y + (point.y - center.y) * ratio,
  });
  const world = (point: Point): Point => ({
    x: Math.round((center.x + (point.x - W / 2 - pan.x) / ratio) * 1000) / 1000,
    y: Math.round((center.y + (point.y - H / 2 - pan.y) / ratio) * 1000) / 1000,
  });
  function pointer(event: PointerEvent): Point | undefined {
    const transform = svg.current?.getScreenCTM();
    if (!transform) return undefined;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
  }
  function onDown(event: PointerEvent<SVGSVGElement>) {
    if (!interactive || event.button !== 0) return;
    const start = pointer(event);
    if (!start) return;
    const target = (event.target as Element).closest<SVGElement>('[data-vertex]');
    const vertex = target ? Number(target.dataset.vertex) : undefined;
    if (coordinateEditing && activeTool === 'draw' && vertex === undefined) {
      survey.add(world(start));
      return;
    }
    if (vertex !== undefined) survey.setSelected(vertex);
    const index = activeTool === 'select' && coordinateEditing ? vertex : undefined;
    if (index === undefined && activeTool !== 'pan') return;
    const origin = index === undefined ? pan : points[index]!;
    gesture.current = { start, origin, index, fit };
    setFrozenBounds(fit);
    if (index !== undefined) {
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      survey.beginEdit();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onMove(event: PointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!interactive || (!active && event.pointerType !== 'mouse')) return;
    const p = pointer(event);
    if (!p) return;
    if (event.pointerType === 'mouse') {
      lamp.current?.setAttribute('cx', String(p.x));
      lamp.current?.setAttribute('cy', String(p.y));
    }
    if (!active) return;
    const delta = { x: p.x - active.start.x, y: p.y - active.start.y };
    if (active.index === undefined) {
      setPan({ x: active.origin.x + delta.x, y: active.origin.y + delta.y });
    } else if (Math.hypot(delta.x, delta.y) > .2) {
      survey.editRow(active.index, {
        xMm: Math.round((active.origin.x + delta.x / ratio) * 1000) / 1000,
        yMm: Math.round((active.origin.y + delta.y / ratio) * 1000) / 1000,
      });
    }
  }
  function finish() {
    if (gesture.current?.index !== undefined) survey.finishEdit();
    gesture.current = null;
    setFrozenBounds(undefined);
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTool('select');
  }
  const edgePaths = edges.map(edge => {
    const a = screen(edge.start);
    const b = screen(edge.end);
    return edge.arc ? arcPath(a, b, edge.arc.radiusMm * ratio, edge.arc.sweepRad) : `M ${fmt(a)} L ${fmt(b)}`;
  });
  const closedPath = edgePaths.length ? edgePaths[0] + edgePaths.slice(1).map(path => path.replace(/^M \S+ \S+ /, ' ')).join('') + ' Z' : '';
  const road = draft.roadEdge == null ? undefined : edges[draft.roadEdge];
  const roadPoint = road && screen(pointAlongSurveyEdge(road, .5));
  const pickedEdge = edges[selected];
  const centroid = metrics && screen(metrics.centroid);
  const previousEdge = edges[(selected + edges.length - 1) % edges.length];
  const pickedCorner = metrics && pickedEdge && previousEdge ? screen(pickedEdge.start) : undefined;
  const angle = pickedCorner && metrics ? metrics.cornerAnglesDeg[selected]! : undefined;
  const anglePath = pickedCorner && angle !== undefined && previousEdge ? (() => {
    const start = tangent(previousEdge, true) + Math.PI;
    const sweep = angle / 360 * TAU * (metrics!.clockwise ? -1 : 1);
    const at = (theta: number, radius: number) => ({
      x: pickedCorner.x + Math.cos(theta) * radius,
      y: pickedCorner.y + Math.sin(theta) * radius,
    });
    return { path: arcPath(at(start, 23), at(start + sweep, 23), 23, sweep), label: at(start + sweep / 2, 44) };
  })() : undefined;
  const badEdge = (index: number) => issues.some(issue =>
    'index' in issue && issue.index === index || 'other' in issue && issue.other === index);

  return <figure className="rh-survey-drawing" data-testid="survey-drawing">
    <figcaption>
      <div className="rh-survey-view-switch" role="group" aria-label="Survey view">
        <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><Scan size={15} /> Plan</button>
        <button type="button" aria-pressed={view === 'site'} onClick={() => setView('site')}><Box size={15} /> 3D site</button>
      </div>
      {interactive && view === 'plan' && <div className="rh-survey-map-tools" aria-label="Drawing controls">
        <button type="button" title="Undo survey edit" aria-label="Undo survey edit" disabled={!survey.canUndo} onClick={survey.undo}><Undo2 size={16} /></button>
        <button type="button" title="Redo survey edit" aria-label="Redo survey edit" disabled={!survey.canRedo} onClick={survey.redo}><Redo2 size={16} /></button>
        <button type="button" title="Draw vertices" aria-label="Draw vertices" disabled={!coordinateEditing} aria-pressed={tool === 'draw'} onClick={() => {
          if (activeTool === 'draw') setTool('select');
          else {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setTool('draw');
          }
        }}><PenLine size={16} /></button>
        <button type="button" title="Pan drawing" aria-label="Pan drawing" aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')}><Hand size={16} /></button>
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(v => Math.max(.3, v / 1.25))}><Minus size={16} /></button>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(v => Math.min(12, v * 1.25))}><Plus size={16} /></button>
        <button type="button" title="Fit boundary" aria-label="Fit boundary" onClick={resetView}><Maximize2 size={16} /></button>
      </div>}
    </figcaption>
    {view === 'plan' ? <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Survey boundary drawing"
      data-tool={interactive ? activeTool : undefined} onPointerDown={onDown} onPointerMove={onMove}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <defs>
        <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#aac6ba" strokeOpacity=".19" />
        </pattern>
        <radialGradient ref={lamp} id={lampId} cx="290" cy="110" r="260" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ccf2ce" stopOpacity=".21" />
          <stop offset="1" stopColor="#a1e1c8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect className="rh-survey-lamp" width={W} height={H} fill={`url(#${lampId})`} pointerEvents="none" />
      <rect width={W} height={H} fill={`url(#${gridId})`} />
      <g className="rh-survey-north" transform="translate(550 48)" aria-label="North is up">
        <path d="M 0 30 L 0 0 M -7 9 L 0 0 7 9" /><text y="-8" textAnchor="middle">N</text>
      </g>
      {metrics && <path d={closedPath} data-testid="survey-outline" className="rh-survey-fill" />}
      {envelope && envelope.points.length > 0 && <polygon className="rh-survey-envelope" points={envelope.points.map(point => fmt(screen(point))).join(' ')} />}
      {!edges.length && <polyline className="rh-survey-open" points={visiblePoints.map(point => fmt(screen(point))).join(' ')} />}
      {closingPoint && points[0] && <path className="rh-survey-closure" d={`M ${fmt(screen(closingPoint))} L ${fmt(screen(points[0]))}`} />}
      {edges.map((edge, index) => {
        const mid = screen(pointAlongSurveyEdge(edge, .5));
        return <g key={index}>
          <path d={edgePaths[index]} className={`rh-survey-edge${edge === road ? ' is-road' : ''}${badEdge(index) ? ' is-invalid' : ''}`}
            data-testid={edge.arc ? 'survey-arc' : undefined} />
          <text className="rh-survey-dimension" x={mid.x} y={mid.y - 11} textAnchor="middle">{showMeasure(edge.lengthMm, draft.unit)} {draft.unit}</text>
        </g>;
      })}
      {roadPoint && road && <g className="rh-survey-frontage">
        <circle cx={roadPoint.x} cy={roadPoint.y} r="5" />
        <text x={roadPoint.x} y={roadPoint.y + 25} textAnchor="middle">Road · {roadWidthM} m</text>
      </g>}
      {centroid && <path className="rh-survey-centroid" aria-label="Geometric centroid"
        d={`M ${centroid.x - 5} ${centroid.y} h 10 m -5 -5 v 10`} />}
      {anglePath && <g className="rh-survey-angle">
        <path d={anglePath.path} /><text x={anglePath.label.x} y={anglePath.label.y} textAnchor="middle">{angle?.toFixed(1)}°</text>
      </g>}
      {points.map((point, index) => {
        const p = screen(point);
        const labelLeft = centroid && p.x < centroid.x;
        return <g key={index} className={`rh-survey-vertex${selected === index ? ' is-selected' : ''}`} transform={`translate(${fmt(p)})`}
          data-vertex={index} data-testid={`survey-vertex-${index}`}>
          <circle r="13" className="rh-survey-hit" /><circle r="4.5" />
          {selected === index && <circle r="10" className="rh-survey-selected-ring" pointerEvents="none" />}
          <text x={labelLeft ? -11 : 11} y="5" textAnchor={labelLeft ? 'end' : 'start'}>{surveyLabel(index)}</text>
        </g>;
      })}
    </svg> : metrics ? <Suspense fallback={<div className="rh-survey-site-placeholder" role="status">Opening 3D preview…</div>}>
      <SurveySitePreview boundary={boundary} envelope={envelope} roadEdge={draft.roadEdge}
        selected={selected} onSelect={survey.setSelected} onShowPlan={() => setView('plan')} />
    </Suspense> : <div className="rh-survey-site-placeholder" role="status">Close the survey boundary to preview it in 3D.</div>}
    <div className="rh-survey-metrics">
      <span>Plot area <strong>{metrics ? `${(metrics.areaMm2 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m²` : '—'}</strong></span>
      <span>Perimeter <strong>{metrics ? `${showMeasure(metrics.perimeterMm, draft.unit)} ${draft.unit}` : '—'}</strong></span>
      <span>Setback area <strong>{envelope ? `${(polygonArea(envelope) / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m²` : '—'}</strong></span>
    </div>
    {interactive && view === 'plan' && activeTool === 'draw' && <p>Click the drawing to add vertices in boundary order.</p>}
  </figure>;
}
