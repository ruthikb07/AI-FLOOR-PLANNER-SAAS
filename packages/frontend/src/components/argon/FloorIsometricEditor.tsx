import React, { useState } from 'react';
import {
  Layers,
} from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';
import { ArchitecturalCanvas } from '../canvas/ArchitecturalCanvas';

export type FloorLevelId =
  | 'stilt'
  | '1st_floor'
  | '2nd_floor'
  | '3rd_floor'
  | '4th_floor'
  | 'terrace';

interface FloorIsometricEditorProps {
  editor: EditorContextValue;
}

export const FloorIsometricEditor: React.FC<FloorIsometricEditorProps> = ({
  editor,
}) => {
  const [selectedFloorId, setSelectedFloorId] = useState<FloorLevelId>('1st_floor');

  const floorLevels: Array<{ id: FloorLevelId; label: string; elevationM: string }> = [
    { id: 'stilt', label: 'Stilt Ground', elevationM: '+0.00m' },
    { id: '1st_floor', label: '1st Floor', elevationM: '+3.15m' },
    { id: '2nd_floor', label: '2nd Floor', elevationM: '+6.30m' },
    { id: '3rd_floor', label: '3rd Floor', elevationM: '+9.45m' },
    { id: '4th_floor', label: '4th Floor', elevationM: '+12.60m' },
    { id: 'terrace', label: 'Terrace', elevationM: '+15.75m' },
  ];

  return (
    <div className="w-full h-[calc(100vh-3.5rem)] bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Top Per-Floor Selector Header Bar */}
      <div className="h-12 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 mr-2 flex items-center gap-1.5">
            <Layers className="w-4 h-4" />
            <span>INDEPENDENT FLOOR ISOMETRIC EDITOR:</span>
          </span>

          <div className="flex items-center gap-2">
            {floorLevels.map((floor) => (
              <button
                key={floor.id}
                onClick={() => setSelectedFloorId(floor.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all flex items-center gap-2 ${
                  selectedFloorId === floor.id
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/10'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <span>{floor.label}</span>
                <span className="text-[10px] opacity-70">({floor.elevationM})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1 rounded border border-slate-800">
          Upper Floors Hidden • Direct Unobstructed Isometric View
        </div>
      </div>

      {/* Isometric Canvas Area */}
      <div className="flex-1 relative bg-slate-950 flex flex-col min-w-0">
        <ArchitecturalCanvas
          editor={editor}
          onCursorMove={() => {}}
          onZoomChange={() => {}}
          snapEnabled={true}
          layers={{
            rooms: true,
            walls: true,
            openings: true,
            stairs: true,
            dimensions: true,
            grid: true,
            validation: true,
            siteZones: true,
          }}
          fitRequest={0}
        />

        {/* Floating Floor Info Badge */}
        <div className="absolute top-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 shadow-xl text-xs space-y-1">
          <div className="font-mono font-bold text-amber-400 uppercase tracking-wider">
            ACTIVE ISOMETRIC PLATE
          </div>
          <div className="text-sm font-bold text-slate-100">
            {floorLevels.find((f) => f.id === selectedFloorId)?.label}
          </div>
          <div className="text-slate-400 font-mono">
            Slab Level: {floorLevels.find((f) => f.id === selectedFloorId)?.elevationM}
          </div>
        </div>
      </div>
    </div>
  );
};
