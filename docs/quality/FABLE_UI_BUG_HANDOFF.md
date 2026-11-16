# Fable UI & Cinematic Scene Bug Handoff

**Date:** 2026-11-12  
**Reporting Agent:** Gemini 3.8 Flash High (Lead QA Auditor & Architect)  
**Assigned Agent:** Fable (Owner of Cinematic Welcome UI, Landing Page & 3D Marketing Scenes)  
**Scope:** `packages/frontend/src/components/studio/CinematicWelcomeScene.tsx` & associated styles/hooks  
**Status:** **ACTION REQUIRED BY FABLE** (Blocks full monorepo `pnpm turbo run typecheck`)

---

## 1. Executive Summary

During the Phase 1 & 2 full-repository audit, 8 of 9 monorepo packages (`core`, `geometry-engine`, `constraint-engine`, `planning-engine`, `ai-orchestration`, `projection-3d`, `renderer`, `backend`) passed TypeScript compilation with 0 errors.

The `@ai-floor-planner/frontend` build currently fails due to 12 strict TypeScript compiler errors in Fable's in-progress `CinematicWelcomeScene.tsx`. In accordance with Phase 0.3 ownership rules, Gemini has left this file untouched to preserve Fable's active implementation.

---

## 2. Identified TypeScript Compilation Errors

File: `packages/frontend/src/components/studio/CinematicWelcomeScene.tsx`

| Line | Error Code | Description | Recommended Fix |
|---|---|---|---|
| **7:16** | `TS2614` / `TS6133` | `Module '"gsap"' has no exported member 'ScrollTrigger'.` (and unused) | Replace with `import { ScrollTrigger } from 'gsap/ScrollTrigger';` or register via `gsap.registerPlugin(...)`. |
| **51:9** | `TS6133` | `'initAudio' is declared but its value is never read.` | Invoke `initAudio` in interaction listener or attach to sound toggle button. |
| **52:36** | `TS2304` | `Cannot find name 'audioEnabled'.` | Declare `const [audioEnabled, setAudioEnabled] = useState(false);` in the component state. |
| **67:7** | `TS2304` | `Cannot find name 'setAudioEnabled'.` | Add state setter from `useState(false)`. |
| **174:24** | `TS2304` | `Cannot find name 'audioEnabled'.` | Missing state variable. |
| **181:20** | `TS2304` | `Cannot find name 'audioEnabled'.` | Missing state variable. |
| **302:7** | `TS6133` | `'particleSystem' is declared but its value is never read.` | Prefix with `_particleSystem` or use it in the trail rendering logic. |
| **307:25** | `TS18048` | `'particleGeometry.attributes.position' is possibly 'undefined'.` | Guard with `if (!particleGeometry.attributes.position) return;`. |
| **324:11** | `TS2532` | `Object is possibly 'undefined'.` | Null-guard array index before mutation. |
| **327:9** | `TS18048` | `'particleGeometry.attributes.position' is possibly 'undefined'.` | Guard before `.needsUpdate = true`. |
| **348:30** | `TS2345` | `Argument of type 'Points<...> | null' is not assignable to parameter of type 'Points<...>'.` | Guard `particleSystemRef.current` against `null` before passing to `animateParticleTrail`. |

---

## 3. Reproduction Command

```powershell
Set-Location "AI BUILDING SAAS - Copy"
pnpm --filter @ai-floor-planner/frontend typecheck
```
Exit code: `2`. Expected after fix: `0`.

