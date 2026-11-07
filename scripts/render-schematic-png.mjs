import zlib from 'node:zlib';
import fs from 'node:fs';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const table = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  table[i] = c;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcPayload = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcPayload), 0);
  return Buffer.concat([lenBuf, crcPayload, crcBuf]);
}

export function renderSchematicPng512(schematic) {
  const width = 512;
  const height = 512;

  // RGBA buffer: 4 bytes per pixel. Each row has 1 filter byte (0) + width * 4 bytes
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(height * rowSize, 255); // Default white

  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // Filter type 0 (None)
  }

  function setPixel(x, y, r, g, b) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = y * rowSize + 1 + x * 4;
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = 255;
  }

  function drawRect(rx, ry, rw, rh, r, g, b, fillR, fillG, fillB) {
    const x0 = Math.max(0, Math.min(width - 1, Math.round(rx)));
    const y0 = Math.max(0, Math.min(height - 1, Math.round(ry)));
    const x1 = Math.max(0, Math.min(width - 1, Math.round(rx + rw)));
    const y1 = Math.max(0, Math.min(height - 1, Math.round(ry + rh)));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) {
          setPixel(x, y, r, g, b);
        } else if (fillR !== undefined) {
          setPixel(x, y, fillR, fillG, fillB);
        }
      }
    }
  }

  const siteW = schematic?.siteFootprint?.width || 18.288;
  const siteD = schematic?.siteFootprint?.height || 30.48;
  const scale = 460 / Math.max(siteW, siteD);
  const offsetX = 26 + (460 - siteW * scale) / 2;
  const offsetY = 26 + (460 - siteD * scale) / 2;

  const toPx = (mX, mY, mW, mH) => ({
    x: offsetX + mX * scale,
    y: offsetY + mY * scale,
    w: mW * scale,
    h: mH * scale,
  });

  // 1. Draw Building Footprint
  if (schematic?.buildingFootprint) {
    const b = toPx(schematic.buildingFootprint.x, schematic.buildingFootprint.y, schematic.buildingFootprint.width, schematic.buildingFootprint.height);
    drawRect(b.x, b.y, b.w, b.h, 40, 40, 40, 245, 245, 245);
  }

  // 2. Draw Flats
  const flatColors = [
    { r: 224, g: 242, b: 254 }, // light blue (Flat 01 - 2BHK)
    { r: 254, g: 243, b: 199 }, // light amber (Flat 02 - 3BHK)
    { r: 220, g: 252, b: 231 },
    { r: 254, g: 226, b: 226 },
  ];

  if (schematic?.units) {
    schematic.units.forEach((u, i) => {
      const c = flatColors[i % flatColors.length];
      const p = toPx(u.bounds.x, u.bounds.y, u.bounds.width, u.bounds.height);
      drawRect(p.x, p.y, p.w, p.h, 0, 0, 0, c.r, c.g, c.b);

      // Draw rooms inside flat
      if (u.rooms) {
        for (const rm of u.rooms) {
          const rp = toPx(rm.bounds.x, rm.bounds.y, rm.bounds.width, rm.bounds.height);
          drawRect(rp.x, rp.y, rp.w, rp.h, 100, 100, 100);
        }
      }
    });
  }

  // 3. Draw Core
  if (schematic?.core) {
    const cp = toPx(schematic.core.bounds.x, schematic.core.bounds.y, schematic.core.bounds.width, schematic.core.bounds.height);
    drawRect(cp.x, cp.y, cp.w, cp.h, 30, 41, 59, 226, 232, 240); // Slate core

    // Lifts
    if (schematic.core.lifts) {
      for (const lift of schematic.core.lifts) {
        const lp = toPx(lift.bounds.x, lift.bounds.y, lift.bounds.width, lift.bounds.height);
        drawRect(lp.x, lp.y, lp.w, lp.h, 2, 132, 199, 186, 230, 253);
      }
    }

    // Stairs
    if (schematic.core.stairs) {
      for (const stair of schematic.core.stairs) {
        const sp = toPx(stair.bounds.x, stair.bounds.y, stair.bounds.width, stair.bounds.height);
        drawRect(sp.x, sp.y, sp.w, sp.h, 217, 119, 6, 254, 215, 170);
      }
    }
  }

  // Assemble PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const ihdr = makePngChunk('IHDR', ihdrData);
  const idat = makePngChunk('IDAT', zlib.deflateSync(raw));
  const iend = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Test generation
const dummySchematic = {
  siteFootprint: { width: 18.288, height: 30.48 },
  buildingFootprint: { x: 2.5, y: 3.0, width: 13.2, height: 23.0 },
  core: {
    bounds: { x: 6.8, y: 11.0, width: 4.6, height: 7.0 },
    lifts: [
      { bounds: { x: 7.0, y: 11.2, width: 2.0, height: 2.0 } },
      { bounds: { x: 9.2, y: 11.2, width: 2.0, height: 2.0 } },
    ],
    stairs: [
      { bounds: { x: 7.0, y: 14.5, width: 2.0, height: 3.0 } },
      { bounds: { x: 9.2, y: 14.5, width: 2.0, height: 3.0 } },
    ],
  },
  units: [
    {
      bounds: { x: 2.5, y: 3.0, width: 6.6, height: 23.0 },
      rooms: [
        { bounds: { x: 2.6, y: 3.2, width: 4.0, height: 4.0 } },
      ],
    },
    {
      bounds: { x: 9.1, y: 3.0, width: 6.6, height: 23.0 },
      rooms: [
        { bounds: { x: 9.2, y: 3.2, width: 4.0, height: 4.0 } },
      ],
    },
  ],
};

const png = renderSchematicPng512(dummySchematic);
console.log('Generated PNG bytes:', png.length);
fs.writeFileSync('scripts/test_schematic_512.png', png);
