# AI Floor Planner — API Contracts

## 1. Overview

This document defines the API boundaries between subsystems (internal contracts) and the external HTTP API exposed to clients.

---

## 2. Internal Package Contracts

### 2.1 Core → Geometry Engine

```typescript
// Geometry Engine expects and returns core types
import { Point, Polygon, BoundingBox, LineSegment, Room, Wall, Floor } from '@ai-floor-planner/core';
```

### 2.2 Core → Constraint Engine

```typescript
import { Building, Floor, Room, Wall, Door, Window } from '@ai-floor-planner/core';

interface ConstraintEngine {
  validate(building: Building): ValidationReport;
  validateFloor(floor: Floor): ValidationReport;
  score(building: Building, config?: ConstraintConfig): PlanScore;
}
```

### 2.3 Core → Planning Engine

```typescript
import { UserRequirements, Building, PlanScore } from '@ai-floor-planner/core';

interface PlanningEngine {
  generateCandidates(requirements: UserRequirements, count: number): Building[];
  optimizeCandidate(building: Building, constraints: ConstraintConfig): Building;
  rankCandidates(candidates: Building[]): RankedCandidate[];
}

interface RankedCandidate {
  building: Building;
  score: PlanScore;
  rank: number;
}
```

### 2.4 Core → AI Orchestration

```typescript
import { UserRequirements, Building, AITaskType } from '@ai-floor-planner/core';

interface AIOrchestration {
  parseRequirements(naturalLanguage: string): Promise<UserRequirements>;
  parseEditCommand(command: string, context: Building): Promise<EditOperation[]>;
  critiquePlan(building: Building, score: PlanScore): Promise<DesignCritique>;
  explainPlan(building: Building): Promise<string>;
}

interface EditOperation {
  type: 'move' | 'resize' | 'add' | 'remove' | 'modify';
  targetId?: string;
  changes: Record<string, any>;
  reasoning: string;
}
```

### 2.5 Core → Renderer

```typescript
import { Building, Floor, ViewTransform } from '@ai-floor-planner/core';

interface Renderer {
  renderFloor(floor: Floor, transform: ViewTransform): SVGElement;
  renderBuilding(building: Building, floorLevel: number): SVGElement;
  exportSVG(building: Building, options: ExportOptions): string;
}
```

---

## 3. External HTTP API

Base URL: `/api/v1`

> **Implemented backend surface.** The running `packages/backend` server currently exposes
> `GET /api/v1/health`, `POST /api/v1/architecture/evaluate` (advisory commentary on an
> already-validated plan) and the CAD/PDF/Blender/ETABS export routes. The rest of this
> section is the target contract, not a description of implemented endpoints.
>
> **There are no image-generation or image-to-plan endpoints.** Plan generation is
> deterministic and runs in `planning-engine`, which the studio calls directly in a web
> worker. No image model decides layout, counts or geometry.

### 3.1 Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | Create account |
| `/auth/login` | POST | Login, get JWT |
| `/auth/refresh` | POST | Refresh token |
| `/auth/logout` | POST | Invalidate token |

### 3.2 Projects

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects` | GET | List user's projects |
| `/projects` | POST | Create new project |
| `/projects/:id` | GET | Get project details |
| `/projects/:id` | PUT | Update project |
| `/projects/:id` | DELETE | Archive project |

#### POST /projects

```json
// Request
{
  "name": "Residential Villa",
  "clientName": "John Doe",
  "description": "3BHK villa with parking",
  "site": {
    "plotWidth": 9144,
    "plotDepth": 15240,
    "orientation": 90,
    "roadFacing": "east",
    "setbacks": {
      "front": 1500,
      "rear": 1000,
      "left": 900,
      "right": 900
    }
  }
}

// Response: 201
{
  "id": "proj_abc123",
  "name": "Residential Villa",
  "status": "draft",
  "createdAt": "2026-08-14T10:00:00Z"
}
```

### 3.3 Buildings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects/:id/buildings` | GET | List buildings in project |
| `/projects/:id/buildings` | POST | Create building |
| `/projects/:pid/buildings/:bid` | GET | Get full building model |
| `/projects/:pid/buildings/:bid` | PUT | Update building model |

