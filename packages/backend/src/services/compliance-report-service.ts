import {
  validateBuildingSchema,
  type Building,
  type UDCPRComplianceReport,
} from "@ai-floor-planner/core";
import { ExportError } from "./export-selection.js";
import { evaluateUDCPRCompliance } from "@ai-floor-planner/planning-engine";
export function complianceReport(building: Building): UDCPRComplianceReport {
  const errors = validateBuildingSchema(building);
  if (errors.length)
    throw new ExportError(
      "INVALID_BUILDING",
      errors
        .slice(0, 5)
        .map((e) => `${e.path}: ${e.message}`)
        .join("; "),
      400,
    );
  return evaluateUDCPRCompliance(building);
}
export function complianceReportJson(
  report: UDCPRComplianceReport,
): Uint8Array {
  return Buffer.from(JSON.stringify(report, null, 2));
}
/** Paginated text tables; serialized content is independently reopened and measured. */
export function complianceReportPdf(report: UDCPRComplianceReport): Uint8Array {
  const value = (v: unknown) =>
    v === null || v === undefined
      ? "NOT VERIFIED"
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  const lines = [
    "UDCPR 2020 / NBC 2016 - ENGINEERING ASSISTANCE REPORT",
    "PROFESSIONAL REVIEW REQUIRED - NOT A MUNICIPAL COMPLIANCE CERTIFICATE",
    report.disclaimer,
    `Building: ${report.buildingId} | Revision: ${report.buildingVersion}`,
    `Canonical SHA-256: ${report.canonicalHash}`,
    `Context SHA-256: ${report.contextHash}`,
    `Generated: ${report.generatedAt} | Result: ${report.status}`,
    `${report.gate} | ${report.professionalStatus}`,
    "REGULATORY CONTEXT (m, m2; canonical measurements in mm, mm2)",
    ...Object.entries(report.regulatoryContext).map(
      ([k, v]) => `${k}: ${value(v)}`,
    ),
    `Missing critical inputs: ${report.missingInputs.join(", ") || "none"}`,
    "INPUT PROVENANCE",
    ...Object.entries(report.contextProvenance).map(([k, v]) => `${k}: ${v}`),
    "FSI BREAKDOWN - POTENTIAL DOES NOT ESTABLISH PURCHASED RIGHTS",
    ...Object.entries(report.fsiUtilization).map(
      ([k, v]) => `${k}: ${value(v)}`,
    ),
    "SETBACKS / MARGINS - required mm | measured mm | result",
    ...Object.entries(report.setbacks).map(
      ([k, v]) =>
        `${k}: ${value(v.requiredMm)} | ${value(v.providedMm)} | ${v.compliant ? "PASS" : "REVIEW FINDINGS"}`,
    ),
    "PARKING AND DRIVEWAY",
    ...Object.entries(report.parking).map(([k, v]) => `${k}: ${value(v)}`),
    "ROS / GROUND COVERAGE",
    ...Object.entries(report.openSpace).map(([k, v]) => `${k}: ${value(v)}`),
    "STAIRCASE / FIRE TRAVEL",
    ...Object.entries(report.staircaseFireSafety).map(
      ([k, v]) => `${k}: ${value(v)}`,
    ),
    "CLAUSE AUDIT - status | required | measured | affected IDs | remediation",
    ...report.rulesChecked.flatMap((r) => [
      `${r.status} | ${r.id}`,
      r.clause,
      r.description,
      `Required: ${value(r.required)} | Measured: ${value(r.actual)} ${r.unit ?? ""}`,
      `Elements: ${r.elementIds.join(", ") || "project"}${r.floorId ? ` | Floor: ${r.floorId}` : ""}`,
      `Action: ${r.remediation}`,
    ]),
    "VERSIONED SOURCE REGISTRY - snapshot is not proof of later amendments",
    ...report.sources.flatMap((s) => [
      `${s.id} | ${s.edition} | ${s.verification}`,
      `${s.clause} | consolidated through ${s.consolidatedThrough ?? "not verified"}`,
      `PDF pages: ${s.pdfPages.join(", ") || "not verified"}`,
      s.applicability,
      s.url,
    ]),
    report.disclaimer,
  ].flatMap((line) => {
    const out: string[] = [];
    let rest = line.replace(/[^\x20-\x7e]/g, "?");
    while (rest.length > 108) {
      let n = rest.lastIndexOf(" ", 108);
      if (n < 20) n = 108;
      out.push(rest.slice(0, n));
      rest = rest.slice(n).trimStart();
    }
    out.push(rest);
    return out;
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  const refs: string[] = [],
    count = Math.ceil(lines.length / 48),
    escape = (s: string) => s.replace(/([\\()])/g, "\\$1");
  for (let start = 0; start < lines.length; start += 48) {
    const page = objects.length + 1;
    refs.push(`${page} 0 R`);
    const stream =
      `% SCALE_MODE REPORT_NOT_TO_SCALE\n% REPORT_TYPE UDCPR_COMPLIANCE_REPORT\n% CANONICAL_HASH ${report.canonicalHash}\n` +
      `BT /F1 8 Tf 32 824 Td (UDCPR engineering report - revision ${report.buildingVersion} - page ${Math.floor(start / 48) + 1} of ${count}) Tj ET\n` +
      lines
        .slice(start, start + 48)
        .map((s, i) => `BT /F1 8 Tf 32 ${800 - i * 15} Td (${escape(s)}) Tj ET`)
        .join("\n") +
      "\n";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets
    .slice(1)
    .forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
