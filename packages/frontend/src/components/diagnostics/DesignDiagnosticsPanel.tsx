import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Info,
  TrendingUp,
  Compass,
  Eye,
  Sun,
  Maximize2,
  ShieldCheck,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react';
import type { DesignDiagnostics } from '@ai-floor-planner/core';
import type { EditorContextValue } from '../../stores/editor-store';

interface DesignDiagnosticsPanelProps {
  editor: EditorContextValue;
}

export const DesignDiagnosticsPanel: React.FC<DesignDiagnosticsPanelProps> = ({ editor }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'strengths' | 'opportunities' | 'vastu'>('all');
  const diagnostics: DesignDiagnostics = editor.diagnostics ?? {
    geometryHealthy: true,
    overallScore: 78,
    warnings: [],
    observations: [],
    scores: {
      overall: 78,
      areaEfficiency: 82,
      circulation: 75,
      privacy: 80,
      daylight: 74,
      adjacency: 85,
    },
  };

  const { scores, observations, warnings, geometryHealthy } = diagnostics;
  const strengths = observations.filter(o => o.category === 'strength');
  const opportunities = observations.filter(o => o.category === 'opportunity');
  const vastuObs = observations.filter(o => o.category === 'preference');

  const focusEntity = (entityIds?: readonly string[]) => {
    if (!entityIds || entityIds.length === 0) return;
    for (const id of entityIds) {
      if (editor.activeFloor.rooms.some(r => r.id === id)) {
        editor.selectEntity('room', id, editor.activeFloor.id);
        return;
      }
    }
  };

  return (
    <div className="studio-diagnostics-panel">
      {/* Header score & health banner */}
      <section className="diagnostics-hero">
        <div className="diagnostics-score-display">
          <div className="diagnostics-score-circle">
            <span className="score-num">{Math.round(scores.overall)}</span>
            <span className="score-max">/100</span>
          </div>
          <div className="diagnostics-summary">
            <span className="diagnostics-status-pill">
              {geometryHealthy ? (
                <><ShieldCheck size={13} className="text-emerald" /> Geometry Healthy</>
              ) : (
                <><AlertTriangle size={13} className="text-amber" /> Boundary Alert</>
              )}
            </span>
            <h3>Architectural Quality</h3>
            <p>
              {scores.overall >= 80 ? 'Well-proportioned layout with strong functional zoning.' :
               scores.overall >= 60 ? 'Functioning spatial configuration with clear optimization opportunities.' :
               'Draft plan in progress.'}
            </p>
          </div>
        </div>

        {/* Diagnostic Metrics Matrix */}
        <div className="diagnostics-metric-matrix">
          <div className="matrix-item">
            <span className="matrix-label"><Maximize2 size={12} /> Area Efficiency</span>
            <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.areaEfficiency}%` }} /></div>
            <span className="matrix-value">{Math.round(scores.areaEfficiency)}%</span>
          </div>
          <div className="matrix-item">
            <span className="matrix-label"><TrendingUp size={12} /> Circulation Flow</span>
            <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.circulation}%` }} /></div>
            <span className="matrix-value">{Math.round(scores.circulation)}%</span>
          </div>
          <div className="matrix-item">
            <span className="matrix-label"><Sun size={12} /> Daylight Potential</span>
            <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.daylight}%` }} /></div>
            <span className="matrix-value">{Math.round(scores.daylight)}%</span>
          </div>
          <div className="matrix-item">
            <span className="matrix-label"><Eye size={12} /> Privacy Zoning</span>
            <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.privacy}%` }} /></div>
            <span className="matrix-value">{Math.round(scores.privacy)}%</span>
          </div>
          <div className="matrix-item">
            <span className="matrix-label"><Compass size={12} /> Adjacency</span>
            <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.adjacency}%` }} /></div>
            <span className="matrix-value">{Math.round(scores.adjacency)}%</span>
          </div>
          {scores.zoning !== undefined && (
            <div className="matrix-item">
              <span className="matrix-label"><ShieldCheck size={12} /> Functional Zoning</span>
              <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.zoning}%` }} /></div>
              <span className="matrix-value">{Math.round(scores.zoning)}%</span>
            </div>
          )}
          {scores.shape !== undefined && (
            <div className="matrix-item">
              <span className="matrix-label"><Maximize2 size={12} /> Room Proportions</span>
              <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.shape}%` }} /></div>
              <span className="matrix-value">{Math.round(scores.shape)}%</span>
            </div>
          )}
          {scores.vastu !== undefined && (
            <div className="matrix-item">
              <span className="matrix-label"><Sparkles size={12} /> Vastu Alignment</span>
              <div className="matrix-bar"><div className="matrix-fill" style={{ width: `${scores.vastu}%` }} /></div>
              <span className="matrix-value">{Math.round(scores.vastu)}%</span>
            </div>
          )}
        </div>
      </section>

      {/* Geometry Warnings if any */}
      {warnings.length > 0 && (
        <section className="diagnostics-warnings-section">
          <h4><AlertTriangle size={14} /> Attention Needed ({warnings.length})</h4>
          <div className="diagnostics-issues-list">
            {warnings.map((w, idx) => (
              <div key={idx} className={`diagnostic-issue-card ${w.severity}`}>
                <div className="issue-content">
                  <strong>{w.code.replace(/_/g, ' ')}</strong>
                  <p>{w.message}</p>
                </div>
                {w.affectedEntityIds && w.affectedEntityIds.length > 0 && (
                  <button
                    className="issue-locate-btn"
                    onClick={() => focusEntity(w.affectedEntityIds)}
                    title="Focus space"
                  >
                    Locate <ChevronRight size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Non-blocking Architectural Insights */}
      <section className="diagnostics-observations-section">
        <div className="observation-tabs">
          <button
            className={activeTab === 'all' ? 'active' : ''}
            onClick={() => setActiveTab('all')}
          >
            All Insights ({observations.length})
          </button>
          <button
            className={activeTab === 'strengths' ? 'active' : ''}
            onClick={() => setActiveTab('strengths')}
          >
            Strengths ({strengths.length})
          </button>
          <button
            className={activeTab === 'opportunities' ? 'active' : ''}
            onClick={() => setActiveTab('opportunities')}
          >
            Opportunities ({opportunities.length})
          </button>
          {vastuObs.length > 0 && (
            <button
              className={activeTab === 'vastu' ? 'active' : ''}
              onClick={() => setActiveTab('vastu')}
            >
              Vastu ({vastuObs.length})
            </button>
          )}
        </div>

        <div className="observation-cards-list">
          {observations
            .filter(o => activeTab === 'all' || o.category === (activeTab === 'vastu' ? 'preference' : activeTab.slice(0, -1)))
            .map((obs, index) => (
              <div key={index} className={`observation-card ${obs.category}`}>
                <div className="obs-icon">
                  {obs.category === 'strength' && <CheckCircle2 size={16} className="text-emerald" />}
                  {obs.category === 'opportunity' && <Sparkles size={16} className="text-amber" />}
                  {obs.category === 'preference' && <Compass size={16} className="text-indigo" />}
                </div>
                <div className="obs-body">
                  <div className="obs-header">
                    <h5>{obs.title}</h5>
                    <span className="obs-tag">{obs.category}</span>
                  </div>
                  <p>{obs.description}</p>
                  {obs.affectedEntityIds && obs.affectedEntityIds.length > 0 && (
                    <button
                      className="obs-focus-btn"
                      onClick={() => focusEntity(obs.affectedEntityIds)}
                    >
                      Inspect space <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}

          {observations.length === 0 && (
            <div className="observation-empty-state">
              <Info size={24} />
              <p>Add rooms to your floor plan to view live architectural observations.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
