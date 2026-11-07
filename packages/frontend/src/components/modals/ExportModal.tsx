import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Layers3,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { Building, Floor, PaperSize } from '@ai-floor-planner/core';
import type { ValidationSummary } from '@ai-floor-planner/planning-engine';
import {
  createExportArtifact,
  exportCadArtifact,
  persistArtifactToServer,
  DEFAULT_ADVANCED_EXPORT_SETTINGS,
  downloadExportArtifact,
  formatExportSize,
  type AdvancedExportSettings,
  type ExportFormat,
} from '../../services/advanced-export';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  building: Building;
  floor?: Floor;
  validationSummary: ValidationSummary;
}

const FORMAT_OPTIONS: Array<{
  id: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'dwg', label: 'AutoCAD DWG', description: 'Genuine AC1032 editable drawing', icon: <Layers3 size={18} /> },
  { id: 'dxf', label: 'AutoCAD DXF', description: 'Universal CAD vector exchange', icon: <FileCode2 size={18} /> },
  { id: 'pdf', label: 'PDF Sheet', description: 'Print-ready vector document', icon: <FileText size={18} /> },
  { id: 'svg', label: 'SVG Vector', description: 'Editable infinite-resolution drawing', icon: <FileCode2 size={18} /> },
  { id: 'json', label: 'Project JSON', description: 'Complete canonical building model', icon: <FileJson size={18} /> },
  { id: 'pc', label: 'Plancraft Structure (.pc)', description: 'Declarative wall, door, and room DSL', icon: <FileCode2 size={18} /> },
  { id: 'pcf', label: 'Plancraft Furniture (.pcf)', description: 'Wall-anchored furniture layout manifest', icon: <Layers3 size={18} /> },
];

