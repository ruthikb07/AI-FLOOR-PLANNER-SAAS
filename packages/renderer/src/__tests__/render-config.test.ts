import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENDER_CONFIG,
  mergeConfig,
  resolveConfig,
  formatLength,
  formatArea,
} from '../render-config';
import type { RenderConfig, DeepPartial } from '../render-config';
import { RenderLayer, RoomType, WallType } from '@ai-floor-planner/core';

describe('RenderConfig', () => {
  // ─── Default Configuration ──────────────────────────────────────────────

  describe('DEFAULT_RENDER_CONFIG', () => {
    it('has all required top-level keys', () => {
      const config = DEFAULT_RENDER_CONFIG;
      expect(config).toHaveProperty('layers');
      expect(config).toHaveProperty('showDimensions');
      expect(config).toHaveProperty('showRoomLabels');
      expect(config).toHaveProperty('showRoomAreas');
      expect(config).toHaveProperty('showNorthArrow');
      expect(config).toHaveProperty('showScaleBar');
      expect(config).toHaveProperty('showGrid');
      expect(config).toHaveProperty('showTitleBlock');
      expect(config).toHaveProperty('displayUnit');
      expect(config).toHaveProperty('fontFamily');
      expect(config).toHaveProperty('gridSpacing');
      expect(config).toHaveProperty('wallStyles');
      expect(config).toHaveProperty('roomStyles');
      expect(config).toHaveProperty('doorStyle');
      expect(config).toHaveProperty('windowStyle');
      expect(config).toHaveProperty('columnStyle');
      expect(config).toHaveProperty('dimensionStyle');
      expect(config).toHaveProperty('labelStyle');
      expect(config).toHaveProperty('areaStyle');
      expect(config).toHaveProperty('gridStyle');
    });

    it('preserves existing renderer defaults for backward compatibility', () => {
      const config = DEFAULT_RENDER_CONFIG;

      // Display options that were always on
      expect(config.showDimensions).toBe(true);
      expect(config.showRoomLabels).toBe(true);
      expect(config.showRoomAreas).toBe(true);
      expect(config.showNorthArrow).toBe(true);
      expect(config.showGrid).toBe(true);

      // New features off by default
      expect(config.showScaleBar).toBe(false);
      expect(config.showTitleBlock).toBe(false);

      // Font
      expect(config.fontFamily).toBe('Inter, Arial, sans-serif');

      // Units
      expect(config.displayUnit).toBe('ft');

      // Grid spacing
      expect(config.gridSpacing).toBe(1000);
    });

    it('has all render layers defined', () => {
      const layers = DEFAULT_RENDER_CONFIG.layers;
      expect(layers[RenderLayer.Grid]).toBe(true);
      expect(layers[RenderLayer.Plot]).toBe(true);
      expect(layers[RenderLayer.SiteZones]).toBe(true);
      expect(layers[RenderLayer.Floor]).toBe(true);
      expect(layers[RenderLayer.Rooms]).toBe(true);
      expect(layers[RenderLayer.Walls]).toBe(true);
      expect(layers[RenderLayer.Openings]).toBe(true);
      expect(layers[RenderLayer.Stairs]).toBe(true);
      expect(layers[RenderLayer.Columns]).toBe(true);
      expect(layers[RenderLayer.Furniture]).toBe(true); // Illustrative symbols are available.
      expect(layers[RenderLayer.Annotations]).toBe(true);
      expect(layers[RenderLayer.Selection]).toBe(false); // Interactive only
      expect(layers[RenderLayer.Guides]).toBe(false);    // Interactive only
    });

    it('has room styles for all RoomType values', () => {
      const roomTypes = Object.values(RoomType);
      for (const type of roomTypes) {
        expect(DEFAULT_RENDER_CONFIG.roomStyles[type]).toBeDefined();
        expect(DEFAULT_RENDER_CONFIG.roomStyles[type]!.fill).toBeDefined();
        expect(DEFAULT_RENDER_CONFIG.roomStyles[type]!.fillOpacity).toBeDefined();
      }
    });

    it('has wall styles for all WallType values', () => {
      const wallTypes = Object.values(WallType);
      for (const type of wallTypes) {
        expect(DEFAULT_RENDER_CONFIG.wallStyles[type]).toBeDefined();
        expect(DEFAULT_RENDER_CONFIG.wallStyles[type]!.fill).toBeDefined();
        expect(DEFAULT_RENDER_CONFIG.wallStyles[type]!.stroke).toBeDefined();
        expect(DEFAULT_RENDER_CONFIG.wallStyles[type]!.strokeWidth).toBeDefined();
      }
    });
  });

  // ─── Mutation Safety ────────────────────────────────────────────────────

  describe('mutation safety', () => {
    it('DEFAULT_RENDER_CONFIG is frozen at top level', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG)).toBe(true);
    });

    it('layers object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.layers)).toBe(true);
    });

    it('wall styles object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.wallStyles)).toBe(true);
    });

    it('room styles object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.roomStyles)).toBe(true);
    });

    it('door style object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.doorStyle)).toBe(true);
    });

    it('window style object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.windowStyle)).toBe(true);
    });

    it('column style object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.columnStyle)).toBe(true);
    });

    it('dimension style object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.dimensionStyle)).toBe(true);
    });

    it('grid style object is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RENDER_CONFIG.gridStyle)).toBe(true);
    });

    it('cannot mutate top-level properties', () => {
      expect(() => {
        (DEFAULT_RENDER_CONFIG as any).showGrid = false;
      }).toThrow();
    });
  });

  // ─── mergeConfig ────────────────────────────────────────────────────────

  describe('mergeConfig', () => {
    it('returns a frozen config', () => {
      const config = mergeConfig({});
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('returns defaults when given empty overrides', () => {
      const config = mergeConfig({});
      expect(config.showDimensions).toBe(DEFAULT_RENDER_CONFIG.showDimensions);
      expect(config.fontFamily).toBe(DEFAULT_RENDER_CONFIG.fontFamily);
      expect(config.displayUnit).toBe(DEFAULT_RENDER_CONFIG.displayUnit);
      expect(config.gridSpacing).toBe(DEFAULT_RENDER_CONFIG.gridSpacing);
    });

    it('overrides display options', () => {
      const config = mergeConfig({
        showGrid: false,
        showDimensions: false,
        showTitleBlock: true,
      });
      expect(config.showGrid).toBe(false);
      expect(config.showDimensions).toBe(false);
      expect(config.showTitleBlock).toBe(true);
      // Non-overridden values remain default
      expect(config.showRoomLabels).toBe(true);
      expect(config.showNorthArrow).toBe(true);
    });

    it('overrides font family', () => {
      const config = mergeConfig({ fontFamily: 'Roboto, sans-serif' });
      expect(config.fontFamily).toBe('Roboto, sans-serif');
    });

    it('overrides display unit', () => {
      const config = mergeConfig({ displayUnit: 'm' });
      expect(config.displayUnit).toBe('m');
    });

    it('overrides grid spacing', () => {
      const config = mergeConfig({ gridSpacing: 500 });
      expect(config.gridSpacing).toBe(500);
    });

    it('overrides layer visibility partially', () => {
      const config = mergeConfig({
        layers: { [RenderLayer.Grid]: false } as any,
      });
      expect(config.layers[RenderLayer.Grid]).toBe(false);
      // Other layers unchanged
      expect(config.layers[RenderLayer.Walls]).toBe(true);
      expect(config.layers[RenderLayer.Rooms]).toBe(true);
    });

    it('deep-merges wall styles', () => {
      const config = mergeConfig({
        wallStyles: {
          [WallType.External]: { fill: '#000000', stroke: '#000000', strokeWidth: 1 },
        },
      });
      // External wall style overridden
      expect(config.wallStyles[WallType.External]!.fill).toBe('#000000');
      // Internal wall style unchanged
      expect(config.wallStyles[WallType.Internal]!.fill).toBe(
        DEFAULT_RENDER_CONFIG.wallStyles[WallType.Internal]!.fill,
      );
    });

    it('deep-merges room styles', () => {
      const config = mergeConfig({
        roomStyles: {
          [RoomType.Bedroom]: { fill: '#AABBCC', fillOpacity: 0.8 },
        },
      });
      expect(config.roomStyles[RoomType.Bedroom]!.fill).toBe('#AABBCC');
      expect(config.roomStyles[RoomType.Bedroom]!.fillOpacity).toBe(0.8);
      // Other room styles unchanged
      expect(config.roomStyles[RoomType.Kitchen]!.fill).toBe(
        DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Kitchen]!.fill,
      );
    });

    it('merges door style', () => {
      const config = mergeConfig({ doorStyle: { stroke: '#ff0000' } });
      expect(config.doorStyle.stroke).toBe('#ff0000');
      // Non-overridden fields preserved
      expect(config.doorStyle.strokeWidth).toBe(DEFAULT_RENDER_CONFIG.doorStyle.strokeWidth);
    });

    it('merges window style', () => {
      const config = mergeConfig({ windowStyle: { strokeWidth: 2 } });
      expect(config.windowStyle.strokeWidth).toBe(2);
      expect(config.windowStyle.stroke).toBe(DEFAULT_RENDER_CONFIG.windowStyle.stroke);
    });

    it('merges dimension style', () => {
      const config = mergeConfig({ dimensionStyle: { fontSize: 12 } });
      expect(config.dimensionStyle.fontSize).toBe(12);
      expect(config.dimensionStyle.lineColor).toBe(DEFAULT_RENDER_CONFIG.dimensionStyle.lineColor);
    });

    it('does not mutate DEFAULT_RENDER_CONFIG', () => {
      const originalFont = DEFAULT_RENDER_CONFIG.fontFamily;
      mergeConfig({ fontFamily: 'Changed Font' });
      expect(DEFAULT_RENDER_CONFIG.fontFamily).toBe(originalFont);
    });

    it('does not mutate input overrides', () => {
      const overrides: DeepPartial<RenderConfig> = { showGrid: false };
      const original = { ...overrides };
      mergeConfig(overrides);
      expect(overrides).toEqual(original);
    });
  });

  // ─── resolveConfig ──────────────────────────────────────────────────────

  describe('resolveConfig', () => {
    it('returns DEFAULT_RENDER_CONFIG when called with no argument', () => {
      const config = resolveConfig();
      expect(config).toBe(DEFAULT_RENDER_CONFIG);
    });

    it('returns DEFAULT_RENDER_CONFIG when called with undefined', () => {
      const config = resolveConfig(undefined);
      expect(config).toBe(DEFAULT_RENDER_CONFIG);
    });

    it('returns a full config directly if all keys are present', () => {
      const fullConfig = mergeConfig({ showGrid: false });
      const resolved = resolveConfig(fullConfig);
      expect(resolved.showGrid).toBe(false);
    });

    it('merges partial overrides into defaults', () => {
      const config = resolveConfig({ displayUnit: 'm' } as DeepPartial<RenderConfig>);
      expect(config.displayUnit).toBe('m');
      expect(config.fontFamily).toBe('Inter, Arial, sans-serif');
    });
  });

  // ─── Unit Formatting ────────────────────────────────────────────────────

  describe('formatLength', () => {
    it('formats in mm', () => {
      expect(formatLength(3048, 'mm')).toBe('3048 mm');
    });

    it('formats in meters', () => {
      expect(formatLength(3048, 'm')).toBe('3.0 m');
    });

    it('formats in feet', () => {
      expect(formatLength(3048, 'ft')).toBe("10.0'");
    });

    it('rounds mm values', () => {
      expect(formatLength(3048.7, 'mm')).toBe('3049 mm');
    });
  });

  describe('formatArea', () => {
    it('formats in sq mm', () => {
      expect(formatArea(1_000_000, 'mm')).toBe('1000000 sq mm');
    });

    it('formats in sq m', () => {
      expect(formatArea(1_000_000, 'm')).toBe('1.0 sq m');
    });

    it('formats in sq ft', () => {
      expect(formatArea(929_030, 'ft')).toBe('10.0 sq ft');
    });
  });

  // ─── Backward Compatibility ─────────────────────────────────────────────

  describe('backward compatibility', () => {
    it('default room colors match existing ROOM_COLORS', () => {
      // Verify the critical colors match what the current renderer uses
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Bedroom]!.fill).toBe('#E3F2FD');
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Bathroom]!.fill).toBe('#E8F5E9');
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Kitchen]!.fill).toBe('#FFF3E0');
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Living]!.fill).toBe('#F3E5F5');
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Dining]!.fill).toBe('#FFFDE7');
      expect(DEFAULT_RENDER_CONFIG.roomStyles[RoomType.Corridor]!.fill).toBe('#ECEFF1');
    });

    it('default room fill opacity is 0.6', () => {
      for (const style of Object.values(DEFAULT_RENDER_CONFIG.roomStyles)) {
        expect(style.fillOpacity).toBe(0.6);
      }
    });

    it('default wall style colors match existing WALL_STYLES', () => {
      expect(DEFAULT_RENDER_CONFIG.wallStyles[WallType.External]!.fill).toBe('#1a1a1a');
      expect(DEFAULT_RENDER_CONFIG.wallStyles[WallType.Internal]!.fill).toBe('#333333');
      expect(DEFAULT_RENDER_CONFIG.wallStyles[WallType.Partition]!.fill).toBe('#666666');
    });

    it('default door style color matches existing', () => {
      expect(DEFAULT_RENDER_CONFIG.doorStyle.stroke).toBe('#0066cc');
    });

    it('default window style color matches existing', () => {
      expect(DEFAULT_RENDER_CONFIG.windowStyle.stroke).toBe('#4488cc');
    });

    it('default grid spacing is 1000mm', () => {
      expect(DEFAULT_RENDER_CONFIG.gridSpacing).toBe(1000);
    });
  });
});
