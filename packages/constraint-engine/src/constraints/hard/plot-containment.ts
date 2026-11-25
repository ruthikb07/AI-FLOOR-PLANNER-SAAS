/**
 * Hard Constraints: Plot and Floor Containment
 * HC-001: Every room must be fully inside its floor boundary.
 * HC-002: Every floor boundary must be inside plot minus setbacks.
 */

import type { Constraint, ConstraintResult, EvaluationContext, SuggestedFix } from '../../types';
import { ConstraintSeverity, ConstraintCategory } from '../../types';
import { containsPolygon, containsSurveyFootprint } from '@ai-floor-planner/geometry-engine';

export const RoomContainment: Constraint = {
  id: 'HC-001',
  name: 'Room Containment',
  description: 'Every room boundary must be fully inside its floor boundary',
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,

  evaluate(context: EvaluationContext): ConstraintResult[] {
    const results: ConstraintResult[] = [];

    for (const floor of context.building.floors) {
      if (floor.boundary.points.length < 3) continue;

      for (const room of floor.rooms) {
        if (room.boundary.points.length < 3) continue;

        const contained = containsPolygon(floor.boundary, room.boundary);

        if (!contained) {
          const fix: SuggestedFix = {
            description: `Move or resize "${room.name}" to fit within the floor boundary`,
            actionType: 'move',
            targetEntity: room.id,
            priority: 1,
          };

          results.push({
            constraintId: 'HC-001',
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Room "${room.name}" extends outside the floor boundary on "${floor.name}"`,
            affectedEntities: [room.id],
            explanation: `The boundary of "${room.name}" is not fully contained within the "${floor.name}" boundary. This makes the plan structurally invalid. Move or resize the room so it fits entirely within the buildable area.`,
            suggestedFixes: [fix],
          });
        }
      }
    }

    // If no violations, return a single pass result
    if (results.length === 0) {
      results.push({
        constraintId: 'HC-001',
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: 'All rooms are contained within their floor boundaries',
        affectedEntities: [],
        explanation: 'All room boundaries are fully inside their respective floor boundaries.',
      });
    }

    return results;
  },
};

export const FloorContainment: Constraint = {
  id: 'HC-002',
  name: 'Floor Containment',
  description: 'Every floor boundary must be inside the buildable envelope (plot minus setbacks)',
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,

  evaluate(context: EvaluationContext): ConstraintResult[] {
    const results: ConstraintResult[] = [];

    const contains = context.building.metadata.irregularPlotBoundary?.sourceFormat === 'survey'
      ? containsSurveyFootprint : containsPolygon;
    for (const floor of context.building.floors) {
      if (floor.boundary.points.length < 3) continue;
      if (context.buildableEnvelope.points.length < 3) continue;

      const contained = contains(context.buildableEnvelope, floor.boundary);

      if (!contained) {
        results.push({
          constraintId: 'HC-002',
          passed: false,
          severity: ConstraintSeverity.HARD,
          score: 0,
          maxScore: 0,
          message: `Floor "${floor.name}" extends outside the buildable area (plot minus setbacks)`,
          affectedEntities: [floor.id],
          explanation: `The "${floor.name}" boundary exceeds the buildable envelope defined by plot dimensions minus required setbacks. Reduce the floor footprint to respect setback requirements.`,
          suggestedFixes: [{
            description: `Reduce floor footprint to fit within setback limits`,
            actionType: 'resize',
            targetEntity: floor.id,
            priority: 1,
          }],
        });
      }
    }

    if (results.length === 0) {
      results.push({
        constraintId: 'HC-002',
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: 'All floors are within the buildable envelope',
        affectedEntities: [],
        explanation: 'All floor boundaries respect the required setback distances from plot edges.',
      });
    }

    return results;
  },
};
