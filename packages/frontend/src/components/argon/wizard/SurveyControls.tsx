import { useRef, useState } from 'react';
import { Download, FileUp, Plus, Trash2 } from 'lucide-react';
import {
  inputMeasure, parseSurveyMeasure, showMeasure, surveyEdgeLabel, surveyIssueText, surveyLabel, surveyTemplates,
  type SurveyMode, type SurveyRow, type SurveyTemplate, type SurveyUnit,
} from '../../../services/survey-draft';
import { readSurveyDxf } from '../../../services/survey-dxf';
import type { SurveyEditor } from './useSurveyEditor';

type Edit = Pick<SurveyEditor, 'beginEdit' | 'finishEdit'>;
const units: SurveyUnit[] = ['m', 'mm', 'ft', 'in'];

function Measurement({ label, value, unit, onChange, edit }: {
  label: string; value: number | null; unit?: SurveyUnit; onChange: (value: number | null) => void; edit: Edit;
}) {
  const [entered, setEntered] = useState<string>();
  const formatted = value === null ? '' : inputMeasure(value, unit ?? 'mm');
  return <label className="rh-survey-field">
    <span>{label}</span>
    <input type="text" inputMode={unit === 'ft' || unit === 'in' ? 'text' : 'decimal'}
      value={entered ?? formatted}
      onFocus={() => { edit.beginEdit(); setEntered(formatted); }}
      onBlur={() => { setEntered(undefined); edit.finishEdit(); }}
      onChange={event => { setEntered(event.target.value); onChange(parseSurveyMeasure(event.target.value, unit ?? 'mm')); }} />
  </label>;
}

export function SurveyModeChoice({ survey }: { survey: SurveyEditor }) {
  return <section className="rh-survey-mode" aria-labelledby="site-definition-heading">
    <h3 id="site-definition-heading">Define the site boundary</h3>
    <div role="group" aria-label="Site geometry">
      <button type="button" aria-pressed={!survey.active} onClick={() => survey.setActive(false)}>Rectangular site</button>
      <button type="button" aria-pressed={survey.active} onClick={() => survey.setActive(true)}>Surveyed boundary</button>
    </div>
  </section>;
}

