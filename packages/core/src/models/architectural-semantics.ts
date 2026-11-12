import type {
  ArchitecturalBoundaryRole,
  ArchitecturalSpaceRole,
  Building,
  Room,
  Wall,
  ArchitecturalElement,
} from "../types";
export function architecturalSpaceRole(r: Room): ArchitecturalSpaceRole {
  if (r.architecturalRole) return r.architecturalRole;
  if (r.spaceUse === "VOID" || r.type === "ots") return "OPEN_TO_SKY_VOID";
  if (r.type === "service_shaft") return "SERVICE_SHAFT";
  if (r.type === "staircase") return "STAIR_ENCLOSURE";
  if (r.type === "lift") return "LIFT_SHAFT";
  if (
    r.type === "balcony" ||
    (r.type === "utility" && r.spaceUse === "OUTDOOR")
  )
    return "BALCONY_SLAB";
  if (r.type === "terrace") return "OPEN_TERRACE";
  if (
    r.type === "corridor" ||
    r.type === "foyer" ||
    r.type === "garden" ||
    r.type === "porch"
  )
    return "OPEN_CIRCULATION";
  if (r.type === "parking")
    return r.tags.some((t) => /driveway|circulation/i.test(t))
      ? "VEHICLE_AISLE"
      : "PARKING_BAY";
  return [
    "bedroom",
    "living",
    "dining",
    "study",
    "drawing",
    "family_living",
  ].includes(r.type)
    ? "ENCLOSED_HABITABLE"
    : "ENCLOSED_SERVICE";
}
export function requiresEnclosure(role: ArchitecturalSpaceRole): boolean {
  return [
    "ENCLOSED_HABITABLE",
    "ENCLOSED_SERVICE",
    "STAIR_ENCLOSURE",
    "PROTECTED_STAIR_ENCLOSURE",
    "STAIR_MUMTY",
    "LIFT_SHAFT",
    "SERVICE_SHAFT",
    "LIFT_EQUIPMENT",
  ].includes(role);
}
export function architecturalBoundaryRole(
  owners: readonly Room[],
  exterior: boolean,
): ArchitecturalBoundaryRole {
  if (owners.some((r) => requiresEnclosure(architecturalSpaceRole(r))))
    return "FULL_HEIGHT_WALL";
  if (owners.some((r) => architecturalSpaceRole(r) === "OPEN_TO_SKY_VOID"))
    return "PARAPET";
  if (
    exterior &&
    owners.some((r) =>
      [
        "BALCONY_SLAB",
        "OPEN_TERRACE",
        "ROOF_EQUIPMENT_ZONE",
        "OPEN_TO_SKY_VOID",
      ].includes(architecturalSpaceRole(r)),
    )
  )
    return "PARAPET";
  return "OPEN_BOUNDARY";
}
export const isPhysicalBoundary = (w: Wall): boolean =>
  w.boundaryRole !== "OPEN_BOUNDARY";
export function architecturalWallHeight(w: Wall, fullHeight: number): number {
  if (w.boundaryRole === "OPEN_BOUNDARY") return 0;
  if (w.heightMm !== undefined) return w.heightMm;
  return w.wallUse === "PARAPET" ||
    w.boundaryRole === "PARAPET" ||
    w.boundaryRole === "GUARDRAIL"
    ? 1100
    : fullHeight;
}
/** Explicit annotation only: never removes old geometry or infers safety approval. */
export function withArchitecturalElements(building: Building): Building {
  return {
    ...building,
    floors: building.floors.map((f) => {
      const elements: ArchitecturalElement[] = [];
      const add = (
        role: ArchitecturalElement["role"],
        collection: ArchitecturalElement["source"]["collection"],
        id: string,
        part?: ArchitecturalElement["source"]["part"],
      ) =>
        elements.push({
          id: `${id}:architecture:${part ?? role}`,
          floorId: f.id,
          role,
          source: { collection, id, ...(part ? { part } : {}) },
          reviewStatus: "DESIGN_PROPOSAL",
        });
      f.rooms.forEach((r) => add(architecturalSpaceRole(r), "rooms", r.id));
      f.walls.forEach((w) =>
        add(w.boundaryRole ?? "FULL_HEIGHT_WALL", "walls", w.id),
      );
      f.doors.forEach((o) => add("DOOR_OPENING", "doors", o.id));
      f.windows.forEach((o) => add("WINDOW_OPENING", "windows", o.id));
      (f.canonicalStaircases ?? []).forEach((s) => {
        add("STAIR_FLIGHT", "canonicalStaircases", s.id, "flight1");
        add("STAIR_FLIGHT", "canonicalStaircases", s.id, "flight2");
        add("STAIR_LANDING", "canonicalStaircases", s.id, "midLanding");
        if (s.floorLanding)
          add("STAIR_LANDING", "canonicalStaircases", s.id, "floorLanding");
      });
      if (f.floorUse === "ROOF") add("OPEN_TERRACE", "floor", f.id);
      return {
        ...f,
        architecture: {
          schemaVersion: 1 as const,
          elements,
          drainage: f.architecture?.drainage ?? {
            status: "NOT_VERIFIED" as const,
          },
          statutoryStatus: "NOT_VERIFIED" as const,
        },
      };
    }),
  };
}
export function architecturalModelErrors(building: Building): string[] {
  const errors: string[] = [];
  for (const f of building.floors) {
    for (const w of f.walls) {
      if (
        w.boundaryRole !== undefined &&
        !["FULL_HEIGHT_WALL", "PARAPET", "GUARDRAIL", "OPEN_BOUNDARY"].includes(
          w.boundaryRole,
        )
      )
        errors.push(`${w.id}: unsupported boundary role`);
      if (
        w.heightMm !== undefined &&
        (!Number.isFinite(w.heightMm) || w.heightMm < 0)
      )
        errors.push(`${w.id}: invalid boundary height`);
    }
    if (!f.architecture) continue;
    if (f.architecture.schemaVersion !== 1)
      errors.push(`${f.id}: unsupported architectural schema`);
    for (const w of f.walls) {
      const h = architecturalWallHeight(w, f.floorHeight);
      if (h > f.floorHeight)
        errors.push(`${w.id}: boundary exceeds floor height`);
      if (
        !Number.isFinite(h) ||
        h < 0 ||
        (w.boundaryRole !== "OPEN_BOUNDARY" && h <= 0)
      )
        errors.push(`${w.id}: invalid boundary height`);
      if (
        w.boundaryRole === "OPEN_BOUNDARY" &&
        f.doors.some((d) => d.wallId === w.id && d.type !== "open_passage")
      )
        errors.push(
          `${w.id}: a door leaf cannot be hosted by an open boundary`,
        );
      if (
        w.boundaryRole &&
        w.boundaryRole !== "FULL_HEIGHT_WALL" &&
        f.windows.some((d) => d.wallId === w.id)
      )
        errors.push(`${w.id}: window requires full-height wall`);
    }
    for (const e of f.architecture.elements) {
      const collection =
        e.source.collection === "floor" ? [f] : (f[e.source.collection] ?? []);
      if (e.floorId !== f.id || !collection.some((o) => o.id === e.source.id))
        errors.push(`${e.id}: unresolved canonical source`);
    }
    if (
      new Set(f.architecture.elements.map((e) => e.id)).size !==
      f.architecture.elements.length
    )
      errors.push(`${f.id}: duplicate architectural identity`);
  }
  return errors;
}
