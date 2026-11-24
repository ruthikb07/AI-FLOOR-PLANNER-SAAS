import React, { useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  FileUp,
  Layers,
  Loader2,
  MapPin,
  Ruler,
  X,
  AlertTriangle,
} from 'lucide-react';
import type { Building, BuildingMassingShape, IrregularPlotBoundary } from '@ai-floor-planner/core';
import {
  importCadFloorPlanLayout,
  importCadPlotLayout,
  previewCadLayout,
  type CadLayerSummary,
  type CadPreviewData,
  type CadUnitOverride,
} from '../../services/local-project-api';

export interface CadImportCommittedPayload {
  readonly building: Building;
  readonly projectName: string;
  readonly importMode: 'plot_boundary' | 'floor_plan';
  readonly plotBoundary?: IrregularPlotBoundary;
  readonly sourceCadAttachment?: {
    readonly fileName: string;
    readonly contentBase64?: string;
    readonly contentText?: string;
  };
}

interface CadImportModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onLoaded: (payload: CadImportCommittedPayload) => void;
}

const ROLE_COLORS: Record<CadLayerSummary['suggestedRole'], string> = {
  boundary: '#F59E0B',
  wall: '#F8FAFC',
  door: '#38BDF8',
  window: '#22D3EE',
  text: '#FBBF24',
  ignore: '#475569',
  other: '#94A3B8',
};

const MASSING_CHOICES: Array<{ id: BuildingMassingShape; label: string }> = [
  { id: 'IRREGULAR_ANGLED_PLOT', label: 'Irregular / CAD Site Fit' },
  { id: 'CURVED_CRESCENT', label: 'Curved Crescent' },
  { id: 'PINWHEEL_CLUSTER', label: 'Pinwheel Cluster' },
  { id: 'U_SHAPE_COURTYARD', label: 'U-Shape Courtyard' },
  { id: 'H_SHAPE_WING', label: 'H-Shape Wing' },
  { id: 'COMPACT_DOUBLE_LOADED', label: 'Compact Double Loaded' },
];

