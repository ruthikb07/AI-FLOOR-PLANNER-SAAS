import { it, expect } from "vitest";
import { Direction, rectToPolygon } from "@ai-floor-planner/core";
import {
  permissibleResidentialEnvelope,
  inscribedResidentialRectangle,
} from "../residential-envelope";
import { polygonArea } from "../polygon";
import { rectangularBounds } from "../regulatory-measurements";
it.each([Direction.North, Direction.South, Direction.East, Direction.West])(
  "preserves exact cardinal rectangular setback envelope for %s",
  (facing) => {
    const p = permissibleResidentialEnvelope(
      rectToPolygon(0, 0, 18000, 25000),
      { front: 3115, rear: 1615, left: 1615, right: 1615 },
      facing,
    );
    const rectangle = inscribedResidentialRectangle(p);
    expect(rectangularBounds(p), JSON.stringify(p)).not.toBeNull();
    expect(polygonArea(rectangle)).toBeCloseTo(polygonArea(p), 3);
  },
);