### 3.4 Plan Generation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/projects/:id/generate` | POST | Generate candidate plans |
| `/projects/:id/candidates` | GET | List generated candidates |
| `/projects/:id/candidates/:cid/select` | POST | Select a candidate as active |

#### POST /projects/:id/generate

```json
// Request
{
  "requirements": {
    "floors": 2,
    "rooms": [
      { "type": "bedroom", "count": 3, "priority": 8 },
      { "type": "bathroom", "count": 2, "priority": 7 },
      { "type": "kitchen", "count": 1, "priority": 9 },
      { "type": "living", "count": 1, "priority": 8 },
      { "type": "dining", "count": 1, "priority": 7 },
      { "type": "pooja", "count": 1, "priority": 6 },
      { "type": "parking", "count": 1, "priority": 7 }
    ],
    "preferences": {
      "vastuCompliance": true,
      "naturalLight": "high",
      "privacy": "medium",
      "circulationEfficiency": "high"
    }
  },
  "candidateCount": 3
}

// Response: 202 (async generation)
{
  "jobId": "gen_xyz789",
  "status": "processing",
  "estimatedTime": 15000
}
```

### 3.5 Plan Editing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/buildings/:id/edit` | POST | Apply manual edit |
| `/buildings/:id/ai-edit` | POST | Apply AI-powered edit |
| `/buildings/:id/undo` | POST | Undo last edit |
| `/buildings/:id/redo` | POST | Redo undone edit |

#### POST /buildings/:id/ai-edit

```json
// Request
{
  "command": "Make the master bedroom larger and move kitchen closer to dining"
}

// Response: 200
{
  "success": true,
  "operations": [
    {
      "type": "resize",
      "targetId": "room_master01",
      "before": { "width": 3600, "height": 4200 },
      "after": { "width": 4200, "height": 4800 }
    },
    {
      "type": "move",
      "targetId": "room_kitchen01",
      "before": { "x": 6000, "y": 3000 },
      "after": { "x": 4500, "y": 3000 }
    }
  ],
  "versionId": "ver_456",
  "validation": {
    "isValid": true,
    "score": { "overall": 87 }
  }
}
```

### 3.6 Validation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/buildings/:id/validate` | GET | Full validation report |
| `/buildings/:id/score` | GET | Plan quality scores |

### 3.7 Versions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/buildings/:id/versions` | GET | List all versions |
| `/buildings/:id/versions/:vid` | GET | Get specific version |
| `/buildings/:id/versions/:vid/restore` | POST | Restore to version |

### 3.8 Export

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/buildings/:id/export/svg` | GET | Export as SVG |
| `/buildings/:id/export/pdf` | GET | Export as PDF |
| `/buildings/:id/export/json` | GET | Export building model JSON |

---

## 4. WebSocket API

For real-time plan editing feedback:

```
ws://api/v1/buildings/:id/live

// Client → Server messages
{ "type": "edit", "operation": { ... } }
{ "type": "undo" }
{ "type": "redo" }
{ "type": "subscribe", "floor": 0 }

// Server → Client messages
{ "type": "model_updated", "building": { ... } }
{ "type": "validation", "report": { ... } }
{ "type": "ai_response", "content": "..." }
{ "type": "generation_progress", "percent": 45 }
```

---

## 5. Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Room extends outside plot boundary",
    "details": {
      "constraintId": "HC-001",
      "affectedEntities": ["room_bed01"]
    }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_FAILED | 400 | Plan validation failure |
| INVALID_INPUT | 400 | Malformed request |
| NOT_FOUND | 404 | Entity not found |
| UNAUTHORIZED | 401 | Not authenticated |
| FORBIDDEN | 403 | Not authorized |
| AI_UNAVAILABLE | 503 | AI service down |
| QUOTA_EXCEEDED | 429 | AI request limit hit |
| GENERATION_FAILED | 500 | Plan generation error |

---

## 6. Pagination

List endpoints support cursor-based pagination:

```
GET /projects?cursor=abc123&limit=20

Response:
{
  "data": [...],
  "pagination": {
    "nextCursor": "def456",
    "hasMore": true,
    "total": 47
  }
}
```

---

## 7. Rate Limits

| Endpoint Category | Rate Limit |
|-------------------|-----------|
| Auth | 10/min |
| CRUD | 100/min |
| Generation | 5/min |
| AI Edit | 30/min |
| Export | 20/min |
