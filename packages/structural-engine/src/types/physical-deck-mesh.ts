/** Geometry-only handoff. Node order is counter-clockwise in solver XY.
 * An explicit frame node reference shares its DOFs. A plan point creates a separate node.
 */
export interface PhysicalDeckMeshProposal {
  readonly supportingFloorId: string;
  readonly regionId: string;
  readonly nodes: readonly (
    | { readonly id: string; readonly frameNodeIndex: number }
    | { readonly id: string; readonly pointMm: readonly [number, number] }
  )[];
  readonly quads: readonly { readonly id: string; readonly nodeIds: readonly [string, string, string, string] }[];
}

export interface PhysicalDeckMeshReceipt {
  readonly status: 'MESH_GEOMETRY_CHECKED';
  readonly regionId: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly index: number;
    readonly positionM: readonly [number, number, number];
    readonly sharesFrameDofs: boolean;
  }[];
  readonly quadConnectivity: readonly {
    readonly id: string;
    readonly nodeIndices: readonly [number, number, number, number];
  }[];
  readonly quadCount: number;
  readonly gapMm2: number;
  readonly outsideMm2: number;
  readonly overlapMm2: number;
  readonly sharedEdges: readonly {
    readonly physicalBeamId: string;
    readonly elementId: string;
    readonly frameNodeIndices: readonly [number, number];
    readonly plateIds: readonly string[];
  }[];
  readonly gravityStatus: 'BEARING_AND_LOAD_TRANSFER_UNVERIFIED';
}
