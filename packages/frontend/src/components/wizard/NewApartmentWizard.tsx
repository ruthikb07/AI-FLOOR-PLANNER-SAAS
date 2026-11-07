import React, { useState } from 'react';
import {
  Sparkles,
  Building2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  Direction,
  type ApartmentBhkType,
  type ApartmentJurisdictionCode,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
} from '@ai-floor-planner/core';
import {
  solveMultiSheetApartmentProject,
  type MultiSheetApartmentConfig,
  type MultiSheetApartmentResult,
} from '@ai-floor-planner/planning-engine';

export interface NewApartmentWizardProps {
  onProjectCreated: (result: MultiSheetApartmentResult, projectTitle: string, config: MultiSheetApartmentConfig) => void;
  onCancel?: () => void;
}

export const NewApartmentWizard: React.FC<NewApartmentWizardProps> = ({
  onProjectCreated,
  onCancel,
}) => {
  const [activeTab, setActiveTab] = useState<'1A' | '1B' | '1C'>('1A');

  // Step 1A: Project Title & Natural Language Brief
  const [projectTitle, setProjectTitle] = useState('Gulmohar Heights Residency');
  const [naturalBrief, setNaturalBrief] = useState(
    'Design a Stilt + 7 floor apartment on a 50m x 50m plot in Pune PMC with 4 flats per floor (2x 2BHK + 2x 3BHK), ground floor stilt parking on columns, main entry/exit road on South, and 10% garden on East',
  );

  // Step 1B: Plot, Roadway & Vertical Stack Parameters
  const [plotUnit, setPlotUnit] = useState<'m' | 'ft' | 'mm'>('m');
  const [plotWidthInput, setPlotWidthInput] = useState<number>(50);
  const [plotDepthInput, setPlotDepthInput] = useState<number>(50);
  const [roadWidthM, setRoadWidthM] = useState<number>(12);
  const [roadSide, setRoadSide] = useState<Direction>(Direction.South);
  const [jurisdiction, setJurisdiction] = useState<ApartmentJurisdictionCode>('pune_pmc');
  const [numFloors, setNumFloors] = useState<number>(7);

  // Step 1C: Upper Floor Unit Mix & Amenities
  const [flatsPerFloor, setFlatsPerFloor] = useState<2 | 3 | 4>(4);
  const [flatTypes, setFlatTypes] = useState<ApartmentBhkType[]>(['2BHK', '2BHK', '3BHK', '3BHK']);
  const [siteSecurity, setSiteSecurity] = useState(true);
  const [siteGarden, setSiteGarden] = useState(true);
  const [stiltOffice, setStiltOffice] = useState(true);
  const [terraceSolar, setTerraceSolar] = useState(true);

  // Generating status
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Unit conversion helper
  const getWidthMm = (): number => {
    if (plotUnit === 'm') return Math.round(plotWidthInput * 1000);
    if (plotUnit === 'ft') return Math.round(plotWidthInput * 304.8);
    return Math.round(plotWidthInput);
  };

  const getDepthMm = (): number => {
    if (plotUnit === 'm') return Math.round(plotDepthInput * 1000);
    if (plotUnit === 'ft') return Math.round(plotDepthInput * 304.8);
    return Math.round(plotDepthInput);
  };

  const handleApplyPreset = (presetText: string, widthM: number, depthM: number, floors: number, fCount: 2 | 3 | 4, types: ApartmentBhkType[]) => {
    setNaturalBrief(presetText);
    setPlotUnit('m');
    setPlotWidthInput(widthM);
    setPlotDepthInput(depthM);
    setNumFloors(floors);
    setFlatsPerFloor(fCount);
    setFlatTypes(types);
  };

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      setStatusMessage('Parsing requirements brief & calculating UDCPR setbacks...');
      await new Promise(r => setTimeout(r, 140));

      const plotWidthMm = getWidthMm();
      const plotDepthMm = getDepthMm();

      const config: MultiSheetApartmentConfig = {
        plotWidthMm,
        plotDepthMm,
        roadWidthMm: roadWidthM * 1000,
        roadAccessSides: [roadSide],
        lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
        jurisdiction,
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: numFloors,
        stiltHeightMm: 3000,
        floorToFloorHeightMm: 3000,
        flatsPerFloor,
        units: flatTypes.slice(0, flatsPerFloor).map((bhk, i) => ({
          unitIndex: i + 1,
          bhkType: bhk,
          targetCarpetAreaSqFt: bhk === '4BHK' ? 1450 : bhk === '3BHK' ? 1100 : 750,
          hasUtilityBalcony: true,
        })),
        siteAmenities: {
          ...DEFAULT_SITE_AMENITIES,
          securityCabin: siteSecurity,
          landscapeGardenRos: siteGarden,
        },
        stiltAmenities: {
          ...DEFAULT_STILT_AMENITIES,
          societyOffice: stiltOffice,
        },
        terraceAmenities: {
          ...DEFAULT_TERRACE_AMENITIES,
          solarPvArray: terraceSolar,
        },
        parkingMode: 'STILT_AND_SURFACE',
      };

      setStatusMessage('Synthesizing Ground Stilt column grid & 6000mm vehicular loop...');
      await new Promise(r => setTimeout(r, 140));

      setStatusMessage('Solving Upper Residential floor plate & assembling 6 coordinated sheets...');
      const result = solveMultiSheetApartmentProject(config);
      await new Promise(r => setTimeout(r, 100));

      onProjectCreated(result, projectTitle.trim() || 'Untitled Apartment Project', config);
    } catch (err) {
      console.error('Wizard pipeline execution failed:', err);
      setStatusMessage('Generation error. Please check parameters.');
      setIsGenerating(false);
    }
  };

  return (
    <div className="new-apartment-wizard-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'radial-gradient(circle at 50% 20%, #0f172a 0%, #020617 100%)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      overflowY: 'auto',
    }}>
      {/* Top Banner Header */}
      <header style={{
        padding: '20px 32px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
          }}>
            <Sparkles size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
                FORMA AI Apartment Planner
              </h1>
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: '#0284c7',
                color: '#ffffff',
                fontWeight: 600,
              }}>
                STEP 1: INTAKE WIZARD
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
              Create New Apartment Project & Coordinated 6-Sheet 2D CAD Package
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#94a3b8',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel / Back to Projects
          </button>
        )}
      </header>

      {/* Main Content Area */}
      <main style={{
        maxWidth: 1040,
        width: '100%',
        margin: '32px auto',
        padding: '0 24px 48px',
        flex: 1,
      }}>
        {/* Step Indicator Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 28,
        }}>
          <button
            onClick={() => setActiveTab('1A')}
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              background: activeTab === '1A' ? 'rgba(2, 132, 199, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${activeTab === '1A' ? '#0284c7' : 'rgba(255, 255, 255, 0.08)'}`,
              cursor: 'pointer',
              textAlign: 'left',
              color: activeTab === '1A' ? '#38bdf8' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: activeTab === '1A' ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
            }}>
              1A
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#f8fafc' }}>Natural Language Brief</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Prompt & Project Title</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('1B')}
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              background: activeTab === '1B' ? 'rgba(2, 132, 199, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${activeTab === '1B' ? '#0284c7' : 'rgba(255, 255, 255, 0.08)'}`,
              cursor: 'pointer',
              textAlign: 'left',
              color: activeTab === '1B' ? '#38bdf8' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: activeTab === '1B' ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
            }}>
              1B
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#f8fafc' }}>Plot & Vertical Stack</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Dimensions, Road, S+N Floors</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('1C')}
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              background: activeTab === '1C' ? 'rgba(2, 132, 199, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${activeTab === '1C' ? '#0284c7' : 'rgba(255, 255, 255, 0.08)'}`,
              cursor: 'pointer',
              textAlign: 'left',
              color: activeTab === '1C' ? '#38bdf8' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: activeTab === '1C' ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
            }}>
              1C
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#f8fafc' }}>Unit Mix & Amenities</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Flats/Floor & Amenities</div>
            </div>
          </button>
        </div>

        {/* Tab 1A: Project Title & Natural Language Brief */}
        {activeTab === '1A' && (
          <section style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '28px',
          }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>
              Step 1A — What are your project requirements?
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#94a3b8' }}>
              Describe your Indian residential apartment project brief in plain English. The AI engine will parse your requirements and construct the coordinated 6-sheet CAD model.
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#cbd5e1' }}>
                Project Title / File Name
              </label>
              <input
                type="text"
                value={projectTitle}
                onChange={e => setProjectTitle(e.target.value)}
                placeholder="e.g. Gulmohar Heights Residency"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#cbd5e1' }}>
                Natural Language Brief & Architectural Constraints
              </label>
              <textarea
                rows={5}
                value={naturalBrief}
                onChange={e => setNaturalBrief(e.target.value)}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: 14,
                  lineHeight: '1.6',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Quick Suggestion Chips */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                Quick Architectural Presets:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleApplyPreset(
                    'Design a Stilt + 7 floor apartment on a 50m x 50m plot in Pune PMC with 4 flats per floor (2x 2BHK + 2x 3BHK), ground floor stilt parking on columns, main entry/exit road on South, and 10% garden on East',
                    50, 50, 7, 4, ['2BHK', '2BHK', '3BHK', '3BHK']
                  )}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: 'rgba(2, 132, 199, 0.12)',
                    border: '1px solid rgba(2, 132, 199, 0.3)',
                    color: '#38bdf8',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  🏢 Pune PMC S+7 (50x50m, 4 Flats/Floor)
                </button>

                <button
                  type="button"
                  onClick={() => handleApplyPreset(
                    'Design a Stilt + 12 floor high-rise residential apartment on a 40m x 60m plot in Pune PMC with 3 flats per floor (3x 3BHK), ground floor stilt parking, main road on North, and statutory ROS garden on East',
                    40, 60, 12, 3, ['3BHK', '3BHK', '3BHK']
                  )}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#cbd5e1',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  🏙️ Pune S+12 High-Rise (3x 3BHK)
                </button>

                <button
                  type="button"
                  onClick={() => handleApplyPreset(
                    'Design a Stilt + 4 floor luxury boutique apartment on a 35m x 45m plot with 2 flats per floor (2x 4BHK), ground stilt parking on columns, road on West, and private sit-out garden',
                    35, 45, 4, 2, ['4BHK', '4BHK']
                  )}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#cbd5e1',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  🌟 Luxury S+4 Boutique (2x 4BHK)
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={() => setActiveTab('1B')}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  padding: '12px 24px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Next: Plot & Stack Parameters <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* Tab 1B: Plot, Roadway & Vertical Stack Parameters */}
        {activeTab === '1B' && (
          <section style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '28px',
          }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>
              Step 1B — Plot, Roadway & Vertical Stack Architecture
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#94a3b8' }}>
              Define boundary dimensions, road width under UDCPR 2020, and the vertical floor stack.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Plot Dimension Unit
                </label>
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
                  {(['m', 'ft', 'mm'] as const).map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setPlotUnit(u)}
                      style={{
                        flex: 1,
                        padding: '10px 0',
                        background: plotUnit === u ? '#0284c7' : 'rgba(15, 23, 42, 0.6)',
                        color: '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: plotUnit === u ? 700 : 500,
                      }}
                    >
                      {u.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Plot Width ({plotUnit})
                </label>
                <input
                  type="number"
                  value={plotWidthInput}
                  onChange={e => setPlotWidthInput(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Plot Depth ({plotUnit})
                </label>
                <input
                  type="number"
                  value={plotDepthInput}
                  onChange={e => setPlotDepthInput(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Access Road Width (m)
                </label>
                <select
                  value={roadWidthM}
                  onChange={e => setRoadWidthM(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value={9}>9.0m (FSI 1.50)</option>
                  <option value={12}>12.0m (FSI 2.00 - Standard)</option>
                  <option value={18}>18.0m (FSI 2.50)</option>
                  <option value={24}>24.0m (FSI 3.00)</option>
                  <option value={30}>30.0m+ (FSI 3.50)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Road Access Side
                </label>
                <select
                  value={roadSide}
                  onChange={e => setRoadSide(e.target.value as Direction)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value={Direction.South}>South (Standard Ingress)</option>
                  <option value={Direction.North}>North</option>
                  <option value={Direction.East}>East</option>
                  <option value={Direction.West}>West</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' }}>
                  Statutory Jurisdiction
                </label>
                <select
                  value={jurisdiction}
                  onChange={e => setJurisdiction(e.target.value as ApartmentJurisdictionCode)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="pune_pmc">Pune PMC (UDCPR 2020)</option>
                  <option value="pcmc">PCMC Pimpri-Chinchwad</option>
                  <option value="mcgm_mumbai">MCGM Greater Mumbai</option>
                </select>
              </div>
            </div>

            {/* Vertical Stack Architecture Card */}
            <div style={{
              padding: '18px 20px',
              borderRadius: 10,
              background: 'rgba(2, 132, 199, 0.08)',
              border: '1px solid rgba(2, 132, 199, 0.3)',
              marginBottom: 28,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Building2 size={20} color="#38bdf8" />
                  <div>
                    <strong style={{ fontSize: 14, color: '#f8fafc' }}>
                      Vertical Stack: Stilt Parking on Ground + N Upper Residential Floors (S + {numFloors})
                    </strong>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      Ground level contains Columns + Parking + Core ONLY. Upper floors contain Residential Flats ONLY.
                    </div>
                  </div>
                </div>
                <span style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#0284c7',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {numFloors} Typical Floors
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>Upper Residential Floors (1 to 30):</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={numFloors}
                  onChange={e => setNumFloors(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#0284c7' }}
                />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#38bdf8', minWidth: 40 }}>
                  {numFloors}F
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <button
                type="button"
                onClick={() => setActiveTab('1A')}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#cbd5e1',
                  padding: '12px 20px',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ChevronLeft size={16} /> Back to Brief
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('1C')}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  padding: '12px 24px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Next: Unit Mix & Amenities <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* Tab 1C: Apartment Unit Mix & Amenities */}
        {activeTab === '1C' && (
          <section style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '28px',
          }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>
              Step 1C — Upper Floor Apartment Mix & Project Amenities
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#94a3b8' }}>
              Select typical floor flat count (2, 3, or 4 units per floor) and customize per-unit BHK types and amenities.
            </p>

            {/* Flats per floor selector */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#cbd5e1' }}>
                Flats per Typical Floor
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { count: 2 as const, label: 'Double Flat (2 Units/Floor)' },
                  { count: 3 as const, label: 'Triple Flat (3 Units/Floor)' },
                  { count: 4 as const, label: 'Quad Flat (4 Units/Floor)' },
                ].map(item => (
                  <button
                    key={item.count}
                    type="button"
                    onClick={() => {
                      setFlatsPerFloor(item.count);
                    }}
                    style={{
                      padding: '14px',
                      borderRadius: 8,
                      background: flatsPerFloor === item.count ? 'rgba(2, 132, 199, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                      border: `1px solid ${flatsPerFloor === item.count ? '#0284c7' : 'rgba(255, 255, 255, 0.1)'}`,
                      color: flatsPerFloor === item.count ? '#38bdf8' : '#94a3b8',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Per-Unit BHK Selectors */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#cbd5e1' }}>
                Unit Configuration per Floor
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${flatsPerFloor}, 1fr)`, gap: 12 }}>
                {Array.from({ length: flatsPerFloor }).map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '14px',
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#f8fafc' }}>
                      Flat 10{idx + 1}
                    </div>
                    <select
                      value={flatTypes[idx] || '2BHK'}
                      onChange={e => {
                        const newTypes = [...flatTypes];
                        newTypes[idx] = e.target.value as ApartmentBhkType;
                        setFlatTypes(newTypes);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: '#1e293b',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      <option value="2BHK">2 BHK (750 sq.ft)</option>
                      <option value="3BHK">3 BHK (1100 sq.ft)</option>
                      <option value="4BHK">4 BHK (1450 sq.ft)</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Amenity Toggles */}
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 12, color: '#cbd5e1' }}>
                Statutory & Architectural Amenities
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={siteSecurity}
                    onChange={e => setSiteSecurity(e.target.checked)}
                    style={{ accentColor: '#0284c7' }}
                  />
                  <span>Security Cabin & 4.5m In/Out Gates (Sheet 01)</span>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={siteGarden}
                    onChange={e => setSiteGarden(e.target.checked)}
                    style={{ accentColor: '#0284c7' }}
                  />
                  <span>10% Statutory ROS Landscaped Garden on East</span>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={stiltOffice}
                    onChange={e => setStiltOffice(e.target.checked)}
                    style={{ accentColor: '#0284c7' }}
                  />
                  <span>Society Office & Grand Foyer Lobby (Sheet 02)</span>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={terraceSolar}
                    onChange={e => setTerraceSolar(e.target.checked)}
                    style={{ accentColor: '#0284c7' }}
                  />
                  <span>Rooftop Solar PV Array & Yoga Deck (Sheet 05)</span>
                </label>
              </div>
            </div>

            {/* Primary CTA and Actions */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 16,
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('1B')}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#cbd5e1',
                  padding: '12px 20px',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ChevronLeft size={16} /> Back
              </button>

              <button
                type="button"
                disabled={isGenerating}
                onClick={handleGenerate}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: '#ffffff',
                  padding: '14px 32px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: '0 4px 18px rgba(2, 132, 199, 0.45)',
                  opacity: isGenerating ? 0.7 : 1,
                }}
              >
                {isGenerating ? (
                  <>
                    <div style={{
                      width: 16,
                      height: 16,
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      borderTopColor: '#ffffff',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    <span>{statusMessage}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>Create Project & Generate AI 2D Plans -&gt;</span>
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
