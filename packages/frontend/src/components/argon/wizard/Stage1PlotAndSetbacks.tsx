import React from 'react';
import { Ruler, Compass, Layers, ShieldCheck } from 'lucide-react';
import type { AuthorityType, CongestionZone } from '@ai-floor-planner/core';
import { useStudioStore } from '../../../stores/useStudioStore';
import {
  ArgonCard,
  ArgonInput,
  ArgonSelect,
  ArgonBadge,
} from '../ui';

export const Stage1PlotAndSetbacks: React.FC = () => {
  const {
    wizard,
    updateWizard,
    plotAreaM2,
    plotAreaSqFt,
    buildableWidthM,
    buildableDepthM,
    buildableFootprintM2,
    buildableFootprintSqFt,
    groundCoveragePct,
  } = useStudioStore();

  const orientations: Array<'North' | 'East' | 'South' | 'West'> = [
    'North',
    'East',
    'South',
    'West',
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Project Identity & Planning Jurisdiction */}
      <ArgonCard variant="surface" className="p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="md:col-span-1">
            <ArgonInput
              label="Project Title / Estate"
              value={wizard.projectName}
              onChange={(e) => updateWizard({ projectName: e.target.value })}
              placeholder="e.g. ARGON Heights Phase 1"
            />
          </div>

          <div>
            <ArgonSelect
              label="Planning Authority"
              aria-label="Planning authority"
              value={wizard.authorityType ?? ''}
              onChange={(e) =>
                updateWizard({ authorityType: (e.target.value as AuthorityType) || undefined })
              }
            >
              <option value="">Not selected — default statutory</option>
              <option value="MUNICIPAL_CORPORATION">Municipal Corporation (PMC/PCMC)</option>
              <option value="MUNICIPAL_COUNCIL">Municipal Council / Nagar Palika</option>
            </ArgonSelect>
          </div>

          <div>
            <ArgonSelect
              label="UDCPR Congestion Zone"
              aria-label="Congestion zone"
              value={wizard.congestionZone ?? ''}
              onChange={(e) =>
                updateWizard({ congestionZone: (e.target.value as CongestionZone) || undefined })
              }
            >
              <option value="">Not selected — unverified</option>
              <option value="NON_CONGESTED">Non-Congested (Standard FSI 1.10 - 2.0)</option>
              <option value="CONGESTED">Congested / Core City Ward</option>
            </ArgonSelect>
          </div>
        </div>
      </ArgonCard>

      {/* Plot Dimensions & Road Access */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Plot Dimensions */}
        <ArgonCard className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Ruler className="w-4 h-4 text-argon-btn" />
              <span>Plot Boundaries & Frontage</span>
            </h3>
            <ArgonBadge variant="leather" size="sm">
              Metric Metres
            </ArgonBadge>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <ArgonInput
              label="Frontage (Width W)"
              type="number"
              min={10}
              max={250}
              step={0.5}
              suffix="m"
              value={wizard.plotWidthM}
              onChange={(e) => updateWizard({ plotWidthM: Math.max(1, Number(e.target.value)) })}
            />
            <ArgonInput
              label="Depth (D)"
              type="number"
              min={10}
              max={250}
              step={0.5}
              suffix="m"
              value={wizard.plotDepthM}
              onChange={(e) => updateWizard({ plotDepthM: Math.max(1, Number(e.target.value)) })}
            />
          </div>

          {/* Area Metrics Callout */}
          <div className="p-3 bg-argon-surface/70 rounded-xl border border-argon-border flex items-center justify-between font-mono text-xs text-argon-text">
            <span>Gross Lot Area:</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-argon-btn">{plotAreaM2} m²</span>
              <span className="text-argon-muted">({plotAreaSqFt.toLocaleString()} sq ft)</span>
            </div>
          </div>
        </ArgonCard>

        {/* Road Access & Compass Rose */}
        <ArgonCard className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Compass className="w-4 h-4 text-argon-accent" />
              <span>Right-of-Way & Orientation</span>
            </h3>
            <ArgonBadge variant="neutral" size="sm">
              Road Access
            </ArgonBadge>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <ArgonInput
              label="Right-of-Way Width"
              type="number"
              min={6}
              max={60}
              step={0.5}
              suffix="m"
              value={wizard.roadWidthM}
              onChange={(e) => updateWizard({ roadWidthM: Math.max(1, Number(e.target.value)) })}
              helperText={wizard.roadWidthM >= 12 ? '>=12m road: High FSI allowed' : '<12m road: standard low-rise'}
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-mono font-bold uppercase tracking-wider text-argon-text">
                Road Facing Side
              </label>
              <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                {orientations.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => updateWizard({ roadFacing: dir })}
                    className={`py-2 px-1 text-center font-mono text-xs font-bold rounded-lg border transition-all ${
                      wizard.roadFacing === dir
                        ? 'bg-argon-btn text-argon-card border-argon-btn shadow-2xs'
                        : 'bg-argon-surface/50 text-argon-muted border-argon-border hover:bg-argon-surface hover:text-argon-text'
                    }`}
                  >
                    {dir[0]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-argon-muted text-center pt-0.5 font-medium">
                Facing: <span className="text-argon-text font-bold">{wizard.roadFacing}</span>
              </p>
            </div>
          </div>
        </ArgonCard>
      </div>

      {/* Statutory Boundary Setbacks */}
      <ArgonCard className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-argon-pass" />
            <h3 className="text-sm font-bold text-argon-text">Statutory Boundary Setbacks (m)</h3>
          </div>
          <span className="text-xs text-argon-muted font-mono">
            NBC / UDCPR Clearance Buffer
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <ArgonInput
            label="Front Setback"
            type="number"
            step={0.5}
            min={1.5}
            max={20}
            suffix="m"
            value={wizard.frontSetbackM}
            onChange={(e) => updateWizard({ frontSetbackM: Math.max(0, Number(e.target.value)) })}
            helperText="Clearance to Road Margin"
          />
          <ArgonInput
            label="Rear Setback"
            type="number"
            step={0.5}
            min={1.5}
            max={20}
            suffix="m"
            value={wizard.rearSetbackM}
            onChange={(e) => updateWizard({ rearSetbackM: Math.max(0, Number(e.target.value)) })}
            helperText="Clearance to Rear Boundary"
          />
          <ArgonInput
            label="Side Setbacks (Each Side)"
            type="number"
            step={0.5}
            min={1.5}
            max={20}
            suffix="m"
            value={wizard.sideSetbackM}
            onChange={(e) => updateWizard({ sideSetbackM: Math.max(0, Number(e.target.value)) })}
            helperText="Left & Right Side Clearances"
          />
        </div>

        {/* Live Buildable Footprint Calculation Banner */}
        <div className="mt-3 p-4 bg-argon-card border border-argon-accent/40 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-argon-text font-semibold">
            <ShieldCheck className="w-4 h-4 text-argon-pass shrink-0" />
            <span>Buildable Footprint Envelope:</span>
            <span className="font-mono text-argon-btn font-bold">
              {buildableWidthM}m (W) × {buildableDepthM}m (D)
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono">
            <span className="text-argon-muted">Plinth Footprint:</span>
            <span className="font-bold text-argon-pass bg-argon-pass/10 px-2 py-0.5 rounded border border-argon-pass/20">
              {buildableFootprintM2} m² ({buildableFootprintSqFt.toLocaleString()} sq ft)
            </span>
            <span className="text-argon-muted">
              ({groundCoveragePct}% ground coverage)
            </span>
          </div>
        </div>
      </ArgonCard>
    </div>
  );
};
