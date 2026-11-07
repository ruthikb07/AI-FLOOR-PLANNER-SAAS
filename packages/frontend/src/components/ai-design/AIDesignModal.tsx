import React, { useState, useMemo, useEffect } from 'react';
import { withProjectSite, generationStatus, createQuickDesignRequirements } from '../../services/design-site-context';
import { fitFloorToViewport } from '../../services/floor-camera';
import { ArchitecturalEvidencePanel } from '../generation/ArchitecturalEvidencePanel';
import {
  Sparkles,
  X,
  Compass,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import type {
  DesignRequirementSpecification,
  CandidatePlan,
  RequirementValidationResult,
  Building,
} from '@ai-floor-planner/core';
import {
  SUPPORTED_FLOOR_COUNTS,
  Direction,
  formatBuildingFloorCount,
  normalizeDesignRequirementSpecification,
} from '@ai-floor-planner/core';
import {
  RequirementValidator,
  RoomProgramGenerator,
} from '@ai-floor-planner/planning-engine';
import {
  type RequirementParseResult,
} from '@ai-floor-planner/ai-orchestration';
import { renderFloor } from '@ai-floor-planner/renderer';
import { getAIService } from '../../services/ai-provider';

interface AIDesignModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
  onSelectCandidate: (candidate: CandidatePlan) => void;
  onReviewRequirements: () => void;
}

