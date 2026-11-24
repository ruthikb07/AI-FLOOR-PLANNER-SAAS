import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHITECTURAL_CAD_LAYERS,
  CanonicalDxfExchangeAdapter,
  DEFAULT_CAD_OSNAP_CONFIG,
  cadArcFrom3Points,
  cadArcPointAt,
  deterministicDxfHandle,
  exchangeRevision,
  extendDraftingLine,
  measureCadAngle,
  measureCadDistance,
  mirrorDraftingEntity,
  moveDraftingEntity,
  offsetDraftingEntity,
  projectBuildingToCanonicalCad,
  resolveCadSnap,
  rotateDraftingEntity,
  trimDraftingLine,
  type CadArcEntity,
  type CadEntity,
  type CadLineEntity,
  type CadOsnapConfig,
  type CadPoint2D,
  type CadSnapResult,
} from '@ai-floor-planner/core';
import {
  proposeControlledCadEdit,
  type CadAiEditProposalResult,
} from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';

export interface PrecisionCadWorkbenchProps {
  readonly editor: EditorContextValue;
  readonly onExitPrecisionStudio?: () => void;
}

type CadToolId =
  | 'select'
  | 'pan'
  | 'measure_distance'
  | 'measure_angle'
  | 'line'
  | 'polyline'
  | 'arc3pt'
  | 'rectangle'
  | 'dimension'
  | 'text'
  | 'offset'
  | 'trim'
  | 'extend'
  | 'move'
  | 'rotate'
  | 'mirror';

const QUICK_AI_CAD_INSTRUCTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Resize window → 1500 mm', prompt: 'Resize this window to 1500 mm' },
  { label: 'Move bedroom door to corner', prompt: 'Move this bedroom door towards the corner' },
  { label: 'Increase master bedroom area', prompt: 'Increase the master bedroom carpet area by 8%' },
  { label: 'Reduce passage width safely', prompt: 'Reduce the passage width without compromising circulation' },
  { label: 'Regenerate only Flat 2', prompt: 'Regenerate only Flat 2 while keeping the remaining flats unchanged' },
];

function svgArcPath(arc: CadArcEntity): string {
  const start = cadArcPointAt(arc, 0);
  const end = cadArcPointAt(arc, 1);
  let sweep = arc.endAngle - arc.startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  const largeArc = sweep > Math.PI ? 1 : 0;
  // In SVG where Y is inverted via `scale(1, -1)` group or negated Y: we plot CAD coordinates `(x, -y)` directly so +Y is up on screen!
  return `M ${start.x} ${-start.y} A ${arc.radius} ${arc.radius} 0 ${largeArc} 0 ${end.x} ${-end.y}`;
}

function entityHitDistanceMm(entity: CadEntity, pt: CadPoint2D): number {
  switch (entity.type) {
    case 'LINE': {
      const dx = entity.end.x - entity.start.x;
      const dy = entity.end.y - entity.start.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) return Math.hypot(pt.x - entity.start.x, pt.y - entity.start.y);
      const t = Math.max(0, Math.min(1, ((pt.x - entity.start.x) * dx + (pt.y - entity.start.y) * dy) / len2));
      return Math.hypot(pt.x - (entity.start.x + dx * t), pt.y - (entity.start.y + dy * t));
    }
    case 'ARC':
    case 'CIRCLE':
      return Math.abs(Math.hypot(pt.x - entity.center.x, pt.y - entity.center.y) - entity.radius);
    case 'POLYLINE': {
      let best = Infinity;
      const n = entity.vertices.length;
      const segs = entity.closed ? n : Math.max(0, n - 1);
      for (let i = 0; i < segs; i++) {
        const a = entity.vertices[i]!;
        const b = entity.vertices[(i + 1) % n]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
        best = Math.min(best, Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t)));
      }
      return best;
    }
    case 'RECTANGLE': {
      const { x, y } = entity.corner;
      const inX = Math.max(x, Math.min(x + entity.width, pt.x));
      const inY = Math.max(y, Math.min(y + entity.height, pt.y));
      return Math.hypot(pt.x - inX, pt.y - inY);
    }
    case 'TEXT':
      return Math.hypot(pt.x - entity.position.x, pt.y - entity.position.y);
    case 'DIMENSION':
      return Math.min(
        Math.hypot(pt.x - entity.textPosition.x, pt.y - entity.textPosition.y),
        Math.hypot(pt.x - (entity.p1.x + entity.p2.x) / 2, pt.y - (entity.p1.y + entity.p2.y) / 2),
      );
  }
}

