import type {
  Building,
  MultiSheetApartmentConfig,
} from "@ai-floor-planner/core";
import {
  measureApartmentAreaLedger,
  measureWindowAdjacency,
} from "@ai-floor-planner/geometry-engine";
import { solveMultiSheetApartmentProject } from "../apartment/multi-sheet-apartment-solver";
import {
  infeasible,
  solverResult,
  type SolverResult,
} from "../structural/solver-result";
export class ApartmentUnitPacker {
  validate(building: Building): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [];
    for (const f of building.floors.filter(
      (f) => f.floorUse === "RESIDENTIAL",
    )) {
      const ledger = measureApartmentAreaLedger(f);
      if (!f.apartmentUnits?.length)
        errors.push(
          infeasible(
            "No canonical apartment units are allocated.",
            [f.id],
            f.id,
          ),
        );
      for (const u of f.apartmentUnits ?? []) {
        const rooms = f.rooms.filter((r) => r.unitId === u.id),
          entries = f.doors.filter(
            (d) =>
              d.connectsRooms.some((id) => rooms.some((r) => r.id === id)) &&
              d.connectsRooms.some((id) =>
                f.rooms.some(
                  (r) =>
                    r.id === id &&
                    !r.unitId &&
                    ["corridor", "foyer"].includes(r.type),
                ),
              ),
          );
        if (
          !entries.length ||
          entries.some(
            (d) =>
              !d.connectsRooms.some((id) =>
                rooms.some((r) => r.id === id && r.type === "living"),
              ),
          )
        )
          errors.push(
            infeasible(
              "Each unit entrance must connect common lobby directly to its living room.",
              [u.id, ...entries.map((d) => d.id)],
              f.id,
            ),
          );
        const bedrooms = /^([1-4])BHK$/.exec(u.unitType);
        if (
          !bedrooms ||
          rooms.filter((r) => r.type === "bedroom").length !==
            Number(bedrooms[1]) ||
          !rooms.some((r) => r.type === "kitchen") ||
          !rooms.some((r) => r.type === "bathroom")
        )
          errors.push(
            infeasible(
              "Unit room inventory does not match its canonical BHK intent.",
              [u.id],
              f.id,
            ),
          );
        const reachable = new Set(
          rooms.filter((r) => r.type === "living").map((r) => r.id),
        );
        let changed = true;
        while (changed) {
          changed = false;
          for (const door of f.doors)
            if (
              door.width > 0 &&
              door.connectsRooms.some((id) => reachable.has(id))
            )
              for (const id of door.connectsRooms)
                if (rooms.some((r) => r.id === id) && !reachable.has(id)) {
                  reachable.add(id);
                  changed = true;
                }
        }
        if (rooms.some((r) => !reachable.has(r.id)))
          errors.push(
            infeasible(
              "Private room has no explicit door/open-passage route from the living room.",
              [u.id],
              f.id,
            ),
          );
        for (const r of rooms) {
          if (["living", "bedroom"].includes(r.type)) {
            let area = 0;
            for (const w of f.windows.filter((w) => w.roomId === r.id)) {
              const m = measureWindowAdjacency({ ...f, windows: [w] }, r);
              if (
                !m.invalid.length &&
                m.shaftIds.every(
                  (id) => f.rooms.find((r) => r.id === id)?.type === "ots",
                )
              )
                area += m.areaMm2;
            }
            const usable = ledger.roomUsable[r.id];
            if (!ledger.supported || !usable || area < usable / 8)
              errors.push(
                infeasible(
                  "Habitable room lacks measured exterior/OTS window area >=1/8 of clear floor area (project policy).",
                  [r.id],
                  f.id,
                ),
              );
          }
          if (
            r.type === "bathroom" &&
            !f.walls.some(
              (w) =>
                w.roomIds.includes(r.id) &&
                (w.type === "external" ||
                  w.roomIds.some((id) =>
                    f.rooms.some(
                      (s) =>
                        s.id === id &&
                        ["ots", "service_shaft"].includes(s.type),
                    ),
                  )),
            )
          )
            errors.push(
              infeasible(
                "Wet room has no registered external/shaft plumbing adjacency.",
                [r.id],
                f.id,
              ),
            );
        }
      }
      const expected = {
        EXTERNAL: 230,
        UNIT_SEPARATION: 230,
        COMMON_CORRIDOR: 150,
        INTERNAL_PARTITION: 115,
        SHAFT: 100,
      };
      for (const w of f.walls) {
        const width = expected[w.wallUse as keyof typeof expected];
        if (width !== undefined && w.thickness !== width)
          errors.push(
            infeasible(
              "Wall thickness differs from the explicit apartment hierarchy.",
              [w.id],
              f.id,
            ),
          );
        if (!w.wallUse)
          errors.push(
            infeasible(
              "Wall use is unclassified; thickness compliance cannot be inferred.",
              [w.id],
              f.id,
            ),
          );
      }
    }
    return solverResult(building, building, errors);
  }
  pack(config: MultiSheetApartmentConfig): SolverResult {
    try {
      if (
        ![config.plotWidthMm, config.plotDepthMm, config.roadWidthMm].every(
          (v) => Number.isFinite(v) && v > 0,
        ) ||
        !Number.isInteger(config.numTypicalFloors) ||
        config.numTypicalFloors < 1 ||
        config.numTypicalFloors > 40 ||
        ![2, 3, 4].includes(config.flatsPerFloor) ||
        config.units?.length !== config.flatsPerFloor
      )
        throw infeasible(
          "Invalid or incomplete canonical apartment generation requirements.",
        );
      const b = solveMultiSheetApartmentProject(config).building;
      return this.validate(b);
    } catch (error) {
      throw infeasible(error instanceof Error ? error.message : String(error));
    }
  }
}
