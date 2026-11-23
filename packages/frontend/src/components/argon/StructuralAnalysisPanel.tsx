import React, { useMemo, useState } from 'react';
import type { Building } from '@ai-floor-planner/core';
import {
  evaluateIS456StructuralAnalysis,
  type ConcreteGradeCode,
  type SeismicZoneCode,
  type SteelGradeCode,
} from '@ai-floor-planner/planning-engine';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  ShieldAlert,
} from 'lucide-react';

interface StructuralAnalysisPanelProps {
  readonly building: Building;
  readonly onDownloadReportPdf?: () => void;
  readonly reportBusy?: boolean;
}

type ScheduleSubTab = 'COLUMNS' | 'BEAMS_SLABS' | 'FOOTINGS' | 'SEISMIC';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const StructuralAnalysisPanel: React.FC<StructuralAnalysisPanelProps> = ({
  building,
  onDownloadReportPdf,
  reportBusy = false,
}) => {
  const [seismicZone, setSeismicZone] = useState<SeismicZoneCode>('III');
  const [concreteGrade, setConcreteGrade] = useState<ConcreteGradeCode>('M25');
  const [steelGrade, setSteelGrade] = useState<SteelGradeCode>('Fe500');
  const [sbcKnM2, setSbcKnM2] = useState<number>(200);
  const [activeSubTab, setActiveSubTab] = useState<ScheduleSubTab>('COLUMNS');
  const [e2kBusy, setE2kBusy] = useState(false);
  const [e2kStatus, setE2kStatus] = useState('');

  const analysis = useMemo(
    () =>
      evaluateIS456StructuralAnalysis(building, {
        seismicZone,
        concreteGrade,
        steelGrade,
        safeBearingCapacityKnM2: Number.isFinite(sbcKnM2) && sbcKnM2 >= 50 ? sbcKnM2 : 200,
      }),
    [building, seismicZone, concreteGrade, steelGrade, sbcKnM2],
  );

  async function handleDownloadE2k() {
    setE2kBusy(true);
    setE2kStatus('Generating CSI ETABS (.e2k) model…');
    try {
      const response = await fetch('/api/v1/export/etabs/e2k', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message ?? 'ETABS .e2k generation failed');
      }
      const text = await response.text();
      const safeName = (building.name || building.id || 'etabs_model').replace(/[^a-zA-Z0-9_-]/g, '_');
      triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeName}.e2k`);
      setE2kStatus(`Downloaded ${safeName}.e2k (${Math.round(text.length / 1024)} KB)`);
    } catch (err) {
      setE2kStatus(err instanceof Error ? err.message : 'ETABS .e2k export failed');
    } finally {
      setE2kBusy(false);
    }
  }

  return (
    <div
      data-testid="structural-analysis-panel"
      className="flex flex-col gap-4 bg-[#0B101B] text-[#F8FAFC] p-4 sm:p-5 overflow-auto h-full"
    >
      {/* Header & Interactive Design Parameter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-bold tracking-tight text-[#F8FAFC]">
              Built-In IS 456:2000 &amp; IS 1893:2016 Structural Analysis
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono font-semibold ${
                analysis.healthSummary.overallStatus === 'PASS_PRELIMINARY'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              {analysis.healthSummary.overallStatus === 'PASS_PRELIMINARY'
                ? 'PRELIMINARY CHECKS OK'
                : 'MEMBER REVIEW ADVISED'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            {analysis.buildingSummary.storeyCount} storeys ({analysis.buildingSummary.totalHeightM} m) ·{' '}
            {analysis.buildingSummary.columnCountPerFloor} corner-locked columns/floor ·{' '}
            {analysis.buildingSummary.beamCountPerFloor} beams/floor (max span {analysis.buildingSummary.maxBeamSpanMm} mm)
          </p>
        </div>

        {/* One-Click ETABS .e2k + PDF Report Export */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="struct-download-e2k"
            disabled={e2kBusy}
            onClick={() => void handleDownloadE2k()}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/70 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {e2kBusy ? 'Exporting .e2k…' : 'Export CSI ETABS (.e2k)'}
          </button>
          {onDownloadReportPdf && (
            <button
              type="button"
              data-testid="struct-download-report-pdf"
              disabled={reportBusy}
              onClick={onDownloadReportPdf}
              className="flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              Structural Report (PDF)
            </button>
          )}
        </div>
      </div>

      {/* Editable Engineering Inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Seismic Zone (IS 1893)</span>
          <select
            data-testid="struct-seismic-zone"
            value={seismicZone}
            onChange={(e) => setSeismicZone(e.target.value as SeismicZoneCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC] focus:border-amber-400 focus:outline-none"
          >
            <option value="II">Zone II (Z = 0.10)</option>
            <option value="III">Zone III (Z = 0.16 · Pune/Mumbai)</option>
            <option value="IV">Zone IV (Z = 0.24 · Delhi NCR)</option>
            <option value="V">Zone V (Z = 0.36 · High Seismic)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Concrete Grade (IS 456)</span>
          <select
            data-testid="struct-concrete-grade"
            value={concreteGrade}
            onChange={(e) => setConcreteGrade(e.target.value as ConcreteGradeCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC] focus:border-amber-400 focus:outline-none"
          >
            <option value="M20">M20 (20 MPa)</option>
            <option value="M25">M25 (25 MPa)</option>
            <option value="M30">M30 (30 MPa)</option>
            <option value="M35">M35 (35 MPa)</option>
            <option value="M40">M40 (40 MPa)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Rebar Steel Grade</span>
          <select
            data-testid="struct-steel-grade"
            value={steelGrade}
            onChange={(e) => setSteelGrade(e.target.value as SteelGradeCode)}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC] focus:border-amber-400 focus:outline-none"
          >
            <option value="Fe415">Fe415</option>
            <option value="Fe500">Fe500 (Standard HYSD)</option>
            <option value="Fe550">Fe550</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-300">
          <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400">Soil SBC (kN/m²)</span>
          <input
            data-testid="struct-sbc-input"
            type="number"
            min={50}
            max={1000}
            step={10}
            value={sbcKnM2}
            onChange={(e) => setSbcKnM2(Math.max(50, Number(e.target.value) || 200))}
            className="rounded-lg border border-slate-600 bg-[#0B101B] px-2.5 py-1.5 text-xs font-mono text-[#F8FAFC] focus:border-amber-400 focus:outline-none"
          />
        </label>
      </div>

      {e2kStatus && (
        <div role="status" className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 font-mono">
          {e2kStatus}
        </div>
      )}

      {/* Key Gravity & Seismic Engineering Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Factored Gravity 1.5(DL+LL)</div>
          <div className="mt-1 text-xl font-bold font-mono text-[#F8FAFC]">
            {analysis.gravitySummary.factoredTotalGravityKn.toLocaleString()} <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            DL {analysis.gravitySummary.totalDeadLoadKn.toLocaleString()} · LL {analysis.gravitySummary.totalLiveLoadKn.toLocaleString()} kN
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Seismic Base Shear Vb (Zone {analysis.inputs.seismicZone})
          </div>
          <div data-testid="struct-base-shear-value" className="mt-1 text-xl font-bold font-mono text-amber-300">
            {analysis.seismicSummary.designBaseShearVbKn.toLocaleString()} <span className="text-xs font-normal text-slate-400">kN</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Ah = {analysis.seismicSummary.horizontalCoeffAh} ({analysis.seismicSummary.baseShearPercentW}% W) · Ta = {analysis.seismicSummary.fundamentalPeriodSec}s
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Columns (C1..C{analysis.columnSchedule.length})</div>
          <div className="mt-1 text-xl font-bold font-mono text-emerald-300">
            {analysis.healthSummary.columnsOk}/{analysis.columnSchedule.length} <span className="text-xs font-normal text-slate-400">OK</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Max util {(analysis.healthSummary.maxColumnUtilization * 100).toFixed(0)}% · Rebar 0.8%–4.0%
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Beams &amp; Slab Check</div>
          <div className="mt-1 text-xl font-bold font-mono text-sky-300">
            {analysis.healthSummary.beamsOk}/{analysis.beamChecks.length} <span className="text-xs font-normal text-slate-400">OK</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Slab {analysis.slabCheck.thicknessMm} mm ({analysis.slabCheck.slabAction.replace('_', '-')}) · L/d {analysis.slabCheck.actualSpanDepthRatio}/{analysis.slabCheck.allowableSpanDepthRatio}
          </div>
        </div>
      </div>

      {/* Sub-Tabs for Detailed Schedules */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700/80 pb-2">
        {([
          ['COLUMNS', `Column Schedule (${analysis.columnSchedule.length})`],
          ['BEAMS_SLABS', `Beam & Slab Checks (${analysis.beamChecks.length})`],
          ['FOOTINGS', `Footing Sizing (SBC ${analysis.inputs.safeBearingCapacityKnM2} kN/m²)`],
          ['SEISMIC', `Gravity & Seismic Breakdown`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`struct-subtab-${id.toLowerCase()}`}
            onClick={() => setActiveSubTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-mono font-semibold transition-colors cursor-pointer ${
              activeSubTab === id
                ? 'bg-amber-500 text-[#0B101B]'
                : 'bg-[#111827] text-slate-300 border border-slate-700 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Schedule Content Tables */}
      {activeSubTab === 'COLUMNS' && (
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[380px]">
          <table data-testid="struct-column-schedule-table" className="w-full text-left text-xs font-mono">
            <thead className="sticky top-0 bg-[#0F172A] text-slate-300 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2">Col</th>
                <th className="px-3 py-2">Grid</th>
                <th className="px-3 py-2">Size (mm)</th>
                <th className="px-3 py-2 text-right">Trib (m²)</th>
                <th className="px-3 py-2 text-right">Pu (kN)</th>
                <th className="px-3 py-2 text-right">Cap (kN)</th>
                <th className="px-3 py-2 text-right">Util</th>
                <th className="px-3 py-2">Rebar (%)</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {analysis.columnSchedule.map((row) => (
                <tr key={row.columnId} className="hover:bg-slate-800/60">
                  <td className="px-3 py-2 font-bold text-amber-300">{row.gridRef}</td>
                  <td className="px-3 py-2 text-slate-300">{row.gridCoordLabel}</td>
                  <td className="px-3 py-2">{row.sectionLabel}</td>
                  <td className="px-3 py-2 text-right">{row.tributaryAreaM2.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.factoredPuKn.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{row.axialCapacityKn.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={row.utilizationRatio > 0.95 ? 'text-amber-300 font-bold' : 'text-emerald-300'}>
                      {(row.utilizationRatio * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.rebarCallout} <span className="text-slate-400">({row.rebarPercent.toFixed(2)}%)</span>
                  </td>
                  <td className="px-3 py-2">
                    {row.status === 'OK' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> OK
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> UPSIZE
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'BEAMS_SLABS' && (
        <div className="space-y-3">
          {/* Governing Slab Check Banner */}
          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" />
              <span className="font-bold text-[#F8FAFC]">
                Governing Slab Panel ({analysis.slabCheck.slabAction.replace('_', ' ')})
              </span>
              <span className="text-slate-300">
                {analysis.slabCheck.governingShortSpanMm} × {analysis.slabCheck.governingLongSpanMm} mm · t = {analysis.slabCheck.thicknessMm} mm · Wu = {analysis.slabCheck.factoredLoadKnM2} kN/m²
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-300">
                L/d = {analysis.slabCheck.actualSpanDepthRatio} / {analysis.slabCheck.allowableSpanDepthRatio}
              </span>
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                analysis.slabCheck.status === 'OK'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/20 text-amber-300'
              }`}>
                {analysis.slabCheck.status}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[340px]">
            <table data-testid="struct-beam-checks-table" className="w-full text-left text-xs font-mono">
              <thead className="sticky top-0 bg-[#0F172A] text-slate-300 border-b border-slate-700">
                <tr>
                  <th className="px-3 py-2">Beam</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Span (mm)</th>
                  <th className="px-3 py-2">b × D (mm)</th>
                  <th className="px-3 py-2 text-right">Mu (kNm)</th>
                  <th className="px-3 py-2 text-right">Vu (kN)</th>
                  <th className="px-3 py-2 text-right">L/d (Allow)</th>
                  <th className="px-3 py-2">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {analysis.beamChecks.slice(0, 80).map((bm) => (
                  <tr key={bm.beamId} className="hover:bg-slate-800/60">
                    <td className="px-3 py-2 font-bold text-sky-300">{bm.label}</td>
                    <td className="px-3 py-2 text-slate-300">{bm.beamType}</td>
                    <td className="px-3 py-2 text-right">{bm.spanMm}</td>
                    <td className="px-3 py-2">{bm.sectionLabel}</td>
                    <td className="px-3 py-2 text-right font-semibold">{bm.factoredMuKnM.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{bm.factoredVuKn.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">
                      {bm.actualSpanDepthRatio} / {bm.allowableSpanDepthRatio}
                    </td>
                    <td className="px-3 py-2">
                      {bm.status === 'OK' ? (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">OK</span>
                      ) : (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">DEEPEN BEAM</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'FOOTINGS' && (
        <div className="rounded-xl border border-slate-700/80 bg-[#111827] overflow-auto max-h-[380px]">
          <table data-testid="struct-footing-schedule-table" className="w-full text-left text-xs font-mono">
            <thead className="sticky top-0 bg-[#0F172A] text-slate-300 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2">Col</th>
                <th className="px-3 py-2">Col Size</th>
                <th className="px-3 py-2 text-right">Service Ps (kN)</th>
                <th className="px-3 py-2 text-right">Req Area (m²)</th>
                <th className="px-3 py-2">Footing Size (L × B × D)</th>
                <th className="px-3 py-2 text-right">q_net (kN/m²)</th>
                <th className="px-3 py-2">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {analysis.footingSchedule.map((ft) => (
                <tr key={ft.gridRef} className="hover:bg-slate-800/60">
                  <td className="px-3 py-2 font-bold text-amber-300">{ft.gridRef}</td>
                  <td className="px-3 py-2 text-slate-300">{ft.columnSection}</td>
                  <td className="px-3 py-2 text-right">{ft.serviceLoadKn.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right">{ft.requiredAreaM2.toFixed(2)}</td>
                  <td className="px-3 py-2 font-semibold text-[#F8FAFC]">{ft.footingLabel}</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{ft.netBearingPressureKnM2.toFixed(1)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      ft.footingType === 'ISOLATED'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-sky-500/20 text-sky-300'
                    }`}>
                      {ft.footingType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'SEISMIC' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 space-y-2 text-xs font-mono">
            <h3 className="font-bold text-[#F8FAFC] text-sm">Gravity Load Breakdown (IS 875 Parts 1 &amp; 2)</h3>
            <dl className="grid grid-cols-2 gap-y-1.5 text-slate-300">
              <dt>RCC Slab Self-Weight (25 kN/m³)</dt><dd className="text-right text-[#F8FAFC]">{analysis.gravitySummary.slabSelfWeightKn.toLocaleString()} kN</dd>
              <dt>Beams &amp; Columns Frame Self-Weight</dt><dd className="text-right text-[#F8FAFC]">{analysis.gravitySummary.beamColumnSelfWeightKn.toLocaleString()} kN</dd>
              <dt>Masonry Infill Wall Load</dt><dd className="text-right text-[#F8FAFC]">{analysis.gravitySummary.masonryInfillLoadKn.toLocaleString()} kN</dd>
              <dt>Floor Finish ({analysis.inputs.floorFinishKnM2} kN/m²)</dt><dd className="text-right text-[#F8FAFC]">{analysis.gravitySummary.floorFinishLoadKn.toLocaleString()} kN</dd>
              <dt className="font-bold text-slate-100 border-t border-slate-700 pt-1.5">Total Unfactored Dead Load (DL)</dt><dd className="text-right font-bold text-[#F8FAFC] border-t border-slate-700 pt-1.5">{analysis.gravitySummary.totalDeadLoadKn.toLocaleString()} kN</dd>
              <dt>Total Live Load ({analysis.inputs.residentialLiveLoadKnM2}/{analysis.inputs.balconyStairLiveLoadKnM2} kN/m²)</dt><dd className="text-right text-[#F8FAFC]">{analysis.gravitySummary.totalLiveLoadKn.toLocaleString()} kN</dd>
              <dt className="font-bold text-amber-300 border-t border-slate-700 pt-1.5">Factored Gravity 1.5(DL + LL)</dt><dd className="text-right font-bold text-amber-300 border-t border-slate-700 pt-1.5">{analysis.gravitySummary.factoredTotalGravityKn.toLocaleString()} kN</dd>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#111827] p-4 space-y-2 text-xs font-mono">
            <h3 className="font-bold text-[#F8FAFC] text-sm">
              IS 1893:2016 Storey Lateral Shear Distribution (Vb = {analysis.seismicSummary.designBaseShearVbKn} kN)
            </h3>
            <table className="w-full text-left">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-1">Storey</th>
                  <th className="py-1 text-right">h (m)</th>
                  <th className="py-1 text-right">Wi (kN)</th>
                  <th className="py-1 text-right">Qi (kN)</th>
                  <th className="py-1 text-right">Vi (kN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {[...analysis.seismicSummary.storeyDistribution].reverse().map((st) => (
                  <tr key={st.floorId}>
                    <td className="py-1.5 truncate max-w-[140px]">{st.floorName}</td>
                    <td className="py-1.5 text-right text-slate-400">{st.elevationM.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{st.seismicWeightKn.toFixed(0)}</td>
                    <td className="py-1.5 text-right text-amber-300 font-semibold">{st.lateralForceQiKn.toFixed(1)}</td>
                    <td className="py-1.5 text-right text-sky-300">{st.cumulativeShearViKn.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Engineering Disclaimer */}
      <footer className="flex items-start gap-2.5 rounded-xl border border-slate-700/80 bg-[#0F172A] px-3.5 py-2.5 text-[11px] text-slate-300">
        <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <p>{analysis.disclaimer}</p>
      </footer>
    </div>
  );
};
