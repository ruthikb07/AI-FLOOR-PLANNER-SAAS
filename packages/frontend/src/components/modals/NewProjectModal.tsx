import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  GraduationCap,
  Home,
  LayoutGrid,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import type { Building } from '@ai-floor-planner/core';
import {
  createCanonical30x50_2BHK,
  createEmptyPlot,
  type BuildingCategory,
} from '../../services/storage';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBuilding: (building: Building, name: string, category: BuildingCategory) => void;
}

const CATEGORY_OPTIONS: Array<{
  id: BuildingCategory;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'residential', label: 'Residential', description: 'Homes, villas, apartments and multi-floor residences.', icon: <Home size={20} /> },
  { id: 'commercial', label: 'Commercial', description: 'Offices, retail and professional workplace projects.', icon: <Building2 size={20} /> },
  { id: 'mixed_use', label: 'Mixed use', description: 'Residential and commercial uses within one project.', icon: <Store size={20} /> },
  { id: 'educational', label: 'Educational', description: 'Schools, learning spaces and academic facilities.', icon: <GraduationCap size={20} /> },
];

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onSelectBuilding,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<BuildingCategory>('residential');
  const [name, setName] = useState('My Building Project');
  const [plotWidthFt, setPlotWidthFt] = useState(30);
  const [plotDepthFt, setPlotDepthFt] = useState(50);
  const [unit, setUnit] = useState<'ft' | 'm'>('ft');

  useEffect(() => {
    if (isOpen) setStep(1);
  }, [isOpen]);

  if (!isOpen) return null;

  const safeName = name.trim() || 'Untitled Building Project';
  const factor = unit === 'm' ? 1000 : 304.8;
  const dimensionsValid = Number.isFinite(plotWidthFt) && Number.isFinite(plotDepthFt) && plotWidthFt * factor >= 3048 && plotDepthFt * factor >= 3048;
  const starterMatches = Math.abs(plotWidthFt * factor - 9144) < 1 && Math.abs(plotDepthFt * factor - 15240) < 1;

  const createCanonical = () => {
    if (!starterMatches) return;
    const building = createCanonical30x50_2BHK(safeName);
    onSelectBuilding(building, safeName, category);
    onClose();
  };

  const createBlank = () => {
    if (!dimensionsValid) return;
    const building = createEmptyPlot(
      Math.round(plotWidthFt * factor),
      Math.round(plotDepthFt * factor),
      safeName,
    );
    onSelectBuilding({ ...building, site: { ...building.site, unitSystem: unit === 'm' ? 'metric' : 'imperial' } }, safeName, category);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card project-setup-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <span className="eyebrow">Project setup · Step {step} of 2</span>
            <h2 id="new-project-title">{step === 1 ? 'Choose a building category' : 'Define the project baseline'}</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close project setup"><X size={16} /></button>
        </header>

        <div className="modal-body project-setup-body">
          {step === 1 ? (
            <>
              <p className="project-setup-intro">The category is stored with the project and will drive space programs and rule sets as those modules are enabled.</p>
              <div className="project-category-grid">
                {CATEGORY_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    className={`project-category-card ${category === option.id ? 'selected' : ''}`}
                    onClick={() => setCategory(option.id)}
                    aria-pressed={category === option.id}
                  >
                    <span className="project-category-icon">{option.icon}</span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="project-baseline-grid">
                <div className="form-group project-name-field">
                  <label className="form-label" htmlFor="project-name">Project name</label>
                  <input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. East Avenue Residence" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="plot-units">Units (choose before entering sizes)</label>
                  <select id="plot-units" value={unit} onChange={event => {
                    const next = event.target.value as 'ft' | 'm';
                    const nextFactor = next === 'm' ? 1000 : 304.8;
                    setPlotWidthFt(value => Number((value * factor / nextFactor).toFixed(4)));
                    setPlotDepthFt(value => Number((value * factor / nextFactor).toFixed(4)));
                    setUnit(next);
                  }}><option value="ft">Feet (ft)</option><option value="m">Metres (m)</option></select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="plot-width">Plot frontage ({unit})</label>
                  <input id="plot-width" type="number" min="10" value={plotWidthFt} onChange={event => setPlotWidthFt(Number(event.target.value))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="plot-depth">Plot depth ({unit})</label>
                  <input id="plot-depth" type="number" min="10" value={plotDepthFt} onChange={event => setPlotDepthFt(Number(event.target.value))} />
                </div>
              </div>

              {!dimensionsValid && <p className="field-warning" role="alert">Plot dimensions must be finite and at least 3.048 m (10 ft).</p>}
              {dimensionsValid && <p className="design-site-notice">Site: {plotWidthFt} × {plotDepthFt} {unit} · {(plotWidthFt * plotDepthFt * factor * factor / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} m². This is land area, not a requested building area.</p>}

              <div className="project-template-grid">
                {category === 'residential' && (
                  <button className="project-template-card" onClick={createCanonical} disabled={!starterMatches} title={starterMatches ? 'Load the example model' : 'This fixed example is only available for a 30 × 50 ft site. Your custom site will not be replaced.'}>
                    <span className="project-template-icon"><Sparkles size={19} /></span>
                    <span><strong>Example only · 30×50 ft starter</strong><small>{starterMatches ? 'Example 2BHK model, not a custom generated plan.' : 'Unavailable for your custom dimensions. Create your site below.'}</small></span>
                    <ArrowRight size={16} />
                  </button>
                )}
                <button className="project-template-card featured" onClick={createBlank} disabled={!dimensionsValid}>
                  <span className="project-template-icon"><LayoutGrid size={19} /></span>
                  <span><strong>Create my {plotWidthFt} × {plotDepthFt} {unit} site</strong><small>Next: specify rooms and target areas in Program, then review a building footprint.</small></span>
                  <ArrowRight size={16} />
                </button>
              </div>

              {category !== 'residential' && (
                <p className="project-scope-note"><strong>Category recorded.</strong> Category-specific space programs and planning rules are not configured yet, so this milestone starts these projects from an honest blank plot.</p>
              )}
            </>
          )}
        </div>

        <footer className="modal-footer project-setup-footer">
          {step === 1 ? (
            <>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => setStep(2)}>Continue <ArrowRight size={15} /></button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</button>
              <span className="project-setup-selection">{CATEGORY_OPTIONS.find(option => option.id === category)?.label}</span>
            </>
          )}
        </footer>
      </section>
    </div>
  );
};
