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
import { ETABSExportPanel } from "./ETABSExportPanel";

const fmt = (v: number | null | undefined, d = 2) =>
  v == null ? "Not verified" : v.toFixed(d);
export const UdcprEtabsAnalysis: React.FC<{
  editor: EditorContextValue;
  onHighlight?: () => void;
  onOpenExports?: () => void;
  onAutoFix?: () => void;
  autoFixStatus?: string;
}> = ({ editor, onHighlight, onOpenExports, onAutoFix, autoFixStatus }) => {
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
        className="mt-1 block w-full rounded bg-argon-surface p-2"
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
        className="mt-1 block w-full rounded bg-argon-surface p-2"
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
    format: "udcpr-pdf" | "udcpr-json" | "udcpr-fix-pdf",
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
      if (action === "download") {
        if (format === "udcpr-fix-pdf") await downloadVerifiedExport(artifact, signal, "Compliance_Audit_and_Fix_Plan.pdf");
        else await downloadVerifiedExport(artifact, signal);
      }
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
  const ruleSummary = Object.entries(statuses).map(([label, status]) => ({
    label, status, count: report.rulesChecked.filter(rule => rule.status === status).length,
  }));
  const rows = report.rulesChecked.filter(
    (r) =>
      (filter === "All" || r.status === statuses[filter]) &&
      (!group ||
        r.id.startsWith(group) ||
        (group === "ros." && r.id.startsWith("coverage."))),
  );
  return (
    <section
      className="rh-engineering h-full overflow-auto bg-argon-bg p-4 text-argon-text sm:p-6"
      aria-label="Engineering status"
    >
      <header className="rh-engineering-cover">
        <div>
          <h2 className="font-display text-4xl font-semibold">Code Compliance</h2>
          <p className="mt-2 text-sm">{building.name} · Revision {building.version}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rh-button" disabled={busy} onClick={() => void exportReport("udcpr-fix-pdf", "download")}>Download Violation &amp; Fix Guide (PDF)</button>
            <button type="button" className="rh-button" disabled={busy || !onAutoFix} onClick={onAutoFix}>Auto-Fix All Violations &amp; Regenerate</button>
          </div>
          {autoFixStatus && <p className="mt-2 text-sm" role="status">{autoFixStatus}</p>}
          <details><summary className="text-xs font-mono text-slate-400 cursor-pointer">Revision Checksum</summary><p className="break-all font-mono text-xs text-slate-400">SHA-256 {report.canonicalHash}</p></details>
        </div>
        <div className="rh-rule-summary">
          <p>{report.rulesChecked.length} regulatory checks</p>
          <div className="rh-rule-bar" aria-hidden="true">
            {ruleSummary.map(item => item.count > 0 &&
              <span key={item.status} data-status={item.status} style={{ flexGrow: item.count }} />)}
          </div>
          <ul>
            {ruleSummary.map(item => <li key={item.status}>
              <button type="button" aria-pressed={tab === "UDCPR" && filter === item.label} onClick={() => {
                setTab("UDCPR");
                setGroup("");
                setFilter(current => tab === "UDCPR" && current === item.label ? "All" : item.label);
              }}>
                <i data-status={item.status} aria-hidden="true" /><span>{item.label.toLowerCase()} checks</span><strong>{item.count}</strong>
              </button>
            </li>)}
          </ul>
        </div>
      </header>
      <div
        className="my-4 flex gap-4"
        role="tablist"
        aria-label="Engineering discipline"
      >
        <button
          role="tab"
          className="rh-button"
          aria-selected={tab === "UDCPR"}
          onClick={() => setTab("UDCPR")}
        >
          UDCPR / NBC
        </button>
        <button
          role="tab"
          className="rh-button"
          aria-selected={tab === "ETABS"}
          onClick={() => setTab("ETABS")}
        >
          ETABS Structural Analysis
        </button>
      </div>
      <p className="mb-5 border border-argon-border bg-argon-surface p-4 text-sm text-argon-text">
        PROFESSIONAL REVIEW REQUIRED — NOT A MUNICIPAL COMPLIANCE CERTIFICATE.{" "}
        {report.disclaimer}
      </p>
      {tab === "ETABS" ? (
        <div className="space-y-4">
          <article className="rh-export-card p-4">
            <h3 className="font-semibold">ETABS analysis status</h3>
            <p className="my-2 text-sm text-argon-muted">
              Verified analysis results are unavailable in this workspace. Native model export
              requires reviewed structural inputs for this architectural revision.
            </p>
            {onOpenExports && (
              <button type="button" className="rh-button" onClick={onOpenExports}>Open Export Center</button>
            )}
          </article>
          <ETABSExportPanel building={building} />
        </div>
      ) : (
        <>
          <p className="mb-4 font-mono text-xs tracking-wider uppercase text-amber-300/90">
            CODE COMPLIANCE AUDIT · {report.status} · LICENSED ARCHITECT REVIEW REQUIRED
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
          <p className="my-4 text-xs text-argon-muted">
            Rules pinned to UDCPR consolidation 30 January 2025. Scheme/local
            amendments, NBC original clauses, statutory exemptions and fire
            strategy require professional review. Changes create an undoable
            canonical revision.
          </p>
          <div className="my-5 grid gap-4 md:grid-cols-2">
            {cards.map(([title, prefix, text]) => (
              <button
                key={title}
                className="rounded-xl border border-argon-border bg-argon-card p-4 text-left"
                onClick={() => {
                  setGroup(group === prefix ? "" : prefix!);
                  setFilter("All");
                }}
              >
                <strong>{title}</strong>
                <p className="mt-2 text-sm text-argon-muted">{text}</p>
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
                  className="rounded bg-argon-surface px-3 py-2"
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
                  <tr key={r.id} className="border-t border-argon-border">
                    <td className="min-w-48 p-3">
                      <strong>{r.status}</strong>
                      <p className="mt-1 text-xs text-argon-muted">{r.clause}</p>
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
                        className="mt-2 rounded bg-argon-surface px-3 py-2"
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
          className="fixed inset-6 z-50 flex flex-col rounded bg-argon-card p-4"
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
