import { useMemo, useRef, useState } from 'react';
import type { Point } from '@ai-floor-planner/core';
import { surveySetbackEnvelope } from '@ai-floor-planner/geometry-engine';
import {
  addSurveyVertex, createSurveyDraft, removeSurveyVertex, resolveSurveyDraft, switchSurveyMode,
  type SurveyDraft, type SurveyMode, type SurveyRow, type SurveyTemplate,
} from '../../../services/survey-draft';
import type { WizardState } from '../../../stores/useStudioStore';

export function useSurveyEditor(wizard: WizardState, patch: (value: Partial<WizardState>) => void) {
  const width = wizard.plotWidthM * 1000;
  const depth = wizard.plotDepthM * 1000;
  const draft = useMemo(() => wizard.surveyDraft ?? createSurveyDraft('custom', width, depth), [wizard.surveyDraft, width, depth]);
  const boundary = useMemo(() => resolveSurveyDraft(draft), [draft]);
  const envelope = useMemo(() => surveySetbackEnvelope(boundary, draft.rows.map(row => row.setbackMm)), [boundary, draft.rows]);
  const [selected, setSelected] = useState(0);
  const [past, setPast] = useState<SurveyDraft[]>([]);
  const [future, setFuture] = useState<SurveyDraft[]>([]);
  const editStart = useRef<SurveyDraft | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const active = wizard.siteGeometryMode === 'survey';

  const publish = (next: SurveyDraft) => {
    latest.current = next;
    patch({ surveyDraft: next });
  };
  const change = (next: SurveyDraft) => {
    const current = latest.current;
    if (next === current) return;
    if (!editStart.current) {
      setPast(items => [...items, current].slice(-100));
      setFuture([]);
    }
    publish(next);
  };
  const beginEdit = () => { editStart.current = latest.current; };
  const finishEdit = () => {
    const initial = editStart.current;
    editStart.current = null;
    if (!initial || initial === latest.current) return;
    setPast(items => [...items, initial].slice(-100));
    setFuture([]);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    const current = latest.current;
    setPast(items => items.slice(0, -1));
    setFuture(items => [...items, current]);
    publish(previous);
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    const current = latest.current;
    setPast(items => [...items, current]);
    setFuture(items => items.slice(0, -1));
    publish(next);
  };
  const editRow = (index: number, value: Partial<SurveyRow>) => {
    const current = latest.current;
    change({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, ...value } : row) });
  };
  const add = (point?: Point) => {
    setSelected(latest.current.rows.length);
    change(addSurveyVertex(latest.current, point));
  };
  const remove = (index: number) => {
    setSelected(Math.max(0, index - 1));
    change(removeSurveyVertex(latest.current, index));
  };
  return {
    active, draft, boundary, envelope, width, depth,
    selected: Math.max(0, Math.min(selected, draft.rows.length - 1)), setSelected,
    change, editRow, add, remove, beginEdit, finishEdit,
    undo, redo, canUndo: past.length > 0, canRedo: future.length > 0,
    setActive: (survey: boolean) => patch({ siteGeometryMode: survey ? 'survey' : 'rectangle', ...(survey && { surveyDraft: draft }) }),
    setTemplate: (template: SurveyTemplate) => {
      setSelected(0);
      change(createSurveyDraft(template, width, depth, draft.unit));
    },
    setMode: (mode: SurveyMode) => change(switchSurveyMode(draft, mode, boundary)),
  };
}

export type SurveyEditor = ReturnType<typeof useSurveyEditor>;
