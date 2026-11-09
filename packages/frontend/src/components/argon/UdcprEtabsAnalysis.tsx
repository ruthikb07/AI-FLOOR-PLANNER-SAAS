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
        <article className="rounded border border-slate-700 p-6">
          <h3>ETABS structural analysis</h3>
          <p className="my-4">NOT_RUN — PENDING PHASE 6</p>
          <p>
            No licensed ETABS solver run or verified structural results are
            connected. Architectural column and beam suggestions do not
            establish structural safety.
          </p>
          <button disabled>Structural report unavailable</button>
        </article>
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
