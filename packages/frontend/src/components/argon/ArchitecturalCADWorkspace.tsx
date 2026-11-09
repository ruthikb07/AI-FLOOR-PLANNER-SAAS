import React, { useMemo, useState } from 'react';
import { GeometryValidator } from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';
import { PropertyInspector } from '../inspector/PropertyInspector';
import { requestVerifiedExport, downloadVerifiedExport } from '../../services/export-client';
import type { WorkspaceLayer } from '../workspace/BuildingNavigator';

export const ArchitecturalCADWorkspace: React.FC<{ editor: EditorContextValue }> = ({ editor }) => {
  const [entityLayers, setEntityLayers] = useState({ columns: true, beams: true, furniture: true });
  const [exportStatus, setExportStatus] = useState('');
  const controller = React.useRef(new AbortController());
  React.useEffect(() => {
    controller.current.abort();
    controller.current = new AbortController();
    setExportStatus('');
    return () => controller.current.abort();
  }, [editor.building, editor.activeFloor.id]);
  const snapshot = React.useRef(editor.building);
  snapshot.current = editor.building;
  const quickExport = async (format: 'dwg' | 'dxf' | 'pdf') => {
    const building = editor.building,
      signal = controller.current.signal;
    setExportStatus('Generating / verifying...');
    try {
      const artifact = await requestVerifiedExport(
        building,
        format,
        { floorId: editor.activeFloor.id, scale: 'FIT_TO_PAGE' },
        signal,
      );
      if (signal.aborted || snapshot.current !== building)
        throw new Error('Stale revision: export again');
      await downloadVerifiedExport(artifact, signal);
      setExportStatus(`VERIFIED ${artifact.sizeBytes} bytes · ${artifact.sha256?.slice(0, 12)}`);
    } catch (e) {
      setExportStatus(String(e));
    }
  };
  const [layers, setLayers] = useState<Record<WorkspaceLayer, boolean>>({
    rooms: true,
    walls: true,
    openings: true,
    stairs: true,
    dimensions: true,
    grid: true,
    validation: true,
    siteZones: true,
  });
  const report = useMemo(
    () => new GeometryValidator({ autoCorrect: false }).audit(editor.building, false).report,
    [editor.building],
  );
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      aria-label="Architectural CAD workspace"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 p-3">
        <strong>2D CAD Studio</strong>
        {(['dwg', 'dxf', 'pdf'] as const).map((format) => (
          <button
            key={format}
            className="rounded bg-slate-800 px-3 py-2 text-xs"
            onClick={() => void quickExport(format)}
          >
            Export {format.toUpperCase()}
          </button>
        ))}
        <span role="status" className="text-xs text-amber-200">
          {exportStatus}
        </span>
      </div>
      <div
        className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-700 bg-slate-900 p-3"
        aria-label="Model floors"
      >
        {editor.building.floors.map((floor) => (
          <button
            key={floor.id}
            onClick={() => editor.switchFloor(floor.id)}
            className={`shrink-0 rounded px-3 py-2 text-xs ${floor.id === editor.activeFloor.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
          >
            {floor.name}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[320px] min-w-0 flex-1">
          <ArchitecturalCanvas
            modelOnly
            entityLayers={entityLayers}
            editor={editor}
            snapEnabled
            layers={layers}
            fitRequest={0}
          />
        </div>
        <aside className="w-full overflow-auto border-t border-slate-700 bg-slate-900 p-5 lg:w-80 lg:border-l lg:border-t-0">
          <PropertyInspector editor={editor} embedded />
          <h2 className="font-bold">Geometry audit · revision {editor.building.version}</h2>
          <p className={`my-3 text-sm ${report.isValid ? 'text-emerald-300' : 'text-amber-300'}`}>
            {report.isValid ? 'INTERNAL GEOMETRY CHECK PASSED' : 'CORRECTION REQUIRED'}
          </p>
          <p className="text-xs text-slate-300">Measured area delta: {report.planarDeltaMm2} mm²</p>
          <p className="my-3 text-xs text-slate-400">
            This software check does not certify structural safety or regulatory compliance.
            Professional review required.
          </p>
          <div className="my-4 flex flex-wrap gap-2">
            {(
              ['rooms', 'walls', 'openings', 'stairs', 'dimensions', 'grid'] as WorkspaceLayer[]
            ).map((layer) => (
              <button
                key={layer}
                aria-pressed={layers[layer]}
                onClick={() =>
                  setLayers((previous) => ({ ...previous, [layer]: !previous[layer] }))
                }
                className={`rounded px-2 py-1 text-xs ${layers[layer] ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-800 text-slate-400'}`}
              >
                {layer}
              </button>
            ))}
          </div>
          <ul className="space-y-3 text-xs">
            {report.errors
              .filter((error) => !error.autoCorrected)
              .map((error, index) => (
                <li key={`${error.code}-${index}`} className="rounded border border-slate-700 p-2">
                  <strong>{error.code}</strong>
                  <p className="mt-1 text-slate-300">{error.description}</p>
                </li>
              ))}
          </ul>
        </aside>
      </div>
      <div
        aria-label="CAD layers"
        className="flex shrink-0 flex-wrap gap-2 border-t border-slate-700 bg-slate-900 p-3"
      >
        {(['walls', 'openings', 'stairs', 'dimensions'] as const).map((layer) => (
          <button
            key={layer}
            aria-pressed={layers[layer]}
            onClick={() => setLayers((p) => ({ ...p, [layer]: !p[layer] }))}
          >
            {
              {
                walls: 'Walls',
                openings: 'Doors/Windows',
                stairs: 'Staircases',
                dimensions: 'Dimensions',
              }[layer]
            }
          </button>
        ))}
        {(['columns', 'beams', 'furniture'] as const).map((layer) => (
          <button
            key={layer}
            aria-pressed={entityLayers[layer]}
            onClick={() => setEntityLayers((p) => ({ ...p, [layer]: !p[layer] }))}
          >
            {layer[0]!.toUpperCase() + layer.slice(1)}
          </button>
        ))}
      </div>
    </section>
  );
};
