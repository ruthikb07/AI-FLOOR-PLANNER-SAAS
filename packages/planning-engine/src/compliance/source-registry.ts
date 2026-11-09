import type { RegulatorySource } from "@ai-floor-planner/core";
export const STATUTORY_DISCLAIMER =
  "Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.";
export const UDCPR_SOURCE_URL =
  "https://dtp.maharashtra.gov.in/wp-content/uploads/2025/01/UDCPR%20Updated%2030.01.25%20with%20earlier%20provisions%20%26%20corrections_compressed.pdf";
const source = (
  id: string,
  clause: string,
  pdfPages: number[],
  applicability: string,
): RegulatorySource => ({
  id,
  clause,
  pdfPages,
  applicability,
  edition: "Maharashtra UDCPR 2020",
  consolidatedThrough: "2025-01-30",
  url: UDCPR_SOURCE_URL,
  verification: "VERIFIED_FROM_SOURCE",
});
export const REGULATORY_SOURCES: readonly RegulatorySource[] = [
  source(
    "fsi",
    "UDCPR 6.1.1 Table 6-A; 6.3 Table 6-G and notes",
    [128, 138, 139],
    "Standard residential greenfield; separate congested/non-congested and corporation/remaining authority tables. Purchased rights and scheme/local amendments require review.",
  ),
  source(
    "margins",
    "UDCPR 6.1.1 Tables 6-B/6-C; 6.2.1 Table 6-D; 6.2.3",
    [128, 129, 130, 131, 136, 137],
    "Congested: original holding/height exceptions. Non-congested: road band and city class, H/5 only above table height/floor limits; special buildings require separate review.",
  ),
  source(
    "ros",
    "UDCPR 3.4.1, 3.4.6 and 3.4.8",
    [70, 71, 72, 73],
    "Layout/group housing and original holding rules; net area after road/reservation deductions, approved layout exemptions; dedicated accessible ROS (10m minimum, aspect <=2.5 if width <20m), not residual margins.",
  ),
  source(
    "parking",
    "UDCPR 8.1.1 Table 8-A; 8.2 Table 8-B; 8.2.2 Table 8-C",
    [167, 168, 169, 172, 173, 174],
    "Apartment carpet bands, 5% visitors and city/class car factors (not apartment two-wheelers); fractions strictly above 0.5 round up; standard marked stalls; no automatic composite/mechanical substitution.",
  ),
  source(
    "rooms",
    "UDCPR 9.2, 9.3, 9.4",
    [175, 176],
    "Standard apartment habitable/kitchen sizes are owner requirements; bath/WC minima and clear heights are statutory. NBC sizes require separate verification.",
  ),
  source(
    "ventilation",
    "UDCPR 9.20.1, 9.20.2 Table 9-C; 9.4.3",
    [176, 182],
    "Habitable/kitchen openings >=1/10 floor area, wet ventilation >=0.30 m2; adjacency and shaft size mandatory; depth beyond 7.5m requires further assessment.",
  ),
  source(
    "egress",
    "UDCPR 9.27.1; 9.28.4 Table 9-D; 9.28.7; 9.28.8 Table 9-G; 9.29.3",
    [184, 185, 186, 187, 188],
    "Residential travel 22.5m; stair clear widths 1.0/1.2/1.5m by height. Project brief separately requires 1.5m. Residential tread 250mm/riser 190mm/headroom 2.2m. Fire enclosure and special-building applicability require review.",
  ),
  {
    id: "nbc",
    clause: "NBC 2016 Part 3 and Part 4",
    edition: "NBC 2016",
    consolidatedThrough: null,
    pdfPages: [],
    url: "https://www.bis.gov.in/standards/national-building-code/?lang=en",
    verification: "NOT_VERIFIED",
    applicability:
      "Official edition confirmed; original licensed clause text and local adoption/amendments have not been verified. No NBC compliance result may be inferred from UDCPR checks.",
  },
  {
    id: "brief",
    clause: "PROJECT BRIEF - engineering design policy",
    edition: "ARGON Phase 3 brief",
    consolidatedThrough: null,
    pdfPages: [],
    url: "",
    verification: "NOT_VERIFIED",
    applicability:
      "Explicit requested stricter 1500mm stair and 6000/3600mm driveway policy; not presented as a UDCPR/NBC quotation.",
  },
];
export function regulatorySource(id: string): RegulatorySource {
  return REGULATORY_SOURCES.find((s) => s.id === id)!;
}
