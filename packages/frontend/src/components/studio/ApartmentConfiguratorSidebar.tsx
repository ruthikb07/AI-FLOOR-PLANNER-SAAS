import React, { useState, useMemo } from 'react';
import {
  Building2,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Trees,
  Home,
  Check,
  Flame,
} from 'lucide-react';
import {
  type MultiSheetApartmentConfig,
  type VerticalStackType,
  type ParkingMode,
  type ApartmentJurisdictionCode,
  type DynamicApartmentUnitSpec,
  type ApartmentBhkType,
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
} from '@ai-floor-planner/core';
import {
  computeBuildingStackParameters,
  solveMultiSheetApartmentProject,
  type MultiSheetApartmentResult,
} from '@ai-floor-planner/planning-engine';
import { mmToFeet, feetToMm, sqMmToSqFt } from '@ai-floor-planner/geometry-engine';
import type { EditorContextValue } from '../../stores/editor-store';

export type PipelineStage =
  | 'IDLE'
  | 'VISUAL_PREFLIGHT'
  | 'GEMINI_INTERPRETATION'
  | 'SPACE_FILLING_SNAPPER'
  | 'MULTI_SHEET_SOLVER'
  | 'CLOSURE_VALIDATED';

export type ProvenanceBadge = 'PROVIDER_LLM' | 'FALLBACK_DETERMINISTIC';

export interface ApartmentConfiguratorSidebarProps {
  editor?: EditorContextValue;
  onProjectGenerated?: (result: MultiSheetApartmentResult, provenance: ProvenanceBadge) => void;
  provenance?: ProvenanceBadge;
  onSetActiveSheet?: (sheetIndex: number) => void;
  isGenerating?: boolean;
  generationStage?: PipelineStage;
  onGenerate?: (config: MultiSheetApartmentConfig) => void;
}

