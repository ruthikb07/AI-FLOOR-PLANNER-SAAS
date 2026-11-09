import React from 'react';
import { Home, Layers, Check, AlertTriangle, AlertCircle } from 'lucide-react';
import { useStudioStore, type BhkType } from '../../../stores/useStudioStore';
import {
  ArgonCard,
  ArgonBadge,
  ArgonCounter,
} from '../ui';

export const Stage3FlatsAndBhkMix: React.FC = () => {
  const {
    wizard,
    setFlatsPerFloor,
    setBhkCount,
    setBhkCarpetArea,
    totalSelectedFlats,
    isBhkMixValid,
    remainingFlatsToAssign,
  } = useStudioStore();

  const strategies: Array<{
    count: 2 | 3 | 4;
    title: string;
    description: string;
    tag: string;
  }> = [
    {
      count: 2,
      title: 'Double Flat Layout',
      description: '2 Luxury Through-Plate Flats flanking a central circulation core.',
      tag: '2 Units/Floor',
    },
    {
      count: 3,
      title: 'Triple Flat Layout',
      description: '3 Units around central core (1 full-depth wing + 2 corner suites).',
      tag: '3 Units/Floor',
    },
    {
      count: 4,
      title: 'Quad Flat Layout',
      description: '4 Quadrant Flats with corner cross-ventilation and central core spine.',
      tag: '4 Units/Floor',
    },
  ];

  const bhkTypes: Array<{
    type: BhkType;
    label: string;
    sublabel: string;
    defaultCarpet: number;
  }> = [
    { type: '1BHK', label: '1 BHK Suite', sublabel: 'Master Bed, 1 Bath, Living, Kitchen & Balcony', defaultCarpet: 550 },
    { type: '2BHK', label: '2 BHK Regular', sublabel: 'Master Suite + Bed 2, 2 Baths, Living, Kitchen & Utility', defaultCarpet: 850 },
    { type: '3BHK', label: '3 BHK Luxury', sublabel: 'Master Suite + 2 Beds, 3 Baths, Living, Dining & 2 Balconies', defaultCarpet: 1250 },
    { type: '4BHK', label: '4 BHK Grand', sublabel: '4 En-suite Bedrooms, Powder Bath, Dining, Staff & Balconies', defaultCarpet: 1800 },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Typology Layout Strategy */}
      <ArgonCard className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Layers className="w-4 h-4 text-argon-btn" />
            <span>Flats Per Typical Floor Strategy</span>
          </h3>
          <ArgonBadge variant="leather" size="sm">
            Floor Partition
          </ArgonBadge>
        </div>

        <p className="text-xs text-argon-muted leading-relaxed">
          Select the canonical spatial slicing macro-structure for the residential floor plates.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
          {strategies.map((strat) => {
            const isSelected = wizard.flatsPerFloor === strat.count;
            return (
              <button
                key={strat.count}
                type="button"
                onClick={() => setFlatsPerFloor(strat.count)}
                className={`p-4 rounded-xl border text-left transition-all relative ${
                  isSelected
                    ? 'bg-argon-card border-argon-btn shadow-sm ring-1 ring-argon-btn/30 scale-[1.01]'
                    : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface/80 text-argon-muted'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-argon-btn">
                    {strat.tag}
                  </span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-argon-btn text-argon-card flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
                <div className="font-bold text-sm text-argon-text">{strat.title}</div>
                <p className="text-xs text-argon-muted mt-1 leading-relaxed">
                  {strat.description}
                </p>
              </button>
            );
          })}
        </div>
      </ArgonCard>

      {/* BHK Per-Unit Selectors */}
      <ArgonCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-argon-border/70 gap-2">
          <div>
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Home className="w-4 h-4 text-argon-accent" />
              <span>BHK Mix Allocation Matrix</span>
            </h3>
            <p className="text-xs text-argon-muted mt-0.5">
              Specify the unit distribution to perfectly match the {wizard.flatsPerFloor} flats on each typical floor plate.
            </p>
          </div>

          <div>
            {isBhkMixValid ? (
              <ArgonBadge variant="pass" size="md" icon={<Check className="w-3.5 h-3.5" />}>
                {totalSelectedFlats} / {wizard.flatsPerFloor} Flats Balanced
              </ArgonBadge>
            ) : totalSelectedFlats < wizard.flatsPerFloor ? (
              <ArgonBadge
                variant="warn"
                size="md"
                icon={<AlertTriangle className="w-3.5 h-3.5" />}
              >
                {totalSelectedFlats} / {wizard.flatsPerFloor} Allocated ({remainingFlatsToAssign} more needed)
              </ArgonBadge>
            ) : (
              <ArgonBadge
                variant="error"
                size="md"
                icon={<AlertCircle className="w-3.5 h-3.5" />}
              >
                {totalSelectedFlats} / {wizard.flatsPerFloor} Allocated ({Math.abs(remainingFlatsToAssign)} excess)
              </ArgonBadge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {bhkTypes.map(({ type, label, sublabel, defaultCarpet }) => {
            const count = wizard.bhkCounts[type] ?? 0;
            const carpet = wizard.bhkCarpetAreas[type] ?? defaultCarpet;

            return (
              <div
                key={type}
                className={`p-4 rounded-xl border transition-all ${
                  count > 0
                    ? 'bg-argon-card border-argon-border shadow-2xs'
                    : 'bg-argon-surface/30 border-argon-border/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-argon-text">{label}</span>
                      {count > 0 && (
                        <ArgonBadge variant="accent" size="sm">
                          {count} &times; {carpet} sq ft
                        </ArgonBadge>
                      )}
                    </div>
                    <p className="text-xs text-argon-muted mt-1 leading-relaxed">
                      {sublabel}
                    </p>
                  </div>

                  {/* Stepper Counter */}
                  <ArgonCounter
                    value={count}
                    onChange={(newVal) => setBhkCount(type, newVal, false)}
                    min={0}
                    max={wizard.flatsPerFloor}
                  />
                </div>

                {/* Target Carpet Area Editor */}
                {count > 0 && (
                  <div className="mt-3 pt-3 border-t border-argon-border/60 flex items-center justify-between text-xs font-mono">
                    <span className="text-argon-muted">Target Carpet Area:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step={25}
                        min={350}
                        max={4500}
                        value={carpet}
                        onChange={(e) => setBhkCarpetArea(type, Number(e.target.value))}
                        className="w-24 text-right bg-argon-surface border border-argon-border rounded-lg px-2.5 py-1 text-xs font-mono text-argon-text focus:border-argon-btn focus:outline-none"
                      />
                      <span className="text-argon-muted font-mono">sq ft</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Informational Guidance Alert */}
        {!isBhkMixValid && (
          <div className="p-3.5 bg-argon-warn/10 border border-argon-warn/30 rounded-xl text-xs text-argon-text flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-argon-warn shrink-0" />
            <span>
              {totalSelectedFlats < wizard.flatsPerFloor
                ? `You have allocated ${totalSelectedFlats} of ${wizard.flatsPerFloor} required flats. Use the (+) buttons above to add ${remainingFlatsToAssign} more unit(s).`
                : `You have allocated ${totalSelectedFlats} flats, which exceeds the ${wizard.flatsPerFloor} units allowed by the current layout strategy. Reduce ${Math.abs(remainingFlatsToAssign)} unit(s).`}
            </span>
          </div>
        )}
      </ArgonCard>
    </div>
  );
};
