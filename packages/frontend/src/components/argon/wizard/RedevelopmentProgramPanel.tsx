import React, { useState } from 'react';
import {
  Building,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Plus,
  Trash2,
  Layers,
  Users,
} from 'lucide-react';
import { useStudioStore } from '../../../stores/useStudioStore';
import { DEFAULT_REDEVELOPMENT_PROGRAM, type RetentionMode } from '../../../services/redevelopment-feasibility';
import { ArgonBadge, ArgonCard, ArgonInput, ArgonSelect } from '../ui';

const OPTIONAL_OWNER_ROOMS = [
  'Living/Dining',
  'Vastu Kitchen',
  'Master En-suite',
  'Pooja Room',
  'Study',
  'Utility Balcony',
  'Senior Guest Room',
  'Internal Stair Zone',
] as const;

export const RedevelopmentProgramPanel: React.FC = () => {
  const {
    wizard,
    updateWizard,
    updateRedevelopment,
    addOwnerRoomBrief,
    updateOwnerRoomBrief,
    removeOwnerRoomBrief,
    redevelopmentFeasibility,
  } = useStudioStore();

  const redev = wizard.redevelopment ?? DEFAULT_REDEVELOPMENT_PROGRAM;
  const [newOwnerName, setNewOwnerName] = useState('');

  const handleAddOwner = () => {
    addOwnerRoomBrief({
      ownerLabel: newOwnerName.trim() || `Member ${100 + redev.ownerRoomBriefs.length + 1}`,
    });
    setNewOwnerName('');
  };

  const toggleOwnerRoom = (ownerId: string, roomName: string, currentRooms: readonly string[]) => {
    const exists = currentRooms.includes(roomName);
    const nextRooms = exists
      ? currentRooms.filter(r => r !== roomName)
      : [...currentRooms, roomName];
    updateOwnerRoomBrief(ownerId, { requiredRooms: nextRooms });
  };

  return (
    <div className="space-y-5 animate-fadeIn" data-testid="redevelopment-program-panel">
      {/* 1. Existing Building Details & Structural Condition */}
      <ArgonCard className="space-y-4 border-argon-btn/40">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Building className="w-4 h-4 text-argon-btn" />
            <span>Existing Society / Building Details</span>
          </h3>
          <ArgonBadge variant="leather" size="sm">
            Baseline Survey
          </ArgonBadge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          <ArgonInput
            label="Existing Structure Name"
            aria-label="Existing building name"
            value={redev.existingBuildingName}
            onChange={(e) => updateRedevelopment({ existingBuildingName: e.target.value })}
          />
          <ArgonInput
            label="Building Age (Years)"
            type="number"
            min={1}
            max={120}
            value={redev.existingAgeYears}
            onChange={(e) => updateRedevelopment({ existingAgeYears: Math.max(1, Number(e.target.value)) })}
          />
          <ArgonInput
            label="Existing Storeys (G+N)"
            type="number"
            min={1}
            max={20}
            value={redev.existingStoreys}
            onChange={(e) => updateRedevelopment({ existingStoreys: Math.max(1, Number(e.target.value)) })}
          />
          <ArgonInput
            label="Existing Flats / Members"
            type="number"
            min={1}
            max={200}
            value={redev.existingFlatsCount}
            onChange={(e) => updateRedevelopment({ existingFlatsCount: Math.max(1, Number(e.target.value)) })}
          />
          <ArgonInput
            label="Existing Built-Up Area"
            type="number"
            min={500}
            step={100}
            suffix="sq ft"
            value={redev.existingBuiltUpSqFt}
            onChange={(e) => updateRedevelopment({ existingBuiltUpSqFt: Math.max(200, Number(e.target.value)) })}
          />
          <ArgonSelect
            label="Structural Condition"
            aria-label="Existing structural condition"
            value={redev.existingCondition}
            onChange={(e) =>
              updateRedevelopment({
                existingCondition: e.target.value as typeof redev.existingCondition,
              })
            }
          >
            <option value="aged_full_demolition">Aged RCC (&gt;30 yrs — Full Demolition)</option>
            <option value="sound_partial_retention">Sound Frame (Candidate for Retention)</option>
            <option value="heritage_facade">Heritage Envelope Retention</option>
          </ArgonSelect>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-argon-text pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={redev.structuralAuditAvailable}
            onChange={(e) => updateRedevelopment({ structuralAuditAvailable: e.target.checked })}
            className="accent-amber-600"
          />
          <span>Licensed NDT / Structural Stability Audit Report on record</span>
        </label>
      </ArgonCard>

      {/* 2. Retained vs Demolished Portions + Proposed Multi-Storey / Duplex / Triplex Targets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ArgonCard className="space-y-3.5">
          <div className="flex items-center justify-between pb-2.5 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text">Retained vs Demolished Scope</h3>
            <ArgonBadge variant="neutral" size="sm">
              Site Phasing
            </ArgonBadge>
          </div>

          <ArgonSelect
            label="Demolition / Retention Strategy"
            aria-label="Retention mode"
            value={redev.retentionMode}
            onChange={(e) => {
              const mode = e.target.value as RetentionMode;
              updateRedevelopment({
                retentionMode: mode,
                retainedAreaPct: mode === 'full_demolition' ? 0 : Math.max(20, redev.retainedAreaPct),
              });
            }}
          >
            <option value="full_demolition">100% Demolition &amp; Clean Rebuild</option>
            <option value="retain_stilt_podium">Retain Lower Stilt / Podium &amp; Rebuild Upper</option>
            <option value="vertical_extension">Retain Core &amp; Add Upper Storeys</option>
          </ArgonSelect>

          {redev.retentionMode !== 'full_demolition' && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-argon-muted">Retained Portion Share:</span>
                <span className="font-bold text-argon-btn">{redev.retainedAreaPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={85}
                value={redev.retainedAreaPct}
                onChange={(e) => updateRedevelopment({ retainedAreaPct: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-[11px] font-mono font-bold uppercase text-argon-muted">
              Retained Portions Notes
            </label>
            <textarea
              rows={2}
              value={redev.retainedPortionNotes}
              onChange={(e) => updateRedevelopment({ retainedPortionNotes: e.target.value })}
              className="w-full rounded-xl border border-argon-border bg-argon-card px-3 py-2 text-xs text-argon-text"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-mono font-bold uppercase text-argon-muted">
              Demolished Portions Scope
            </label>
            <textarea
              rows={2}
              value={redev.demolishedPortionNotes}
              onChange={(e) => updateRedevelopment({ demolishedPortionNotes: e.target.value })}
              className="w-full rounded-xl border border-argon-border bg-argon-card px-3 py-2 text-xs text-argon-text"
            />
          </div>
        </ArgonCard>

        <ArgonCard className="space-y-3.5">
          <div className="flex items-center justify-between pb-2.5 border-b border-argon-border/70">
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Layers className="w-4 h-4 text-argon-btn" />
              <span>Required Storeys, Duplex &amp; Triplex Counts</span>
            </h3>
            <ArgonBadge variant="leather" size="sm">
              Rehab + Sale
            </ArgonBadge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ArgonInput
              label="Required Storeys"
              aria-label="Required storeys"
              type="number"
              min={1}
              max={12}
              value={redev.requiredStoreys}
              onChange={(e) => updateRedevelopment({ requiredStoreys: Math.max(1, Number(e.target.value)) })}
            />
            <ArgonInput
              label="Member Bonus Corpus"
              aria-label="Member bonus corpus percent"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={redev.corpusEntitlementBonusPct}
              onChange={(e) =>
                updateRedevelopment({ corpusEntitlementBonusPct: Math.max(0, Number(e.target.value)) })
              }
            />
            <ArgonInput
              label="Duplex Units (2-Storey)"
              aria-label="Duplex count"
              type="number"
              min={0}
              max={12}
              value={wizard.duplexCount ?? 0}
              onChange={(e) => updateWizard({ duplexCount: Math.max(0, Number(e.target.value)) })}
            />
            <ArgonInput
              label="Triplex Units (3-Storey)"
              aria-label="Triplex count"
              type="number"
              min={0}
              max={8}
              value={wizard.triplexCount ?? 0}
              onChange={(e) => updateWizard({ triplexCount: Math.max(0, Number(e.target.value)) })}
            />
          </div>

          {/* Preliminary Feasibility Status Card */}
          {redevelopmentFeasibility && (
            <div
              data-testid="redevelopment-feasibility-card"
              className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                redevelopmentFeasibility.status === 'FEASIBLE_PRELIMINARY'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : redevelopmentFeasibility.status === 'CONDITIONAL_REVIEW'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold flex items-center gap-1.5">
                  {redevelopmentFeasibility.status === 'FEASIBLE_PRELIMINARY' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  )}
                  {redevelopmentFeasibility.status === 'CONDITIONAL_REVIEW' && (
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                  )}
                  {redevelopmentFeasibility.status === 'INFEASIBLE_PROGRAM_EXCEEDS_ENVELOPE' && (
                    <AlertOctagon className="w-4 h-4 text-rose-700" />
                  )}
                  <span>Feasibility Status: {redevelopmentFeasibility.status}</span>
                </span>
                <span className="font-mono font-semibold">
                  Est. {redevelopmentFeasibility.heightM} m
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] pt-1 border-t border-black/10">
                <span>Retained: {redevelopmentFeasibility.retainedBuiltUpSqFt.toLocaleString()} sq ft</span>
                <span>Demolished: {redevelopmentFeasibility.demolishedBuiltUpSqFt.toLocaleString()} sq ft</span>
                <span>Req. Rehab: {redevelopmentFeasibility.requiredMemberCarpetSqFt.toLocaleString()} sq ft</span>
                <span>Envelope Cap: {redevelopmentFeasibility.maxBuildableCarpetCapacitySqFt.toLocaleString()} sq ft</span>
              </div>

              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                {redevelopmentFeasibility.findings.map((finding, idx) => (
                  <li key={idx}>{finding}</li>
                ))}
              </ul>
              <p className="text-[10px] opacity-80">{redevelopmentFeasibility.engineeringNote}</p>
            </div>
          )}
        </ArgonCard>
      </div>

      {/* 3. Owner-Specific Room Briefs */}
      <ArgonCard className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-argon-border/70">
          <div>
            <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
              <Users className="w-4 h-4 text-argon-btn" />
              <span>Owner-Specific Room Briefs ({redev.ownerRoomBriefs.length} Members)</span>
            </h3>
            <p className="text-xs text-argon-muted">
              Capture society member unit entitlements, room requests, and retention vs re-allotment preference.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Owner / Flat label..."
              value={newOwnerName}
              onChange={(e) => setNewOwnerName(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-argon-border bg-argon-card text-xs"
            />
            <button
              type="button"
              onClick={handleAddOwner}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-argon-btn text-argon-card text-xs font-bold hover:bg-argon-btnHover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Owner Brief
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {redev.ownerRoomBriefs.map((owner) => (
            <div
              key={owner.id}
              className="p-3.5 rounded-xl border border-argon-border bg-argon-surface/40 space-y-2.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                <ArgonInput
                  label="Owner / Member"
                  value={owner.ownerLabel}
                  onChange={(e) => updateOwnerRoomBrief(owner.id, { ownerLabel: e.target.value })}
                />
                <ArgonSelect
                  label="Typology"
                  value={owner.targetTypology}
                  onChange={(e) =>
                    updateOwnerRoomBrief(owner.id, {
                      targetTypology: e.target.value as typeof owner.targetTypology,
                    })
                  }
                >
                  <option value="2BHK">2BHK Rehab Suite</option>
                  <option value="3BHK">3BHK Rehab Suite</option>
                  <option value="Duplex">Duplex (2-Storey)</option>
                  <option value="Triplex">Triplex (3-Storey)</option>
                </ArgonSelect>
                <ArgonInput
                  label="Target Carpet (sq ft)"
                  type="number"
                  min={450}
                  max={6000}
                  step={50}
                  value={owner.targetCarpetSqFt}
                  onChange={(e) =>
                    updateOwnerRoomBrief(owner.id, {
                      targetCarpetSqFt: Math.max(300, Number(e.target.value)),
                    })
                  }
                />
                <div className="flex items-center justify-between gap-2">
                  <ArgonSelect
                    label="Allocation"
                    value={owner.disposition}
                    onChange={(e) =>
                      updateOwnerRoomBrief(owner.id, {
                        disposition: e.target.value as typeof owner.disposition,
                      })
                    }
                  >
                    <option value="reallot_new_core">Re-allot New Tower</option>
                    <option value="retain_in_existing">Retain Existing Core</option>
                  </ArgonSelect>
                  <button
                    type="button"
                    onClick={() => removeOwnerRoomBrief(owner.id)}
                    aria-label={`Remove ${owner.ownerLabel}`}
                    className="mt-5 p-2 rounded-lg text-argon-muted hover:text-argon-error hover:bg-argon-error/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {(owner.targetTypology === 'Duplex' || owner.targetTypology === 'Triplex') && (() => {
                const span = owner.targetTypology === 'Duplex' ? 2 : 3;
                const lastStart = Math.max(0, Math.min(70, Math.floor(wizard.floorsCount) - span + 1));
                return <label className="rh-linked-request">
                  <span>Requested linked levels for {owner.ownerLabel}</span>
                  <select value={owner.firstLinkedStorey && owner.firstLinkedStorey <= lastStart ? owner.firstLinkedStorey : ''}
                    onChange={event => updateOwnerRoomBrief(owner.id, { firstLinkedStorey: event.target.value ? Number(event.target.value) : undefined })}>
                    <option value="">Unassigned</option>
                    {Array.from({ length: lastStart }, (_, index) =>
                      <option key={index + 1} value={index + 1}>Levels {index + 1}–{index + span}</option>)}
                  </select>
                </label>;
              })()}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {OPTIONAL_OWNER_ROOMS.map((room) => {
                  const active = owner.requiredRooms.includes(room);
                  return (
                    <button
                      key={room}
                      type="button"
                      onClick={() => toggleOwnerRoom(owner.id, room, owner.requiredRooms)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                        active
                          ? 'bg-argon-btn text-argon-card border-argon-btn font-bold'
                          : 'bg-argon-card text-argon-muted border-argon-border hover:text-argon-text'
                      }`}
                    >
                      {active ? '✓ ' : '+ '}
                      {room}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ArgonCard>
    </div>
  );
};