export const ApartmentConfiguratorSidebar: React.FC<ApartmentConfiguratorSidebarProps> = ({
  editor,
  onProjectGenerated,
  provenance = 'FALLBACK_DETERMINISTIC',
  onSetActiveSheet,
  isGenerating: externalIsGenerating,
  generationStage: externalPipelineStage,
  onGenerate,
}) => {
  // ─── 1. Plot & Jurisdiction State ───
  const [plotWidthMm, setPlotWidthMm] = useState<number>(editor?.building?.site?.plotWidth || 45000);
  const [plotDepthMm, setPlotDepthMm] = useState<number>(editor?.building?.site?.plotDepth || 35000);
  const [unitMode, setUnitMode] = useState<'m' | 'ft' | 'mm'>('m');
  const [roadWidthM, setRoadWidthM] = useState<number>(12);
  const [accessSides, setAccessSides] = useState<Direction[]>([Direction.South]);
  const [jurisdiction, setJurisdiction] = useState<ApartmentJurisdictionCode>('pune_pmc');
  const [lotAllotmentMode, setLotAllotmentMode] = useState<'FULL_LOT_100_PERCENT' | 'STATUTORY_SETBACK_100_PERCENT'>('STATUTORY_SETBACK_100_PERCENT');

  // ─── 2. Floors & Vertical Stacking State ───
  const [verticalStackType, setVerticalStackType] = useState<VerticalStackType>('STILT_PLUS_N');
  const [numTypicalFloors, setNumTypicalFloors] = useState<number>(7);
  const [floorToFloorHeightMm] = useState<number>(3000);

  // ─── 3. Flats Per Floor & BHK Mix ───
  const [flatsPerFloor, setFlatsPerFloor] = useState<2 | 3 | 4>(4);
  const [units, setUnits] = useState<DynamicApartmentUnitSpec[]>([
    {
      unitIndex: 0,
      bhkType: '2BHK',
      targetCarpetSqFt: 750,
      attachedBathCount: 1,
      hasUtilityBalcony: true,
    },
    {
      unitIndex: 1,
      bhkType: '2BHK',
      targetCarpetSqFt: 750,
      attachedBathCount: 1,
      hasUtilityBalcony: true,
    },
    {
      unitIndex: 2,
      bhkType: '3BHK',
      targetCarpetSqFt: 1100,
      attachedBathCount: 2,
      hasUtilityBalcony: true,
    },
    {
      unitIndex: 3,
      bhkType: '3BHK',
      targetCarpetSqFt: 1100,
      attachedBathCount: 2,
      hasUtilityBalcony: true,
    },
  ]);

  // ─── 4. Parking & Amenities State ───
  const [parkingMode, setParkingMode] = useState<ParkingMode>('STILT_AND_SURFACE');
  const [visitorParkingPercent, setVisitorParkingPercent] = useState<number>(10);
  const [siteAmenities, setSiteAmenities] = useState({ ...DEFAULT_SITE_AMENITIES });
  const [stiltAmenities, setStiltAmenities] = useState({ ...DEFAULT_STILT_AMENITIES });
  const [terraceAmenities, setTerraceAmenities] = useState({ ...DEFAULT_TERRACE_AMENITIES });

  // ─── 5. AI Prompt & Generation Pipeline State ───
  const [prompt, setPrompt] = useState<string>('Modern Indian high-rise residential apartment conforming to UDCPR norms with central vertical core, grand lobby, and landscaped garden.');
  const [internalPipelineStage, setInternalPipelineStage] = useState<PipelineStage>('IDLE');
  const [internalIsGenerating, setInternalIsGenerating] = useState(false);

  const isGenerating = externalIsGenerating !== undefined ? externalIsGenerating : internalIsGenerating;
  const pipelineStage = externalPipelineStage !== undefined ? externalPipelineStage : internalPipelineStage;

  // Accordion collapsed state for sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    plot: true,
    floors: true,
    flats: true,
    amenities: false,
    generate: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Build Configuration Object
  const currentConfig: MultiSheetApartmentConfig = useMemo(() => ({
    plotWidthMm,
    plotDepthMm,
    roadWidthMm: roadWidthM * 1000,
    roadAccessSides: accessSides,
    lotAllotmentMode,
    jurisdiction,
    verticalStackType,
    numTypicalFloors,
    floorToFloorHeightMm,
    flatsPerFloor,
    units: units.slice(0, flatsPerFloor),
    siteAmenities,
    stiltAmenities,
    terraceAmenities,
    parkingMode,
    visitorParkingPercent,
  }), [
    plotWidthMm,
    plotDepthMm,
    roadWidthM,
    accessSides,
    lotAllotmentMode,
    jurisdiction,
    verticalStackType,
    numTypicalFloors,
    floorToFloorHeightMm,
    flatsPerFloor,
    units,
    siteAmenities,
    stiltAmenities,
    terraceAmenities,
    parkingMode,
    visitorParkingPercent,
  ]);

  // Live Statutory Readout
  const stackParams = useMemo(() => {
    return computeBuildingStackParameters(currentConfig);
  }, [currentConfig]);

  // Parking Stalls Calculation
  const parkingMetrics = useMemo(() => {
    const totalFlats = flatsPerFloor * numTypicalFloors;
    const requiredCars = Math.ceil(totalFlats * 1.0);
    const visitorCars = Math.ceil(requiredCars * (visitorParkingPercent / 100));
    const totalRequiredCars = requiredCars + visitorCars;
    const totalRequired2W = Math.ceil(totalFlats * 2.0);
    const providedCars = Math.max(totalRequiredCars, Math.floor(plotWidthMm / 3000));
    const provided2W = Math.max(totalRequired2W, Math.floor(plotDepthMm / 1500));
    return {
      requiredCars: totalRequiredCars,
      providedCars,
      required2W: totalRequired2W,
      provided2W,
    };
  }, [flatsPerFloor, numTypicalFloors, visitorParkingPercent, plotWidthMm, plotDepthMm]);

  // Quick Uniform BHK setter
  const setUniformBhk = (bhk: ApartmentBhkType) => {
    const targetSqFt = bhk === '1BHK' ? 450 : bhk === '2BHK' ? 750 : bhk === '3BHK' ? 1100 : 1550;
    const baths = bhk === '1BHK' ? 1 : bhk === '2BHK' ? 1 : bhk === '3BHK' ? 2 : 3;
    const nextUnits: DynamicApartmentUnitSpec[] = [];
    for (let i = 0; i < flatsPerFloor; i++) {
      nextUnits.push({
        unitIndex: i,
        bhkType: bhk,
        targetCarpetSqFt: targetSqFt,
        attachedBathCount: baths,
        hasUtilityBalcony: true,
      });
    }
    setUnits(nextUnits);
  };

  const handleFlatsPerFloorChange = (count: 2 | 3 | 4) => {
    setFlatsPerFloor(count);
    if (units.length < count) {
      const extra: DynamicApartmentUnitSpec[] = [];
      for (let i = units.length; i < count; i++) {
        extra.push({
          unitIndex: i,
          bhkType: '2BHK',
          targetCarpetSqFt: 750,
          attachedBathCount: 1,
          hasUtilityBalcony: true,
        });
      }
      setUnits(prev => [...prev, ...extra]);
    } else if (units.length > count) {
      setUnits(prev => prev.slice(0, count));
    }
  };

  // Generation Trigger Handler with Visual Pipeline Stage Progression
  const handleGenerateProject = async () => {
    try {
      setInternalIsGenerating(true);
      setInternalPipelineStage('VISUAL_PREFLIGHT');
      await new Promise(r => setTimeout(r, 120));

      setInternalPipelineStage('GEMINI_INTERPRETATION');
      await new Promise(r => setTimeout(r, 120));

      setInternalPipelineStage('SPACE_FILLING_SNAPPER');
      await new Promise(r => setTimeout(r, 120));

      setInternalPipelineStage('MULTI_SHEET_SOLVER');
      const result = solveMultiSheetApartmentProject(currentConfig);

      setInternalPipelineStage('CLOSURE_VALIDATED');
      await new Promise(r => setTimeout(r, 80));

      if (onGenerate) onGenerate(currentConfig);

      // Synchronize editor store building and site
      if (editor) {
        editor.setBuilding(
          result.building,
          `Apartment Project (${flatsPerFloor} Flats/Floor, ${numTypicalFloors} Floors)`,
          {},
          'residential',
        );
        editor.updateSite({
          plotWidth: plotWidthMm,
          plotDepth: plotDepthMm,
          siteZones: result.building.site.siteZones,
        });

        // Default to Typical Floor Plan in editor
        const typicalFloor = result.building.floors.find(f => f.id.includes('typ')) ?? result.building.floors[1] ?? result.building.floors[0]!;
        editor.switchFloor(typicalFloor.id);
      }

      if (onProjectGenerated) onProjectGenerated(result, provenance);
      if (onSetActiveSheet) {
        onSetActiveSheet(2); // Typical floor plan tab
      }
    } catch (err) {
      console.error('Project generation error:', err);
    } finally {
      setInternalIsGenerating(false);
    }
  };

  return (
    <div style={{ width: 360, height: '100%', display: 'flex', flexDirection: 'column', background: '#FAFAFA', borderRight: '1px solid #E5E7EB', overflowY: 'auto', fontSize: 13, color: '#1F2937' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={18} color="#C86D48" />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: -0.2 }}>Apartment Studio Configurator</h2>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, background: provenance === 'PROVIDER_LLM' ? '#ECFDF5' : '#FFF7ED', color: provenance === 'PROVIDER_LLM' ? '#047857' : '#C86D48', border: '1px solid currentColor', borderRadius: 4, padding: '2px 6px' }}>
          {provenance}
        </span>
      </div>

      <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ─── GROUP 1: PLOT, JURISDICTION & ALLOTMENT MODE ─── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => toggleSection('plot')}
            style={{ width: '100%', padding: '10px 12px', background: '#F9FAFB', border: 'none', borderBottom: expandedSections.plot ? '1px solid #E5E7EB' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
          >
            <span>1. Plot, Jurisdiction &amp; Allotment</span>
            {expandedSections.plot ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {expandedSections.plot && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Unit Switcher */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#6B7280' }}>Input Unit:</span>
                <div style={{ display: 'flex', gap: 2, background: '#F3F4F6', padding: 2, borderRadius: 4 }}>
                  {(['m', 'ft', 'mm'] as const).map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnitMode(u)}
                      style={{ padding: '2px 8px', fontSize: 10, fontWeight: 600, border: 'none', borderRadius: 3, background: unitMode === u ? '#FFFFFF' : 'transparent', color: unitMode === u ? '#111827' : '#6B7280', cursor: 'pointer', boxShadow: unitMode === u ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}
                    >
                      {u.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plot Width & Depth */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                    Width ({unitMode})
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={unitMode === 'm' ? (plotWidthMm / 1000).toFixed(1) : unitMode === 'ft' ? Math.round(mmToFeet(plotWidthMm)) : plotWidthMm}
                    onChange={e => {
                      const val = Number(e.target.value);
                      if (val > 0) {
                        const mm = unitMode === 'm' ? Math.round(val * 1000) : unitMode === 'ft' ? feetToMm(val) : val;
                        setPlotWidthMm(mm);
                      }
                    }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }}
                  />
                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                    {unitMode !== 'ft' ? `${Math.round(mmToFeet(plotWidthMm))} ft` : `${(plotWidthMm / 1000).toFixed(1)} m`}
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                    Depth ({unitMode})
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={unitMode === 'm' ? (plotDepthMm / 1000).toFixed(1) : unitMode === 'ft' ? Math.round(mmToFeet(plotDepthMm)) : plotDepthMm}
                    onChange={e => {
                      const val = Number(e.target.value);
                      if (val > 0) {
                        const mm = unitMode === 'm' ? Math.round(val * 1000) : unitMode === 'ft' ? feetToMm(val) : val;
                        setPlotDepthMm(mm);
                      }
                    }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }}
                  />
                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                    {unitMode !== 'ft' ? `${Math.round(mmToFeet(plotDepthMm))} ft` : `${(plotDepthMm / 1000).toFixed(1)} m`}
                  </span>
                </div>
              </div>

              {/* Area Readout Badge */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#334155' }}>
                <span>Total Plot Area: </span>
                <strong>{((plotWidthMm * plotDepthMm) / 1e6).toFixed(1)} m²</strong>
                <span style={{ color: '#64748B' }}> ({Math.round(sqMmToSqFt(plotWidthMm * plotDepthMm)).toLocaleString()} sq ft)</span>
              </div>

              {/* Road Width & Access Sides */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                    Road Width (m)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={roadWidthM}
                    onChange={e => setRoadWidthM(Math.max(6, Number(e.target.value)))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                    Access Sides
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[Direction.South, Direction.North, Direction.East, Direction.West].map(d => {
                      const label = d === Direction.South ? 'S' : d === Direction.North ? 'N' : d === Direction.East ? 'E' : 'W';
                      const active = accessSides.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            if (active && accessSides.length > 1) {
                              setAccessSides(prev => prev.filter(x => x !== d));
                            } else if (!active) {
                              setAccessSides(prev => [...prev, d]);
                            }
                          }}
                          style={{ flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid', borderColor: active ? '#C86D48' : '#D1D5DB', background: active ? '#FFF7ED' : '#FFFFFF', color: active ? '#C86D48' : '#4B5563', cursor: 'pointer' }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Jurisdiction */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  Statutory Jurisdiction
                </label>
                <select
                  value={jurisdiction}
                  onChange={e => setJurisdiction(e.target.value as ApartmentJurisdictionCode)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#FFFFFF' }}
                >
                  <option value="pune_pmc">Pune (PMC UDCPR-2020)</option>
                  <option value="pune_pmrda">Pune Regional (PMRDA)</option>
                  <option value="mumbai_mcgm">Mumbai (MCGM DCPR-2034)</option>
                  <option value="generic_maharashtra">Maharashtra UDCPR Unified</option>
                  <option value="generic_indian">National NBC-2016 Compliant</option>
                </select>
              </div>

              {/* Allotment Mode Toggle */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  Lot Allotment Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setLotAllotmentMode('STATUTORY_SETBACK_100_PERCENT')}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid', borderColor: lotAllotmentMode === 'STATUTORY_SETBACK_100_PERCENT' ? '#C86D48' : '#E5E7EB', background: lotAllotmentMode === 'STATUTORY_SETBACK_100_PERCENT' ? '#FFF7ED' : '#FFFFFF', color: lotAllotmentMode === 'STATUTORY_SETBACK_100_PERCENT' ? '#9A3412' : '#4B5563', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                  >
                    Setbacks + 10% ROS Garden
                  </button>
                  <button
                    type="button"
                    onClick={() => setLotAllotmentMode('FULL_LOT_100_PERCENT')}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid', borderColor: lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? '#C86D48' : '#E5E7EB', background: lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? '#FFF7ED' : '#FFFFFF', color: lotAllotmentMode === 'FULL_LOT_100_PERCENT' ? '#9A3412' : '#4B5563', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                  >
                    100% Full Footprint
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── GROUP 2: FLOORS & VERTICAL STACKING ─── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => toggleSection('floors')}
            style={{ width: '100%', padding: '10px 12px', background: '#F9FAFB', border: 'none', borderBottom: expandedSections.floors ? '1px solid #E5E7EB' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
          >
            <span>2. Floors &amp; Vertical Stacking</span>
            {expandedSections.floors ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {expandedSections.floors && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Stack Type */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  Stack Typology
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  {[
                    { id: 'STILT_PLUS_N', label: 'S + N (Stilt)' },
                    { id: 'G_PLUS_N', label: 'G + N (Ground)' },
                    { id: 'BASEMENT_STILT_PLUS_N', label: 'B + S + N' },
                  ].map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setVerticalStackType(s.id as VerticalStackType)}
                      style={{ padding: '6px 4px', fontSize: 10.5, fontWeight: 600, borderRadius: 4, border: '1px solid', borderColor: verticalStackType === s.id ? '#C86D48' : '#D1D5DB', background: verticalStackType === s.id ? '#FFF7ED' : '#FFFFFF', color: verticalStackType === s.id ? '#C86D48' : '#4B5563', cursor: 'pointer' }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Floor Count Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  <span>Typical Floors Count</span>
                  <span style={{ color: '#C86D48', fontWeight: 700 }}>{numTypicalFloors} Floors</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={numTypicalFloors}
                  onChange={e => setNumTypicalFloors(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#C86D48' }}
                />
              </div>

              {/* Live Statutory Readout Badge */}
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#166534', marginBottom: 4 }}>
                  <ShieldCheck size={14} />
                  <span>NBC &amp; Fire Act Statutory Ledger</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#15803D' }}>
                  <div>Total Height: <strong>{(stackParams.totalBuildingHeightMm / 1000).toFixed(1)} m</strong></div>
                  <div>Fire Stairs: <strong>{stackParams.minStaircases} Flight{stackParams.minStaircases > 1 ? 's' : ''}</strong></div>
                  <div>Passenger Lifts: <strong>{stackParams.minLifts} Lift{stackParams.minLifts > 1 ? 's' : ''}</strong></div>
                  <div style={{ color: stackParams.requiresRefugeFloor ? '#B45309' : '#15803D' }}>
                    Refuge Floor: <strong>{stackParams.requiresRefugeFloor ? `Active (Level ${stackParams.refugeFloorLevels[0]})` : 'N/A (≤24m)'}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── GROUP 3: FLATS PER FLOOR & BHK MIX ─── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => toggleSection('flats')}
            style={{ width: '100%', padding: '10px 12px', background: '#F9FAFB', border: 'none', borderBottom: expandedSections.flats ? '1px solid #E5E7EB' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
          >
            <span>3. Flats Per Floor &amp; BHK Mix</span>
            {expandedSections.flats ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {expandedSections.flats && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Flats Per Floor Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  Typology Density
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { count: 2 as const, label: 'Double (2 Units)' },
                    { count: 3 as const, label: 'Triple (3 Units)' },
                    { count: 4 as const, label: 'Quad (4 Units)' },
                  ].map(t => (
                    <button
                      key={t.count}
                      type="button"
                      onClick={() => handleFlatsPerFloorChange(t.count)}
                      style={{ padding: '6px 4px', fontSize: 10.5, fontWeight: 600, borderRadius: 4, border: '1px solid', borderColor: flatsPerFloor === t.count ? '#C86D48' : '#D1D5DB', background: flatsPerFloor === t.count ? '#FFF7ED' : '#FFFFFF', color: flatsPerFloor === t.count ? '#C86D48' : '#4B5563', cursor: 'pointer' }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Uniform BHK buttons */}
              <div>
                <span style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }}>Set Uniform BHK across all units:</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['2BHK', '3BHK', '4BHK'] as const).map(bhk => (
                    <button
                      key={bhk}
                      type="button"
                      onClick={() => setUniformBhk(bhk)}
                      style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #E5E7EB', background: '#F8FAFC', color: '#1E293B', cursor: 'pointer' }}
                    >
                      All {bhk}
                    </button>
                  ))}
                </div>
              </div>

              {/* Individual Unit Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {units.slice(0, flatsPerFloor).map((unit, idx) => (
                  <div key={idx} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: '#111827' }}>Unit {idx + 1} (Flat {101 + idx})</span>
                      <select
                        value={unit.bhkType}
                        onChange={e => {
                          const nextBhk = e.target.value as ApartmentBhkType;
                          const nextCarpet = nextBhk === '1BHK' ? 450 : nextBhk === '2BHK' ? 750 : nextBhk === '3BHK' ? 1100 : 1550;
                          setUnits(prev => prev.map((u, i) => i === idx ? { ...u, bhkType: nextBhk, targetCarpetSqFt: nextCarpet } : u));
                        }}
                        style={{ padding: '2px 6px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #D1D5DB' }}
                      >
                        <option value="1BHK">1BHK</option>
                        <option value="2BHK">2BHK</option>
                        <option value="3BHK">3BHK</option>
                        <option value="4BHK">4BHK</option>
                      </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#4B5563' }}>
                      <div>Carpet: <strong>{unit.targetCarpetSqFt} sq ft</strong></div>
                      <div>Baths: <strong>{unit.attachedBathCount ?? 1} Attached</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── GROUP 4: PARKING & AMENITIES SELECTOR ─── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => toggleSection('amenities')}
            style={{ width: '100%', padding: '10px 12px', background: '#F9FAFB', border: 'none', borderBottom: expandedSections.amenities ? '1px solid #E5E7EB' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
          >
            <span>4. Parking &amp; Amenities ({Object.values(siteAmenities).filter(Boolean).length + Object.values(stiltAmenities).filter(Boolean).length + Object.values(terraceAmenities).filter(Boolean).length} Active)</span>
            {expandedSections.amenities ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {expandedSections.amenities && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Parking Mode & Visitor % */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
                  Parking Layout Mode
                </label>
                <select
                  value={parkingMode}
                  onChange={e => setParkingMode(e.target.value as ParkingMode)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#FFFFFF', marginBottom: 6 }}
                >
                  <option value="STILT_AND_SURFACE">Stilt + Surface Parking</option>
                  <option value="STILT_ONLY">Stilt Only</option>
                  <option value="MECHANICAL_STACK">Mechanical Hydraulic Stack (4.5m Ht)</option>
                </select>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#4B5563' }}>Visitor Parking Quota:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="number"
                      min="5"
                      max="30"
                      value={visitorParkingPercent}
                      onChange={e => setVisitorParkingPercent(Number(e.target.value))}
                      style={{ width: 45, padding: '2px 4px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11 }}
                    />
                    <span style={{ fontSize: 11, color: '#6B7280' }}>%</span>
                  </div>
                </div>

                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#1E40AF' }}>
                  Car Stalls: <strong>{parkingMetrics.providedCars} Provided</strong> ({parkingMetrics.requiredCars} Req) · 2W: <strong>{parkingMetrics.provided2W} Provided</strong>
                </div>
              </div>

              {/* Site Amenities Checkboxes */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Trees size={12} color="#059669" /> Site &amp; Ground Setback Amenities
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                  {[
                    { key: 'securityCabin' as const, label: 'Security Cabin (2.4x2.4m)' },
                    { key: 'landscapeGardenRos' as const, label: '10% ROS Landscaped Garden' },
                    { key: 'childrenPlayTotLot' as const, label: "Children's Play Tot-Lot" },
                    { key: 'seniorCitizenSitout' as const, label: 'Senior Citizen Sit-out Gazebo' },
                    { key: 'transformerDgYard' as const, label: 'Transformer / DG Yard' },
                    { key: 'ugwtPumpRoom' as const, label: 'UGWT + Fire Pump Room' },
                    { key: 'stpPlant' as const, label: 'STP Plant (Sewage Treatment)' },
                    { key: 'owcWasteYard' as const, label: 'OWC Organic Waste Yard' },
                    { key: 'rainwaterHarvestingPits' as const, label: 'Rainwater Harvesting Pits' },
                    { key: 'evChargingBays' as const, label: 'EV Charging Vehicle Zone' },
                  ].map(a => (
                    <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4B5563', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={siteAmenities[a.key]}
                        onChange={e => setSiteAmenities(prev => ({ ...prev, [a.key]: e.target.checked }))}
                        style={{ accentColor: '#C86D48' }}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Stilt Indoor Amenities Checkboxes */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Home size={12} color="#2563EB" /> Stilt Plinth Indoor Amenities
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                  {[
                    { key: 'grandEntranceLobby' as const, label: 'Grand Entrance Double-Ht Lobby' },
                    { key: 'societyOffice' as const, label: 'Society Management Office' },
                    { key: 'fitnessGymnasium' as const, label: 'Fitness Gymnasium' },
                    { key: 'multipurposeHall' as const, label: 'Multipurpose Society Hall' },
                    { key: 'meterBmsRoom' as const, label: 'Electric Meter & BMS Control' },
                    { key: 'driverStaffToilet' as const, label: 'Driver / Society Staff Toilet' },
                  ].map(a => (
                    <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4B5563', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={stiltAmenities[a.key]}
                        onChange={e => setStiltAmenities(prev => ({ ...prev, [a.key]: e.target.checked }))}
                        style={{ accentColor: '#C86D48' }}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Terrace Amenities Checkboxes */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Flame size={12} color="#D97706" /> Terrace &amp; Rooftop Services
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                  {[
                    { key: 'stairMumtyHeadroom' as const, label: 'Stair Mumty Headroom Enclosure' },
                    { key: 'liftMachineRoom' as const, label: 'Lift Machine Room (LMR)' },
                    { key: 'overheadWaterTank' as const, label: 'Overhead Water Tank (OHWT)' },
                    { key: 'solarPvArray' as const, label: 'Solar PV Panel Renewable Array' },
                    { key: 'terraceYogaDeck' as const, label: 'Terrace Yoga & Sit-Out Deck' },
                  ].map(a => (
                    <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4B5563', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={terraceAmenities[a.key]}
                        onChange={e => setTerraceAmenities(prev => ({ ...prev, [a.key]: e.target.checked }))}
                        style={{ accentColor: '#C86D48' }}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── GROUP 5: AI GENERATION & PROVENANCE BAR ─── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>5. AI Generation &amp; Pipeline</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: provenance === 'PROVIDER_LLM' ? '#ECFDF5' : '#FFF7ED', color: provenance === 'PROVIDER_LLM' ? '#047857' : '#C86D48', padding: '1px 6px', borderRadius: 4, border: '1px solid currentColor' }}>
              {provenance}
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
              Architectural Concept Prompt
            </label>
            <textarea
              rows={2}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 11.5, resize: 'vertical' }}
            />
          </div>

          {/* Pipeline Stage Indicators */}
          {pipelineStage !== 'IDLE' && (
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 10px', fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { stage: 'VISUAL_PREFLIGHT', label: '1. Visual Preflight & Stack Solver' },
                { stage: 'GEMINI_INTERPRETATION', label: '2. Gemini Vision Spatial Interpretation' },
                { stage: 'SPACE_FILLING_SNAPPER', label: '3. Orthogonal Space-Filling Snapper' },
                { stage: 'MULTI_SHEET_SOLVER', label: '4. 6-Sheet Multi-Sheet Apartment Solver' },
                { stage: 'CLOSURE_VALIDATED', label: '5. Planar Conservation Validated (Delta = 0.000 mm²)' },
              ].map(st => {
                const isActive = pipelineStage === st.stage;
                const isPassed = ['VISUAL_PREFLIGHT', 'GEMINI_INTERPRETATION', 'SPACE_FILLING_SNAPPER', 'MULTI_SHEET_SOLVER', 'CLOSURE_VALIDATED'].indexOf(pipelineStage) >= ['VISUAL_PREFLIGHT', 'GEMINI_INTERPRETATION', 'SPACE_FILLING_SNAPPER', 'MULTI_SHEET_SOLVER', 'CLOSURE_VALIDATED'].indexOf(st.stage);
                return (
                  <div key={st.stage} style={{ display: 'flex', alignItems: 'center', gap: 6, color: isPassed ? '#15803D' : '#94A3B8', fontWeight: isActive ? 700 : 500 }}>
                    {isPassed ? <Check size={12} color="#15803D" /> : <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid #CBD5E1' }} />}
                    <span>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action Button */}
          <button
            type="button"
            onClick={handleGenerateProject}
            disabled={isGenerating}
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#C86D48',
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 700,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              opacity: isGenerating ? 0.7 : 1,
            }}
          >
            <Sparkles size={15} />
            <span>{isGenerating ? 'Solving Coordinated Project…' : 'Generate Complete 2D Apartment Project (FLUX.2 + Gemini)'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