export const CadImportModal: React.FC<CadImportModalProps> = ({ isOpen, onClose, onLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<'floor_plan' | 'plot_boundary'>('floor_plan');
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState<string | undefined>(undefined);
  const [rawBase64, setRawBase64] = useState<string | undefined>(undefined);
  const [unitOverride, setUnitOverride] = useState<CadUnitOverride>('auto');
  const [preview, setPreview] = useState<CadPreviewData | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [projectName, setProjectName] = useState('');
  const [numFloors, setNumFloors] = useState(4);
  const [stackType, setStackType] = useState<'STILT_PLUS_N' | 'G_PLUS_N'>('STILT_PLUS_N');
  const [redevelopmentBase, setRedevelopmentBase] = useState(false);
  const [flatsPerFloor, setFlatsPerFloor] = useState<1 | 2 | 3 | 4 | 5 | 6>(4);
  const [massingShape, setMassingShape] = useState<BuildingMassingShape>('IRREGULAR_ANGLED_PLOT');
  const [frontSetbackM, setFrontSetbackM] = useState(4.5);
  const [rearSetbackM, setRearSetbackM] = useState(3.0);
  const [sideSetbackM, setSideSetbackM] = useState(3.0);
  const [pdfKnownLenMm, setPdfKnownLenMm] = useState(12000);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');

  const runPreview = async (
    name: string,
    opts: { contentText?: string; contentBase64?: string; unit: CadUnitOverride },
  ) => {
    setLoading(true);
    setError('');
    try {
      const data = await previewCadLayout({
        fileName: name,
        contentText: opts.contentText,
        contentBase64: opts.contentBase64,
        unitOverride: opts.unit,
        pdfCalibration: name.toLowerCase().endsWith('.pdf')
          ? {
              pointA: { x: 100, y: 100 },
              pointB: { x: 600, y: 100 },
              knownLengthMm: pdfKnownLenMm,
              imageWidthPx: 1400,
              imageHeightPx: 1000,
            }
          : undefined,
      });
      setPreview(data);
      setSelectedLayers(data.layers.filter(l => l.defaultSelected).map(l => l.name));
      // Auto-select Plot Boundary mode when only boundary layers are present
      if (data.layers.length > 0 && data.layers.every(l => l.suggestedRole === 'boundary' || l.suggestedRole === 'ignore')) {
        setImportMode('plot_boundary');
      }
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Failed to parse CAD file.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilePicked = async (file: File) => {
    setFileName(file.name);
    const stem = file.name.replace(/\.[^.]+$/, '');
    setProjectName(stem);
    setError('');
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.dxf')) {
      const text = await file.text();
      setRawText(text);
      setRawBase64(undefined);
      await runPreview(file.name, { contentText: text, unit: unitOverride });
    } else {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const b64 = btoa(binary);
      setRawText(undefined);
      setRawBase64(b64);
      await runPreview(file.name, { contentBase64: b64, unit: unitOverride });
    }
  };

  const handleUnitChange = async (nextUnit: CadUnitOverride) => {
    setUnitOverride(nextUnit);
    if (fileName && (rawText || rawBase64)) {
      await runPreview(fileName, { contentText: rawText, contentBase64: rawBase64, unit: nextUnit });
    }
  };

  const toggleLayer = (layerName: string) => {
    setSelectedLayers(prev =>
      prev.includes(layerName) ? prev.filter(l => l !== layerName) : [...prev, layerName],
    );
  };

  const handleCommit = async () => {
    if (!preview || !fileName) return;
    setCommitting(true);
    setError('');
    try {
      const common = {
        fileName,
        contentText: rawText,
        contentBase64: rawBase64,
        unitOverride,
        selectedLayers,
        projectName: projectName.trim() || preview.fileName.replace(/\.[^.]+$/, ''),
        numTypicalFloors: numFloors,
        verticalStackType: stackType,
        redevelopmentBase,
        pdfCalibration:
          preview.format === 'pdf'
            ? {
                pointA: { x: 100, y: 100 },
                pointB: { x: 600, y: 100 },
                knownLengthMm: pdfKnownLenMm,
                imageWidthPx: 1400,
                imageHeightPx: 1000,
              }
            : undefined,
      };

      const sourceCadAttachment = {
        fileName,
        contentText: rawText,
        contentBase64: rawBase64,
      };

      if (importMode === 'plot_boundary') {
        const res = await importCadPlotLayout({
          ...common,
          buildingMassingShape: massingShape,
          flatsPerFloor,
          setbacksMm: {
            front: Math.round(frontSetbackM * 1000),
            rear: Math.round(rearSetbackM * 1000),
            left: Math.round(sideSetbackM * 1000),
            right: Math.round(sideSetbackM * 1000),
          },
          generateBuilding: true,
        });
        if (!res.building) throw new Error('Plot imported, but no building was generated inside the setback envelope.');
        onLoaded({
          building: res.building,
          projectName: res.building.name,
          importMode: 'plot_boundary',
          plotBoundary: res.plotBoundary,
          sourceCadAttachment,
        });
      } else {
        const res = await importCadFloorPlanLayout(common);
        onLoaded({
          building: res.building,
          projectName: res.building.name,
          importMode: 'floor_plan',
          sourceCadAttachment,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CAD import failed.');
    } finally {
      setCommitting(false);
    }
  };

  const layerRoleMap = useMemo(() => {
    const m = new Map<string, CadLayerSummary['suggestedRole']>();
    for (const l of preview?.layers ?? []) m.set(l.name, l.suggestedRole);
    return m;
  }, [preview]);

  const visiblePolylines = useMemo(() => {
    if (!preview) return [];
    const set = new Set(selectedLayers);
    return preview.polylines.filter(pl => set.has(pl.layer));
  }, [preview, selectedLayers]);

  const visibleTexts = useMemo(() => {
    if (!preview) return [];
    const set = new Set(selectedLayers);
    return preview.texts.filter(t => set.has(t.layer));
  }, [preview, selectedLayers]);

  if (!isOpen) return null;

  const pad = preview ? Math.max(preview.boundsMm.width, preview.boundsMm.height) * 0.06 || 500 : 500;
  const vbW = Math.max(1000, (preview?.boundsMm.width ?? 10000) + pad * 2);
  const vbH = Math.max(1000, (preview?.boundsMm.height ?? 10000) + pad * 2);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(5, 7, 12, 0.78)', backdropFilter: 'blur(12px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Import CAD Layout"
      data-testid="cad-import-modal"
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(13, 17, 25, 0.94)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#F8FAFC',
        }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-500/15 border border-amber-400/35 text-amber-400">
              <FileUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-50">
                Import Local CAD Layout (.DXF / .DWG / .PDF)
              </h2>
              <p className="text-xs text-slate-400">
                Parse plot boundaries or full architectural floor plans locally into live 2D CAD, 3D BIM & Structural Framing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close CAD Import"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Controls */}
          <div className="lg:col-span-5 p-5 border-b lg:border-b-0 lg:border-r border-white/10 overflow-y-auto space-y-4">
            {/* Import Mode Selector */}
            <div>
              <span className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-2">
                Import Mode
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="cad-mode-floor-plan"
                  onClick={() => setImportMode('floor_plan')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    importMode === 'floor_plan'
                      ? 'bg-amber-500/15 border-amber-400/60 text-amber-200'
                      : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    Floor Plan Layout
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Walls, rooms, doors &amp; 3D stack
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="cad-mode-plot-boundary"
                  onClick={() => setImportMode('plot_boundary')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    importMode === 'plot_boundary'
                      ? 'bg-sky-500/15 border-sky-400/60 text-sky-200'
                      : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <MapPin className="w-3.5 h-3.5 text-sky-400" />
                    Plot Boundary
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Irregular site + setbacks
                  </div>
                </button>
              </div>
            </div>

            {/* File Dropzone */}
            <div>
              <input
                ref={fileInputRef}
                data-testid="cad-file-input"
                type="file"
                accept=".dxf,.dwg,.pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleFilePicked(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-4 rounded-xl border border-dashed border-amber-400/40 bg-amber-500/[0.04] hover:bg-amber-500/[0.09] transition-colors text-center cursor-pointer"
              >
                <FileUp className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
                <div className="text-xs font-semibold text-slate-100">
                  {fileName ? fileName : 'Choose AutoCAD .DXF, .DWG, or .PDF file'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Processed 100% locally — zero cloud upload
                </div>
              </button>
            </div>

            {/* Project Name & Unit Override */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  data-testid="cad-project-name"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="Imported CAD Project"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">
                  Drawing Units
                </label>
                <select
                  data-testid="cad-unit-select"
                  value={unitOverride}
                  onChange={e => void handleUnitChange(e.target.value as CadUnitOverride)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-400"
                >
                  <option value="auto">Auto ({preview?.detectedUnit ?? 'INSUNITS'})</option>
                  <option value="mm">Millimeters (mm)</option>
                  <option value="m">Meters (m)</option>
                  <option value="ft">Feet (ft)</option>
                  <option value="cm">Centimeters (cm)</option>
                  <option value="in">Inches (in)</option>
                </select>
              </div>
            </div>

            {/* PDF 2-point Calibration */}
            {preview?.format === 'pdf' && (
              <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-400/30 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                  <Ruler className="w-3.5 h-3.5" /> PDF 2-Point Scale Calibration
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-300">Known Wall Length (mm)</label>
                  <input
                    type="number"
                    min={1000}
                    step={100}
                    value={pdfKnownLenMm}
                    onChange={e => setPdfKnownLenMm(Math.max(1000, Number(e.target.value) || 12000))}
                    className="w-28 px-2 py-1 rounded bg-slate-950 border border-white/15 text-xs font-mono text-white"
                  />
                </div>
              </div>
            )}

            {/* Storey Count & Stack Options */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">
                  Storeys (G+1 to G+20)
                </label>
                <input
                  type="number"
                  data-testid="cad-floors-input"
                  min={1}
                  max={20}
                  value={numFloors}
                  onChange={e => setNumFloors(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">
                  Base Configuration
                </label>
                <select
                  value={stackType}
                  onChange={e => setStackType(e.target.value as 'STILT_PLUS_N' | 'G_PLUS_N')}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs text-slate-100"
                >
                  <option value="STILT_PLUS_N">Stilt + {numFloors} Floors</option>
                  <option value="G_PLUS_N">Ground + {Math.max(0, numFloors - 1)} Floors</option>
                </select>
              </div>
            </div>

            {importMode === 'floor_plan' ? (
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={redevelopmentBase}
                  onChange={e => setRedevelopmentBase(e.target.checked)}
                  className="rounded border-white/20 bg-slate-900 accent-amber-500"
                />
                Redevelopment Base Mode (retain imported floorplate for upper-storey synthesis)
              </label>
            ) : (
              <div className="space-y-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Massing Shape</label>
                    <select
                      value={massingShape}
                      onChange={e => setMassingShape(e.target.value as BuildingMassingShape)}
                      className="w-full px-2 py-1.5 rounded bg-slate-900 border border-white/10 text-xs text-slate-100"
                    >
                      {MASSING_CHOICES.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Flats / Floor</label>
                    <select
                      value={flatsPerFloor}
                      onChange={e => setFlatsPerFloor(Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6)}
                      className="w-full px-2 py-1.5 rounded bg-slate-900 border border-white/10 text-xs font-mono text-slate-100"
                    >
                      <option value={1}>1 (Villa)</option>
                      <option value={2}>2 Flats</option>
                      <option value={3}>3 Flats</option>
                      <option value={4}>4 Flats</option>
                      <option value={5}>5 Flats</option>
                      <option value={6}>6 Flats</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-0.5">Front (m)</label>
                    <input
                      type="number"
                      step={0.5}
                      value={frontSetbackM}
                      onChange={e => setFrontSetbackM(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1 rounded bg-slate-900 border border-white/10 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-0.5">Rear (m)</label>
                    <input
                      type="number"
                      step={0.5}
                      value={rearSetbackM}
                      onChange={e => setRearSetbackM(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1 rounded bg-slate-900 border border-white/10 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-0.5">Sides (m)</label>
                    <input
                      type="number"
                      step={0.5}
                      value={sideSetbackM}
                      onChange={e => setSideSetbackM(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1 rounded bg-slate-900 border border-white/10 text-xs font-mono text-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Layer Toggle List */}
            {preview && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-sky-400" /> Source CAD Layers ({selectedLayers.length}/{preview.layers.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedLayers(
                        selectedLayers.length === preview.layers.length ? [] : preview.layers.map(l => l.name),
                      )
                    }
                    className="text-[10px] font-mono text-sky-400 hover:text-sky-300 cursor-pointer"
                  >
                    {selectedLayers.length === preview.layers.length ? 'Clear All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1" data-testid="cad-layer-list">
                  {preview.layers.map(layer => {
                    const checked = selectedLayers.includes(layer.name);
                    return (
                      <label
                        key={layer.name}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                          checked
                            ? 'bg-white/[0.06] border-white/15 text-slate-100'
                            : 'bg-transparent border-white/5 text-slate-500'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLayer(layer.name)}
                            className="accent-amber-500"
                          />
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: ROLE_COLORS[layer.suggestedRole] }}
                          />
                          <span className="truncate font-mono text-[11px]">{layer.name}</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-2">
                          {layer.entityCount} · {layer.suggestedRole}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/40 text-xs text-rose-200 flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right Vector Calibration Preview */}
          <div className="lg:col-span-7 flex flex-col min-h-[340px] bg-[#080A0F] relative">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 text-[11px] font-mono text-slate-400">
              <span>VECTOR CALIBRATION PREVIEW</span>
              {preview && (
                <span className="text-amber-300 tabular-nums" data-testid="cad-preview-dimensions">
                  {(preview.boundsMm.width / 1000).toFixed(2)} m × {(preview.boundsMm.height / 1000).toFixed(2)} m ·{' '}
                  {preview.appliedUnit.toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center gap-2 text-slate-400 text-xs font-mono">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                  Parsing local CAD geometry...
                </div>
              ) : preview ? (
                <svg
                  data-testid="cad-preview-svg"
                  viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
                  className="w-full h-full max-h-[480px]"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <rect x={-pad} y={-pad} width={vbW} height={vbH} fill="#080A0F" />
                  {visiblePolylines.map((pl, idx) => {
                    const role = layerRoleMap.get(pl.layer) ?? 'other';
                    const stroke = ROLE_COLORS[role];
                    const d = pl.points
                      .map((p, pi) => `${pi === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                      .join(' ') + (pl.closed ? ' Z' : '');
                    return (
                      <path
                        key={idx}
                        d={d}
                        fill={pl.closed && role === 'boundary' ? 'rgba(245, 158, 11, 0.08)' : 'none'}
                        stroke={stroke}
                        strokeWidth={Math.max(vbW * 0.0028, 30)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {visibleTexts.map((tx, idx) => (
                    <text
                      key={`t-${idx}`}
                      x={tx.position.x}
                      y={tx.position.y}
                      fill="#FBBF24"
                      fontSize={Math.max(vbW * 0.022, 240)}
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                    >
                      {tx.text}
                    </text>
                  ))}
                </svg>
              ) : (
                <div className="text-center max-w-xs space-y-2 text-slate-500">
                  <Layers className="w-10 h-10 mx-auto text-slate-700" />
                  <p className="text-xs text-slate-400">
                    Upload a local <span className="font-mono text-amber-400">.DXF</span>,{' '}
                    <span className="font-mono text-sky-400">.DWG</span>, or{' '}
                    <span className="font-mono text-slate-200">.PDF</span> drawing to inspect layers, verify scale, and
                    import directly into 2D CAD &amp; 3D BIM.
                  </p>
                </div>
              )}
            </div>

            {preview && preview.warnings.length > 0 && (
              <div className="px-4 py-2 border-t border-white/10 bg-amber-500/10 text-[11px] text-amber-200">
                {preview.warnings.join(' · ')}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-black/30">
          <div className="text-[11px] font-mono text-slate-400">
            {preview
              ? `${visiblePolylines.length} polylines · ${visibleTexts.length} labels · ${preview.insertCount} blocks active`
              : 'Ready for local CAD ingestion'}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-white/15 text-xs font-medium text-slate-300 hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="cad-load-into-studio"
              disabled={!preview || selectedLayers.length === 0 || committing}
              onClick={() => void handleCommit()}
              className="px-5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#080A0F',
                boxShadow: '0 0 24px rgba(245, 158, 11, 0.35)',
              }}
            >
              {committing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {committing ? 'Building Canonical BIM...' : 'Load into Studio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
