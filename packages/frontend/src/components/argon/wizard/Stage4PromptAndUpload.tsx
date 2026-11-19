import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Upload,
  FileText,
  X,
  Lightbulb,
  AlertTriangle,
  Ruler,
  Compass,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { useStudioStore } from '../../../stores/useStudioStore';
import {
  REFERENCE_WORKFLOW_STAGES,
  createSampleConceptSvgDataUrl,
  createSampleSiteDxfContent,
  parseAsciiDxfSummary,
  parsePdfMetadataSummary,
  type ReferenceWorkflowStage,
  type ReferenceWorkflowState,
} from '../../../services/reference-workflow';
import { ArgonCard, ArgonBadge } from '../ui';

export const Stage4PromptAndUpload: React.FC<{ onReadingChange?: (reading: boolean) => void }> = ({ onReadingChange }) => {
  const { wizard, updateWizard, setReferenceWorkflow } = useStudioStore();
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const workflow = wizard.referenceWorkflow;
  const currentReader = useRef<FileReader>();
  const pdfSource = wizard.referenceImage?.mimeType === 'application/pdf'
    ? wizard.referenceImage.dataUrl : undefined;
  const [pdfPreview, setPdfPreview] = useState<string>();
  useEffect(() => () => {
    currentReader.current?.abort();
    onReadingChange?.(false);
  }, [onReadingChange]);
  useEffect(() => {
    setPdfPreview(undefined);
    if (!pdfSource?.startsWith('data:application/pdf;base64,')) return;
    const data = atob(pdfSource.slice(pdfSource.indexOf(',') + 1));
    const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setPdfPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfSource]);

  function setReading(reading: boolean) {
    setIsUploading(reading);
    onReadingChange?.(reading);
  }

  const promptSuggestions = [
    'Vastu-compliant residential tower with East/North living balconies and Southeast kitchens.',
    'High-end luxury apartments with generous corner balconies, double-height lobby, and dual stair cores.',
    'Compact high-efficiency investor housing with maximized carpet efficiency and centralized plumbing shafts.',
    'Modern urban facade with continuous cantilevered balconies, sun-shaded UPVC fenestrations, and cross ventilation.',
  ];

  const handleFileUpload = (file?: File) => {
    setUploadError('');
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setUploadError('File size exceeds the 25 MB limit.');
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isDxf = lowerName.endsWith('.dxf');
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isImage = ['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type) || /\.(png|jpe?g|svg)$/i.test(lowerName);

    if (!isImage && !isPdf && !isDxf) {
      setUploadError('Please select a PNG, JPG, PDF, or ASCII DXF architectural file.');
      return;
    }

    currentReader.current?.abort();
    setReading(true);

    if (isDxf) {
      const textReader = new FileReader();
      currentReader.current = textReader;
      textReader.onload = () => {
        const text = String(textReader.result ?? '');
        const dxfSummary = parseAsciiDxfSummary(text);
        const nextWorkflow: ReferenceWorkflowState = {
          stage: 'extraction',
          fileName: file.name,
          mimeType: file.type || 'application/dxf',
          sizeBytes: file.size,
          fileKind: 'cad',
          dxfSummary,
          calibrationScaleLabel: '1:100 CAD (mm)',
          calibratedWidthM: dxfSummary.boundsSpanMeters?.widthM ?? wizard.plotWidthM,
          calibratedDepthM: dxfSummary.boundsSpanMeters?.depthM ?? wizard.plotDepthM,
          northRotationDeg: 0,
          provenance: dxfSummary.entityCount > 0 ? 'ASSERTED_FROM_BRIEF' : 'AMBIGUOUS',
          userVerified: false,
          extractionNotes: `Parsed ${dxfSummary.entityCount} DXF entities across ${dxfSummary.layers.length} layer(s). Verify bounds before generation.`,
        };
        updateWizard({ referenceSketchName: file.name, referenceImage: undefined });
        setReferenceWorkflow(nextWorkflow);
        setReading(false);
      };
      textReader.onerror = () => {
        setUploadError('Failed to read the selected DXF file.');
        setReading(false);
      };
      textReader.readAsText(file);
      return;
    }

    if (isPdf) {
      const pdfReader = new FileReader();
      currentReader.current = pdfReader;
      pdfReader.onload = () => {
        const buffer = pdfReader.result as ArrayBuffer;
        const ascii = new TextDecoder('latin1').decode(new Uint8Array(buffer));
        if (!/^%PDF-\d+\.\d+/.test(ascii)) {
          setUploadError('The selected file does not have a valid PDF signature.');
          setReading(false);
          return;
        }
        const pdfSummary = parsePdfMetadataSummary(ascii);
        const nextWorkflow: ReferenceWorkflowState = {
          stage: 'extraction',
          fileName: file.name,
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          fileKind: 'pdf',
          pdfSummary,
          calibrationScaleLabel: 'Unconfirmed',
          calibratedWidthM: wizard.plotWidthM,
          calibratedDepthM: wizard.plotDepthM,
          northRotationDeg: 0,
          provenance: 'AMBIGUOUS',
          userVerified: false,
          extractionNotes:
            `PDF v${pdfSummary.version} (${pdfSummary.estimatedPageCount} page). Direct PDF-to-3D vector conversion is NOT active; verify dimensions manually below.`,
        };
        const dataReader = new FileReader();
        currentReader.current = dataReader;
        dataReader.onload = () => {
          updateWizard({
            referenceSketchName: file.name,
            referenceImage: {
              name: file.name,
              mimeType: 'application/pdf',
              dataUrl: String(dataReader.result),
            },
          });
          setReferenceWorkflow(nextWorkflow);
          setReading(false);
        };
        dataReader.onerror = () => {
          setUploadError('Failed to prepare the PDF preview.');
          setReading(false);
        };
        dataReader.readAsDataURL(new Blob([buffer], { type: 'application/pdf' }));
      };
      pdfReader.onerror = () => {
        setUploadError('Failed to read the PDF drawing.');
        setReading(false);
      };
      pdfReader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    currentReader.current = reader;
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const nextWorkflow: ReferenceWorkflowState = {
          stage: 'extraction',
          fileName: file.name,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          fileKind: 'image',
          imageDimensionsPx: { width: img.naturalWidth, height: img.naturalHeight },
          calibrationScaleLabel: '1:100 Architectural Reference',
          calibratedWidthM: wizard.plotWidthM,
          calibratedDepthM: wizard.plotDepthM,
          northRotationDeg: 0,
          provenance: 'ASSERTED_FROM_BRIEF',
          userVerified: false,
          extractionNotes: `Extracted ${img.naturalWidth}×${img.naturalHeight} px sketch. Used as advisory visual context only.`,
        };
        updateWizard({
          referenceSketchName: file.name,
          referenceImage: { name: file.name, mimeType: file.type || 'image/png', dataUrl },
        });
        setReferenceWorkflow(nextWorkflow);
        setReading(false);
      };
      img.onerror = () => {
        updateWizard({
          referenceSketchName: file.name,
          referenceImage: { name: file.name, mimeType: file.type || 'image/png', dataUrl },
        });
        setReferenceWorkflow({
          stage: 'extraction',
          fileName: file.name,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          fileKind: 'image',
          calibrationScaleLabel: '1:100 Architectural Reference',
          calibratedWidthM: wizard.plotWidthM,
          calibratedDepthM: wizard.plotDepthM,
          northRotationDeg: 0,
          provenance: 'AMBIGUOUS',
          userVerified: false,
          extractionNotes: 'Image loaded; calibrate frontage and confirm bounds below.',
        });
        setReading(false);
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      setUploadError('Failed to read the selected file.');
      setReading(false);
    };
    reader.readAsDataURL(file);
  };

  const loadSampleReference = (kind: 'sketch' | 'dxf') => {
    setUploadError('');
    if (kind === 'dxf') {
      const content = createSampleSiteDxfContent(wizard.plotWidthM, wizard.plotDepthM);
      const dxfSummary = parseAsciiDxfSummary(content);
      updateWizard({ referenceSketchName: 'sample-survey-plot.dxf', referenceImage: undefined });
      setReferenceWorkflow({
        stage: 'calibration',
        fileName: 'sample-survey-plot.dxf',
        mimeType: 'application/dxf',
        sizeBytes: content.length,
        fileKind: 'cad',
        dxfSummary,
        calibrationScaleLabel: '1:100 CAD (mm)',
        calibratedWidthM: dxfSummary.boundsSpanMeters?.widthM ?? wizard.plotWidthM,
        calibratedDepthM: dxfSummary.boundsSpanMeters?.depthM ?? wizard.plotDepthM,
        northRotationDeg: 0,
        provenance: 'ASSERTED_FROM_BRIEF',
        userVerified: false,
        extractionNotes: `Sample DXF loaded: ${dxfSummary.entityCount} entities (${dxfSummary.layers.join(', ')}).`,
      });
    } else {
      const dataUrl = createSampleConceptSvgDataUrl(wizard.plotWidthM, wizard.plotDepthM);
      updateWizard({
        referenceSketchName: 'sample-h-wing-concept.svg',
        referenceImage: {
          name: 'sample-h-wing-concept.svg',
          mimeType: 'image/svg+xml',
          dataUrl,
        },
      });
      setReferenceWorkflow({
        stage: 'calibration',
        fileName: 'sample-h-wing-concept.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: dataUrl.length,
        fileKind: 'image',
        imageDimensionsPx: { width: 800, height: 600 },
        calibrationScaleLabel: '1:100 Concept Overlay',
        calibratedWidthM: wizard.plotWidthM,
        calibratedDepthM: wizard.plotDepthM,
        northRotationDeg: 0,
        provenance: 'ASSERTED_FROM_BRIEF',
        userVerified: false,
        extractionNotes: 'Sample H-wing concept diagram extracted (800×600 px). Calibrate and verify before solver handoff.',
      });
    }
  };

  const clearUploadedFile = () => {
    updateWizard({ referenceSketchName: undefined, referenceImage: undefined });
    setReferenceWorkflow(undefined);
    setUploadError('');
  };

  const advanceWorkflowStage = (stage: ReferenceWorkflowStage) => {
    if (!workflow) return;
    setReferenceWorkflow({ ...workflow, stage });
  };

  const applyCalibrationToPlot = () => {
    if (!workflow || wizard.siteGeometryMode === 'survey') return;
    updateWizard({
      plotWidthM: Math.max(8, workflow.calibratedWidthM),
      plotDepthM: Math.max(8, workflow.calibratedDepthM),
    });
    setReferenceWorkflow({ ...workflow, stage: 'verification' });
  };

  const activeStageIndex = workflow
    ? REFERENCE_WORKFLOW_STAGES.findIndex(s => s.id === workflow.stage)
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Architectural Design Brief & Directives */}
      <ArgonCard className="rh-brief-notebook space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-argon-accent" />
            <span>Architectural Design Brief &amp; Directives</span>
          </h3>
          <ArgonBadge variant="leather" size="sm">
            Design Intent
          </ArgonBadge>
        </div>

        <p className="text-xs text-argon-muted leading-relaxed">
          Provide contextual instructions or design principles to guide floor plan synthesis, spatial zoning, and facade fenestration.
        </p>

        <textarea
          aria-label="Architectural brief"
          rows={5}
          value={wizard.aiPrompt}
          onChange={(e) => updateWizard({ aiPrompt: e.target.value })}
          placeholder="Describe room layout preferences, orientation priorities, circulation requirements, or architectural style..."
          className="w-full bg-argon-card text-argon-text border border-argon-border rounded-xl p-4 text-sm font-sans focus:outline-none focus:border-argon-btn focus:ring-1 focus:ring-argon-btn transition-colors placeholder:text-argon-muted/50 leading-relaxed"
        />

        {/* Prompt Suggestions Chips */}
        <div className="space-y-2 pt-1">
          <div className="text-[11px] font-mono text-argon-muted flex items-center gap-1.5 font-semibold uppercase">
            <Lightbulb className="w-3.5 h-3.5 text-argon-warn" />
            <span>Add a design requirement</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {promptSuggestions.map((prompt, i) => (
              <button
                key={i}
                type="button"
                disabled={wizard.aiPrompt.includes(prompt)}
                onClick={() => updateWizard({ aiPrompt: [wizard.aiPrompt.trim(), prompt].filter(Boolean).join('\n\n') })}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </ArgonCard>

      {/* 5-Stage Reference Workflow: Upload -> Extraction -> Calibration -> User Verification -> Model Generation */}
      <ArgonCard className="rh-reference-desk space-y-4" data-testid="reference-workflow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Upload className="w-4 h-4 text-argon-btn" />
            <span>PDF / CAD / Image Reference Pipeline (5 Stages)</span>
          </h3>
          <span className="text-xs text-argon-muted font-mono">PNG, JPG, PDF, ASCII DXF up to 25MB</span>
        </div>

        {/* 5-Stage Interactive Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="reference-stage-stepper">
          {REFERENCE_WORKFLOW_STAGES.map((stage, idx) => {
            const reached = workflow ? idx <= activeStageIndex : idx === 0;
            const current = workflow ? workflow.stage === stage.id : idx === 0;
            return (
              <button
                key={stage.id}
                type="button"
                disabled={!workflow && idx > 0}
                onClick={() => advanceWorkflowStage(stage.id)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  current
                    ? 'bg-argon-btn text-argon-card border-argon-btn shadow-xs'
                    : reached
                      ? 'bg-argon-card border-argon-pass/50 text-argon-text'
                      : 'bg-argon-surface/40 border-argon-border/60 text-argon-muted opacity-60'
                }`}
              >
                <div className="text-[11px] font-mono font-bold">{stage.label}</div>
                <div className="text-[10px] opacity-80 truncate">{stage.summary}</div>
              </button>
            );
          })}
        </div>

        {!workflow ? (
          <div className="border-2 border-dashed border-argon-border rounded-xl p-6 text-center bg-argon-surface/30 hover:bg-argon-surface/60 transition-colors space-y-4">
            <div className="w-12 h-12 rounded-xl bg-argon-accent/20 border border-argon-accent/40 text-argon-btn flex items-center justify-center mx-auto">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-argon-text">
                Upload Architectural Reference Drawing or Test a Sample
              </h4>
              <p className="text-xs text-argon-muted mt-1 max-w-lg mx-auto">
                Extract image pixel dimensions, ASCII DXF layers/bounds, or PDF page metrics. PDF files remain advisory-only and require user verification before deterministic generation.
              </p>
            </div>

            <input
              type="file"
              id="argon-ref-upload"
              accept="image/png,image/jpeg,application/pdf,.dxf"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <label
                htmlFor="argon-ref-upload"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-argon-btn hover:bg-argon-btnHover text-argon-card text-xs font-bold cursor-pointer transition-colors shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploading ? 'Parsing Drawing...' : 'Browse Local File...'}</span>
              </label>

              <button
                type="button"
                data-testid="btn-load-sample-sketch"
                onClick={() => loadSampleReference('sketch')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-argon-border bg-argon-card hover:bg-argon-surface text-xs font-mono font-semibold text-argon-text"
              >
                <Layers className="w-3.5 h-3.5 text-argon-btn" /> Load Sample H-Wing Sketch
              </button>

              <button
                type="button"
                data-testid="btn-load-sample-dxf"
                onClick={() => loadSampleReference('dxf')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-argon-border bg-argon-card hover:bg-argon-surface text-xs font-mono font-semibold text-argon-text"
              >
                <FileText className="w-3.5 h-3.5 text-argon-btn" /> Load Sample Site DXF
              </button>
            </div>

            {uploadError && (
              <p role="alert" className="text-xs text-argon-error font-medium">
                {uploadError}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Uploaded Header Strip */}
            <div className="p-3.5 bg-argon-surface/80 border border-argon-border rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-argon-btn/15 border border-argon-btn/30 text-argon-btn flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-argon-text truncate font-mono">
                    {workflow.fileName}
                  </div>
                  <div className="text-[11px] text-argon-muted font-mono">
                    {workflow.fileKind.toUpperCase()} • {(workflow.sizeBytes / 1024).toFixed(1)} KB • Provenance: {workflow.provenance}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={clearUploadedFile}
                aria-label="Remove uploaded reference"
                className="p-1.5 rounded-lg text-argon-muted hover:text-argon-error hover:bg-argon-error/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Honest PDF Warning */}
            {workflow.fileKind === 'pdf' && (
              <div className="rounded-lg border border-argon-border p-3">
                <h4 className="font-semibold">PDF page preview</h4>
                {pdfPreview ? (
                  <>
                    <iframe className="mt-2 h-72 w-full" src={pdfPreview} title="Reference PDF page preview" />
                    <a className="mt-2 inline-flex underline" href={pdfPreview} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a>
                  </>
                ) : <p>Reattach the PDF to open the pages. Saved reference notes remain available.</p>}
              </div>
            )}
            {workflow.fileKind === 'pdf' && workflow.pdfSummary && (
              <div
                data-testid="pdf-conversion-disclaimer"
                className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong>
                    PDF metadata · v{workflow.pdfSummary.version} · estimated pages {workflow.pdfSummary.estimatedPageCount}
                  </strong>
                  <p>
                    Drawing recognition and model reconstruction require manual input. Confirm source dimensions below.{' '}
                    {workflow.pdfSummary.mediaBoxPt
                      ? `MediaBox ratio ${workflow.pdfSummary.aspectRatio ?? 'N/A'}. `
                      : ''}
                    Raw vector PDF linework is not converted directly to 3D solids yet. Calibrate plot frontage/depth and confirm bounds below so deterministic engines generate exact geometry.
                  </p>
                </div>
              </div>
            )}

            {/* Extraction & Visual Inspection */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-argon-border bg-argon-surface/40 space-y-2.5 text-xs">
                <div className="font-mono font-bold uppercase text-[11px] text-argon-btn">
                  02 • Extraction Diagnostics
                </div>
                <p className="text-argon-text">{workflow.extractionNotes}</p>

                {workflow.dxfSummary && (
                  <div className="p-2.5 rounded-lg bg-argon-card border border-argon-border font-mono text-[11px] space-y-1">
                    <div>Entities: {workflow.dxfSummary.entityCount} (Lines: {workflow.dxfSummary.lineCount}, Polylines: {workflow.dxfSummary.polylineCount})</div>
                    <div>Layers ({workflow.dxfSummary.layers.length}): {workflow.dxfSummary.layers.join(', ') || 'Default'}</div>
                    {workflow.dxfSummary.boundsSpanMeters && (
                      <div>Extracted Extents: {workflow.dxfSummary.boundsSpanMeters.widthM}m × {workflow.dxfSummary.boundsSpanMeters.depthM}m</div>
                    )}
                  </div>
                )}

                {wizard.referenceImage && workflow.fileKind === 'image' && (
                  <div className="rounded-lg overflow-hidden border border-argon-border bg-white max-h-44 flex items-center justify-center">
                    <img
                      src={wizard.referenceImage.dataUrl}
                      alt={workflow.fileName}
                      className="max-h-44 w-auto object-contain"
                    />
                  </div>
                )}
              </div>

              {/* Calibration & Verification Controls */}
              <div className="p-4 rounded-xl border border-argon-border bg-argon-surface/40 space-y-3 text-xs">
                <div className="font-mono font-bold uppercase text-[11px] text-argon-btn flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5" /> 03 &amp; 04 • Scale Calibration &amp; Verification
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="font-mono text-[11px] text-argon-muted">Calibrated Width (m)</span>
                    <input
                      type="number"
                      min={6}
                      step="any"
                      value={workflow.calibratedWidthM}
                      onChange={(e) =>
                        setReferenceWorkflow({
                          ...workflow,
                          stage: 'calibration',
                          calibratedWidthM: Math.max(6, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded-lg border border-argon-border px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-mono text-[11px] text-argon-muted">Calibrated Depth (m)</span>
                    <input
                      type="number"
                      min={6}
                      step="any"
                      value={workflow.calibratedDepthM}
                      onChange={(e) =>
                        setReferenceWorkflow({
                          ...workflow,
                          stage: 'calibration',
                          calibratedDepthM: Math.max(6, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded-lg border border-argon-border px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {wizard.siteGeometryMode === 'survey' ? <p>Enter the survey measurements in Plot &amp; Type.</p> : <button
                    type="button"
                    data-testid="btn-apply-calibration"
                    onClick={applyCalibrationToPlot}
                    className="px-3 py-1.5 rounded-lg bg-argon-btn text-argon-card font-bold text-xs hover:bg-argon-btnHover"
                  >
                    Apply Calibrated Plot Size ({workflow.calibratedWidthM}m × {workflow.calibratedDepthM}m)
                  </button>}
                  <button
                    type="button"
                    onClick={() =>
                      setReferenceWorkflow({
                        ...workflow,
                        northRotationDeg: (((workflow.northRotationDeg + 90) % 360) as 0 | 90 | 180 | 270),
                      })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-argon-border bg-argon-card font-mono text-[11px]"
                  >
                    <Compass className="w-3.5 h-3.5" /> North: {workflow.northRotationDeg}°
                  </button>
                </div>

                <label className="flex items-start gap-2.5 pt-2 border-t border-argon-border/60 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="checkbox-reference-verified"
                    checked={workflow.userVerified}
                    onChange={(e) =>
                      setReferenceWorkflow({
                        ...workflow,
                        userVerified: e.target.checked,
                        provenance: e.target.checked ? 'VERIFIED_FROM_SOURCE' : 'ASSERTED_FROM_BRIEF',
                        stage: e.target.checked ? 'generation' : 'verification',
                      })
                    }
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span className="text-[11px] leading-snug text-argon-text">
                    <strong className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-argon-pass" />
                      User Verification Complete ({workflow.userVerified ? 'VERIFIED_FROM_SOURCE -> Ready for Generation' : 'Verification Pending'})
                    </strong>
                    <span className="text-argon-muted block mt-0.5">
                      Confirm bounds and unit counts below before invoking the deterministic planning solver.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
      </ArgonCard>
    </div>
  );
};
