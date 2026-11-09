import {
  canonicalBuildingHash,
  stableValueHash,
  polygonArea,
  type Building,
  type RegulatoryContextInput,
  type UDCPRComplianceReport,
  type UDCPRClauseCheck,
  type UDCPRClauseStatus,
} from "@ai-floor-planner/core";
import {
  measurePlotMargins,
  measureMarkedParking,
  measureRecreationalSpace,
  measureRegulatoryFloors,
  measureEgressTravel,
  measureWindowAdjacency,
  measureUnitCarpetAreas,
  rectangularBounds,
} from "@ai-floor-planner/geometry-engine";
import { resolveRegulatoryContext } from "../compliance/jurisdiction-context";
import {
  REGULATORY_SOURCES,
  STATUTORY_DISCLAIMER,
  regulatorySource,
} from "../compliance/source-registry";
import {
  fsiEntitlements,
  requiredMargins,
  parkingFactors,
  requiredParkingCount,
} from "../compliance/rules/entitlements";

/** Pure measured audit. No repairs, invented stalls, requested-as-provided margins or default safety values. */
export function evaluateUDCPRCompliance(
  building: Building,
  input?: RegulatoryContextInput,
): UDCPRComplianceReport {
  const {
    context: c,
    missing,
    provenance,
  } = resolveRegulatoryContext(building, input);
  const rules: UDCPRClauseCheck[] = [];
  const add = (
    id: string,
    sourceId: string,
    description: string,
    actual: UDCPRClauseCheck["actual"],
    required: UDCPRClauseCheck["required"],
    status: UDCPRClauseStatus,
    elementIds: readonly string[] = [],
    unit?: string,
    remediation = "Review this clause with a licensed Architect/Engineer.",
    floorId?: string,
  ) => {
    rules.push({
      id,
      sourceId,
      clause: regulatorySource(sourceId).clause,
      description,
      actual,
      required,
      status,
      elementIds,
      unit,
      remediation,
      floorId,
    });
  };
  const cmp = (
    a: number | null | undefined,
    r: number | null | undefined,
    minimum = true,
  ): UDCPRClauseStatus =>
    a == null || r == null || !Number.isFinite(a) || !Number.isFinite(r)
      ? "NOT_VERIFIED"
      : (minimum ? a >= r : a <= r)
        ? "PASS"
        : "VIOLATION";
  for (const key of missing)
    add(
      `input.${key}`,
      "fsi",
      `Required regulatory input: ${key}`,
      null,
      "Explicit valid input",
      "NOT_VERIFIED",
      [],
      undefined,
      `Provide ${key}; no passing default is used.`,
    );
  add(
    "source.applicability",
    "fsi",
    "Jurisdiction, scheme and post-2025 amendments reviewed",
    c.amendmentApplicabilityReviewed === true &&
      c.standardGreenfieldSchemeConfirmed === true,
    true,
    c.amendmentApplicabilityReviewed === true &&
      c.standardGreenfieldSchemeConfirmed === true
      ? "PASS"
      : "NOT_VERIFIED",
    [],
    undefined,
    "Confirm the standard greenfield scheme and current local/amendment applicability. Source snapshot is pinned to 2025-01-30.",
  );
  add(
    "source.nbc",
    "nbc",
    "NBC Part 3 and Part 4 clause verification",
    null,
    "Original applicable NBC clauses reviewed",
    "NOT_VERIFIED",
    [],
    undefined,
    "Verify original NBC 2016 clauses and local adoption. UDCPR measurements do not establish NBC compliance.",
  );
  for(const floor of building.floors.filter(f=>f.floorUse==='STILT_PARKING')){
    const habitable=floor.rooms.filter(r=>['bedroom','living','dining','kitchen','study','drawing','family_living','servant_quarter'].includes(r.type));
    add(`stilt.${floor.id}.enclosures`,'parking','Stilt has no flats or habitable enclosures',habitable.length+(floor.apartmentUnits?.length??0),0,habitable.length||floor.apartmentUnits?.length?'VIOLATION':floor.rooms.some(r=>r.type==='custom'&&!r.tags?.includes('SECURITY_CABIN'))?'NOT_VERIFIED':'PASS',habitable.map(r=>r.id),undefined,'Remove habitable enclosures from the designated parking-only floor; exemption eligibility requires separate review.',floor.id);
    const clearance=floor.parkingClearHeightMm??null;
    add(`stilt.${floor.id}.clearance`,'parking','Explicit stilt clearance below beams',clearance,2400,cmp(clearance,2400),[floor.id],'mm','Provide measured below-beam clearance; floor-to-floor height does not establish parking clearance.',floor.id);
  }
  const measured = measureRegulatoryFloors(building);
  const physical = measured.filter((m) => m.floor.floorUse !== "ROOF");
  const rolesKnown =
    building.floors.length > 0 && building.floors.every((f) => f.floorUse);
  add(
    "geometry.roles",
    "fsi",
    "Physical residential/stilt/roof roles are explicit",
    rolesKnown,
    true,
    rolesKnown ? "PASS" : "NOT_VERIFIED",
    building.floors.map((f) => f.id),
    undefined,
    "Assign floorUse; roof drawing sheets must not be counted as residential storeys.",
  );
  if (rolesKnown) {
    add(
      "geometry.floor-count",
      "fsi",
      "Physical level count agrees with the regulatory input",
      physical.length,
      c.numFloors ?? null,
      physical.length === c.numFloors
        ? "PASS"
        : c.numFloors === undefined
          ? "NOT_VERIFIED"
          : "VIOLATION",
      physical.map((m) => m.floor.id),
      undefined,
      "Reconcile physical storeys and the brief; drawing-only roof sheets are excluded.",
    );
    const hasStilt = physical.some((m) => m.floor.floorUse === "STILT_PARKING");
    add(
      "geometry.stilt",
      "fsi",
      "Explicit stilt flag agrees with physical floor roles",
      hasStilt,
      c.stiltParkingEnabled ?? null,
      c.stiltParkingEnabled === undefined
        ? "NOT_VERIFIED"
        : hasStilt === c.stiltParkingEnabled
          ? "PASS"
          : "VIOLATION",
      physical.map((m) => m.floor.id),
      undefined,
      "Reconcile stilt parking inputs with physical floor roles.",
    );
  }
  const ledgersValid =
    physical.length > 0 &&
    physical.every(
      (m) =>
        m.ledger.supported &&
        Math.abs(m.ledger.delta) < 0.001 &&
        m.ledger.overlap < 0.001 &&
        m.ledger.roomVoidOverlap < 0.001 &&
        m.ledger.unassigned < 0.001,
    );
  add(
    "geometry.ledger",
    "fsi",
    "Canonical disjoint centreline-cell ledger (no unassigned or overlap)",
    ledgersValid,
    true,
    ledgersValid ? "PASS" : "NOT_VERIFIED",
    physical.map((m) => m.floor.id),
    undefined,
    "Resolve unsupported polygons, overlaps or unassigned ledger cells; no area rounding is used.",
  );
  const gross = physical.reduce(
      (s, m) => s + m.ledger.gross - m.ledger.void,
      0,
    ),
    core = physical.reduce((s, m) => s + m.ledger.core, 0),
    stilt = physical
      .filter((m) => m.floor.floorUse === "STILT_PARKING")
      .reduce((s, m) => s + m.ledger.gross - m.ledger.void, 0);
  const entitlement = fsiEntitlements(c);
  const exemptions = c.reviewedFsiExemptions ?? [];
  const exemptionsValid =
    c.fsiExemptionsReviewed === true &&
    exemptions.every(
      (e) =>
        !!e.clause.trim() &&
        Number.isFinite(e.areaMm2) &&
        e.areaMm2 >= 0 &&
        physical.some((m) => m.floor.id === e.floorId),
    ) &&
    physical.every(
      (m) =>
        exemptions
          .filter((e) => e.floorId === m.floor.id)
          .reduce((s, e) => s + e.areaMm2, 0) <=
        m.ledger.gross - m.ledger.void,
    );
  const exempt = exemptionsValid
    ? exemptions.reduce((s, e) => s + e.areaMm2, 0)
    : null;
  const roofKnown =
    !building.floors.some((f) => f.floorUse === "ROOF") ||
    c.roofFsiReviewed === true;
  add(
    "fsi.roof",
    "fsi",
    "Covered roof structures and roof FSI applicability reviewed",
    roofKnown,
    true,
    roofKnown ? "PASS" : "NOT_VERIFIED",
    building.floors.filter((f) => f.floorUse === "ROOF").map((f) => f.id),
    undefined,
    "Review roof structure sections; a roof drawing is not automatically an exempt floor.",
  );
  const net =
    rolesKnown && ledgersValid && roofKnown && exempt !== null
      ? gross - exempt
      : null;
  const netPlot =
    c.netPlotAreaSqm && c.plotAreaSqm && c.netPlotAreaSqm <= c.plotAreaSqm
      ? c.netPlotAreaSqm
      : null;
  const purchased = [
    c.approvedPremiumFsi,
    c.approvedTdrFsi,
    c.approvedAncillaryFsi,
  ];
  const approved =
    entitlement &&
    purchased.every((v) => v !== undefined && Number.isFinite(v) && v >= 0) &&
    c.approvedPremiumFsi! <= entitlement.premium &&
    c.approvedTdrFsi! <= entitlement.tdr &&
    c.approvedAncillaryFsi! <=
      (entitlement.basic + c.approvedPremiumFsi! + c.approvedTdrFsi!) * 0.6
      ? entitlement.basic +
        c.approvedPremiumFsi! +
        c.approvedTdrFsi! +
        c.approvedAncillaryFsi!
      : null;
  const consumed = net !== null && netPlot ? net / (netPlot * 1e6) : null;
  add(
    "fsi.entitlements",
    "fsi",
    "Basic / premium / TDR / ancillary potential (not purchased rights)",
    entitlement ? JSON.stringify(entitlement) : null,
    "Source road/authority/zone table",
    entitlement ? "PASS" : "NOT_VERIFIED",
  );
  add(
    "fsi.approvals",
    "fsi",
    "Premium, TDR, ancillary approvals and net plot deductions",
    approved,
    "Explicit approved rights within source caps",
    approved === null || netPlot === null ? "NOT_VERIFIED" : "PASS",
    [],
    undefined,
    "Supply netPlotAreaSqm and separately reviewed approvedPremiumFsi, approvedTdrFsi and approvedAncillaryFsi (explicit zero permitted).",
  );
  add(
    "fsi.exemptions",
    "fsi",
    "Reviewed exempt areas; measured core/stilt are only candidates",
    exempt,
    "Explicit floor areas and exemption clauses",
    exempt === null ? "NOT_VERIFIED" : "PASS",
    physical.map((m) => m.floor.id),
    "mm2",
    "Review FSI exemptions, including explicit none; never auto-exempt an entire core/stilt by name.",
  );
  add(
    "fsi.consumed",
    "fsi",
    "Net FSI consumed without a 1% overrun allowance",
    consumed,
    approved,
    cmp(consumed, approved, false),
    physical.map((m) => m.floor.id),
    "ratio",
    "Reduce reckonable area or provide reviewed entitlements/exemptions; exact unrounded ratio is compared.",
  );
  const margins = measurePlotMargins(building),
    req = requiredMargins(c);
  const setbacks = {} as Record<
    "front" | "rear" | "left" | "right",
    { requiredMm: number | null; providedMm: number | null; compliant: boolean }
  >;
  for (const side of ["front", "rear", "left", "right"] as const) {
    const required = side === "front" ? req.front : req.side,
      actual = margins?.[side] ?? null,
      status = cmp(actual, required);
    setbacks[side] = {
      requiredMm: required,
      providedMm: actual,
      compliant: status === "PASS",
    };
    add(
      `setback.${side}`,
      "margins",
      `Measured ${side} outer wall / plinth clearance`,
      actual,
      required,
      status,
      building.floors.flatMap((f) => [
        f.id,
        ...f.walls.filter((w) => w.type === "external").map((w) => w.id),
      ]),
      "mm",
      `${req.reason} Rectangular single-road plots only; supply edge roles/street centreline for unsupported sites.`,
    );
  }
  const balconies = building.floors.flatMap((f) =>
    f.rooms.filter((r) => ["balcony", "utility"].includes(r.type)),
  );
  if (balconies.length)
    add(
      "setback.projections",
      "margins",
      "Cantilevered balcony/utility projection assessment",
      JSON.stringify(
        balconies.map((r) => ({ id: r.id, areaMm2: polygonArea(r.boundary) })),
      ),
      "Verified projection limits and section",
      "NOT_VERIFIED",
      balconies.map((r) => r.id),
      undefined,
      "Verify clause 9.14 projections, margin/access restrictions and section geometry. Measured area is not permission.",
    );
  const footprint =
    building.floors.find((f) => f.level === 0) ?? building.floors[0];
  const coverage =
    footprint && c.plotAreaSqm
      ? (polygonArea(footprint.boundary) / (c.plotAreaSqm * 1e6)) * 100
      : null;
  add(
    "coverage.measured",
    "ros",
    "Plinth ground coverage (independent of ROS)",
    coverage,
    "Authority/scheme-specific coverage limit",
    "NOT_VERIFIED",
    footprint ? [footprint.id] : [],
    "%",
    "Confirm applicable ground-coverage restrictions; residual plot area is never counted as ROS.",
  );
  const ros = measureRecreationalSpace(building);
  const rosRequired =
    c.rosApplicability === "REQUIRED" || (netPlot !== null && netPlot >= 4000)
      ? 10
      : c.rosApplicability === "EXEMPT_APPROVED_LAYOUT"
        ? 0
        : null;
  const rosPercent = netPlot ? (ros.areaMm2 / (netPlot * 1e6)) * 100 : 0;
  const rosStatus = ros.invalidIds.length
    ? "VIOLATION"
    : rosRequired === null || netPlot === null
      ? "NOT_VERIFIED"
      : rosPercent < rosRequired
        ? "VIOLATION"
        : rosRequired > 0 && (!ros.reviewed || !ros.accessVerified)
          ? "NOT_VERIFIED"
          : "PASS";
  add(
    "ros.area",
    "ros",
    "Dedicated non-overlapping ROS with 10m minimum dimension and aspect limits and access",
    rosPercent,
    rosRequired,
    rosStatus,
    ros.ids,
    "%",
    "Designate reviewed ROS polygons, verify independent/common access, original holding and DP/RP deductions. A generic garden or residual driveway is not certified ROS.",
  );
  const parking = measureMarkedParking(building);
  const factor = c.parkingFactorCategory
    ? parkingFactors[c.parkingFactorCategory]
    : undefined;
  const factorCompatible =
    c.parkingFactorCategory &&
    (c.authorityType === "MUNICIPAL_COUNCIL"
      ? ["A_COUNCIL", "BC_COUNCIL"].includes(c.parkingFactorCategory)
      : c.authorityType === "MUNICIPAL_CORPORATION"
        ? !["A_COUNCIL", "BC_COUNCIL"].includes(c.parkingFactorCategory)
        : false);
  let baseCars = 0,
    baseBikes = 0,
    unitsKnown = rolesKnown && ledgersValid && !!c.congestionZone,
    unitCount = 0;
  for (const m of physical.filter((v) => v.floor.floorUse === "RESIDENTIAL")) {
    if (!m.floor.apartmentUnits?.length) unitsKnown = false;
    const carpets = measureUnitCarpetAreas(m.floor, m.ledger);
    add(
      `parking.carpet.${m.floor.id}`,
      "parking",
      "Per-unit measured carpet including internal partitions",
      JSON.stringify(carpets),
      "RERA 2(k) geometry convention; explicit wall ownership",
      carpets.every((v) => v.supported) ? "PASS" : "NOT_VERIFIED",
      m.floor.apartmentUnits?.map((u) => u.id) ?? [],
      "mm2",
      "Resolve wall classifications/ownership and verify the carpet convention for the parking schedule.",
      m.floor.id,
    );
    for (const u of m.floor.apartmentUnits ?? []) {
      unitCount++;
      const carpet = carpets.find((v) => v.unitId === u.id);
      const area = (carpet?.areaMm2 ?? 0) / 1e6;
      // The table leaves exact 30m2 linguistically ambiguous; fail closed at that boundary.
      if (!carpet?.supported || area <= 0 || area === 30) {
        unitsKnown = false;
        continue;
      }
      baseCars += area >= 150 ? 2 : area >= 80 ? 1 : area > 30 ? 0.5 : 0;
      baseBikes +=
        area > 30 && area < 40 && c.congestionZone === "CONGESTED" ? 0.5 : 1;
    }
  }
  unitsKnown = unitsKnown && unitCount > 0;
  const requiredCars =
      unitsKnown && factor !== undefined && factorCompatible
        ? requiredParkingCount(baseCars, Math.round(factor * 10))
        : null,
    requiredBikes = unitsKnown ? requiredParkingCount(baseBikes) : null;
  const carStatus = cmp(parking.cars, requiredCars),
    bikeStatus = cmp(parking.bikes, requiredBikes);
  if (unitCount > 0 && parking.cars + parking.bikes === 0)
    add(
      "parking.missing",
      "parking",
      "No marked car or two-wheeler stalls exist",
      0,
      "Actual marked parking provision",
      "VIOLATION",
      physical.map((m) => m.floor.id),
      undefined,
      "Provide actual marked stalls and a verified parking schedule.",
    );
  add(
    "parking.cars",
    "parking",
    "Valid non-overlapping 2500 x 5000mm car bays",
    parking.cars,
    requiredCars,
    carStatus,
    parking.bayIds,
    "bays",
    "Provide marked accessible car stalls, reviewed unit carpet areas and the correct Table 8-C city/class factor.",
  );
  add(
    "parking.bikes",
    "parking",
    "Valid non-overlapping 1000 x 2000mm two-wheeler bays",
    parking.bikes,
    requiredBikes,
    bikeStatus,
    parking.bayIds,
    "bays",
    "Provide actual marked two-wheeler stalls; the software does not invent provided counts.",
  );
  if (parking.invalid.length)
    add(
      "parking.invalid",
      "parking",
      "Undersized / overlapping / obstructed / unclassified stalls",
      parking.invalid.join(", "),
      0,
      "VIOLATION",
      parking.invalid,
      undefined,
      "Resolve stall geometry, walls, columns and duplicate bay overlaps.",
    );
  const drivewayRequired =
    c.drivewayFlow === "TWO_WAY"
      ? 6000
      : c.drivewayFlow === "ONE_WAY"
        ? 3600
        : null;
  add(
    "parking.driveway",
    "brief",
    "Measured driveway width against requested project policy",
    parking.drivewayWidthMm,
    drivewayRequired,
    parking.driveConflicts
      ? "VIOLATION"
      : cmp(parking.drivewayWidthMm, drivewayRequired),
    parking.driveIds,
    "mm",
    "Tag dedicated driveway polygons and specify traffic flow. Verify manoeuvring, connectivity and source 8.1.1(iv) separately; source minimum car drive is 3m.",
  );
  add(
    "parking.access",
    "parking",
    "Street access / turning and stilt beam clearance",
    null,
    "Verified access geometry and 2.4m below beams",
    "NOT_VERIFIED",
    parking.driveIds,
    undefined,
    "Verify connected street access, swept paths and section headroom; width alone is insufficient.",
  );
  let providedStair: number | null = null,
    maxTravel: number | null = null;
  for (const m of physical) {
    const f = m.floor,
      stairs = f.canonicalStaircases ?? [];
    if (!stairs.length) {
      add(
        `stairs.${f.id}.missing`,
        "egress",
        "At least one canonical staircase per physical floor",
        0,
        1,
        "VIOLATION",
        [f.id],
        undefined,
        "Provide canonical staircase and OPEN_PASSAGE circulation access.",
        f.id,
      );
    }
    const statWidth =
      c.buildingHeightM === undefined
        ? null
        : c.buildingHeightM <= 15
          ? 1000
          : c.buildingHeightM <= 24
            ? 1200
            : 1500;
    for (const s of stairs) {
      const flights = [
        rectangularBounds(s.flight1),
        rectangularBounds(s.flight2),
      ];
      const measuredWidth = flights.every((v) => v)
        ? Math.min(
            s.clearWidthMm,
            ...flights.map((v) => Math.min(v!.width, v!.height)),
          )
        : null;
      if (measuredWidth !== null)
        providedStair =
          providedStair === null
            ? measuredWidth
            : Math.min(providedStair, measuredWidth);
      add(
        `stairs.${s.id}.width`,
        "egress",
        "Statutory height-band measured staircase flight width",
        measuredWidth,
        statWidth,
        cmp(measuredWidth, statWidth),
        [s.id],
        "mm",
        "Increase clear flight width; independently review special-building exits.",
        f.id,
      );
      add(
        `stairs.${s.id}.brief`,
        "brief",
        "Requested apartment stair clear width policy",
        measuredWidth,
        1500,
        cmp(measuredWidth, 1500),
        [s.id],
        "mm",
        "Meet the explicit 1500mm project policy.",
        f.id,
      );
      add(
        `stairs.${s.id}.tread`,
        "egress",
        "Canonical stair tread",
        s.treadWidthMm,
        250,
        cmp(s.treadWidthMm, 250),
        [s.id],
        "mm",
        "Provide minimum 250mm tread.",
        f.id,
      );
      const landing = rectangularBounds(s.midLanding);
      add(
        `stairs.${s.id}.landing`,
        "egress",
        "Clear mid-landing depth relative to flight width",
        landing ? Math.min(landing.width, landing.height) : null,
        measuredWidth,
        cmp(
          landing ? Math.min(landing.width, landing.height) : null,
          measuredWidth,
        ),
        [s.id],
        "mm",
        "Provide clear landing depth at least the flight width.",
        f.id,
      );
      const flightRisers = s.flightRiserCounts;
      add(
        `stairs.${s.id}.flight-risers`,
        "egress",
        "Maximum risers per measured flight",
        flightRisers ? Math.max(...flightRisers) : null,
        15,
        flightRisers &&
          flightRisers.every(Number.isInteger) &&
          flightRisers.every((n) => n > 0) &&
          flightRisers[0] + flightRisers[1] === s.riserCount
          ? cmp(Math.max(...flightRisers), 15, false)
          : "NOT_VERIFIED",
        [s.id],
        "risers",
        "Supply explicit flight riser counts consistent with the canonical stair.",
        f.id,
      );
      const instance = f.stairs.find(
        (t) =>
          t.verticalCoreId === s.id ||
          (polygonArea(t.boundary) === polygonArea(s.polygon) &&
            t.boundary.points.every((p) =>
              s.polygon.points.some((q) => p.x === q.x && p.y === q.y),
            )),
      );
      const rise =
        instance?.riserHeight ??
        (Number.isInteger(s.riserCount) && s.riserCount > 0 && f.floorHeight > 0
          ? f.floorHeight / s.riserCount
          : null);
      add(
        `stairs.${s.id}.riser`,
        "egress",
        "Measured floor rise / canonical riser count",
        rise,
        190,
        cmp(rise, 190, false),
        [s.id],
        "mm",
        "Verify riser count, floor heights and <=15 risers per flight.",
        f.id,
      );
      const headroom = s.headroomMm ?? instance?.headroomMm ?? null;
      add(
        `stairs.${s.id}.headroom`,
        "egress",
        "Clear headroom below actual slab / beam",
        headroom,
        2200,
        cmp(headroom, 2200),
        [s.id],
        "mm",
        "Supply measured section headroom; floor-to-floor height does not establish headroom.",
        f.id,
      );
    }
    const route = measureEgressTravel(f);
    if (route.distanceMm !== null)
      maxTravel =
        maxTravel === null
          ? route.distanceMm
          : Math.max(maxTravel, route.distanceMm);
    add(
      `travel.${f.id}`,
      "egress",
      `Constrained room/door/corridor route: ${route.reason}`,
      route.distanceMm,
      22500,
      route.status === "DISCONNECTED"
        ? "VIOLATION"
        : route.status === "NOT_VERIFIED"
          ? "NOT_VERIFIED"
          : cmp(route.distanceMm, 22500, false),
      [
        ...f.rooms.filter((r) => r.unitId).map((r) => r.id),
        ...stairs.map((s) => s.id),
      ],
      "mm",
      "Provide complete door topology and unobstructed common circulation to OPEN_PASSAGE. Residential limit is 22.5m; no assumed 18m or 30m.",
      f.id,
    );
    const lifts = f.rooms.filter((r) => r.type === "lift");
    const needed =
      c.buildingHeightM === undefined
        ? null
        : c.buildingHeightM > 24
          ? 2
          : c.buildingHeightM > 15
            ? 1
            : 0;
    add(
      `lift.${f.id}`,
      "egress",
      "Measured lift shaft provision",
      lifts.length,
      needed,
      cmp(lifts.length, needed),
      lifts.map((r) => r.id),
      "shafts",
      "Provide required lift shafts and verify lift capacity/accessibility; lifts are not fire exits.",
      f.id,
    );
    for (const { room: r, clear } of m.rooms) {
      if (
        !r.unitId ||
        ![
          "living",
          "dining",
          "drawing",
          "family_living",
          "bedroom",
          "kitchen",
          "bathroom",
          "study",
        ].includes(r.type)
      )
        continue;
      const area = m.ledger.supported
          ? (m.ledger.roomUsable[r.id] ?? 0) / 1e6
          : null,
        width = clear ? Math.min(clear.width, clear.height) / 1000 : null;
      const bath = r.type === "bathroom";
      if (bath && r.wetRoomType) {
        const minArea =
            r.wetRoomType === "BATH_ONLY"
              ? 1.2
              : r.wetRoomType === "WC_ONLY"
                ? 0.81
                : 1.5,
          minWidth = r.wetRoomType === "WC_ONLY" ? 0.9 : 1;
        add(
          `room.${r.id}.wet-area`,
          "rooms",
          "Typed wet-room clear area",
          area,
          minArea,
          cmp(area, minArea),
          [r.id],
          "m2",
          "Increase clear wet-room area.",
          f.id,
        );
        add(
          `room.${r.id}.wet-width`,
          "rooms",
          "Typed wet-room minimum clear width",
          width,
          minWidth,
          cmp(width, minWidth),
          [r.id],
          "m",
          "Increase clear wet-room width; bath-only requires 1m x 1.2m.",
          f.id,
        );
        if (r.wetRoomType === "BATH_ONLY")
          add(
            `room.${r.id}.bath-length`,
            "rooms",
            "Bath-only second clear dimension",
            clear ? Math.max(clear.width, clear.height) / 1000 : null,
            1.2,
            cmp(clear ? Math.max(clear.width, clear.height) / 1000 : null, 1.2),
            [r.id],
            "m",
            "Provide a 1m x 1.2m clear bathroom.",
            f.id,
          );
      }
      add(
        `room.${r.id}.height`,
        "rooms",
        "Explicit clear room height below slab/beam",
        r.clearHeightMm ?? null,
        bath ? 2100 : 2750,
        cmp(r.clearHeightMm, bath ? 2100 : 2750),
        [r.id],
        "mm",
        "Supply measured section clear height; floor-to-floor height alone does not establish clearance.",
        f.id,
      );
      add(
        `room.${r.id}.size`,
        "rooms",
        `Clear area / width / aspect: ${r.name}`,
        JSON.stringify({
          areaSqm: area,
          widthM: width,
          aspectRatio: clear
            ? Math.max(clear.width, clear.height) /
              Math.min(clear.width, clear.height)
            : null,
        }),
        bath
          ? "Wet-room subtype required"
          : "UDCPR 9.2.1 / 9.3.1 owner requirements; NBC review pending",
        "NOT_VERIFIED",
        [r.id],
        undefined,
        "Record wet-room subtype for bath/WC minima; verify NBC room sizes. Do not misquote owner-convenience provisions as numerical statutory minima.",
        f.id,
      );
      const ventilation = measureWindowAdjacency(f, r),
        required = bath
          ? 0.3
          : area === null
            ? null
            : r.type === "kitchen"
              ? Math.max(1, area / 10)
              : area / 10;
      const shaftOk = ventilation.shaftIds.every((id) => {
        const shaft = f.rooms.find((v) => v.id === id)!,
          b = rectangularBounds(shaft.boundary),
          h = c.buildingHeightM;
        if (!b || !h || shaft.openToSky !== true) return false;
        const i =
          h <= 10
            ? 0
            : h <= 12
              ? 1
              : h <= 18
                ? 2
                : h <= 24
                  ? 3
                  : h <= 30
                    ? 4
                    : 5;
        return (
          polygonArea(shaft.boundary) / 1e6 >= [1.2, 2.4, 4, 5.4, 8, 9][i]! &&
          Math.min(b.width, b.height) / 1000 >=
            [0.9, 1.2, 1.5, 1.8, 2.4, 3][i]! &&
          h <= 30
        );
      });
      const depthOk = clear && Math.max(clear.width, clear.height) <= 7500;
      const ventStatus = ventilation.invalid.length
        ? "NOT_VERIFIED"
        : !shaftOk
          ? "NOT_VERIFIED"
          : cmp(ventilation.areaMm2 / 1e6, required) === "PASS" && !depthOk
            ? "NOT_VERIFIED"
            : cmp(ventilation.areaMm2 / 1e6, required);
      add(
        `room.${r.id}.ventilation`,
        "ventilation",
        `Actual exterior/balcony/shaft window openings: ${r.name}`,
        ventilation.areaMm2 / 1e6,
        required,
        ventStatus,
        [r.id, ...ventilation.windowIds, ...ventilation.shaftIds],
        "m2",
        "Provide hosted window width/height, outdoor adjacency, adequate shafts and depth/light assessment; opening area alone is insufficient.",
        f.id,
      );
    }
  }
  const sorted = [...physical].sort((a, b) => a.floor.level - b.floor.level);
  const alignment =
    sorted.length > 1 &&
    sorted.every(
      (m, i) =>
        !i ||
        ((m.floor.canonicalStaircases ?? []).length > 0 &&
          (m.floor.canonicalStaircases ?? []).every((s) =>
            (sorted[i - 1]!.floor.canonicalStaircases ?? []).some(
              (p) =>
                s.polygon.points.length === p.polygon.points.length &&
                s.polygon.points.every((a) =>
                  p.polygon.points.some((b) => a.x === b.x && a.y === b.y),
                ),
            ),
          )),
    );
  add(
    "stairs.alignment",
    "egress",
    "Vertical canonical staircase footprint alignment",
    alignment,
    true,
    sorted.length < 2 ? "NOT_VERIFIED" : alignment ? "PASS" : "VIOLATION",
    physical.flatMap((m) =>
      (m.floor.canonicalStaircases ?? []).map((s) => s.id),
    ),
    undefined,
    "Align canonical cores across physical floors; separately verify landings, flight direction and vertical clearances.",
  );
  add(
    "fire.review",
    "egress",
    "Special-building classification, exit capacity, enclosure and fire systems",
    null,
    "Verified fire strategy and section data",
    "NOT_VERIFIED",
    [],
    undefined,
    "Obtain professional fire/accessibility review; planar egress measurements do not verify enclosure, smoke protection, exit capacity or required second exits.",
  );
  const status = rules.some((r) => r.status === "VIOLATION")
    ? "VIOLATION"
    : rules.some((r) => r.status === "NOT_VERIFIED" || r.status === "WARNING")
      ? "NOT_VERIFIED"
      : "PASS";
  const pass = (prefix: string) =>
    rules
      .filter((r) => r.id.startsWith(prefix))
      .every((r) => r.status === "PASS");
  return {
    schemaVersion: 1,
    reportType: "UDCPR_COMPLIANCE_REPORT",
    buildingId: building.id,
    buildingVersion: building.version,
    canonicalHash: canonicalBuildingHash(building),
    contextHash: stableValueHash(c),
    regulatoryContext: c,
    contextProvenance: provenance,
    missingInputs: missing,
    jurisdiction: `${c.authorityType ?? "UNKNOWN"} / ${c.congestionZone ?? "UNKNOWN"}`,
    overallCompliant: status === "PASS",
    status,
    gate: "INTERNAL_ENGINEERING_GATE",
    professionalStatus: "PROFESSIONAL_REVIEW_REQUIRED",
    disclaimer: STATUTORY_DISCLAIMER,
    sources: REGULATORY_SOURCES,
    rulesChecked: rules,
    fsiUtilization: {
      basicFsi: entitlement?.basic ?? null,
      premiumFsi: entitlement?.premium ?? null,
      tdrFsi: entitlement?.tdr ?? null,
      ancillaryFsi: entitlement?.ancillary ?? null,
      approvedFsi: approved,
      permissibleFsi: entitlement
        ? entitlement.total + entitlement.ancillary
        : null,
      consumedFsi: consumed,
      builtUpAreaMm2: gross,
      candidateCoreAreaMm2: core,
      candidateStiltAreaMm2: stilt,
      exemptedAreaMm2: exempt,
      netFsiAreaMm2: net,
      maxPermissibleBuiltUpAreaMm2:
        approved !== null && netPlot ? approved * netPlot * 1e6 : null,
      compliant: pass("fsi."),
    },
    setbacks,
    parking: {
      requiredCars,
      providedCars: parking.cars,
      requiredTwoWheelers: requiredBikes,
      providedTwoWheelers: parking.bikes,
      drivewayWidthMm: parking.drivewayWidthMm,
      compliant: pass("parking."),
    },
    openSpace: {
      requiredPercent: rosRequired,
      providedPercent: rosPercent,
      areaMm2: ros.areaMm2,
      coveragePercent: coverage,
      compliant: rosStatus === "PASS",
    },
    staircaseFireSafety: {
      minWidthMm: 1500,
      providedWidthMm: providedStair,
      maxTravelDistanceMm: 22500,
      actualTravelDistanceMm: maxTravel,
      compliant:
        pass("stairs.") && pass("travel.") && pass("lift.") && pass("fire."),
    },
    generatedAt: new Date().toISOString(),
  };
}
export function isUDCPRReportCurrent(
  report: UDCPRComplianceReport,
  building: Building,
  input?: RegulatoryContextInput,
): boolean {
  return (
    report.buildingId === building.id &&
    report.buildingVersion === building.version &&
    report.canonicalHash === canonicalBuildingHash(building) &&
    report.contextHash ===
      stableValueHash(resolveRegulatoryContext(building, input).context)
  );
}