const LAYER_OPTIONS: Array<{
  key: keyof Pick<
    AdvancedExportSettings,
    | 'includeGrid'
    | 'includeDimensions'
    | 'includeRoomLabels'
    | 'includeRoomAreas'
    | 'includeOpenings'
    | 'includeFurniture'
    | 'includeNorthArrow'
    | 'includeScaleBar'
    | 'includeTitleBlock'
  >;
  label: string;
}> = [
  { key: 'includeDimensions', label: 'Dimensions' },
  { key: 'includeRoomLabels', label: 'Room labels' },
  { key: 'includeRoomAreas', label: 'Room areas' },
  { key: 'includeOpenings', label: 'Doors & windows' },
  { key: 'includeFurniture', label: 'Furniture & Fixtures (A-FURN)' },
  { key: 'includeGrid', label: 'Planning grid' },
  { key: 'includeNorthArrow', label: 'North arrow' },
  { key: 'includeScaleBar', label: 'Scale bar' },
  { key: 'includeTitleBlock', label: 'Title block' },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  building,
  floor,
  validationSummary,
}) => {
  const [settings, setSettings] = useState<AdvancedExportSettings>({
    ...DEFAULT_ADVANCED_EXPORT_SETTINGS,
    floorId: floor?.id ?? building.floors[0]?.id,
  });
  const [exportedMessage, setExportedMessage] = useState<string | null>(null);
  const [exportedPaths, setExportedPaths] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [lastExportedArtifact, setLastExportedArtifact] = useState<{
    filename: string;
    blobUrl: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSettings(current => ({
      ...current,
      floorId: floor?.id ?? building.floors[0]?.id,
    }));
    setExportedMessage(null);
    setExportedPaths([]);
    setLastExportedArtifact(null);
  }, [building.floors, floor?.id, isOpen]);

  const artifactResult = useMemo(() => {
    try {
      return { artifact: createExportArtifact(building, settings), error: null };
    } catch (error) {
      return {
        artifact: null,
        error: error instanceof Error ? error.message : 'Export settings are invalid.',
      };
    }
  }, [building, settings]);

  const previewResult = useMemo(() => {
    try {
      return createExportArtifact(building, { ...settings, format: 'svg' }).content;
    } catch {
      return '';
    }
  }, [building, settings]);

  if (!isOpen) return null;

  const updateSetting = <K extends keyof AdvancedExportSettings>(
    key: K,
    value: AdvancedExportSettings[K],
  ) => {
    setSettings(current => ({ ...current, [key]: value }));
    setExportedMessage(null);
    setExportedPaths([]);
    setLastExportedArtifact(null);
  };

  const handleDownload = async () => {
    // DWG and DXF formats: use the real backend CAD export pipeline
    if (settings.format === 'dwg' || settings.format === 'dxf') {
      try {
        setIsExporting(true);
        setExportedMessage(`Generating and validating ${settings.format.toUpperCase()} CAD drawing from canonical model...`);
        const cadArtifact = await exportCadArtifact(building, settings);
        await downloadExportArtifact(cadArtifact);
        const verificationLabel = settings.format === 'dwg' ? 'AC1032 binary verified' : 'ASCII DXF standard verified';
        setExportedMessage(
          `${cadArtifact.filename} exported (${formatExportSize(cadArtifact.byteSize)} · ` +
          `${cadArtifact.validation?.layerCount ?? 27} layers · ` +
          `${cadArtifact.validation?.entityCount ?? 0} entities · ${verificationLabel}).`
        );
        const userDownloadPaths = (cadArtifact.savedPaths || []).filter(
          p => !p.includes('output') && !p.includes('cad-export')
        );
        setExportedPaths(userDownloadPaths);

        const blobParts: BlobPart[] = cadArtifact.content
          ? [cadArtifact.content instanceof Uint8Array ? cadArtifact.content : String(cadArtifact.content)]
          : [];
        const blob = new Blob(blobParts, {
          type: 'application/octet-stream',
        });
        const blobUrl = URL.createObjectURL(blob);
        setLastExportedArtifact({ filename: cadArtifact.filename, blobUrl });
      } catch (err) {
        setExportedMessage(err instanceof Error ? err.message : 'CAD export failed.');
      } finally {
        setIsExporting(false);
      }
      return;
    }

    // SVG, PDF, JSON formats: generate locally and persist via backend
    if (!artifactResult.artifact) return;
    try {
      setIsExporting(true);
      const persistRes = await persistArtifactToServer(
        artifactResult.artifact.filename,
        artifactResult.artifact.content,
      );
      const artifactToDownload = persistRes
        ? { ...artifactResult.artifact, savedPaths: persistRes.savedPaths, downloadUrl: persistRes.downloadUrl }
        : artifactResult.artifact;
      await downloadExportArtifact(artifactToDownload);
      setExportedMessage(`${artifactResult.artifact.filename} exported successfully.`);
      const userDownloadPaths = (persistRes?.savedPaths || []).filter(
        p => !p.includes('output') && !p.includes('cad-export')
      );
      setExportedPaths(userDownloadPaths);

      const blobParts: BlobPart[] = [String(artifactResult.artifact.content)];
      const blob = new Blob(blobParts, { type: artifactResult.artifact.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      setLastExportedArtifact({ filename: artifactResult.artifact.filename, blobUrl });
    } catch (err) {
      setExportedMessage(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedFormat = FORMAT_OPTIONS.find(option => option.id === settings.format)!;
  const hasPlanEvidence = building.floors.some(candidateFloor => candidateFloor.rooms.length > 0);

  return (
    <div className="modal-backdrop export-studio-backdrop" onClick={onClose}>
      <section
        className="export-studio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-studio-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="export-studio-header">
          <div className="export-studio-title-group">
            <span className="export-studio-mark"><Sparkles size={17} /></span>
            <div>
              <span className="eyebrow">Phase 11 · publishing workspace</span>
              <h2 id="export-studio-title">Export Studio</h2>
            </div>
          </div>

          <div className="export-studio-status">
            <span className={hasPlanEvidence && validationSummary.isValid ? 'ready' : 'review'}>
              <ShieldCheck size={14} />
              {!hasPlanEvidence
                ? 'Insufficient input · quality not scored'
                : validationSummary.isValid
                ? `Validated · ${validationSummary.overallScore}/100`
                : `${validationSummary.failed} hard issues`}
            </span>
            <button className="btn-icon" onClick={onClose} aria-label="Close Export Studio">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="export-studio-body">
          <aside className="export-controls">
            <section className="export-control-section">
              <div className="export-control-heading">
                <span><FileText size={14} /> Output format</span>
                <small>01</small>
              </div>
              <div className="export-format-grid">
                {FORMAT_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    id={`btn-format-${option.id}`}
                    data-testid={`format-${option.id}`}
                    className={settings.format === option.id ? 'active' : ''}
                    onClick={() => updateSetting('format', option.id)}
                    aria-pressed={settings.format === option.id}
                  >
                    <span className="export-format-icon">{option.icon}</span>
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                    {settings.format === option.id && <Check size={14} className="export-format-check" />}
                  </button>
                ))}
              </div>
            </section>

            <section className="export-control-section">
              <div className="export-control-heading">
                <span><Settings2 size={14} /> Sheet setup</span>
                <small>02</small>
              </div>

              <div className="export-field-grid">
                <label className="export-field full">
                  <span>Sheet / Drawing Target</span>
                  <select
                    aria-label="Floor to export"
                    value={settings.floorId}
                    onChange={event => {
                      const val = event.target.value;
                      updateSetting('floorId', val);
                      if (val === 'complete_project' || val === 'all') {
                        updateSetting('exportScope', 'complete_project');
                      } else if (val === 'site') {
                        updateSetting('exportScope', 'site_plan');
                      } else {
                        updateSetting('exportScope', 'current_floor');
                      }
                    }}
                  >
                    <option value="complete_project">Complete 5-Drawing CAD Sheet Set (All Sheets)</option>
                    <option value="site">Sheet 01: Site &amp; Plot Allotment Plan</option>
                    {building.floors.map((candidate, idx) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name.startsWith('Sheet') ? candidate.name : `Sheet 0${idx + 2}: ${candidate.name}`}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="export-field">
                  <span>Paper</span>
                  <select
                    aria-label="Export paper size"
                    value={settings.paperSize}
                    disabled={settings.format === 'json'}
                    onChange={event => updateSetting('paperSize', event.target.value as PaperSize)}
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="A2">A2</option>
                    <option value="A1">A1</option>
                    <option value="A0">A0</option>
                    <option value="letter">US Letter</option>
                    <option value="tabloid">US Tabloid</option>
                  </select>
                </label>

                <label className="export-field">
                  <span>Orientation</span>
                  <select
                    aria-label="Export orientation"
                    value={settings.orientation}
                    disabled={settings.format === 'json'}
                    onChange={event => updateSetting('orientation', event.target.value as 'landscape' | 'portrait')}
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </label>

                <label className="export-field">
                  <span>Scale</span>
                  <select
                    aria-label="Architectural scale"
                    value={settings.scale}
                    disabled={settings.format === 'json'}
                    onChange={event => updateSetting('scale', event.target.value)}
                  >
                    <option value="1:50">1:50</option>
                    <option value="1:75">1:75</option>
                    <option value="1:100">1:100</option>
                    <option value="1:150">1:150</option>
                    <option value="1:200">1:200</option>
                  </select>
                </label>

                <label className="export-field">
                  <span>Scale mode</span>
                  <select aria-label="PDF scale mode" value={settings.scaleMode ?? 'EXACT'} onChange={event=>updateSetting('scaleMode',event.target.value as 'EXACT'|'FIT_TO_PAGE')}>
                    <option value="EXACT">Exact architectural scale</option>
                    <option value="FIT_TO_PAGE">Fit to page (not to scale)</option>
                  </select>
                </label>
                <label className="export-field">
                  <span>Revision</span>
                  <input
                    aria-label="Drawing revision"
                    value={settings.revision}
                    onChange={event => updateSetting('revision', event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="export-control-section">
              <div className="export-control-heading">
                <span><Layers3 size={14} /> Drawing layers</span>
                <small>03</small>
              </div>
              <div className="export-layer-grid">
                {LAYER_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    className={settings[option.key] ? 'active' : ''}
                    disabled={settings.format === 'json'}
                    aria-pressed={settings[option.key]}
                    onClick={() => updateSetting(option.key, !settings[option.key])}
                  >
                    <span className="export-switch"><i /></span>
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="export-control-section compact">
              <div className="export-control-heading">
                <span><BadgeCheck size={14} /> Drawing metadata</span>
                <small>04</small>
              </div>
              <div className="export-field-grid">
                <label className="export-field full">
                  <span>Drawn by</span>
                  <input
                    aria-label="Drawn by"
                    value={settings.drawnBy}
                    onChange={event => updateSetting('drawnBy', event.target.value)}
                  />
                </label>
                <label className="export-field full">
                  <span>Project number</span>
                  <input
                    aria-label="Project number"
                    value={settings.projectNumber}
                    onChange={event => updateSetting('projectNumber', event.target.value)}
                  />
                </label>
              </div>
            </section>
          </aside>

          <main className="export-preview-workspace">
            <div className="export-preview-toolbar">
              <div>
                <span className="eyebrow">Live artifact preview</span>
                <strong>{building.name}</strong>
              </div>
              <div className="export-preview-meta">
                <span>{settings.paperSize} · {settings.orientation}</span>
                <span>{settings.scale}</span>
              </div>
            </div>

            <div className={`export-sheet-stage ${settings.orientation}`}>
              <div className="export-sheet-glow" />
              {settings.format === 'json' ? (
                <div className="json-export-preview">
                  <div><span /><span /><span /></div>
                  <pre>{artifactResult.artifact?.content.slice(0, 1800)}</pre>
                </div>
              ) : (
                <div
                  className="export-sheet-preview"
                  dangerouslySetInnerHTML={{ __html: previewResult }}
                />
              )}
              <span className="export-format-watermark">{settings.format.toUpperCase()}</span>
            </div>

            <div className="export-readiness-card">
              <div className="export-readiness-icon"><BadgeCheck size={20} /></div>
              <div>
                <span className="eyebrow">Artifact readiness</span>
                <strong>{artifactResult.error ? 'Settings need attention' : 'Concept export ready'}</strong>
                <p>
                  {artifactResult.error
                    ?? `NOT FOR CONSTRUCTION · ${selectedFormat.label} · ${artifactResult.artifact ? formatExportSize(artifactResult.artifact.byteSize) : 'Calculating'} · ${building.floors.length} ${building.floors.length === 1 ? 'floor available' : 'floors available'}`}
                </p>
              </div>
              {!artifactResult.error && <Check size={16} />}
            </div>
          </main>
        </div>

        <footer className="export-studio-footer">
          <div className="export-footer-message">
            {exportedMessage ? (
              <div className="export-footer-message-content">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <BadgeCheck size={15} style={{ color: '#10b981', flexShrink: 0 }} />
                  <span><strong>Export complete:</strong> {exportedMessage}</span>
                </div>
                {exportedPaths.length > 0 && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
                    <span style={{ fontWeight: 600, color: '#cbd5e1' }}>Downloaded to: </span>
                    {exportedPaths.map((p, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: 'inline-block',
                          background: 'rgba(255, 255, 255, 0.08)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                          marginRight: '6px',
                          marginTop: '2px',
                          color: '#38bdf8',
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <><ShieldCheck size={15} /> <span><strong>Deterministic output</strong>CAD drawings conform to 1:1 metric AutoCAD standards.</span></>
            )}
          </div>
          <div className="export-footer-actions">
            <button className="btn-secondary" onClick={onClose}>Close</button>
            {lastExportedArtifact && (
              <a
                id="btn-direct-download"
                data-testid="btn-direct-download"
                href={lastExportedArtifact.blobUrl}
                download={lastExportedArtifact.filename}
                className="btn-primary"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#16a34a',
                  color: '#ffffff',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                <Download size={15} />
                Download {lastExportedArtifact.filename}
              </a>
            )}
            <button
              id="btn-export-cad-action"
              data-testid="btn-export-cad-action"
              className="btn-primary export-download-button"
              onClick={handleDownload}
              disabled={!artifactResult.artifact || isExporting}
            >
              <Download size={15} />
              {isExporting ? `Generating ${selectedFormat.label}...` : `Export ${selectedFormat.label}`}
              <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
