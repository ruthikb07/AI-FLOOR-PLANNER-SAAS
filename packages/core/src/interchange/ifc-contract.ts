import { exchangeArtifactDigest } from './cad-bim-adapter-contract';
import { compressGuid } from './ifc-guid';
import type { ExchangeArtifact, ExchangeElementKind, ExchangeElementMapping, ExchangeManifest } from './cad-bim-adapter-contract';

export interface IfcElementMapping extends ExchangeElementMapping {
  readonly ifcClass: string;
  readonly openingGlobalId?: string;
  readonly elevationMm?: number;
  readonly axisMm?: readonly [number, number, number, number];
  readonly profileAreaMm2?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

export interface IfcOmission {
  readonly kind: ExchangeElementKind | 'mep' | 'furniture' | 'survey-curve' | 'stair-flight';
  readonly floorId: string;
  readonly canonicalId: string;
  readonly reason: string;
}

export interface IfcExchangeManifest extends ExchangeManifest {
  readonly format: 'IFC4';
  readonly adapterVersion: 1;
  readonly scope: 'ARCHITECTURAL';
  readonly verification: 'SOFTWARE_READBACK';
  readonly elements: readonly IfcElementMapping[];
  readonly omissions: readonly IfcOmission[];
  readonly maximumCurveChordDeviationMm: number;
}

export interface IfcExchangeArtifact extends ExchangeArtifact {
  readonly manifest: IfcExchangeManifest;
}

/** Stable within the canonical project, building and entity namespace across revisions. */
export function canonicalIfcGlobalId(projectId: string, buildingId: string, ...identity: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(['RH Planner IFC4 v1', projectId, buildingId, ...identity]));
  return compressGuid(exchangeArtifactDigest(bytes).slice(0, 32));
}
