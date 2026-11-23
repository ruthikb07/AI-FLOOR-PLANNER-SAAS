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
      <ArgonCard className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-2 text-sm text-argon-text">
          Clear habitable room height below slab or beam (mm, optional)
          <input className="rounded-lg border border-argon-border bg-argon-surface px-3 py-2"
            type="number" min={1} step={1} value={wizard.clearRoomHeightMm ?? ''}
            onChange={event => {
              const height = event.currentTarget.valueAsNumber;
              updateWizard({ clearRoomHeightMm: height > 0 ? height : undefined });
            }}
          />
        </label>
        {wizard.hasStiltParking && (
          <label className="flex flex-col gap-2 text-sm text-argon-text">
            Clear stilt height below beam (mm, optional)
            <input className="rounded-lg border border-argon-border bg-argon-surface px-3 py-2"
              type="number" min={1} step={1} value={wizard.stiltClearHeightBelowBeamMm ?? ''}
              onChange={event => {
                const height = event.currentTarget.valueAsNumber;
                updateWizard({ stiltClearHeightBelowBeamMm: height > 0 ? height : undefined });
              }}
            />
          </label>
        )}
      </ArgonCard>
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

      {/* Linked Multi-Storey Units (Duplex & Triplex Program) */}
      <ArgonCard className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-argon-border/70">
          <div>
            <h3 className="text-sm font-bold text-argon-text">
              Linked Multi-Storey Residences (Duplex &amp; Triplex)
            </h3>
            <p className="text-xs text-argon-muted mt-0.5">
              Declare duplex (2-storey) or triplex (3-storey) stacks to highlight vertically aligned floors and canonical internal stair linkages in 3D review.
            </p>
          </div>
          <ArgonBadge variant="leather" size="sm">
            Multi-Level Linking
          </ArgonBadge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3 rounded-xl border border-argon-border bg-argon-surface/40">
            <div className="text-xs">
              <strong className="block text-argon-text">Duplex Stacks (2-Storey)</strong>
              <span className="text-argon-muted">Links upper floors N &amp; N+1 cleanly</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease duplex count"
                onClick={() => updateWizard({ duplexCount: Math.max(0, (wizard.duplexCount ?? 0) - 1) })}
                className="w-7 h-7 rounded-lg border border-argon-border bg-argon-card font-bold text-xs"
              >
                -
              </button>
              <span className="w-6 text-center font-mono text-sm font-bold" data-testid="duplex-count-value">
                {wizard.duplexCount ?? 0}
              </span>
              <button
                type="button"
                aria-label="Increase duplex count"
                onClick={() => updateWizard({ duplexCount: Math.min(8, (wizard.duplexCount ?? 0) + 1) })}
                className="w-7 h-7 rounded-lg border border-argon-border bg-argon-card font-bold text-xs"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-argon-border bg-argon-surface/40">
            <div className="text-xs">
              <strong className="block text-argon-text">Triplex Stacks (3-Storey)</strong>
              <span className="text-argon-muted">Links 3 consecutive upper floors via vertical core</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease triplex count"
                onClick={() => updateWizard({ triplexCount: Math.max(0, (wizard.triplexCount ?? 0) - 1) })}
                className="w-7 h-7 rounded-lg border border-argon-border bg-argon-card font-bold text-xs"
              >
                -
              </button>
              <span className="w-6 text-center font-mono text-sm font-bold" data-testid="triplex-count-value">
                {wizard.triplexCount ?? 0}
              </span>
              <button
                type="button"
                aria-label="Increase triplex count"
                onClick={() => updateWizard({ triplexCount: Math.min(4, (wizard.triplexCount ?? 0) + 1) })}
                className="w-7 h-7 rounded-lg border border-argon-border bg-argon-card font-bold text-xs"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </ArgonCard>

      {/* Facade Projections: Window Chajjas & Multi-Floor Staggered Balconies */}
      <ArgonCard className="space-y-3">
        <div className="flex items-center justify-between pb-2.5 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text">
            Weathering Chajjas &amp; Multi-Floor Staggered Balconies
          </h3>
          <ArgonBadge variant="neutral" size="sm">
            Elevation Logic
          </ArgonBadge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 p-3 rounded-xl border border-argon-border bg-argon-surface/40 cursor-pointer hover:bg-argon-surface/70">
            <input
              type="checkbox"
              checked={wizard.includeWindowChajjas ?? true}
              onChange={(e) => updateWizard({ includeWindowChajjas: e.target.checked })}
              className="mt-1 accent-amber-500"
            />
            <span className="text-xs">
              <strong className="block text-argon-text">600 mm Window Chajjas (Sunshades)</strong>
              <span className="text-argon-muted">
                Cast concrete lintel weathering projections on exterior openings (A-CHAJJA in 2D/DXF &amp; 3D).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-xl border border-argon-border bg-argon-surface/40 cursor-pointer">
            <input
              type="checkbox"
              data-testid="brief-include-study-toggle"
              checked={wizard.includeStudyRoom ?? false}
              onChange={(e) => updateWizard({ includeStudyRoom: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-amber-500"
            />
            <span className="text-xs">
              <strong className="block text-argon-text">Include Study / Home Office</strong>
              <span className="text-argon-muted">
                Optional dedicated study alcove per flat (off by default — keeps extra area in Living, Bedrooms &amp; Galleries).
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-argon-border bg-argon-surface/40">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-xs text-argon-text">Gallery / Balcony Rhythm</strong>
              <span className="text-[10px] font-mono uppercase tracking-wider text-argon-muted">
                Multi-Floor
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Gallery coordination rhythm">
              <button
                type="button"
                data-testid="brief-gallery-stagger"
                aria-pressed={(wizard.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER') === 'DOUBLE_HEIGHT_STAGGER'}
                onClick={() =>
                  updateWizard({
                    galleryCoordinationMode: 'DOUBLE_HEIGHT_STAGGER',
                    staggeredBalconies: true,
                  })
                }
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  (wizard.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER') === 'DOUBLE_HEIGHT_STAGGER'
                    ? 'bg-amber-500/20 border-amber-500 text-argon-text shadow-sm'
                    : 'border-argon-border bg-argon-card/60 text-argon-muted hover:text-argon-text'
                }`}
              >
                Double-Height Stagger
              </button>
              <button
                type="button"
                data-testid="brief-gallery-stacked"
                aria-pressed={wizard.galleryCoordinationMode === 'STACKED_RIBBON'}
                onClick={() =>
                  updateWizard({
                    galleryCoordinationMode: 'STACKED_RIBBON',
                    staggeredBalconies: false,
                  })
                }
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  wizard.galleryCoordinationMode === 'STACKED_RIBBON'
                    ? 'bg-amber-500/20 border-amber-500 text-argon-text shadow-sm'
                    : 'border-argon-border bg-argon-card/60 text-argon-muted hover:text-argon-text'
                }`}
              >
                Stacked Ribbon
              </button>
            </div>
            <span className="text-[11px] text-argon-muted">
              {(wizard.galleryCoordinationMode ?? 'DOUBLE_HEIGHT_STAGGER') === 'DOUBLE_HEIGHT_STAGGER'
                ? 'Alternates primary sky-deck bays across odd/even floors for 6,300 mm double-height open volume.'
                : 'Aligns galleries vertically across every storey in continuous recessed ribbon bands.'}
            </span>
          </div>
        </div>
      </ArgonCard>

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
