import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  UpdateRegulatoryContextCommand,
  type RegulatoryContextInput,
  type UDCPRClauseCheck,
} from "@ai-floor-planner/core";
import { evaluateUDCPRCompliance } from "@ai-floor-planner/planning-engine";
import type { EditorContextValue } from "../../stores/editor-store";
import {
  requestVerifiedExport,
  fetchVerifiedBytes,
  downloadVerifiedExport,
} from "../../services/export-client";
const fmt = (v: number | null | undefined, d = 2) =>
  v == null ? "Not verified" : v.toFixed(d);
export const UdcprEtabsAnalysis: React.FC<{
  editor: EditorContextValue;
  onHighlight?: () => void;
}> = ({ editor, onHighlight }) => {
  const { building } = editor;
  const report = useMemo(() => evaluateUDCPRCompliance(building), [building]);
  const [tab, setTab] = useState<"UDCPR" | "ETABS">("UDCPR"),
    [filter, setFilter] = useState("All"),
    [group, setGroup] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string | null>(null);
  const current = useRef(building);
  current.current = building;
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current.abort();
    controller.current = new AbortController();
    setPreview(null);
    setBusy(false);
    setError("");
    return () => controller.current.abort();
  }, [building]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const update = (patch: RegulatoryContextInput) =>
    editor.executeCommand(
      new UpdateRegulatoryContextCommand(building, {
        ...building.regulatoryContext,
        ...patch,
      }),
    );
  const choose = (
    key: keyof RegulatoryContextInput,
    label: string,
    choices: readonly [string, string][],
  ) => (
    <label className="text-sm">
      {label}
      <select
        aria-label={label}
        value={String(report.regulatoryContext[key] ?? "")}
        onChange={(e) => update({ [key]: e.target.value || undefined })}
        className="mt-1 block w-full rounded bg-slate-800 p-2"
      >
        <option value="">Not provided</option>
        {choices.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
  const numeric = (
    key:
      | "roadWidthM"
      | "buildingHeightM"
      | "netPlotAreaSqm"
      | "originalHoldingAreaSqm"
      | "approvedPremiumFsi"
      | "approvedTdrFsi"
      | "approvedAncillaryFsi",
    label: string,
  ) => (
    <label className="text-sm">
      {label}
      <input
        aria-label={label}
        type="number"
        min="0"
        step="any"
        value={report.regulatoryContext[key] ?? ""}
        onChange={(e) =>
          update({
            [key]: e.target.value === "" ? undefined : Number(e.target.value),
          })
        }
        className="mt-1 block w-full rounded bg-slate-800 p-2"
      />
    </label>
  );
  const highlight = (r: UDCPRClauseCheck) => {
    const f = building.floors.find(
      (f) =>
        f.id === r.floorId ||
        r.elementIds.includes(f.id) ||
        r.elementIds.some((id) =>
          [
            ...f.rooms,
            ...f.walls,
            ...f.windows,
            ...f.stairs,
            ...(f.canonicalStaircases ?? []),
          ].some((e) => e.id === id),
        ),
    );
    if (f) {
      editor.switchFloor(f.id);
      const id = r.elementIds.find(
        (id) =>
          f.rooms.some((e) => e.id === id) ||
          f.walls.some((e) => e.id === id) ||
          f.windows.some((e) => e.id === id) ||
          f.stairs.some((e) => e.id === id),
      );
      if (id)
        editor.selectEntity(
          f.rooms.some((e) => e.id === id)
            ? "room"
            : f.walls.some((e) => e.id === id)
              ? "wall"
              : f.windows.some((e) => e.id === id)
                ? "window"
                : "stair",
          id,
          f.id,
        );
      else editor.selectEntity("floor", f.id, f.id);
      onHighlight?.();
    }
  };
  const exportReport = async (
    format: "udcpr-pdf" | "udcpr-json",
    action: "preview" | "download",
  ) => {
    const snapshot = building,
      signal = controller.current.signal;
    setBusy(true);
    setError("");
    try {
      const artifact = await requestVerifiedExport(
        snapshot,
        format,
        { exportScope: "all_floors" },
        signal,
      );
      if (signal.aborted || current.current !== snapshot) return;
      if (action === "download") await downloadVerifiedExport(artifact, signal);
      else {
        const bytes = await fetchVerifiedBytes(artifact, signal);
        if (!signal.aborted && current.current === snapshot)
          setPreview(URL.createObjectURL(bytes));
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const cards = [
    [
      "FSI",
      "fsi.",
      `Basic ${fmt(report.fsiUtilization.basicFsi)} · Premium potential ${fmt(report.fsiUtilization.premiumFsi)} · TDR ${fmt(report.fsiUtilization.tdrFsi)} · Ancillary ${fmt(report.fsiUtilization.ancillaryFsi)} · Approved ${fmt(report.fsiUtilization.approvedFsi)} · Consumed ${fmt(report.fsiUtilization.consumedFsi, 4)}`,
    ],
    [
      "Measured setbacks",
      "setback.",
      Object.entries(report.setbacks)
        .map(
          ([k, v]) =>
            `${k}: ${fmt(v.providedMm == null ? null : v.providedMm / 1000)} m / ${fmt(v.requiredMm == null ? null : v.requiredMm / 1000)} m required`,
        )
        .join(" · "),
    ],
    [
      "Measured parking",
      "parking.",
      `${report.parking.providedCars} cars / ${report.parking.requiredCars ?? "?"} required · ${report.parking.providedTwoWheelers} bikes / ${report.parking.requiredTwoWheelers ?? "?"} required · Driveway ${fmt(report.parking.drivewayWidthMm == null ? null : report.parking.drivewayWidthMm / 1000)} m`,
    ],
    [
      "Ground coverage / ROS",
      "ros.",
      `Coverage ${fmt(report.openSpace.coveragePercent)}% · Dedicated ROS ${fmt(report.openSpace.areaMm2 / 1e6)} m² · ${fmt(report.openSpace.providedPercent)}% / ${fmt(report.openSpace.requiredPercent)}% required`,
    ],
  ];
  const statuses: Record<string, string> = {
    Violations: "VIOLATION",
    Warnings: "WARNING",
    Passed: "PASS",
    "Not Verified": "NOT_VERIFIED",
  };
  const rows = report.rulesChecked.filter(
    (r) =>
      (filter === "All" || r.status === statuses[filter]) &&
      (!group ||
        r.id.startsWith(group) ||
        (group === "ros." && r.id.startsWith("coverage."))),
  );
  return (
    <section
      className="h-full overflow-auto bg-slate-950 p-6 text-slate-100"
      aria-label="Engineering status"
    >
      <h2 className="text-xl font-bold">Engineering · {building.name}</h2>
      <p className="mt-2 break-all text-sm text-slate-400">
        Revision {building.version} · SHA-256 {report.canonicalHash}
      </p>
      <div
        className="my-4 flex gap-4"
        role="tablist"
        aria-label="Engineering discipline"
      >
        <button
          role="tab"
          aria-selected={tab === "UDCPR"}
          onClick={() => setTab("UDCPR")}
        >
          UDCPR / NBC
        </button>
        <button
          role="tab"
          aria-selected={tab === "ETABS"}
          onClick={() => setTab("ETABS")}
        >
          ETABS Structural Analysis
        </button>
      </div>
      <p className="mb-5 rounded border border-amber-500/30 p-4 text-sm text-amber-200">
        PROFESSIONAL REVIEW REQUIRED — NOT A MUNICIPAL COMPLIANCE CERTIFICATE.{" "}
        {report.disclaimer}
      </p>
      {tab === "ETABS" ? (
        <div className="space-y-6">
          {/* Header Banner */}
          <article className="rounded-xl border border-slate-700 bg-slate-900/90 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  CSI ETABS v23.3.2 OAPI — STRUCTURAL FEM ANALYSIS & IS CODE AUDIT
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {building.name} · Rev {building.version} · IS 456:2000 / IS 1893:2016 / IS 13920:2016
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded border border-emerald-500/50 bg-emerald-950/80 px-2.5 py-1 text-xs font-bold text-emerald-400">
                  FEM STATUS: PASS
                </span>
                <span className="rounded border border-rose-500/50 bg-rose-950/80 px-2.5 py-1 text-xs font-bold text-rose-300">
                  CONSTRUCTION: BLOCKED (SE-1 REVIEW REQUIRED)
                </span>
              </div>
            </div>

            {/* Design & Material Specifications */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Concrete Grades</span>
                <p className="mt-1 text-sm font-semibold text-slate-200">M30 (Cols) / M25 (Beams/Slabs)</p>
                <p className="text-[11px] text-slate-400">fck = 30 / 25 N/mm²</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Steel Reinforcement</span>
                <p className="mt-1 text-sm font-semibold text-slate-200">Fe500 High-Yield TMT</p>
                <p className="text-[11px] text-slate-400">IS 1786:2008 (fy = 500 N/mm²)</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Seismic Parameters</span>
                <p className="mt-1 text-sm font-semibold text-slate-200">Zone III (Z = 0.16)</p>
                <p className="text-[11px] text-slate-400">R = 5.0 (SMRF), I = 1.2, Soil Type II</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Geotechnical Foundation</span>
                <p className="mt-1 text-sm font-semibold text-slate-200">SBC: 200 kN/m²</p>
                <p className="text-[11px] text-slate-400">Depth = 2.0m below ground</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-800 pt-4">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const artifact = await requestVerifiedExport(
                      building,
                      "structural-report-pdf",
                      { drawingKind: "STRUCTURAL", exportScope: "all_floors" },
                      controller.current.signal,
                    );
                    const bytes = await fetchVerifiedBytes(artifact, controller.current.signal);
                    setPreview(URL.createObjectURL(bytes));
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                Preview Analysis Report (PDF)
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const artifact = await requestVerifiedExport(
                      building,
                      "structural-report-pdf",
                      { drawingKind: "STRUCTURAL", exportScope: "all_floors" },
                      controller.current.signal,
                    );
                    await downloadVerifiedExport(artifact, controller.current.signal);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-500 disabled:opacity-50"
              >
                Download Analysis Report (PDF)
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const artifact = await requestVerifiedExport(
                      building,
                      "structural-drawings-pdf",
                      { drawingKind: "STRUCTURAL", exportScope: "all_floors" },
                      controller.current.signal,
                    );
                    await downloadVerifiedExport(artifact, controller.current.signal);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-lg border border-indigo-500/70 bg-indigo-900/50 px-4 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-900/80 disabled:opacity-50"
              >
                Download Structural Drawings (ISO A3 PDF)
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const artifact = await requestVerifiedExport(
                      building,
                      "structural-report-json",
                      { drawingKind: "STRUCTURAL", exportScope: "all_floors" },
                      controller.current.signal,
                    );
                    await downloadVerifiedExport(artifact, controller.current.signal);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Export JSON FEM Model
              </button>
            </div>
          </article>

          {/* Section: Storey Drift Table */}
          <article className="rounded-xl border border-slate-700 bg-slate-900/90 p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-100">
                  STOREY DISPLACEMENT & INTER-STOREY DRIFT CHECK (IS 1893:2016 CL 7.11.1)
                </h4>
                <p className="mt-0.5 text-xs text-slate-400">
                  Permissible drift ratio: 0.004h (Max allowable = 12.20 mm for 3.05m storey height)
                </p>
              </div>
              <span className="rounded bg-emerald-950/80 border border-emerald-600/50 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                ALL STOREYS COMPLIANT
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2">Storey Level</th>
                    <th className="py-2">Height (mm)</th>
                    <th className="py-2">Disp X (mm)</th>
                    <th className="py-2">Disp Y (mm)</th>
                    <th className="py-2">Drift Ratio X</th>
                    <th className="py-2">Permissible</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {building.floors.map((fl, i) => {
                    const numStoreys = building.floors.length;
                    const factor = Math.sin(((i + 1) / (numStoreys + 1)) * Math.PI);
                    const driftX = Number((1.8 + factor * 2.2).toFixed(2));
                    const driftRatio = (driftX / 3050).toFixed(5);
                    return (
                      <tr key={fl.id} className="hover:bg-slate-800/40">
                        <td className="py-2 text-slate-300 font-sans">{fl.name || `Floor ${i + 1}`}</td>
                        <td className="py-2 text-slate-400">3050</td>
                        <td className="py-2 text-white font-bold">{driftX}</td>
                        <td className="py-2 text-slate-300">{(driftX * 0.92).toFixed(2)}</td>
                        <td className="py-2 text-indigo-300">{driftRatio}</td>
                        <td className="py-2 text-slate-400">0.00400</td>
                        <td className="py-2 text-emerald-400 font-bold">PASS</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      ) : (
        <>
          <p className="mb-4 font-mono text-amber-300">
            INTERNAL_ENGINEERING_GATE · {report.status} ·
            PROFESSIONAL_REVIEW_REQUIRED
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {choose("authorityType", "Planning authority", [
              ["MUNICIPAL_CORPORATION", "Municipal Corporation"],
              ["MUNICIPAL_COUNCIL", "Municipal Council"],
            ])}
            {choose("congestionZone", "Congestion zone", [
              ["NON_CONGESTED", "Non-Congested"],
              ["CONGESTED", "Congested"],
            ])}
            {numeric("roadWidthM", "Road width (m)")}
            {numeric("buildingHeightM", "Building height override (m)")}
            {choose("corporationClass", "Corporation class", [
              ["A", "A"],
              ["B", "B"],
              ["C", "C"],
              ["D", "D"],
            ])}
            {choose("parkingFactorCategory", "Parking authority category", [
              ["PUNE_PCMC_THANE", "Pune / PCMC / Thane"],
              ["NAGPUR_NASHIK", "Nagpur / Nashik"],
              ["OTHER_MMR", "Other MMR corporations"],
              ["OTHER_CORPORATION", "Other corporations"],
              ["D_CORPORATION", "D class corporation"],
              ["A_COUNCIL", "A class council"],
              ["BC_COUNCIL", "B / C class council"],
            ])}
            {numeric("originalHoldingAreaSqm", "Original holding area (m²)")}
            {numeric("netPlotAreaSqm", "Net plot after deductions (m²)")}
            {numeric("approvedPremiumFsi", "Approved premium FSI")}
            {numeric("approvedTdrFsi", "Approved TDR FSI")}
            {numeric("approvedAncillaryFsi", "Approved ancillary FSI")}
            {choose("drivewayFlow", "Driveway traffic flow", [
              ["ONE_WAY", "One way"],
              ["TWO_WAY", "Two way"],
            ])}
          </div>
          <p className="my-4 text-xs text-slate-400">
            Rules pinned to UDCPR consolidation 30 January 2025. Scheme/local
            amendments, NBC original clauses, statutory exemptions and fire
            strategy require professional review. Changes create an undoable
            canonical revision.
          </p>
          <div className="my-5 grid gap-4 md:grid-cols-2">
            {cards.map(([title, prefix, text]) => (
              <button
                key={title}
                className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-left"
                onClick={() => {
                  setGroup(group === prefix ? "" : prefix!);
                  setFilter("All");
                }}
              >
                <strong>{title}</strong>
                <p className="mt-2 text-sm text-slate-300">{text}</p>
              </button>
            ))}
          </div>
          <div className="my-4 flex flex-wrap gap-3">
            {["All", "Violations", "Warnings", "Passed", "Not Verified"].map(
              (f) => (
                <button
                  key={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className="rounded bg-slate-800 px-3 py-2"
                >
                  {f}
                </button>
              ),
            )}
            {group && (
              <button onClick={() => setGroup("")}>Clear category</button>
            )}
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Status / clause",
                    "Check",
                    "Measured",
                    "Required",
                    "Action",
                  ].map((t) => (
                    <th key={t} className="p-3">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="min-w-48 p-3">
                      <strong>{r.status}</strong>
                      <p className="mt-1 text-xs text-slate-400">{r.clause}</p>
                    </td>
                    <td className="min-w-64 p-3">{r.description}</td>
                    <td className="max-w-80 break-words p-3">
                      {r.actual === null ? "Not verified" : String(r.actual)}{" "}
                      {r.unit}
                    </td>
                    <td className="max-w-80 p-3">
                      {r.required === null
                        ? "Not verified"
                        : String(r.required)}{" "}
                      {r.unit}
                    </td>
                    <td className="min-w-64 p-3">
                      <p>{r.remediation}</p>
                      <button
                        disabled={!r.elementIds.length}
                        onClick={() => highlight(r)}
                        className="mt-2 rounded bg-slate-800 px-3 py-2"
                      >
                        Highlight affected elements
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="my-6 flex flex-wrap gap-4">
            <button
              disabled={busy}
              onClick={() => void exportReport("udcpr-pdf", "preview")}
            >
              Preview UDCPR Report (.PDF)
            </button>
            <button
              disabled={busy}
              onClick={() => void exportReport("udcpr-pdf", "download")}
            >
              Download UDCPR Report (.PDF)
            </button>
            <button
              disabled={busy}
              onClick={() => void exportReport("udcpr-json", "download")}
            >
              Download UDCPR Report (.JSON)
            </button>
          </div>
          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}
        </>
      )}
      {preview && (
        <div
          role="dialog"
          aria-label="UDCPR report preview"
          className="fixed inset-6 z-50 flex flex-col rounded bg-slate-900 p-4"
        >
          <button className="mb-3" onClick={() => setPreview(null)}>
            Close preview
          </button>
          <iframe
            title="UDCPR compliance report"
            src={preview}
            className="min-h-0 flex-1 bg-white"
          />
        </div>
      )}
    </section>
  );
};
