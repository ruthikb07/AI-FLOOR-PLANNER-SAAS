import React from 'react';
import { CheckCircle2, AlertTriangle, Crosshair, ChevronUp } from 'lucide-react';
import type { EditorContextValue } from '../../stores/editor-store';

interface StatusBarProps {
  editor: EditorContextValue;
  cursorWorldPos: { x: number; y: number };
  zoom: number;
  snapEnabled: boolean;
  selectionCount: number;
  onToggleSnap: () => void;
  onOpenQuality: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  editor,
  cursorWorldPos,
  zoom,
  snapEnabled,
  selectionCount,
  onToggleSnap,
  onOpenQuality,
}) => {
  const { validationSummary } = editor;
  const isPlanValid = validationSummary.isValid;
  const hasPlanEvidence = editor.building.floors.some(floor => floor.rooms.length > 0);

  return (
    <footer className="statusbar">
      <div className="status-left">
        {/* Real-time Constraint Score & Status */}
        {!hasPlanEvidence ? (
          <button className="status-badge-neutral" onClick={onOpenQuality} title="Add rooms to evaluate plan quality">
            <AlertTriangle size={13} />
            <span>INSUFFICIENT INPUT • Quality not scored</span>
            <ChevronUp size={12} />
          </button>
        ) : isPlanValid ? (
          <button className="status-badge-valid" onClick={onOpenQuality} title="Open quality intelligence">
            <CheckCircle2 size={13} />
            <span>VALID • Quality {validationSummary.overallScore}/100</span>
            <ChevronUp size={12} />
          </button>
        ) : (
          <button className="status-badge-invalid" onClick={onOpenQuality} title="Review validation issues">
            <AlertTriangle size={13} />
            <span>
              {validationSummary.failed} HARD {validationSummary.failed === 1 ? 'ISSUE' : 'ISSUES'} • Quality{' '}
              {validationSummary.overallScore}/100 • {editor.diagnostics.warnings.length} warnings
            </span>
            <ChevronUp size={12} />
          </button>
        )}

        <span>
          Active: <strong>{editor.activeFloor.name}</strong> ({editor.activeFloor.rooms.length} rooms)
        </span>
      </div>

      <div className="status-right">
        <button className={`status-control ${snapEnabled ? 'active' : ''}`} onClick={onToggleSnap} aria-pressed={snapEnabled}>SNAP {snapEnabled ? 'ON' : 'OFF'}</button>
        <span>{selectionCount} SELECTED</span>
        <span>{validationSummary.failed} HARD · {editor.diagnostics.warnings.length} WARNINGS</span>
        {/* World Coordinates Display */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Crosshair size={13} color="var(--text-muted)" />
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            X {(cursorWorldPos.x / 1000).toFixed(2)}m · Y {(cursorWorldPos.y / 1000).toFixed(2)}m
          </span>
        </div>

        {/* Zoom percentage */}
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {editor.activeFloor.name.toUpperCase()} · Zoom {Math.round(zoom * 100)}%
        </span>
      </div>
    </footer>
  );
};
