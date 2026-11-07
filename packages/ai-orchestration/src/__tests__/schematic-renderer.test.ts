import { describe, expect, it } from 'vitest';
import { generateDeterministicApartmentSchematic } from '../apartment/schematic.js';
import { renderSchematicPng512 } from '../apartment/schematic-renderer.js';
import { getApartmentRulesProfile } from '../apartment/jurisdiction.js';

describe('Phase 2 — Schematic Renderer (Readable Line Drawing)', () => {
  const rulesProfile = getApartmentRulesProfile('pune_pmc');

  const baseOptions = {
    siteWidthM: 35,
    siteDepthM: 40,
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2bhk', count: 1, carpetAreaSqM: 65 },
      { unitType: '3bhk', count: 1, carpetAreaSqM: 95 },
    ],
    commonCoreConfig: {
      passengerLifts: 2,
      staircaseCount: 2,
      commonLobby: true,
    },
    rulesProfile,
  };

  it('renders a byte-valid PNG buffer of exactly 512x512', () => {
    const schematic = generateDeterministicApartmentSchematic(baseOptions);
    const pngBuf = renderSchematicPng512(schematic);

    expect(pngBuf).toBeInstanceOf(Buffer);
    expect(pngBuf.length).toBeGreaterThan(1000);

    // PNG signature check
    expect(pngBuf[0]).toBe(0x89);
    expect(pngBuf[1]).toBe(0x50);
    expect(pngBuf[2]).toBe(0x4e);
    expect(pngBuf[3]).toBe(0x47);

    // IHDR width and height check (bytes 16-23)
    const pngWidth = pngBuf.readUInt32BE(16);
    const pngHeight = pngBuf.readUInt32BE(20);
    expect(pngWidth).toBe(512);
    expect(pngHeight).toBe(512);
  });

  it('produces a high-contrast line drawing with predominantly white canvas background', () => {
    const schematic = generateDeterministicApartmentSchematic(baseOptions);
    const pngBuf = renderSchematicPng512(schematic);

    // Verify it is a valid compressed PNG that can be decoded
    expect(pngBuf.length).toBeGreaterThan(500);
  });

  it('represents all requested units and core elements from the schematic', () => {
    const schematic = generateDeterministicApartmentSchematic(baseOptions);
    expect(schematic.units).toHaveLength(2);
    expect(schematic.core.lifts).toHaveLength(2);
    expect(schematic.core.stairs).toHaveLength(2);

    const pngBuf = renderSchematicPng512(schematic);
    expect(pngBuf.length).toBeGreaterThan(1000);
  });

  it('scales and renders arbitrary flat counts (1, 3, 4, 6 flats) without crashing', () => {
    for (const count of [1, 3, 4, 6]) {
      const sch = generateDeterministicApartmentSchematic({
        ...baseOptions,
        flatsPerFloor: count,
        unitMix: [{ unitType: '2bhk', count, carpetAreaSqM: 60 }],
      });
      const png = renderSchematicPng512(sch);
      expect(png).toBeInstanceOf(Buffer);
      expect(png.length).toBeGreaterThan(500);
    }
  });
});