export const PrecisionCadWorkbench: React.FC<PrecisionCadWorkbenchProps> = ({
  editor,
  onExitPrecisionStudio,
}) => {
  const activeFloorId = editor.activeFloor.id;
  const [activeTool, setActiveTool] = useState<CadToolId>('select');
  const [osnap, setOsnap] = useState<CadOsnapConfig>(DEFAULT_CAD_OSNAP_CONFIG);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ARCHITECTURAL_CAD_LAYERS.map(l => [l.id, l.visible])),
  );
  const [layerLocks, setLayerLocks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ARCHITECTURAL_CAD_LAYERS.map(l => [l.id, l.locked])),
  );
  const [selectedCadId, setSelectedCadId] = useState<string | null>(null);
  const [snapState, setSnapState] = useState<CadSnapResult>({
    point: { x: 0, y: 0 },
    snapType: null,
    distanceMm: 0,
  });
  const [pickedPoints, setPickedPoints] = useState<CadPoint2D[]>([]);
  const [textDraftValue, setTextDraftValue] = useState('ARCHITECTURAL NOTE');
  const [offsetDistMm, setOffsetDistMm] = useState(300);
  const [rotateDeg, setRotateDeg] = useState(90);
  const [measurementReadout, setMeasurementReadout] = useState<string | null>(null);
  const [guardrailNotice, setGuardrailNotice] = useState<string | null>(null);
  const [dxfExportNotice, setDxfExportNotice] = useState<string | null>(null);
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'layers' | 'ai'>('none');

  // AI-Assisted Canonical CAD Editing state
  const [aiInstruction, setAiInstruction] = useState('Resize this window to 1500 mm');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    proposal: CadAiEditProposalResult;
    providerMode: string;
  } | null>(null);

  const cadDoc = useMemo(
    () =>
      projectBuildingToCanonicalCad(editor.building, {
        floorId: activeFloorId,
        lockedFloorIds: editor.generationControl.lockedFloorIds,
        lockedEntityIds: editor.generationControl.lockedEntityIds,
        includeDraftingEntities: editor.building.metadata.cadDraftingAnnotations,
      }),
    [
      editor.building,
      activeFloorId,
      editor.generationControl.lockedFloorIds,
      editor.generationControl.lockedEntityIds,
    ],
  );

  const activeSheet = cadDoc.sheets[0];
  const layerMap = useMemo(
    () =>
      new Map(
        cadDoc.layers.map(l => [
          l.id,
          { ...l, visible: layerVisibility[l.id] !== false, locked: layerLocks[l.id] ?? l.locked },
        ]),
      ),
    [cadDoc.layers, layerVisibility, layerLocks],
  );
  const visibleEntities = useMemo(
    () =>
      (activeSheet?.entities ?? []).filter(e => layerVisibility[e.layer] !== false),
    [activeSheet, layerVisibility],
  );

  const selectedEntity = useMemo(
    () => (activeSheet?.entities ?? []).find(entity => entity.id === selectedCadId) ??
      (editor.selection?.floorId === activeFloorId ? activeSheet?.entities.find(entity =>
        entity.canonicalId === editor.selection?.entityId && entity.canonicalKind === editor.selection?.entityType) : undefined) ?? null,
    [activeSheet, activeFloorId, selectedCadId, editor.selection],
  );

  // Compute initial model bounding box in screen-SVG space `(cadX, -cadY)`
  const modelBounds = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    for (const ent of activeSheet?.entities ?? []) {
      if (ent.type === 'LINE') pts.push({ x: ent.start.x, y: -ent.start.y }, { x: ent.end.x, y: -ent.end.y });
      else if (ent.type === 'POLYLINE') ent.vertices.forEach(v => pts.push({ x: v.x, y: -v.y }));
      else if (ent.type === 'ARC' || ent.type === 'CIRCLE') {
        pts.push(
          { x: ent.center.x - ent.radius, y: -(ent.center.y + ent.radius) },
          { x: ent.center.x + ent.radius, y: -(ent.center.y - ent.radius) },
        );
      }
    }
    if (pts.length === 0) return { minX: -2000, minY: -2000, width: 24000, height: 18000 };
    const minX = Math.min(...pts.map(p => p.x)) - 2200;
    const maxX = Math.max(...pts.map(p => p.x)) + 2200;
    const minY = Math.min(...pts.map(p => p.y)) - 2200;
    const maxY = Math.max(...pts.map(p => p.y)) + 2200;
    return {
      minX,
      minY,
      width: Math.max(4000, maxX - minX),
      height: Math.max(4000, maxY - minY),
    };
  }, [activeSheet]);

  const [viewBox, setViewBox] = useState(modelBounds);
  useEffect(() => {
    setViewBox(modelBounds);
  }, [activeFloorId, modelBounds.minX, modelBounds.minY, modelBounds.width, modelBounds.height]);

  // Clear stale AI preview whenever building revision changes
  useEffect(() => {
    setAiPreview(prev =>
      prev && prev.proposal.expectedRevision !== editor.building.version ? null : prev,
    );
  }, [editor.building.version]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const panDragRef = useRef<{ startClientX: number; startClientY: number; box: typeof viewBox } | null>(null);

  const commitDraftingEntities = useCallback(
    (nextFloorDrafts: readonly CadEntity[], description: string) => {
      const prevMap = editor.building.metadata.cadDraftingAnnotations ?? {};
      const nextBuilding = {
        ...editor.building,
        version: editor.building.version + 1,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...editor.building.metadata,
          cadDraftingAnnotations: {
            ...prevMap,
            [activeFloorId]: nextFloorDrafts,
          },
        },
      };
      editor.applyRefinement(nextBuilding, description, true);
    },
    [editor, activeFloorId],
  );

  const currentDrafts = useMemo(
    () => editor.building.metadata.cadDraftingAnnotations?.[activeFloorId] ?? [],
    [editor.building.metadata.cadDraftingAnnotations, activeFloorId],
  );

  const clientToCadPoint = useCallback(
    (clientX: number, clientY: number): CadPoint2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
      const scale = Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
      const renderedW = rect.width * scale;
      const renderedH = rect.height * scale;
      const offsetX = viewBox.minX - (renderedW - viewBox.width) / 2;
      const offsetY = viewBox.minY - (renderedH - viewBox.height) / 2;
      const svgX = offsetX + (clientX - rect.left) * scale;
      const svgY = offsetY + (clientY - rect.top) * scale;
      return { x: svgX, y: -svgY };
    },
    [viewBox],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (panDragRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const scale = Math.max(
          panDragRef.current.box.width / Math.max(1, rect.width),
          panDragRef.current.box.height / Math.max(1, rect.height),
        );
        const dx = (event.clientX - panDragRef.current.startClientX) * scale;
        const dy = (event.clientY - panDragRef.current.startClientY) * scale;
        setViewBox({
          ...panDragRef.current.box,
          minX: panDragRef.current.box.minX - dx,
          minY: panDragRef.current.box.minY - dy,
        });
        return;
      }
      const rawCad = clientToCadPoint(event.clientX, event.clientY);
      const apertureMm = Math.max(180, viewBox.width * 0.018);
      const snapped = resolveCadSnap(
        rawCad,
        visibleEntities,
        layerMap,
        osnap,
        apertureMm,
        pickedPoints.at(-1),
      );
      setSnapState(snapped);
    },
    [clientToCadPoint, layerMap, osnap, pickedPoints, viewBox.width, visibleEntities],
  );

  const makeDraftHandle = (kind: string) => {
    const id = `draft:${kind}:${Date.now().toString(36)}:${currentDrafts.length + 1}`;
    const handle = deterministicDxfHandle(activeFloorId, `draft-${kind}`, id, 4096 + currentDrafts.length);
    return { id, handle };
  };

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (activeTool === 'pan') return;
      const rawPt = clientToCadPoint(event.clientX, event.clientY);
      const apertureMm = Math.max(200, viewBox.width * 0.02);
      const snapped = resolveCadSnap(rawPt, visibleEntities, layerMap, osnap, apertureMm, pickedPoints.at(-1));
      const pt = snapped.point;
      setGuardrailNotice(null);

      // Entity hit test for selection / modification tools
      const hitCandidates = visibleEntities
        .filter(e => e.layer !== 'A-SLAB')
        .map(e => ({ entity: e, dist: entityHitDistanceMm(e, rawPt) }))
        .filter(item => item.dist <= Math.max(320, viewBox.width * 0.022))
        .sort((a, b) => a.dist - b.dist);
      const hitEntity = hitCandidates[0]?.entity ?? null;

      if (activeTool === 'select') {
        setSelectedCadId(hitEntity?.id ?? null);
        if (hitEntity?.canonicalId && hitEntity.canonicalKind && hitEntity.canonicalKind !== 'floor') {
          editor.selectEntity(hitEntity.canonicalKind, hitEntity.canonicalId, activeFloorId);
        }
        return;
      }

      if (activeTool === 'measure_distance') {
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
          setMeasurementReadout('Pick second point to measure distance...');
        } else {
          const m = measureCadDistance(pickedPoints[0]!, pt);
          setMeasurementReadout(
            `Distance: ${Math.round(m.distanceMm)} mm (${(m.distanceMm / 1000).toFixed(3)} m) · ΔX=${Math.round(m.deltaXMm)} mm · ΔY=${Math.round(m.deltaYMm)} mm · ∠${m.angleDeg.toFixed(1)}°`,
          );
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'measure_angle') {
        const next = [...pickedPoints, pt];
        if (next.length < 3) {
          setPickedPoints(next);
          setMeasurementReadout(
            next.length === 1 ? 'Pick first ray point...' : 'Pick second ray point...',
          );
        } else {
          const ang = measureCadAngle(next[0]!, next[1]!, next[2]!);
          setMeasurementReadout(
            ang
              ? `Included Angle: ${ang.interiorAngleDeg.toFixed(2)}° (Reflex ${ang.reflexAngleDeg.toFixed(2)}°)`
              : 'Collinear or coincident points — select three distinct ray points.',
          );
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'line') {
        if (layerLocks['D-DRAFT']) {
          setGuardrailNotice('Layer D-DRAFT is locked. Unlock D-DRAFT in Layer Manager before drawing.');
          return;
        }
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
        } else {
          const { id, handle } = makeDraftHandle('line');
          const line: CadLineEntity = {
            id,
            handle,
            type: 'LINE',
            layer: 'D-DRAFT',
            origin: 'DRAFTING_ANNOTATION',
            start: pickedPoints[0]!,
            end: pt,
          };
          commitDraftingEntities([...currentDrafts, line], 'Add CAD drafting line');
          setSelectedCadId(id);
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'polyline') {
        if (layerLocks['D-DRAFT']) {
          setGuardrailNotice('Layer D-DRAFT is locked.');
          return;
        }
        setPickedPoints(prev => [...prev, pt]);
        return;
      }

      if (activeTool === 'arc3pt') {
        if (layerLocks['D-DRAFT']) {
          setGuardrailNotice('Layer D-DRAFT is locked.');
          return;
        }
        const next = [...pickedPoints, pt];
        if (next.length < 3) {
          setPickedPoints(next);
        } else {
          const arcGeom = cadArcFrom3Points(next[0]!, next[1]!, next[2]!);
          if (!arcGeom) {
            setGuardrailNotice('Arc points are collinear — pick 3 non-collinear points.');
          } else {
            const { id, handle } = makeDraftHandle('arc');
            commitDraftingEntities(
              [
                ...currentDrafts,
                {
                  id,
                  handle,
                  type: 'ARC',
                  layer: 'D-DRAFT',
                  origin: 'DRAFTING_ANNOTATION',
                  ...arcGeom,
                },
              ],
              'Add 3-point CAD arc',
            );
            setSelectedCadId(id);
          }
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'rectangle') {
        if (layerLocks['D-DRAFT']) {
          setGuardrailNotice('Layer D-DRAFT is locked.');
          return;
        }
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
        } else {
          const p0 = pickedPoints[0]!;
          const corner = { x: Math.min(p0.x, pt.x), y: Math.min(p0.y, pt.y) };
          const width = Math.max(50, Math.abs(pt.x - p0.x));
          const height = Math.max(50, Math.abs(pt.y - p0.y));
          const { id, handle } = makeDraftHandle('rect');
          commitDraftingEntities(
            [
              ...currentDrafts,
              {
                id,
                handle,
                type: 'RECTANGLE',
                layer: 'D-DRAFT',
                origin: 'DRAFTING_ANNOTATION',
                corner,
                width,
                height,
              },
            ],
            'Add CAD drafting rectangle',
          );
          setSelectedCadId(id);
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'dimension') {
        if (layerLocks['D-DIM']) {
          setGuardrailNotice('Layer D-DIM is locked.');
          return;
        }
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
        } else {
          const p1 = pickedPoints[0]!;
          const measuredMm = Math.hypot(pt.x - p1.x, pt.y - p1.y);
          const { id, handle } = makeDraftHandle('dim');
          commitDraftingEntities(
            [
              ...currentDrafts,
              {
                id,
                handle,
                type: 'DIMENSION',
                layer: 'D-DIM',
                origin: 'DRAFTING_ANNOTATION',
                dimKind: 'ALIGNED',
                p1,
                p2: pt,
                textPosition: { x: (p1.x + pt.x) / 2, y: (p1.y + pt.y) / 2 + 350 },
                measuredMm,
              },
            ],
            'Add CAD linear dimension',
          );
          setSelectedCadId(id);
          setPickedPoints([]);
        }
        return;
      }

      if (activeTool === 'text') {
        if (layerLocks['D-ANNO']) {
          setGuardrailNotice('Layer D-ANNO is locked.');
          return;
        }
        const { id, handle } = makeDraftHandle('text');
        commitDraftingEntities(
          [
            ...currentDrafts,
            {
              id,
              handle,
              type: 'TEXT',
              layer: 'D-ANNO',
              origin: 'DRAFTING_ANNOTATION',
              position: pt,
              text: textDraftValue.trim() || 'NOTE',
              heightMm: 200,
              rotationRad: 0,
              justify: 'left',
            },
          ],
          'Add CAD text annotation',
        );
        setSelectedCadId(id);
        return;
      }

      // Drafting modification tools acting on selectedEntity or clicked entity
      const target = selectedEntity ?? hitEntity;
      if (!target) {
        setGuardrailNotice('Select a CAD entity first before applying this editing tool.');
        return;
      }

      if (activeTool === 'offset') {
        const { id, handle } = makeDraftHandle('offset');
        const res = offsetDraftingEntity(target, offsetDistMm, pt, id, handle);
        if (!res.ok || !res.entity) {
          setGuardrailNotice(res.reason ?? 'Offset failed.');
          return;
        }
        commitDraftingEntities([...currentDrafts, res.entity], `Offset CAD entity by ${offsetDistMm} mm`);
        setSelectedCadId(id);
        return;
      }

      if (activeTool === 'trim') {
        if (target.origin === 'CANONICAL_ARCHITECTURAL') {
          const blocked = trimDraftingLine(target as CadLineEntity, visibleEntities, pt);
          setGuardrailNotice(blocked.reason ?? 'Canonical wall cannot be raw-trimmed.');
          return;
        }
        if (target.type !== 'LINE') {
          setGuardrailNotice('TRIM operates on LINE drafting entities.');
          return;
        }
        const res = trimDraftingLine(target, visibleEntities, pt);
        if (!res.ok || !res.replacementEntities) {
          setGuardrailNotice(res.reason ?? 'No cutting edge intersected line.');
          return;
        }
        commitDraftingEntities(
          [...currentDrafts.filter(d => d.id !== target.id), ...res.replacementEntities],
          'Trim CAD drafting line',
        );
        return;
      }

      if (activeTool === 'extend') {
        if (target.origin === 'CANONICAL_ARCHITECTURAL') {
          const blocked = extendDraftingLine(target as CadLineEntity, visibleEntities, pt);
          setGuardrailNotice(blocked.reason ?? 'Canonical wall cannot be raw-extended.');
          return;
        }
        if (target.type !== 'LINE') {
          setGuardrailNotice('EXTEND operates on LINE drafting entities.');
          return;
        }
        const res = extendDraftingLine(target, visibleEntities, pt);
        if (!res.ok || !res.entity) {
          setGuardrailNotice(res.reason ?? 'No boundary edge along extended ray.');
          return;
        }
        commitDraftingEntities(
          currentDrafts.map(d => (d.id === target.id ? res.entity! : d)),
          'Extend CAD drafting line',
        );
        return;
      }

      if (activeTool === 'move') {
        if (target.origin === 'CANONICAL_ARCHITECTURAL') {
          const blocked = moveDraftingEntity(target, 100, 0);
          setGuardrailNotice(blocked.reason ?? 'Canonical entity requires controlled edit.');
          return;
        }
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
        } else {
          const base = pickedPoints[0]!;
          const res = moveDraftingEntity(target, pt.x - base.x, pt.y - base.y);
          setPickedPoints([]);
          if (!res.ok || !res.entity) {
            setGuardrailNotice(res.reason ?? 'Move failed.');
            return;
          }
          commitDraftingEntities(
            currentDrafts.map(d => (d.id === target.id ? res.entity! : d)),
            'Move CAD drafting entity',
          );
        }
        return;
      }

      if (activeTool === 'rotate') {
        const res = rotateDraftingEntity(target, pt, rotateDeg);
        if (!res.ok || !res.entity) {
          setGuardrailNotice(res.reason ?? 'Rotate blocked.');
          return;
        }
        commitDraftingEntities(
          currentDrafts.map(d => (d.id === target.id ? res.entity! : d)),
          `Rotate CAD drafting entity ${rotateDeg}°`,
        );
        return;
      }

      if (activeTool === 'mirror') {
        if (target.origin === 'CANONICAL_ARCHITECTURAL') {
          const blocked = mirrorDraftingEntity(target, { x: 0, y: 0 }, { x: 1000, y: 0 });
          setGuardrailNotice(blocked.reason ?? 'Mirror blocked on canonical entity.');
          return;
        }
        if (pickedPoints.length === 0) {
          setPickedPoints([pt]);
        } else {
          const res = mirrorDraftingEntity(target, pickedPoints[0]!, pt);
          setPickedPoints([]);
          if (!res.ok || !res.entity) {
            setGuardrailNotice(res.reason ?? 'Mirror failed.');
            return;
          }
          const { id, handle } = makeDraftHandle('mirror');
          commitDraftingEntities(
            [...currentDrafts, { ...res.entity, id, handle }],
            'Mirror CAD drafting entity',
          );
        }
      }
    },
    [
      activeFloorId,
      activeTool,
      clientToCadPoint,
      commitDraftingEntities,
      currentDrafts,
      editor,
      layerLocks,
      layerMap,
      offsetDistMm,
      osnap,
      pickedPoints,
      rotateDeg,
      selectedEntity,
      textDraftValue,
      viewBox.width,
      visibleEntities,
    ],
  );

  const finishPolyline = () => {
    if (pickedPoints.length < 2) {
      setPickedPoints([]);
      return;
    }
    const { id, handle } = makeDraftHandle('pline');
    commitDraftingEntities(
      [
        ...currentDrafts,
        {
          id,
          handle,
          type: 'POLYLINE',
          layer: 'D-DRAFT',
          origin: 'DRAFTING_ANNOTATION',
          vertices: pickedPoints,
          closed: false,
        },
      ],
      'Add CAD drafting polyline',
    );
    setSelectedCadId(id);
    setPickedPoints([]);
  };

  const handleRequestAiProposal = async (overrideInstruction?: string) => {
    const promptText = (overrideInstruction ?? aiInstruction).trim();
    if (!promptText) return;
    if (overrideInstruction) setAiInstruction(overrideInstruction);
    setAiBusy(true);
    setGuardrailNotice(null);
    try {
      const selectedCanonicalId = selectedEntity?.canonicalId ?? editor.selection?.entityId;
      const response = await fetch('/api/v1/cad/edit-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building: editor.building,
          floorId: activeFloorId,
          expectedRevision: editor.building.version,
          control: editor.generationControl,
          selectedEntityId: selectedCanonicalId,
          instruction: promptText,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          proposal: CadAiEditProposalResult;
          aiTelemetry?: { interpretationSource?: string; modelUsed?: string; fallbackReason?: string };
        };
        const mode =
          data.aiTelemetry?.interpretationSource === 'GEMINI_ASSISTED'
            ? `Live Gemini (${data.aiTelemetry.modelUsed ?? 'gemini'})`
            : `Deterministic Parser (${data.aiTelemetry?.fallbackReason ?? 'local'})`;
        setAiPreview({ proposal: data.proposal, providerMode: mode });
        return;
      }
    } catch {
      // Fall back to in-process deterministic canonical edit proposal if backend route unreachable
    } finally {
      setAiBusy(false);
    }

    const fallbackProposal = proposeControlledCadEdit({
      building: editor.building,
      floorId: activeFloorId,
      expectedRevision: editor.building.version,
      control: editor.generationControl,
      selectedEntityId: selectedEntity?.canonicalId ?? editor.selection?.entityId,
      instruction: promptText,
      intentSource: 'DETERMINISTIC',
    });
    setAiPreview({
      proposal: fallbackProposal,
      providerMode: 'Deterministic Parser (local)',
    });
  };

  const handleAcceptAiProposal = () => {
    if (!aiPreview?.proposal.proposedBuilding) return;
    try {
      editor.applyRefinement(
        aiPreview.proposal.proposedBuilding,
        aiPreview.proposal.message,
        true,
        aiPreview.proposal.baseRevisionDigest,
      );
      setAiPreview(null);
    } catch (err) {
      setGuardrailNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportCanonicalExchangeDxf = async () => {
    try {
      const adapter = new CanonicalDxfExchangeAdapter();
      const rev = exchangeRevision(editor.building);
      const artifact = await adapter.export(editor.building, rev);
      const readback = await adapter.readback(artifact, rev, editor.building);
      const blob = new Blob([new Uint8Array(artifact.bytes)], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${editor.projectName.replace(/[^a-z0-9-_]+/gi, '_')}_rev${editor.building.version}_canonical.dxf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDxfExportNotice(
        `Canonical DXF verified: ${artifact.manifest.elements.length} mapped handles · Lost ${readback.lostCanonicalIds.length} · Rev ${artifact.manifest.source.revision} · SHA ${artifact.manifest.source.sha256.slice(0, 10)}`,
      );
    } catch (err) {
      setDxfExportNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const zoomBy = (factor: number) => {
    setViewBox(prev => {
      const cx = prev.minX + prev.width / 2;
      const cy = prev.minY + prev.height / 2;
      const nw = Math.max(1500, Math.min(250_000, prev.width * factor));
      const nh = Math.max(1500, Math.min(250_000, prev.height * factor));
      return { minX: cx - nw / 2, minY: cy - nh / 2, width: nw, height: nh };
    });
  };

  const strokeScale = Math.max(12, viewBox.width * 0.0018);

  return (
    <section
      data-testid="precision-cad-workbench"
      aria-label="Precision CAD Studio"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#F4F4ED] text-[#122624]"
    >
      {/* Warm Beige Atelier Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CAD1C6] bg-[#EAE8DC] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-[#9B6948]/15 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#7C4F32]">
            Precision CAD · Cota 2D Kernel
          </span>
          <span
            data-testid="cad-revision-badge"
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2 py-0.5 font-mono text-xs font-semibold text-[#122624]"
          >
            Rev {editor.building.version} · {editor.activeFloor.name}
          </span>
          <button
            type="button"
            data-testid="cad-undo-btn"
            disabled={!editor.canUndo}
            onClick={() => editor.undo()}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2.5 py-1 text-xs font-semibold text-[#122624] hover:bg-[#E2DFD0] disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            data-testid="cad-redo-btn"
            disabled={!editor.canRedo}
            onClick={() => editor.redo()}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2.5 py-1 text-xs font-semibold text-[#122624] hover:bg-[#E2DFD0] disabled:opacity-40"
          >
            Redo
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="cad-export-canonical-dxf"
            onClick={() => void handleExportCanonicalExchangeDxf()}
            className="rounded bg-[#1C5148] px-2.5 py-1 text-xs font-semibold text-[#F7FCF7] hover:bg-[#153B36]"
          >
            Export Canonical DXF
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer(d => (d === 'layers' ? 'none' : 'layers'))}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2.5 py-1 text-xs font-semibold lg:hidden"
          >
            Layers
          </button>
          <button
            type="button"
            data-testid="cad-mobile-ai-toggle"
            onClick={() => setMobileDrawer(d => (d === 'ai' ? 'none' : 'ai'))}
            className="rounded border border-[#9B6948] bg-[#9B6948]/15 px-2.5 py-1 text-xs font-semibold text-[#7C4F32] lg:hidden"
          >
            AI Edit
          </button>
          {onExitPrecisionStudio && (
            <button
              type="button"
              data-testid="exit-precision-cad-studio"
              onClick={onExitPrecisionStudio}
              className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2.5 py-1 text-xs font-semibold text-[#122624] hover:bg-[#E2DFD0]"
            >
              Standard Sheet View
            </button>
          )}
        </div>
      </header>

      {/* CAD Drafting & OSNAP Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CAD1C6] bg-[#EFECE1] px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Precision CAD Tools">
          {(
            [
              ['select', 'Select'],
              ['pan', 'Pan'],
              ['measure_distance', 'Dist'],
              ['measure_angle', 'Angle'],
              ['line', 'Line'],
              ['polyline', 'PLine'],
              ['arc3pt', 'Arc 3P'],
              ['rectangle', 'Rect'],
              ['dimension', 'Dim'],
              ['text', 'Text'],
              ['offset', 'Offset'],
              ['trim', 'Trim'],
              ['extend', 'Extend'],
              ['move', 'Move'],
              ['rotate', 'Rotate'],
              ['mirror', 'Mirror'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`cad-tool-${id}`}
              aria-pressed={activeTool === id}
              onClick={() => {
                setActiveTool(id);
                setPickedPoints([]);
                setGuardrailNotice(null);
              }}
              className={`rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
                activeTool === id
                  ? 'bg-[#9B6948] text-[#FCFCF7]'
                  : 'border border-[#CAD1C6] bg-[#FCFCF7] text-[#122624] hover:bg-[#E4E1D3]'
              }`}
            >
              {label}
            </button>
          ))}
          {activeTool === 'polyline' && pickedPoints.length >= 2 && (
            <button
              type="button"
              data-testid="cad-finish-polyline"
              onClick={finishPolyline}
              className="rounded bg-[#1C5148] px-2 py-1 font-mono text-[11px] font-semibold text-white"
            >
              Finish PLine ({pickedPoints.length})
            </button>
          )}
          <button
            type="button"
            data-testid="cad-tool-zoom-in"
            onClick={() => zoomBy(0.8)}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2 py-1 font-mono text-[11px]"
          >
            +
          </button>
          <button
            type="button"
            data-testid="cad-tool-zoom-out"
            onClick={() => zoomBy(1.25)}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2 py-1 font-mono text-[11px]"
          >
            −
          </button>
          <button
            type="button"
            data-testid="cad-tool-fit"
            onClick={() => setViewBox(modelBounds)}
            className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-2 py-1 font-mono text-[11px]"
          >
            Fit
          </button>
        </div>

        {/* OSNAP Toggles */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Object Snap Modes">
          <span className="font-mono text-[10px] font-bold uppercase text-[#6B7068]">OSNAP:</span>
          {(
            [
              ['endpoint', 'END'],
              ['midpoint', 'MID'],
              ['intersection', 'INT'],
              ['perpendicular', 'PERP'],
              ['center', 'CEN'],
              ['gridSnap', 'GRID'],
              ['ortho', 'ORTHO'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`cad-osnap-${key}`}
              aria-pressed={Boolean(osnap[key])}
              onClick={() => setOsnap(prev => ({ ...prev, [key]: !prev[key] }))}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                osnap[key]
                  ? 'bg-[#1C5148] text-[#F7FCF7]'
                  : 'border border-[#CAD1C6] bg-[#FCFCF7] text-[#5B635E]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Contextual Parameter Strip */}
      {(activeTool === 'offset' || activeTool === 'rotate' || activeTool === 'text' || guardrailNotice || measurementReadout || dxfExportNotice) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#CAD1C6] bg-[#FAF8F2] px-3 py-1.5 text-xs">
          {activeTool === 'offset' && (
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              Offset (mm):
              <input
                type="number"
                value={offsetDistMm}
                min={10}
                max={10000}
                onChange={e => setOffsetDistMm(Math.max(10, Number(e.target.value) || 100))}
                className="w-20 rounded border border-[#CAD1C6] bg-white px-1.5 py-0.5"
              />
            </label>
          )}
          {activeTool === 'rotate' && (
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              Angle (°):
              <input
                type="number"
                value={rotateDeg}
                onChange={e => setRotateDeg(Number(e.target.value) || 90)}
                className="w-20 rounded border border-[#CAD1C6] bg-white px-1.5 py-0.5"
              />
            </label>
          )}
          {activeTool === 'text' && (
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              Note:
              <input
                type="text"
                value={textDraftValue}
                onChange={e => setTextDraftValue(e.target.value)}
                className="w-44 rounded border border-[#CAD1C6] bg-white px-1.5 py-0.5"
              />
            </label>
          )}
          {measurementReadout && (
            <span data-testid="cad-measurement-readout" className="font-mono text-xs font-semibold text-[#1C5148]">
              {measurementReadout}
            </span>
          )}
          {guardrailNotice && (
            <span
              data-testid="cad-guardrail-banner"
              role="alert"
              className="rounded border border-[#9B6948]/50 bg-[#9B6948]/15 px-2.5 py-0.5 text-xs font-medium text-[#693D20]"
            >
              {guardrailNotice}
            </span>
          )}
          {dxfExportNotice && (
            <span data-testid="cad-dxf-export-status" className="font-mono text-xs text-[#1C5148]">
              {dxfExportNotice}
            </span>
          )}
        </div>
      )}

      {/* Main 3-Pane Precision CAD Body */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left Layer Manager */}
        <aside
          data-testid="cad-layer-manager"
          aria-label="CAD Layer Manager"
          className={`${
            mobileDrawer === 'layers' ? 'block' : 'hidden'
          } w-full shrink-0 overflow-y-auto border-b border-[#CAD1C6] bg-[#F4F4ED] p-3 lg:block lg:w-56 lg:border-b-0 lg:border-r`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6B7068]">
              CAD Layers ({cadDoc.layers.length})
            </h2>
            <button
              type="button"
              data-testid="cad-floor-lock-toggle"
              onClick={() =>
                editor.setFloorLock(
                  activeFloorId,
                  !editor.generationControl.lockedFloorIds.includes(activeFloorId),
                )
              }
              className="rounded border border-[#CAD1C6] bg-[#FCFCF7] px-1.5 py-0.5 font-mono text-[10px] font-semibold"
            >
              {editor.generationControl.lockedFloorIds.includes(activeFloorId)
                ? 'Unlock Floor'
                : 'Lock Floor'}
            </button>
          </div>
          <ul className="space-y-1 text-xs">
            {cadDoc.layers.map(layer => {
              const isVisible = layerVisibility[layer.id] !== false;
              const isLocked = layerLocks[layer.id] ?? layer.locked;
              return (
                <li
                  key={layer.id}
                  className="flex items-center justify-between gap-1 rounded border border-[#DCE0D8] bg-[#FCFCF7] px-2 py-1"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="truncate font-mono text-[11px] font-medium">{layer.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-testid={`cad-layer-vis-${layer.id}`}
                      aria-label={`Toggle ${layer.name} visibility`}
                      onClick={() =>
                        setLayerVisibility(prev => ({ ...prev, [layer.id]: !isVisible }))
                      }
                      className={`rounded px-1 py-0.5 font-mono text-[10px] ${
                        isVisible ? 'bg-[#1C5148]/15 text-[#1C5148]' : 'bg-stone-200 text-stone-500'
                      }`}
                    >
                      {isVisible ? 'ON' : 'OFF'}
                    </button>
                    {layer.origin === 'DRAFTING_ANNOTATION' && (
                      <button
                        type="button"
                        data-testid={`cad-layer-lock-${layer.id}`}
                        onClick={() =>
                          setLayerLocks(prev => ({ ...prev, [layer.id]: !isLocked }))
                        }
                        className="rounded px-1 py-0.5 font-mono text-[10px] text-[#7C4F32]"
                      >
                        {isLocked ? 'LCK' : 'EDIT'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center Warm Sheet Interactive 2D CAD Viewport */}
        <div className="relative flex min-h-[300px] min-w-0 flex-1 flex-col bg-[#FCFCF7]">
          <svg
            ref={svgRef}
            data-testid="precision-cad-svg"
            viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={handlePointerMove}
            onPointerDown={e => {
              if (activeTool === 'pan' || e.button === 1) {
                panDragRef.current = {
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  box: viewBox,
                };
              }
            }}
            onPointerUp={() => {
              panDragRef.current = null;
            }}
            onWheel={e => {
              e.preventDefault();
              zoomBy(e.deltaY > 0 ? 1.14 : 0.88);
            }}
            onClick={handleCanvasClick}
            className="h-full w-full flex-1 cursor-crosshair select-none touch-none"
          >
            <defs>
              <pattern
                id="rh-cad-grid-1m"
                width={1000}
                height={1000}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 1000 0 L 0 0 0 1000"
                  fill="none"
                  stroke="#E6E4D8"
                  strokeWidth={Math.max(4, strokeScale * 0.35)}
                />
              </pattern>
            </defs>
            <rect
              x={viewBox.minX - viewBox.width}
              y={viewBox.minY - viewBox.height}
              width={viewBox.width * 3}
              height={viewBox.height * 3}
              fill="url(#rh-cad-grid-1m)"
            />

            {/* Render CAD Entities */}
            {visibleEntities.map(ent => {
              const layerMeta = cadDoc.layers.find(l => l.id === ent.layer);
              const isSel = ent.id === selectedEntity?.id;
              const stroke = isSel ? '#C2410C' : (layerMeta?.color ?? '#1F2937');
              const weight =
                strokeScale *
                (isSel ? 2.1 : ent.layer === 'A-WALL-EXT' ? 1.5 : ent.layer === 'A-WALL-INT' ? 1.15 : 0.8);
              const dash = layerMeta?.lineType === 'DASHED' ? `${strokeScale * 4} ${strokeScale * 3}` : undefined;

              switch (ent.type) {
                case 'LINE':
                  return (
                    <line
                      key={ent.id}
                      data-entity-id={ent.id}
                      x1={ent.start.x}
                      y1={-ent.start.y}
                      x2={ent.end.x}
                      y2={-ent.end.y}
                      stroke={stroke}
                      strokeWidth={weight}
                      strokeDasharray={dash}
                      strokeLinecap="round"
                    />
                  );
                case 'POLYLINE':
                  return (
                    <polygon
                      key={ent.id}
                      data-entity-id={ent.id}
                      points={ent.vertices.map(v => `${v.x},${-v.y}`).join(' ')}
                      fill={
                        ent.layer === 'A-ROOM'
                          ? isSel
                            ? 'rgba(194,65,12,0.10)'
                            : 'rgba(155,105,72,0.04)'
                          : 'none'
                      }
                      stroke={stroke}
                      strokeWidth={weight}
                      strokeDasharray={dash}
                    />
                  );
                case 'ARC':
                  return (
                    <path
                      key={ent.id}
                      data-entity-id={ent.id}
                      d={svgArcPath(ent)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={weight}
                    />
                  );
                case 'CIRCLE':
                  return (
                    <circle
                      key={ent.id}
                      data-entity-id={ent.id}
                      cx={ent.center.x}
                      cy={-ent.center.y}
                      r={ent.radius}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={weight}
                    />
                  );
                case 'RECTANGLE':
                  return (
                    <rect
                      key={ent.id}
                      data-entity-id={ent.id}
                      x={ent.corner.x}
                      y={-(ent.corner.y + ent.height)}
                      width={ent.width}
                      height={ent.height}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={weight}
                    />
                  );
                case 'TEXT':
                  return (
                    <text
                      key={ent.id}
                      x={ent.position.x}
                      y={-ent.position.y}
                      fill={stroke}
                      fontSize={Math.max(ent.heightMm, strokeScale * 7)}
                      textAnchor={ent.justify === 'center' ? 'middle' : ent.justify === 'right' ? 'end' : 'start'}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {ent.text}
                    </text>
                  );
                case 'DIMENSION':
                  return (
                    <g key={ent.id} data-entity-id={ent.id}>
                      <line
                        x1={ent.p1.x}
                        y1={-ent.p1.y}
                        x2={ent.p2.x}
                        y2={-ent.p2.y}
                        stroke={stroke}
                        strokeWidth={strokeScale * 0.7}
                      />
                      <text
                        x={ent.textPosition.x}
                        y={-ent.textPosition.y}
                        fill={stroke}
                        fontSize={Math.max(180, strokeScale * 7.5)}
                        textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {ent.textOverride ?? `${Math.round(ent.measuredMm)} mm`}
                      </text>
                    </g>
                  );
              }
            })}

            {/* Active Rubber-band / Picked Points Preview */}
            {pickedPoints.length > 0 && (
              <polyline
                points={[...pickedPoints, snapState.point].map(p => `${p.x},${-p.y}`).join(' ')}
                fill="none"
                stroke="#0F766E"
                strokeWidth={strokeScale * 1.1}
                strokeDasharray={`${strokeScale * 3} ${strokeScale * 2}`}
              />
            )}

            {/* OSNAP Reticle */}
            {snapState.snapType && (
              <g pointerEvents="none">
                <rect
                  x={snapState.point.x - strokeScale * 4}
                  y={-snapState.point.y - strokeScale * 4}
                  width={strokeScale * 8}
                  height={strokeScale * 8}
                  fill="none"
                  stroke="#0D9488"
                  strokeWidth={strokeScale * 1.2}
                />
              </g>
            )}
          </svg>

          {/* Bottom Coordinate & OSNAP Readout Footer */}
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#CAD1C6] bg-[#EFECE1] px-3 py-1 font-mono text-[11px] text-[#354643]">
            <span data-testid="cad-cursor-readout">
              X: {Math.round(snapState.point.x)} mm · Y: {Math.round(snapState.point.y)} mm (Plan Y: {Math.round(-snapState.point.y)} mm)
            </span>
            <span data-testid="cad-snap-badge" className="font-semibold text-[#1C5148]">
              {snapState.snapType ? `OSNAP: ${snapState.snapType.toUpperCase()}` : 'OSNAP: FREE'}
            </span>
            <span>
              Entities: {visibleEntities.length} · Drafts: {currentDrafts.length}
            </span>
          </footer>
        </div>

        {/* Right Canonical Inspector & AI-Assisted CAD Edit Bridge */}
        <aside
          data-testid="cad-ai-edit-panel"
          aria-label="Canonical CAD Inspector & AI Edit Bridge"
          className={`${
            mobileDrawer === 'ai' ? 'block' : 'hidden'
          } w-full shrink-0 overflow-y-auto border-t border-[#CAD1C6] bg-[#F4F4ED] p-3 lg:block lg:w-80 lg:border-l lg:border-t-0`}
        >
          {/* Selected Entity Provenance Inspector */}
          <div data-testid="cad-entity-inspector" className="mb-3 rounded border border-[#CAD1C6] bg-[#FCFCF7] p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#7C4F32]">
                Entity Provenance
              </h3>
              {selectedEntity?.canonicalId && selectedEntity.canonicalKind === 'room' && (
                <button
                  type="button"
                  data-testid="cad-lock-room-btn"
                  onClick={() => {
                    const id = selectedEntity.canonicalId!;
                    const locked = editor.generationControl.lockedEntityIds.includes(id);
                    editor.setRoomLocks([id], !locked);
                  }}
                  className="rounded border border-[#CAD1C6] px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                >
                  {editor.generationControl.lockedEntityIds.includes(selectedEntity.canonicalId)
                    ? 'Unlock Room'
                    : 'Lock Room'}
                </button>
              )}
            </div>
            {selectedEntity ? (
              <dl className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-[#6B7068]">Handle:</dt>
                  <dd className="font-semibold">{selectedEntity.handle}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#6B7068]">Layer / Type:</dt>
                  <dd>
                    {selectedEntity.layer} · {selectedEntity.type}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#6B7068]">Origin:</dt>
                  <dd className="font-semibold text-[#1C5148]">
                    {selectedEntity.origin === 'CANONICAL_ARCHITECTURAL' ? 'CANONICAL' : 'DRAFTING'}
                  </dd>
                </div>
                {selectedEntity.canonicalId && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#6B7068]">Canonical ID:</dt>
                    <dd className="truncate" title={selectedEntity.canonicalId}>
                      {selectedEntity.canonicalId}
                    </dd>
                  </div>
                )}
                {selectedEntity.hostWallId && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#6B7068]">Host Wall:</dt>
                    <dd className="truncate" title={selectedEntity.hostWallId}>
                      {selectedEntity.hostWallId}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-xs text-[#6B7068]">
                Click any wall, room, door, window, or drafting primitive on the sheet to inspect its handle and canonical host.
              </p>
            )}
          </div>

          {/* Controlled AI-Assisted Canonical CAD Edit Bridge */}
          <div className="rounded border border-[#CAD1C6] bg-[#FCFCF7] p-2.5">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#122624]">
              AI-Assisted Canonical CAD Edit
            </h3>
            <p className="mt-1 text-[11px] text-[#5B635E]">
              Proposes verified wall, opening, or room area edits against the canonical Building model without touching unrelated flats.
            </p>

            <div className="mt-2 flex flex-wrap gap-1">
              {QUICK_AI_CAD_INSTRUCTIONS.map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => void handleRequestAiProposal(chip.prompt)}
                  className="rounded border border-[#DCE0D8] bg-[#F4F4ED] px-1.5 py-0.5 text-[10px] font-medium text-[#122624] hover:bg-[#E6E3D5]"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <label className="mt-2 block text-[11px] font-semibold" htmlFor="cad-ai-instruction">
              Architectural Instruction
            </label>
            <textarea
              id="cad-ai-instruction"
              data-testid="cad-ai-instruction-input"
              rows={2}
              value={aiInstruction}
              onChange={e => setAiInstruction(e.target.value)}
              className="mt-1 w-full rounded border border-[#CAD1C6] bg-white p-1.5 text-xs text-[#122624]"
            />

            <button
              type="button"
              data-testid="cad-ai-preview-btn"
              disabled={aiBusy || !aiInstruction.trim()}
              onClick={() => void handleRequestAiProposal()}
              className="mt-2 w-full rounded bg-[#9B6948] px-3 py-1.5 text-xs font-semibold text-[#FCFCF7] hover:bg-[#825537] disabled:opacity-50"
            >
              {aiBusy ? 'Validating Canonical Constraints...' : 'Preview Canonical Edit'}
            </button>

            {aiPreview && (
              <div
                data-testid="cad-ai-preview-card"
                className="mt-3 rounded border border-[#CAD1C6] bg-[#F8F7F1] p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-testid="cad-ai-preview-status"
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      aiPreview.proposal.status === 'PREVIEW_READY'
                        ? 'bg-[#1C5148]/15 text-[#1C5148]'
                        : 'bg-amber-800/15 text-amber-900'
                    }`}
                  >
                    {aiPreview.proposal.status}
                  </span>
                  <span className="font-mono text-[10px] text-[#6B7068]">
                    {aiPreview.providerMode}
                  </span>
                </div>

                <p className="mt-1.5 text-xs leading-relaxed text-[#122624]">
                  {aiPreview.proposal.message}
                </p>

                {aiPreview.proposal.openingSummary && (
                  <div className="mt-2 rounded bg-white p-1.5 font-mono text-[11px]">
                    Width: {aiPreview.proposal.openingSummary.beforeWidthMm} mm →{' '}
                    <strong>{aiPreview.proposal.openingSummary.afterWidthMm} mm</strong>
                  </div>
                )}

                {aiPreview.proposal.roomAreaDeltas.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded bg-white p-1.5 font-mono text-[11px]">
                    {aiPreview.proposal.roomAreaDeltas.map(delta => (
                      <li key={delta.roomId} className="flex justify-between gap-2">
                        <span className="truncate">{delta.roomName}</span>
                        <span>
                          {delta.beforeSqM} → <strong>{delta.afterSqM} m²</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {aiPreview.proposal.status === 'PREVIEW_READY' && aiPreview.proposal.proposedBuilding && (
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      data-testid="cad-ai-accept-btn"
                      onClick={handleAcceptAiProposal}
                      className="flex-1 rounded bg-[#1C5148] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#153B36]"
                    >
                      Accept Canonical Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiPreview(null)}
                      className="rounded border border-[#CAD1C6] bg-white px-2.5 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};

export default PrecisionCadWorkbench;