export function SurveyControls({ survey, roadWidthM, onRoadWidthChange }: {
  survey: SurveyEditor; roadWidthM: number; onRoadWidthChange: (width: number) => void;
}) {
  const { draft, boundary, envelope, selected } = survey;
  const { unit, rows, mode } = draft;
  const row = rows[selected];
  const vertex = surveyLabel(selected);
  const edge = row ? surveyEdgeLabel(selected, rows.length) : '';
  const current = boundary.edges[selected];
  const uploaded = useRef<HTMLInputElement>(null);
  const [importUnit, setImportUnit] = useState<SurveyUnit | ''>('');
  const [importing, setImporting] = useState(false);
  const [fileError, setFileError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const editRow = (field: keyof SurveyRow, value: number | null) => survey.editRow(selected, { [field]: value });
  const fromFile = async (file: File) => {
    setFileError('');
    setImporting(true);
    try {
      survey.change(readSurveyDxf(await file.text(), importUnit || undefined, unit, file.name));
      survey.setSelected(0);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The DXF could not be read.');
    } finally {
      setImporting(false);
    }
  };
  const downloadBoundary = async () => {
    setExportError('');
    setExporting(true);
    try {
      const response = await fetch('/api/v1/export/survey-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: boundary.points, sweepsDeg: rows.map(row => row.sweepDeg), roadEdge: draft.roadEdge }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message ?? `Boundary export failed (${response.status}).`);
      }
      const artifact = await response.blob();
      if (artifact.type !== 'application/dxf' || !artifact.size) throw new Error('The server did not return a boundary DXF.');
      const url = URL.createObjectURL(artifact);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'survey-boundary.dxf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The boundary DXF could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return <section className="rh-survey-controls" aria-labelledby="survey-fields-heading">
    <header>
      <h3 id="survey-fields-heading">Survey geometry</h3>
      <p>Enter east and south coordinates or a measured traverse. Bearings run clockwise from north.</p>
    </header>
    <div className="rh-survey-fields">
      <label className="rh-survey-field"><span>Starting outline</span>
        <select value="" onChange={event => survey.setTemplate(event.target.value as SurveyTemplate)}>
          <option value="" disabled>Choose an editable outline</option>
          {surveyTemplates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
        </select>
      </label>
      <label className="rh-survey-field"><span>Survey input</span>
        <select value={mode} disabled={rows.length > 0 && !boundary.metrics} onChange={event => survey.setMode(event.target.value as SurveyMode)}>
          <option value="coordinates">Vertex coordinates / drawing</option>
          <option value="bearings">Lengths and bearings</option>
          <option value="angles">Lengths and corner angles</option>
        </select>
      </label>
      <label className="rh-survey-field"><span>Display units</span>
        <select value={unit} onChange={event => survey.change({ ...draft, unit: event.target.value as SurveyUnit })}>
          {units.map(option => <option value={option} key={option}>{option}</option>)}
        </select>
      </label>
      <label className="rh-survey-field"><span>Road-facing edge</span>
        <select value={draft.roadEdge ?? ''} onChange={event => survey.change({ ...draft, roadEdge: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">Choose frontage</option>
          {rows.map((_, index) => <option value={index} key={index}>{surveyEdgeLabel(index, rows.length)}</option>)}
        </select>
      </label>
      <label className="rh-survey-field"><span>Right-of-way width (m)</span>
        <input type="number" min="0" step="any" value={roadWidthM}
          onChange={event => onRoadWidthChange(Math.max(0, Number(event.target.value)))} />
      </label>
      {mode === 'angles' && <>
        <Measurement label="Starting bearing (°)" value={draft.startingBearingDeg} edit={survey}
          onChange={value => survey.change({ ...draft, startingBearingDeg: value })} />
        <label className="rh-survey-field"><span>Traverse direction</span>
          <select value={draft.clockwise ? 'cw' : 'ccw'} onChange={event => survey.change({ ...draft, clockwise: event.target.value === 'cw' })}>
            <option value="cw">Clockwise</option><option value="ccw">Counterclockwise</option>
          </select>
        </label>
      </>}
    </div>
    {(unit === 'ft' || unit === 'in') && <p>Enter decimals or fractions such as 12 3/8 in the selected unit.</p>}
    {mode !== 'coordinates' && <p>Traverse lengths, bearings and angles follow the chords between vertices. The drawing shows the curved edge length and the angle between tangents.</p>}
    <div className="rh-survey-boundary-list" aria-label="Boundary vertices">
      {rows.map((_, index) => <button type="button" aria-label={`Select vertex ${surveyLabel(index)}`} key={index}
        aria-pressed={selected === index} onClick={() => survey.setSelected(index)}>{surveyLabel(index)}</button>)}
      <button type="button" onClick={() => survey.add()}><Plus size={14} /> Add vertex</button>
    </div>
    {row && <div className="rh-survey-inspector" key={selected}>
      <div className="rh-survey-inspector-title">
        <h4>Vertex {vertex} <span>·</span> Edge {edge}</h4>
        <button type="button" aria-label={`Remove vertex ${vertex}`} title={`Remove vertex ${vertex}`} onClick={() => survey.remove(selected)}><Trash2 size={16} /></button>
      </div>
      <div className="rh-survey-fields">
        {mode === 'coordinates' ? <>
          <Measurement label={`East ${vertex} (${unit})`} value={row.xMm} unit={unit} edit={survey} onChange={value => editRow('xMm', value)} />
          <Measurement label={`South ${vertex} (${unit})`} value={row.yMm} unit={unit} edit={survey} onChange={value => editRow('yMm', value)} />
        </> : <>
          <Measurement label={`Length ${edge} (${unit})`} value={row.lengthMm} unit={unit} edit={survey} onChange={value => editRow('lengthMm', value)} />
          {mode === 'angles'
            ? <Measurement label={`Interior angle ${vertex} (°)`} value={row.angleDeg} edit={survey} onChange={value => editRow('angleDeg', value)} />
            : <Measurement label={`Bearing ${edge} (°)`} value={row.bearingDeg} edit={survey} onChange={value => editRow('bearingDeg', value)} />}
        </>}
        <label className="rh-survey-field"><span>Edge geometry</span>
          <select value={row.sweepDeg === 0 ? 'line' : 'arc'} onChange={event => editRow('sweepDeg', event.target.value === 'line' ? 0 : 60)}>
            <option value="line">Straight</option><option value="arc">Circular arc</option>
          </select>
        </label>
        <Measurement label={`Inward setback (${unit})`} value={row.setbackMm} unit={unit} edit={survey} onChange={value => editRow('setbackMm', value)} />
        {row.sweepDeg !== 0 && <Measurement label="Signed sweep (°)" value={row.sweepDeg} edit={survey} onChange={value => editRow('sweepDeg', value === 0 ? null : value)} />}
      </div>
      {row.sweepDeg !== 0 && <p>Use a positive sweep for clockwise and a negative sweep for counterclockwise.</p>}
      {current && <p className="rh-survey-readout">
        {current.arc ? `Radius ${showMeasure(current.arc.radiusMm, unit)} ${unit} · chord ${showMeasure(current.chordMm, unit)} ${unit} · ` : ''}
        Bearing {current.bearingDeg.toFixed(2)}°
      </p>}
    </div>}
    {boundary.issues.length > 0
      ? <ul className="rh-survey-message is-error" role="status">{boundary.issues.map((issue, index) => <li key={index}>{surveyIssueText(issue, draft)}</li>)}</ul>
      : boundary.metrics && <div className="rh-survey-message" role="status">
        <p>Closed · {boundary.metrics.clockwise ? 'clockwise' : 'counterclockwise'} · extent {showMeasure(boundary.metrics.bounds.width, unit)} × {showMeasure(boundary.metrics.bounds.height, unit)} {unit}</p>
        {envelope?.points.length === 0 ? <p>The entered setbacks consume the entire site.</p>
          : !envelope && <p>Setback preview requires a convex, straight boundary and a nonnegative offset on each edge.</p>}
        {envelope && envelope.points.length > 0 && <p>Envelope uses your entered setbacks. Check applicable regulations separately.</p>}
      </div>}
    <details className="rh-survey-import">
      <summary>Import a surveyed boundary</summary>
      <p>Use an ASCII DXF with one closed model-space lightweight polyline and the Y-axis pointing north. Select the source units if the drawing has no unit declaration. For a PDF, use Reference Upload and enter the measurements manually.</p>
      <div className="rh-survey-import-actions">
        <label className="rh-survey-field"><span>DXF source units</span>
          <select value={importUnit} disabled={importing} onChange={event => setImportUnit(event.target.value as SurveyUnit | '')}>
            <option value="">Use drawing units</option>
            {units.map(option => <option value={option} key={option}>{option}</option>)}
          </select>
        </label>
        <button type="button" disabled={importing} onClick={() => uploaded.current?.click()}><FileUp size={16} /> {importing ? 'Reading DXF' : 'Choose DXF'}</button>
        <input ref={uploaded} hidden type="file" accept=".dxf" aria-label="Survey boundary DXF" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void fromFile(file);
        }} />
      </div>
      {draft.sourceFile && <p>Source · {draft.sourceFile}</p>}
      {fileError && <p role="alert">{fileError}</p>}
    </details>
    <div className="rh-survey-download">
      <button type="button" disabled={!boundary.metrics || importing || exporting} onClick={() => void downloadBoundary()}>
        <Download size={16} /> {exporting ? 'Preparing boundary DXF' : 'Download boundary DXF'}
      </button>
      <p>Exports the site outline and any selected road frontage in millimetres.</p>
      {exportError && <p role="alert">{exportError}</p>}
    </div>
  </section>;
}