export const AIDesignModal: React.FC<AIDesignModalProps> = ({
  building,
  isOpen,
  onClose,
  onSelectCandidate,
  onReviewRequirements,
}) => {
  const initialPrompt = '2 bedrooms with 1 master bedroom, 2 bathrooms, living room, kitchen connected to dining. Edit this example brief before generating.';
  const [promptText, setPromptText] = useState(initialPrompt);
  const [spec, setSpec] = useState<DesignRequirementSpecification>(() =>
    createQuickDesignRequirements(building, initialPrompt),
  );

  // Generated state
  const [validationResult, setValidationResult] = useState<RequirementValidationResult | null>(null);
  const [candidates, setCandidates] = useState<CandidatePlan[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<RequirementParseResult | null>(null);

  // Instantiate engines
  const orchestrationService = useMemo(
    () => getAIService(),
    [],
  );
  const requirementValidator = useMemo(() => new RequirementValidator(), []);
  const roomProgramGenerator = useMemo(() => new RoomProgramGenerator(), []);

  useEffect(() => {
    if (!isOpen) return;
    setSpec(current => withProjectSite(current, building));
    setCandidates([]);
    setSelectedCandidateId(null);
    setValidationResult(null);
    setGenerationError(null);
    setParseResult(null);
  }, [isOpen, building]);

  if (!isOpen) return null;

  const invalidateGeneratedState = () => {
    setValidationResult(null);
    setCandidates([]);
    setSelectedCandidateId(null);
    setGenerationError(null);
    setParseResult(null);
  };

  const updateHard = (updates: Partial<DesignRequirementSpecification['hard']>) => {
    invalidateGeneratedState();
    setSpec(current => normalizeDesignRequirementSpecification({
      ...current,
      hard: { ...current.hard, ...updates },
    }));
  };

  const updateSoft = (updates: Partial<DesignRequirementSpecification['soft']>) => {
    invalidateGeneratedState();
    setSpec(current => normalizeDesignRequirementSpecification({
      ...current,
      soft: { ...current.soft, ...updates },
    }));
  };

  // Analyze Natural Language Prompt
  const handleAnalyzePrompt = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const result = await orchestrationService.parseRequirementsDetailed(promptText);
      setParseResult(result);
      const requirements = withProjectSite(result.requirements, building);
      setSpec(requirements);
      setCandidates([]);
      setSelectedCandidateId(null);

      const validation = requirementValidator.validate(requirements);
      setValidationResult(validation);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Requirements could not be analyzed.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Quick interpretation is advisory; it cannot author an independent default Program.
  const handleGenerateCandidates = () => { onClose(); onReviewRequirements(); };

  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId) ?? candidates[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card ai-design-dialog"
        role="dialog" aria-modal="true" aria-label="Design alternatives"
        style={{ width: '92vw', maxWidth: '1180px', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--accent-cyan)" />
            <span className="modal-title">Explore a residential layout</span>
            <span className="badge badge-cyan" style={{ fontSize: 11 }}>Concept study</span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="design-site-notice"><strong>Current site · {building.site.plotWidth / 1000} × {building.site.plotDepth / 1000} metres · {(building.site.plotArea / 1e6).toLocaleString()} m²</strong>
            <p>The plot is not the house size. The room brief determines the proposed building; remaining land stays unassigned. Change plot dimensions in Site setup, not in this dialog. Existing reviewed Program/footprint work belongs in the full generation workflow.</p></div>
          {/* Section 1: Natural Language Prompt Input */}
          <div className="panel" style={{ padding: 14, background: 'var(--bg-canvas)' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Compass size={14} color="var(--accent-cyan)" />
              <strong>Describe Your Building Requirements (Natural Language)</strong>
            </label>
            <textarea
              style={{
                width: '100%',
                minHeight: 70,
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                fontFamily: 'inherit',
                fontSize: 13,
                resize: 'vertical',
              }}
              value={promptText}
              onChange={e => {
                setPromptText(e.target.value);
                invalidateGeneratedState();
              }}
              placeholder="e.g. 30x50 ft plot, 2BHK with east road, parking, pooja room, and vastu..."
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                className="btn btn-secondary"
                onClick={handleAnalyzePrompt}
                disabled={isGenerating}
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                <RefreshCw size={13} />
                Analyze Text Requirements
              </button>
              <button
                className="btn btn-primary"
                onClick={handleGenerateCandidates}
                disabled={isGenerating}
                style={{ fontSize: 12, padding: '6px 16px' }}
              >
                <Sparkles size={13} />
                {isGenerating ? 'Working…' : 'Review saved requirements & budget'}
              </button>
            </div>
            {parseResult && (
              <div
                role="status"
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${parseResult.usedFallback ? '#f0b429' : 'var(--accent-green)'}`,
                  background: parseResult.usedFallback ? 'rgba(240, 180, 41, 0.08)' : 'rgba(0, 230, 153, 0.08)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                }}
              >
                <strong style={{ color: parseResult.usedFallback ? '#f0b429' : 'var(--accent-green)' }}>
                  {parseResult.source === 'provider'
                    ? `AI parsed • ${parseResult.providerName}`
                    : parseResult.usedFallback
                      ? 'Safe local fallback used'
                      : 'Parsed locally • validated'}
                </strong>
                {' '}• Canonical Requirements v1 • {parseResult.latencyMs} ms
                {parseResult.diagnostics.map(diagnostic => (
                  <div key={diagnostic.code}>{diagnostic.message}</div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Structured Parameter Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Site width (metres · fixed)</label>
              <input
                type="number"
                readOnly
                value={building.site.plotWidth / 1000}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Site depth (metres · fixed)</label>
              <input
                type="number"
                readOnly
                value={building.site.plotDepth / 1000}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Bedrooms</label>
              <select value={spec.hard.bedroomCount} onChange={e => updateHard({ bedroomCount: Number(e.target.value) })}>
                <option value={1}>1 BHK</option>
                <option value={2}>2 BHK</option>
                <option value={3}>3 BHK</option>
                <option value={4}>4 BHK</option>
                <option value={5}>5 BHK</option>
                <option value={6}>6 BHK</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Bathrooms</label>
              <select value={spec.hard.bathroomCount} onChange={e => updateHard({ bathroomCount: Number(e.target.value) })}>
                <option value={1}>1 Bathroom</option>
                <option value={2}>2 Bathrooms</option>
                <option value={3}>3 Bathrooms</option>
                <option value={4}>4 Bathrooms</option>
                <option value={5}>5 Bathrooms</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Road Facing</label>
              <select
                disabled title="Change road facing in Site setup"
                value={spec.hard.roadFacing}
                onChange={e => {
                  invalidateGeneratedState();
                  const roadFacing = e.target.value as Direction;
                  const orientationDegrees = roadFacing === Direction.East ? 90 : roadFacing === Direction.South ? 180 : roadFacing === Direction.West ? 270 : 0;
                  setSpec(current => normalizeDesignRequirementSpecification({
                    ...current,
                    orientationDegrees,
                    hard: { ...current.hard, roadFacing },
                  }));
                }}
              >
                <option value={Direction.North}>North</option>
                <option value={Direction.East}>East</option>
                <option value={Direction.South}>South</option>
                <option value={Direction.West}>West</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Vastu Compliance</label>
              <select value={spec.soft.vastuCompliance ? 'yes' : 'no'} onChange={e => updateSoft({ vastuCompliance: e.target.value === 'yes' })}>
                <option value="yes">Vastu Aligned</option>
                <option value="no">Standard Modern</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Balcony requested</label>
              <select value={spec.soft.balconyPreferred ? 'yes' : 'no'} onChange={event => updateSoft({ balconyPreferred: event.target.value === 'yes' })}>
                <option value="no">No balcony requested</option><option value="yes">Include balcony</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Floors</label>
              <select value={spec.hard.floorsCount} onChange={e => updateHard({ floorsCount: Number(e.target.value) })}>
                {SUPPORTED_FLOOR_COUNTS.map(floorCount => (
                  <option key={floorCount} value={floorCount}>{formatBuildingFloorCount(floorCount)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Car Parking Spaces</label>
              <select
                value={spec.hard.parkingSpacesCount}
                onChange={e => {
                  const count = Number(e.target.value);
                  updateHard({ parkingSpacesCount: count, parkingRequired: count > 0 });
                }}
              >
                <option value={0}>None</option>
                <option value={1}>1 Car</option>
                <option value={2}>2 Cars</option>
                <option value={3}>3 Cars</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Staircase</label>
              <select
                value={spec.hard.staircaseRequired ? 'yes' : 'no'}
                onChange={e => updateHard({ staircaseRequired: e.target.value === 'yes' })}
                disabled={spec.hard.floorsCount > 1}
              >
                <option value="yes">Required</option>
                <option value="no">Not required</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Lift</label>
              <select value={spec.hard.liftRequired ? 'yes' : 'no'} onChange={e => updateHard({ liftRequired: e.target.value === 'yes' })}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Pooja Room</label>
              <select value={spec.soft.poojaRoom ? 'yes' : 'no'} onChange={e => updateSoft({ poojaRoom: e.target.value === 'yes' })}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Study / Office</label>
              <select value={spec.soft.studyRoom ? 'yes' : 'no'} onChange={e => updateSoft({ studyRoom: e.target.value === 'yes' })}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Garden / Courtyard</label>
              <select value={spec.soft.gardenPreference ? 'yes' : 'no'} onChange={e => updateSoft({ gardenPreference: e.target.value === 'yes' })}>
                <option value="no">No preference</option>
                <option value="yes">Preferred</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Servant Quarter</label>
              <select value={spec.soft.servantQuarter ? 'yes' : 'no'} onChange={e => updateSoft({ servantQuarter: e.target.value === 'yes' })}>
                <option value="no">Not required</option>
                <option value="yes">Required</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Kitchen Style</label>
              <select value={spec.soft.openKitchen ? 'open' : 'closed'} onChange={e => updateSoft({ openKitchen: e.target.value === 'open' })}>
                <option value="closed">Closed Kitchen</option>
                <option value="open">Open Kitchen</option>
              </select>
            </div>
          </div>

          {generationError && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent-red)',
                background: 'rgba(255, 77, 77, 0.08)',
                border: '1px solid var(--accent-red)',
                fontSize: 12,
              }}
            >
              <strong>No valid layout was generated.</strong> The area estimate does not prove the requested rooms fit. Review room counts, minimum dimensions and setbacks in the project workflow.
              <details><summary>Technical details</summary>{generationError}</details>
            </div>
          )}

          {/* Section 3: Requirement Validation Summary */}
          {validationResult && !generationError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: validationResult.status === 'feasible'
                  ? 'rgba(0, 230, 153, 0.08)'
                  : validationResult.status === 'tight'
                    ? 'rgba(240, 180, 41, 0.08)'
                    : 'rgba(255, 77, 77, 0.08)',
                border: `1px solid ${validationResult.status === 'feasible'
                  ? 'var(--accent-green)'
                  : validationResult.status === 'tight'
                    ? '#f0b429'
                    : 'var(--accent-red)'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'stretch',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {validationResult.status !== 'infeasible' ? (
                  <CheckCircle2 size={16} color="var(--accent-green)" />
                ) : (
                  <AlertTriangle size={16} color="var(--accent-red)" />
                )}
                <span>
                  <strong>{generationStatus(false, validationResult.isFeasible, candidates.length)}</strong> •{' '}
                  Plot Area: {Math.round(validationResult.plotAreaMm2 / 1e6)} sq m (~
                  {Math.round(validationResult.plotAreaMm2 / 92903)} sq ft) • Estimated utilization:{' '}
                  {Math.round(validationResult.groundCoverageRatio * 100)}%
                </span>
                </div>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {validationResult.hardRequirementsCount} Hard Rules • {validationResult.preferencesCount} Preferences
                </span>
              </div>
              <div style={{ width: '100%', display: 'grid', gap: 4 }}>
                {validationResult.issues.map(issue => (
                  <div key={`${issue.code}-${issue.field ?? ''}`} style={{ color: issue.severity === 'error' ? 'var(--accent-red)' : issue.severity === 'warning' ? '#f0b429' : 'var(--text-secondary)' }}>
                    {issue.message}{issue.suggestion ? ` ${issue.suggestion}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Multi-Candidate Generated Plans */}
          {candidates.length > 0 && (
            <div>
              <label className="form-label" style={{ marginBottom: 10, display: 'block' }}>
                <strong>Generated Architectural Candidates ({candidates.length} Ranked Options)</strong>
              </label>

              <div className="candidate-comparison" aria-label="Candidate score comparison">
                <div className="candidate-comparison-heading">
                  <div>
                    <span className="eyebrow">Decision matrix</span>
                    <strong>Compare performance at a glance</strong>
                  </div>
                  <span>Higher is better</span>
                </div>
                <div className="candidate-comparison-grid" style={{ '--candidate-count': candidates.length } as React.CSSProperties}>
                  <span className="comparison-corner">Metric</span>
                  {candidates.map(cand => (
                    <button
                      key={`heading-${cand.id}`}
                      className={cand.id === selectedCandidate?.id ? 'active' : ''}
                      onClick={() => setSelectedCandidateId(cand.id)}
                    >
                      #{cand.rank} {cand.name}
                    </button>
                  ))}
                  {[
                    { label: 'Quality', value: (cand: typeof candidates[number]) => cand.metrics.overallQualityScore },
                    { label: 'Spatial graph', value: (cand: typeof candidates[number]) => cand.metrics.adjacencyScore },
                    { label: 'Circulation', value: (cand: typeof candidates[number]) => cand.metrics.circulationScore },
                  ].flatMap(metric => [
                    <span className="comparison-label" key={`${metric.label}-label`}>{metric.label}</span>,
                    ...candidates.map(cand => {
                      const value = metric.value(cand);
                      return (
                        <div className="comparison-score-cell" key={`${metric.label}-${cand.id}`}>
                          <strong>{value}</strong>
                          <span><i style={{ width: `${value}%` }} /></span>
                        </div>
                      );
                    }),
                  ])}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                {candidates.map(cand => {
                  const isSelected = cand.id === selectedCandidate?.id;
                  const thumbSvg = renderFloor(cand.building.floors[0]!, cand.building, fitFloorToViewport(cand.building.floors[0]!, 300, 220, 20), 300, 220);

                  return (
                    <div
                      key={cand.id}
                      onClick={() => setSelectedCandidateId(cand.id)}
                      style={{
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        background: isSelected ? 'var(--bg-selection)' : 'var(--bg-canvas)',
                        border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      {/* Thumbnail Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                          #{cand.rank} {cand.name}
                        </span>
                        <span
                          className={cand.metrics.hardValidity ? 'badge badge-cyan' : 'badge'}
                          style={{
                            fontSize: 10,
                            color: cand.metrics.hardValidity ? undefined : 'var(--accent-red)',
                            borderColor: cand.metrics.hardValidity ? undefined : 'var(--accent-red)',
                          }}
                        >
                          {cand.metrics.hardValidity
                            ? `Validated • ${cand.metrics.overallQualityScore}/100`
                            : `Draft • ${cand.validation.violations.length} validation issues`}
                        </span>
                      </div>

                      {/* SVG Thumbnail */}
                      <div
                        style={{
                          height: 180,
                          background: '#ffffff',
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        dangerouslySetInnerHTML={{ __html: thumbSvg }}
                      />

                      {/* Strategy & Metrics */}
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, minHeight: 32 }}>
                        {cand.description}
                      </p>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 4,
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          marginTop: 4,
                        }}
                      >
                        <span>Area: {Math.round(cand.metrics.totalCarpetAreaMm2 / 1e6)} sq m</span>
                        <span>Rooms: {cand.metrics.roomCount} spaces</span>
                        <span>Spatial graph: {cand.metrics.adjacencyScore}%</span>
                        <span>Circulation: {cand.metrics.circulationScore}%</span>
                        <span>Vastu: {cand.vastuPlanning.enabled ? `${cand.metrics.vastuProxyScore}%` : 'N/A'}</span>
                        <span>Optimized: {cand.optimization.initialGraphScore}→{cand.optimization.finalGraphScore}</span>
                        <span>Valid trials: {cand.optimization.validAttempts}/{cand.optimization.attempts}</span>
                        <span>Repairs: {cand.optimization.acceptedRepairs}/{cand.optimization.repairAttempts}</span>
                        {cand.vastuPlanning.enabled && (
                          <span>
                            Vastu optimized: {cand.vastuPlanning.initialScore}→{cand.vastuPlanning.finalScore}
                            {' '}({cand.vastuPlanning.acceptedChanges.length}/{cand.vastuPlanning.attempts})
                          </span>
                        )}
                        {cand.multiFloorPlanning.floorCount > 1 && (
                          <>
                            <span>Core: {cand.multiFloorPlanning.verticalCoreAligned ? 'Aligned' : 'Review'}</span>
                            <span>Building score: {cand.multiFloorPlanning.buildingLevelScore}%</span>
                            <span>Floor utilization: {cand.multiFloorPlanning.floorUtilizationScore}%</span>
                            <span>Worst unused: {Math.round(cand.multiFloorPlanning.maximumUnusedSpaceRatio * 100)}%</span>
                            <span>Room distribution: {cand.multiFloorPlanning.roomDistributionScore}%</span>
                            <span>Vertical continuity: {cand.multiFloorPlanning.verticalContinuityScore}%</span>
                            <span>Legacy same-floor bath availability: {cand.multiFloorPlanning.bedroomBathroomPairingScore}%</span>
                            <span>
                              Legacy best wet-pair overlap: {cand.multiFloorPlanning.wetAreaStackScore === null
                                ? 'N/A'
                                : `${cand.multiFloorPlanning.wetAreaStackScore}%`}
                            </span>
                          </>
                        )}
                      </div>

                      <ArchitecturalEvidencePanel candidate={cand} program={roomProgramGenerator.generateProgram(spec)} />
                      {/* Open in Editor Button */}
                      <button
                        className={isSelected ? 'btn btn-primary' : 'btn btn-secondary'}
                        style={{ width: '100%', marginTop: 6, fontSize: 12, padding: '6px' }}
                        onClick={e => {
                          e.stopPropagation();
                          onSelectCandidate(cand);
                          onClose();
                        }}
                      >
                        <ArrowRight size={13} />
                        {cand.metrics.hardValidity ? 'Open Plan in CAD Editor' : 'Open Draft in CAD Editor'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ marginTop: 10 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
