import React from 'react';
import { Building2, Car, Check, ShieldAlert, Sparkles } from 'lucide-react';
import { useStudioStore } from '../../../stores/useStudioStore';
import { ArgonCard, ArgonBadge } from '../ui';

export const Stage2FloorsAndParking: React.FC = () => {
  const {
    wizard,
    updateWizard,
    estimatedBuildingHeightM,
  } = useStudioStore();

  const floorOptions = [1, 2, 3, 4, 5, 6, 7, 8];
  const isHighRise = estimatedBuildingHeightM > 15;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Residential Floors Count */}
        <ArgonCard className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Building2 className="w-4 h-4 text-argon-btn" />
              <span>Typical Residential Upper Floors</span>
            </h3>
            <ArgonBadge variant="leather" size="sm">
              Stacking
            </ArgonBadge>
          </div>

          <p className="text-xs text-argon-muted leading-relaxed">
            Select the number of identical typical upper floor plates stacked above ground level.
          </p>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 pt-1">
            {floorOptions.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => updateWizard({ floorsCount: num })}
                className={`py-3 rounded-xl font-mono text-sm font-bold border transition-all ${
                  wizard.floorsCount === num
                    ? 'bg-argon-btn text-argon-card border-argon-btn shadow-sm ring-2 ring-argon-btn/20 scale-[1.02]'
                    : 'bg-argon-surface/50 text-argon-text border-argon-border hover:bg-argon-surface hover:border-argon-muted active:scale-98'
                }`}
              >
                {num}
              </button>
            ))}
          </div>

          {/* Height Metric Callout */}
          <div className="p-3.5 bg-argon-surface/70 rounded-xl border border-argon-border space-y-2 text-xs">
            <div className="flex items-center justify-between font-mono">
              <span className="text-argon-muted">Floor-to-Floor Height:</span>
              <span className="text-argon-text font-bold">3.15 m clear</span>
            </div>
            <div className="flex items-center justify-between font-mono border-t border-argon-border/60 pt-2">
              <span className="text-argon-text font-semibold">Total Building Height:</span>
              <span className="text-argon-btn font-bold text-sm">
                {estimatedBuildingHeightM} m
              </span>
            </div>
            {isHighRise ? (
              <div className="flex items-start gap-1.5 text-[11px] text-argon-warn font-medium pt-1">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Building height exceeds 15.0m: High-rise statutory norms require dual fire-escape staircases and 2-hour rated lift lobby.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-1.5 text-[11px] text-argon-pass font-medium pt-1">
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Low-rise classification (&le; 15.0m): Streamlined single fire core and standard setback requirements apply.
                </span>
              </div>
            )}
          </div>
        </ArgonCard>

        {/* Ground Floor Infrastructure Strategy */}
        <ArgonCard className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Car className="w-4 h-4 text-argon-accent" />
              <span>Ground Level Strategy</span>
            </h3>
            <ArgonBadge variant="neutral" size="sm">
              Plinth Function
            </ArgonBadge>
          </div>

          <p className="text-xs text-argon-muted leading-relaxed">
            Configure whether ground level is dedicated to covered vehicular parking or residential dwelling suites.
          </p>

          <div className="space-y-3 pt-1">
            {/* Option A: Stilt Parking Ground */}
            <button
              type="button"
              onClick={() => updateWizard({ hasStiltParking: true })}
              className={`w-full p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
                wizard.hasStiltParking
                  ? 'bg-argon-card border-argon-btn shadow-xs ring-1 ring-argon-btn/30'
                  : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface text-argon-muted'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  wizard.hasStiltParking
                    ? 'bg-argon-btn text-argon-card border-argon-btn'
                    : 'bg-argon-card text-argon-muted border-argon-border'
                }`}
              >
                <Car className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-argon-text">
                    Ground Stilt Parking Floor (Recommended)
                  </div>
                  {wizard.hasStiltParking && (
                    <ArgonBadge variant="pass" size="sm">
                      Selected
                    </ArgonBadge>
                  )}
                </div>
                <p className="text-xs text-argon-muted mt-1 leading-relaxed">
                  Covered parking bays (2.5 &times; 5.0m), two-wheeler stalls, society office, driver toilet, and core lift entry. Zero residential units on ground.
                </p>
              </div>
            </button>

            {/* Option B: Ground Floor Flats */}
            <button
              type="button"
              onClick={() => updateWizard({ hasStiltParking: false })}
              className={`w-full p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
                !wizard.hasStiltParking
                  ? 'bg-argon-card border-argon-btn shadow-xs ring-1 ring-argon-btn/30'
                  : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface text-argon-muted'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  !wizard.hasStiltParking
                    ? 'bg-argon-btn text-argon-card border-argon-btn'
                    : 'bg-argon-card text-argon-muted border-argon-border'
                }`}
              >
                <Building2 className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-argon-text">
                    Ground Floor Residential Units
                  </div>
                  {!wizard.hasStiltParking && (
                    <ArgonBadge variant="pass" size="sm">
                      Selected
                    </ArgonBadge>
                  )}
                </div>
                <p className="text-xs text-argon-muted mt-1 leading-relaxed">
                  Typical flats duplicated directly at ground level with direct private veranda access. Parking is handled exclusively in open surface setbacks.
                </p>
              </div>
            </button>
          </div>
        </ArgonCard>
      </div>

      {/* Program Summary Summary Bar */}
      <ArgonCard variant="surface" className="p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-argon-accent/20 border border-argon-accent/40 flex items-center justify-center text-argon-btn">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold font-mono text-argon-text uppercase">
              Vertical Configuration Summary
            </div>
            <div className="text-xs text-argon-muted">
              {wizard.hasStiltParking ? 'Stilt Ground Level + ' : 'Ground Floor Residential + '}
              {wizard.floorsCount} Upper Typical Residential Floors
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-argon-muted">Total Floor Plates: </span>
            <span className="font-bold text-argon-text">
              {wizard.floorsCount + (wizard.hasStiltParking ? 1 : 0)} Floors
            </span>
          </div>
          <div className="h-4 w-px bg-argon-border" />
          <div>
            <span className="text-argon-muted">Est. Total Flats: </span>
            <span className="font-bold text-argon-btn">
              {wizard.floorsCount * wizard.flatsPerFloor} Units
            </span>
          </div>
        </div>
      </ArgonCard>
    </div>
  );
};
