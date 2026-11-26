import React, { useState } from 'react';
import type { PlanCategory } from '@ai-floor-planner/core';
import {
  BUILDING_SHAPE_CATALOG,
  PLAN_CATEGORY_CATALOG,
  synthesizeParametricShape,
  type ShapeFamilyKind,
} from '@ai-floor-planner/planning-engine';
import { Home, Layers, Check, AlertTriangle, AlertCircle, Shapes, Sparkles, Compass } from 'lucide-react';
import { useStudioStore, type BhkType } from '../../../stores/useStudioStore';
import {
  ArgonCard,
  ArgonBadge,
  ArgonCounter,
} from '../ui';

export const Stage3FlatsAndBhkMix: React.FC = () => {
  const [shapeFamilyFilter, setShapeFamilyFilter] = useState<'ALL' | ShapeFamilyKind>('ALL');
  const [showCustomParametric, setShowCustomParametric] = useState(false);
  const {
    wizard,
    updateWizard,
    setFlatsPerFloor,
    setBhkCount,
    setBhkCarpetArea,
    totalSelectedFlats,
    isBhkMixValid,
    remainingFlatsToAssign,
  } = useStudioStore();

    const applyCategorySelection = (category: PlanCategory) => {
      const entry = PLAN_CATEGORY_CATALOG.find(c => c.id === category);
      if (!entry) return;
      updateWizard({
        planCategory: category,
        ...(category === 'LUXURY_VILLA_BUNGALOW'
          ? {
            flatsPerFloor: 1,
            hasStiltParking: false,
            floorsCount: 2,
            bhkCounts: { '1BHK': 0, '2BHK': 0, '3BHK': 0, '4BHK': 1 },
          }
          : {}),
      });
    };

    const applyMixPreset = (flats: 1 | 2 | 3 | 4, counts: Record<BhkType, number>) => {
      setFlatsPerFloor(flats);
      (Object.keys(counts) as BhkType[]).forEach(k => setBhkCount(k, counts[k], false));
    };

    const filteredCatalogShapes = shapeFamilyFilter === 'ALL'
      ? BUILDING_SHAPE_CATALOG
      : BUILDING_SHAPE_CATALOG.filter(s => s.family === shapeFamilyFilter);

    const strategies: Array<{
      count: 1 | 2 | 3 | 4 | 5 | 6;
      title: string;
      description: string;
      tag: string;
    }> = [
        { count: 1, title: 'Single Flat Layout', description: 'One flat per typical residential floor.', tag: '1 Unit/Floor' },
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
        { count: 5, title: 'Five Flat Layout', description: 'Five flats organized around common circulation.', tag: '5 Units/Floor' },
        { count: 6, title: 'Six Flat Layout', description: 'Six flats organized around common circulation.', tag: '6 Units/Floor' },
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
                  className={`p-4 rounded-xl border text-left transition-all relative ${isSelected
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
                  className={`p-4 rounded-xl border transition-all ${count > 0
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

          <fieldset className="grid gap-3 rounded-lg border border-argon-border px-3 py-2">
            <legend className="px-1 text-sm font-semibold">Core and wet rooms</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Core arrangement
                <select value={wizard.architectureOptions?.coreArrangement ?? 'AUTO'} onChange={event =>
                  updateWizard({ architectureOptions: { ...wizard.architectureOptions, coreArrangement: event.target.value === 'SPLIT_COURTYARD' ? 'SPLIT_COURTYARD' : 'AUTO' } })}>
                  <option value="AUTO">Automatic</option><option value="SPLIT_COURTYARD">Prefer split courtyard</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">Internal open-to-sky space
                <select value={wizard.architectureOptions?.openToSky ?? 'AUTO'} onChange={event => {
                  const value = event.target.value;
                  updateWizard({ architectureOptions: { ...wizard.architectureOptions, openToSky: value === 'REQUIRED' || value === 'PROHIBITED' ? value : 'AUTO' } });
                }}><option value="AUTO">Automatic</option><option value="REQUIRED">Required</option><option value="PROHIBITED">Prohibited</option></select>
              </label>
              {(['stairCount', 'liftCount'] as const).map(key => (
                <label key={key} className="grid gap-1 text-sm">{key === 'stairCount' ? 'Number of stairs' : 'Number of lifts'}
                  <select value={wizard.architectureOptions?.[key] ?? ''} onChange={event => {
                    const value = event.target.value;
                    updateWizard({ architectureOptions: { ...wizard.architectureOptions, [key]: value === '1' ? 1 : value === '2' ? 2 : undefined } });
                  }}><option value="">Automatic</option><option value="1">1</option><option value="2">2</option></select>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(wizard.architectureOptions?.preferExteriorLiving)} onChange={event =>
              updateWizard({ architectureOptions: { ...wizard.architectureOptions, preferExteriorLiving: event.target.checked } })} />Prefer exterior living</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wizard.architectureOptions?.coordinatedWetWallLayout ?? Boolean(wizard.coordinatedWetWallLayout)} onChange={event =>
              updateWizard({ architectureOptions: { ...wizard.architectureOptions, coordinatedWetWallLayout: event.target.checked } })} />Reserve shared plumbing shafts outside bathrooms</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(wizard.architectureOptions?.requireWetWallRisers)} onChange={event =>
              updateWizard({ architectureOptions: { ...wizard.architectureOptions, requireWetWallRisers: event.target.checked } })} />Require shared shaft coverage for every bathroom</label>
          </fieldset>

          <fieldset className="grid gap-3 rounded-lg border border-argon-border px-3 py-2">
            <legend className="px-1 text-sm font-semibold">Carpet area acceptance</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(wizard.requireAreaTargets)} onChange={event =>
                updateWizard({ requireAreaTargets: event.target.checked })} />
              Require carpet targets
            </label>
            {wizard.requireAreaTargets && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">Carpet area tolerance (%)
                  <input type="number" min={0} max={99} step="any" value={wizard.areaAcceptanceTolerancePercent ?? 5}
                    onChange={event => {
                      const tolerance = event.target.valueAsNumber;
                      if (Number.isFinite(tolerance) && tolerance >= 0 && tolerance < 100) {
                        updateWizard({ areaAcceptanceTolerancePercent: tolerance });
                      }
                    }}
                    className="ms-2 w-20 rounded border border-argon-border bg-argon-surface px-2 py-1" />
                </label>
                {bhkTypes.flatMap(({ type, defaultCarpet }) =>
                  Array.from({ length: wizard.bhkCounts[type] }, (_, index) => (
                    <label key={`${type}-${index}`} className="text-sm">{type} flat {index + 1} target (sq ft)
                      <input type="number" min={1} step="any"
                        value={wizard.unitCarpetTargets?.[type]?.[index] ?? wizard.bhkCarpetAreas[type] ?? defaultCarpet}
                        onChange={event => {
                          const area = event.target.valueAsNumber;
                          if (!Number.isFinite(area) || area <= 0) return;
                          const perType = Array.from({ length: wizard.bhkCounts[type] }, (_, position) =>
                            position === index ? area : wizard.unitCarpetTargets?.[type]?.[position] ?? null);
                          updateWizard({ unitCarpetTargets: { ...wizard.unitCarpetTargets, [type]: perType } });
                        }}
                        className="ms-2 w-24 rounded border border-argon-border bg-argon-surface px-2 py-1" />
                    </label>
                  )),
                )}
              </div>
            )}
          </fieldset>

          {/* Quick 2BHK / 3BHK Mix Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-argon-border/60">
            <span className="text-[11px] font-mono font-bold uppercase text-argon-muted mr-1">
              2BHK / 3BHK Alternatives:
            </span>
            <button
              type="button"
              data-testid="preset-mix-balanced-2-3"
              onClick={() => applyMixPreset(4, { '1BHK': 0, '2BHK': 2, '3BHK': 2, '4BHK': 0 })}
              className="px-2.5 py-1 rounded-lg border border-argon-border bg-argon-surface/60 hover:bg-argon-surface text-xs font-mono text-argon-text"
            >
              2×2BHK + 2×3BHK (4 Units)
            </button>
            <button
              type="button"
              data-testid="preset-mix-all-2bhk"
              onClick={() => applyMixPreset(4, { '1BHK': 0, '2BHK': 4, '3BHK': 0, '4BHK': 0 })}
              className="px-2.5 py-1 rounded-lg border border-argon-border bg-argon-surface/60 hover:bg-argon-surface text-xs font-mono text-argon-text"
            >
              4×2BHK Efficiency
            </button>
            <button
              type="button"
              data-testid="preset-mix-triple-2-3"
              onClick={() => applyMixPreset(3, { '1BHK': 0, '2BHK': 1, '3BHK': 2, '4BHK': 0 })}
              className="px-2.5 py-1 rounded-lg border border-argon-border bg-argon-surface/60 hover:bg-argon-surface text-xs font-mono text-argon-text"
            >
              1×2BHK + 2×3BHK (Triple)
            </button>
            <button
              type="button"
              data-testid="preset-mix-dual-3bhk"
              onClick={() => applyMixPreset(2, { '1BHK': 0, '2BHK': 0, '3BHK': 2, '4BHK': 0 })}
              className="px-2.5 py-1 rounded-lg border border-argon-border bg-argon-surface/60 hover:bg-argon-surface text-xs font-mono text-argon-text"
            >
              2×3BHK Through-Plate
            </button>
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

          {/* Residential Plan Category & Building Shape Drawer (21+ N-Shape Catalog) */}
          <ArgonCard className="space-y-4" data-testid="plan-category-selector-card">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-argon-border/70">
              <div>
                <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
                  <Compass className="w-4 h-4 text-argon-btn" />
                  <span>Residential Plan Category</span>
                </h3>
                <p className="text-xs text-argon-muted mt-0.5">
                  Choose the architectural residential typology to tailor massing, circulation cores, stairs, and setback utilization.
                </p>
              </div>
              <ArgonBadge variant="leather" size="sm">
                6 Typologies
              </ArgonBadge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {
                  PLAN_CATEGORY_CATALOG.map((cat) => {
                    const active = (wizard.planCategory ?? 'HIGH_RISE_APARTMENT') === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        data-testid={`plan-category-${cat.id}`}
                        onClick={() => applyCategorySelection(cat.id)}
                        className={`p-3 rounded-xl border text-left transition-all flex items-start gap-3 ${active
                          ? 'bg-argon-card border-argon-btn ring-1 ring-argon-btn/35 shadow-sm'
                          : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface'
                          }`}
                      >
                        <svg viewBox="0 0 80 60" className="w-12 h-9 shrink-0 rounded bg-slate-900/5 border border-argon-border/60 p-1">
                          <path d={cat.svgPath} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-argon-btn" />
                        </svg>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-argon-text leading-snug">{cat.shortLabel}</div>
                          <p className="text-[11px] text-argon-muted mt-0.5 line-clamp-2">{cat.description}</p>
                        </div>
                      </button>
                    );
                  })
                }
        </div>
          </ArgonCard>

          {/* Building Massing & Parametric N-Shape Catalog Browser */}
          <ArgonCard className="space-y-4" data-testid="shape-catalog-browser">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-argon-border/70">
              <div>
                <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
                  <Shapes className="w-4 h-4 text-argon-btn" />
                  <span>Building Shape &amp; Parametric N-Shape Catalog</span>
                </h3>
                <p className="text-xs text-argon-muted mt-0.5">
                  Select from {BUILDING_SHAPE_CATALOG.length}+ curved, radial, polygonal, and articulated building footprints or enable Auto-Explore.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="toggle-auto-explore-shape"
                  onClick={() => updateWizard({ autoExploreNovelShape: !(wizard.autoExploreNovelShape ?? false) })}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-colors ${wizard.autoExploreNovelShape
                    ? 'bg-amber-500/20 border-amber-500 text-amber-800 font-bold'
                    : 'bg-argon-surface border-argon-border text-argon-muted hover:text-argon-text'
                    }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-Explore Novel Shape</span>
                </button>
                <ArgonBadge variant="leather" size="sm">
                  {BUILDING_SHAPE_CATALOG.length}+ Shapes
                </ArgonBadge>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {([
                  { id: 'ALL', label: `All Shapes (${BUILDING_SHAPE_CATALOG.length})` },
                  { id: 'CURVED_RADIAL', label: 'Curved & Radial (6)' },
                  { id: 'POLYGONAL_ANGLED', label: 'Polygonal & Angled (6)' },
                  { id: 'ORTHOGONAL', label: 'Classic Orthogonal (9)' },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setShapeFamilyFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${shapeFamilyFilter === tab.id
                      ? 'bg-argon-btn text-white border-argon-btn'
                      : 'bg-argon-surface/60 text-argon-muted border-argon-border hover:text-argon-text'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowCustomParametric(v => !v)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-mono border border-argon-border bg-argon-surface/60 text-argon-text hover:bg-argon-surface"
              >
                {showCustomParametric ? 'Hide Parametric N-Slider' : '+ Custom Parametric N-Shape'}
              </button>
            </div>

            {showCustomParametric && (
              <div className="p-3 rounded-xl bg-argon-surface/60 border border-argon-border grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-argon-muted">
                    Wings: {wizard.shapeParams?.wings ?? 3}
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    value={wizard.shapeParams?.wings ?? 3}
                    onChange={(e) => {
                      const nextParams = { ...(wizard.shapeParams ?? {}), wings: Number(e.target.value) };
                      const synth = synthesizeParametricShape(nextParams);
                      updateWizard({ shapeParams: nextParams, buildingMassingShape: synth.id });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-argon-muted">
                    Splay Angle: {wizard.shapeParams?.angleDeg ?? 120}&deg;
                  </span>
                  <input
                    type="range"
                    min={30}
                    max={180}
                    step={5}
                    value={wizard.shapeParams?.angleDeg ?? 120}
                    onChange={(e) => {
                      const nextParams = { ...(wizard.shapeParams ?? {}), angleDeg: Number(e.target.value) };
                      const synth = synthesizeParametricShape(nextParams);
                      updateWizard({ shapeParams: nextParams, buildingMassingShape: synth.id });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-argon-muted">
                    Arc Sweep: {wizard.shapeParams?.arcSweepDeg ?? 60}&deg;
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={180}
                    step={15}
                    value={wizard.shapeParams?.arcSweepDeg ?? 60}
                    onChange={(e) => {
                      const nextParams = { ...(wizard.shapeParams ?? {}), arcSweepDeg: Number(e.target.value) };
                      const synth = synthesizeParametricShape(nextParams);
                      updateWizard({ shapeParams: nextParams, buildingMassingShape: synth.id });
                    }}
                  />
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1 argon-scrollbar">
              <button
                key="AUTO"
                type="button"
                data-testid="massing-option-AUTO"
                onClick={() => updateWizard({ buildingMassingShape: 'AUTO', shapeParams: undefined })}
                className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${(wizard.buildingMassingShape ?? 'AUTO') === 'AUTO'
                  ? 'bg-argon-card border-argon-btn ring-1 ring-argon-btn/35 shadow-sm'
                  : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface'
                  }`}
              >
                <div className="w-12 h-9 shrink-0 rounded bg-argon-btn/10 border border-argon-btn/30 flex items-center justify-center text-[10px] font-mono text-argon-btn font-bold">
                  AUTO
                </div>
                <div>
                  <div className="text-xs font-bold text-argon-text">AI Optimal</div>
                  <p className="text-[11px] text-argon-muted mt-0.5">Best daylight &amp; non-repeating variant</p>
                </div>
              </button>

              {filteredCatalogShapes.map((alt) => {
                const active = wizard.buildingMassingShape === alt.id;
                return (
                  <button
                    key={alt.id}
                    type="button"
                    data-testid={`massing-option-${alt.id}`}
                    onClick={() => updateWizard({ buildingMassingShape: alt.id, shapeParams: alt.defaultParams })}
              className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${active
                ? 'bg-argon-card border-argon-btn ring-1 ring-argon-btn/35 shadow-sm'
                : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface'
                }`}
              >
                  <svg viewBox="0 0 80 60" className="w-12 h-9 shrink-0 rounded bg-slate-900/5 border border-argon-border/60 p-0.5">
                    <path d={alt.svgPath} fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.5" className="text-argon-btn" />
                  </svg>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-argon-text truncate">{alt.label}</span>
                    </div>
                    <span className="inline-block text-[9px] font-mono uppercase tracking-wider text-argon-btn">
                      {alt.family.replace('_', ' ')}
                    </span>
                    <p className="text-[11px] text-argon-muted mt-0.5 line-clamp-2">{alt.description}</p>
                  </div>
                </button>
                );
          })}
              </div>
          </ArgonCard>

          {/* Dedicated Dining Hall Toggle */}
          <ArgonCard className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-argon-border/70">
              <div>
                <h3 className="text-sm font-bold text-argon-text">Dedicated Dining Hall</h3>
                <p className="text-xs text-argon-muted mt-0.5">
                  Choose whether each flat includes a separate Dining Hall connected to Living &amp; Kitchen, or reallocates that area into Living &amp; Bedrooms.
                </p>
              </div>
              <ArgonBadge variant="neutral" size="sm">
                Spatial Program
              </ArgonBadge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                data-testid="dining-hall-yes"
                onClick={() => updateWizard({ includeDiningHall: true })}
                className={`p-3.5 rounded-xl border text-left transition-all ${(wizard.includeDiningHall ?? true)
                  ? 'bg-argon-card border-argon-btn ring-1 ring-argon-btn/35 shadow-sm'
                  : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface'
                  }`}
              >
                <div className="text-xs font-bold text-argon-text">Yes — Separate Dining Hall</div>
                <p className="text-[11px] text-argon-muted mt-0.5">
                  Dedicated Dining Hall (&ge;3,000 × 3,200 mm) abutting exterior facade or inter-flat OTS duct.
                </p>
              </button>
              <button
                type="button"
                data-testid="dining-hall-no"
                onClick={() => updateWizard({ includeDiningHall: false })}
                className={`p-3.5 rounded-xl border text-left transition-all ${wizard.includeDiningHall === false
                  ? 'bg-argon-card border-argon-btn ring-1 ring-argon-btn/35 shadow-sm'
                  : 'bg-argon-surface/40 border-argon-border hover:bg-argon-surface'
                  }`}
              >
                <div className="text-xs font-bold text-argon-text">No — Open Living-only / Compact Layout</div>
                <p className="text-[11px] text-argon-muted mt-0.5">
                  Omits separate Dining room and expands Living &amp; Bedrooms proportionally.
                </p>
              </button>
            </div>
          </ArgonCard>
      </div>
    );
  };
