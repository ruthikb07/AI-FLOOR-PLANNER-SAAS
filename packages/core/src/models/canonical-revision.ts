import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { Building } from "../types/building";

/** Stable bytes for revision fingerprints across browser and backend runtimes. */
export function canonicalRevisionJson(building: Building): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : value;
  return JSON.stringify(sorted(building));
}

export function canonicalBuildingHash(building: Building): string {
  return stableValueHash(building);
}
export function stableValueHash(value: unknown): string {
  return bytesToHex(
    sha256(utf8ToBytes(canonicalRevisionJson(value as Building))),
  );
}
