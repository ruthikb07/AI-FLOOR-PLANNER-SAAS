// Adapted from OpenBIMStudio 0.74.0, MIT. Copyright (c) 2026 Amdghedy.
// See docs/integration/licenses/openbimstudio-MIT.txt.
/**
 * IFC GlobalId helpers (buildingSMART "compressed GUID", 22 characters).
 *
 * A valid IFC GlobalId is the 128-bit GUID written as 22 base-64 digits using
 * the alphabet below. The first digit therefore only carries 2 bits and must be
 * one of 0-3. A random hex string is NOT a valid GlobalId.
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** 32 hex characters (a UUID without dashes) -> 22-character IFC GlobalId. */
export function compressGuid(hex32: string): string {
  const hex = hex32.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("compressGuid: expected 32 hex digits");
  let n = BigInt("0x" + hex);
  const out: string[] = new Array(22);
  for (let i = 21; i >= 0; i--) {
    out[i] = CHARS[Number(n & 63n)]!;
    n >>= 6n;
  }
  return out.join("");
}

/** 22-character IFC GlobalId -> 32 hex digits. */
export function decompressGuid(g: string): string {
  if (!isValidIfcGuid(g)) throw new Error("decompressGuid: not a valid IFC GlobalId");
  let n = 0n;
  for (const ch of g) n = (n << 6n) | BigInt(CHARS.indexOf(ch));
  return n.toString(16).padStart(32, "0");
}

export function isValidIfcGuid(g: unknown): g is string {
  if (typeof g !== "string" || g.length !== 22) return false;
  if ("0123".indexOf(g[0]!) < 0) return false;
  for (const ch of g) if (CHARS.indexOf(ch) < 0) return false;
  return true;
}
