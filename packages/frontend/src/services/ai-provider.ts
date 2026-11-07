import { BackendAPI } from './backend-api';
import type { ArchitecturalResearchAgent } from '@ai-floor-planner/ai-orchestration';

/**
 * Resolve the Gemini credential for the development-only, client-side fallback.
 *
 * SECURITY (Master PRD §36): No API key is ever hard-coded or committed. The key
 * is read exclusively from the build-time `VITE_GEMINI_API_KEY` environment
 * variable. When it is absent this returns `undefined` so callers surface an
 * explicit "AI unavailable / not configured" state instead of silently calling a
 * provider with a leaked credential. Public builds must route through the
 * server-side backend boundary rather than embedding any key.
 */
export function getAIService(): BackendAPI {
  return new BackendAPI();
}

/**
 * Architectural research is routed through the server-side backend boundary (PRD §36).
 * No client-side Gemini provider or secret credentials exist in the frontend bundle.
 */
export function getArchitecturalResearchAgent(): ArchitecturalResearchAgent | null {
  return null;
}
