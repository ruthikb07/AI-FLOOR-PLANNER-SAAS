import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { create, type Font, type GlyphRun } from 'fontkit';
import { ExportError } from './export-selection.js';

const asciiOnly = /^[\x20-\x7e]*$/;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const shapingControl = /^[\u200c\u200d]$/u;
const families = [
  'NotoSans', 'NotoSansDevanagari', 'NotoSansBengali', 'NotoSansGujarati', 'NotoSansTamil',
] as const;

type Family = typeof families[number];
const fontCache = new Map<Family, { font: Font; bytes: Buffer }>();

function loadFont(family: Family) {
  const cached = fontCache.get(family);
  if (cached) return cached;
  // Service in src/services or dist/services, or the bundled server in dist-server.
  const filename = 'assets/pdf-fonts/' + family + '-Regular.ttf';
  let bytes: Buffer;
  try {
    bytes = readFileSync(new URL('../' + filename, import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    bytes = readFileSync(new URL('../../' + filename, import.meta.url));
  }
  const font = create(bytes);
  if (!('layout' in font)) throw new Error('Expected a standalone PDF drawing font');
  const loaded = { font, bytes };
  fontCache.set(family, loaded);
  return loaded;
}

function unicodeHex(value: string): string {
  return Buffer.from(value, 'utf16le').swap16().toString('hex').toUpperCase();
}

export function pdfTextString(value: string): string {
  return asciiOnly.test(value) ? '(' + value.replace(/([\\()])/g, '\\$1') + ')' : '<FEFF' + unicodeHex(value) + '>';
}

function glyphHex(id: number): string {
  return id.toString(16).toUpperCase().padStart(4, '0');
}

function pdfStream(dictionary: string, stream: string): string {
  return '<< /Length ' + Buffer.byteLength(stream) + ' ' + dictionary + ' >>\nstream\n' + stream + 'endstream';
}

function textUnavailable(text: string): never {
  const point = text.codePointAt(0)?.toString(16).toUpperCase();
  throw new ExportError('PDF_TEXT_FONT_UNAVAILABLE',
    'No supported PDF drawing font or shaping engine for the label at U+' + point + '.', 422);
}

interface ShapedRun {
  readonly family: Family;
  readonly run: GlyphRun;
}

export class PdfDrawingText {
  private readonly usedGlyphs = new Map<Family, Map<number, readonly number[]>>();
  private readonly labels = new Map<string, readonly ShapedRun[]>();

  private shape(value: string): readonly ShapedRun[] {
    const cached = this.labels.get(value);
    if (cached) return cached;
    const groups: { family: Family; text: string }[] = [];
    for (const { segment } of graphemes.segment(value)) {
      if (/[\p{Control}\p{Surrogate}\u202A-\u202E\u2066-\u2069]/u.test(segment)) textUnavailable(segment);
      const family = families.find(name => {
        const { font } = loadFont(name);
        return [...segment].every(char => shapingControl.test(char) || font.hasGlyphForCodePoint(char.codePointAt(0)!));
      });
      if (!family) textUnavailable(segment);
      const previous = groups.at(-1);
      if (previous?.family === family) previous.text += segment;
      else groups.push({ family, text: segment });
    }
    const runs = groups.map(({ family, text }) => {
      const run = loadFont(family).font.layout(text);
      if (run.direction !== 'ltr' || run.glyphs.some(glyph => glyph.id === 0)) textUnavailable(text);
      return { family, run };
    });
    this.labels.set(value, runs);
    return runs;
  }

  width(value: string, size: number): number {
    // Keep the conservative existing placement box for the standard drawing font.
    if (asciiOnly.test(value)) return Math.max(1, value.length) * size * 0.7;
    return this.shape(value).reduce((width, { family, run }) =>
      width + run.advanceWidth * size / loadFont(family).font.unitsPerEm, 0);
  }

  draw(value: string, size: number, x: number, y: number): string {
    if (asciiOnly.test(value)) {
      const number = (input: number) => String(Number(input.toFixed(4)));
      return 'BT /F1 ' + number(size) + ' Tf ' + number(x) + ' ' + number(y) + ' Td ' + pdfTextString(value) + ' Tj ET';
    }
    const commands = ['/Span << /ActualText ' + pdfTextString(value) + ' >> BDC'];
    for (const { family, run } of this.shape(value)) {
      let used = this.usedGlyphs.get(family);
      if (!used) {
        used = new Map();
        this.usedGlyphs.set(family, used);
      }
      const scale = size / loadFont(family).font.unitsPerEm;
      commands.push('BT /' + family + ' ' + size.toFixed(4) + ' Tf');
      run.glyphs.forEach((glyph, index) => {
        const position = run.positions[index]!;
        if (glyph.codePoints.length && !used.has(glyph.id)) used.set(glyph.id, glyph.codePoints);
        commands.push('1 0 0 1 ' + (x + position.xOffset * scale).toFixed(4) + ' '
          + (y + position.yOffset * scale).toFixed(4) + ' Tm <' + glyphHex(glyph.id) + '> Tj');
        x += position.xAdvance * scale;
        y += position.yAdvance * scale;
      });
      commands.push('ET');
    }
    commands.push('EMC');
    return commands.join('\n');
  }

  embedFonts(objects: string[]): string {
    const add = (object: string) => objects.push(object) + ' 0 R';
    const resources = ['/F1 3 0 R'];
    for (const [family, seen] of this.usedGlyphs) {
      const { font, bytes } = loadFont(family);
      const name = '/' + font.postscriptName;
      const units = (value: number) => Math.round(value * 1000 / font.unitsPerEm);
      const fontFile = add(pdfStream('/Length1 ' + bytes.length + ' /Filter [/ASCIIHexDecode /FlateDecode]',
        deflateSync(bytes).toString('hex') + '>\n'));
      const bbox = font.bbox;
      const bounds = [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map(units).join(' ');
      const descriptor = add('<< /Type /FontDescriptor /FontName ' + name + ' /Flags 4 /FontBBox [' + bounds
        + '] /ItalicAngle ' + font.italicAngle + ' /Ascent ' + units(font.ascent) + ' /Descent ' + units(font.descent)
        + ' /CapHeight ' + units(font.capHeight || font.ascent) + ' /StemV 80 /FontFile2 ' + fontFile + ' >>');
      const widths = [...seen.keys()].sort((a, b) => a - b)
        .map(id => id + ' [' + units(font.getGlyph(id).advanceWidth) + ']').join(' ');
      const descendant = add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont ' + name
        + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity'
        + ' /FontDescriptor ' + descriptor + ' /W [' + widths + '] >>');
      const cmap = [
        '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /RHUnicode def', '/CMapType 2 def',
        '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
      ];
      const mappings = [...seen].map(([glyph, codePoints]) =>
        '<' + glyphHex(glyph) + '> <' + unicodeHex(String.fromCodePoint(...codePoints)) + '>');
      for (let offset = 0; offset < mappings.length; offset += 100) {
        const batch = mappings.slice(offset, offset + 100);
        cmap.push(batch.length + ' beginbfchar', ...batch, 'endbfchar');
      }
      cmap.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end', '');
      const toUnicode = add(pdfStream('', cmap.join('\n')));
      const reference = add('<< /Type /Font /Subtype /Type0 /BaseFont ' + name + ' /Encoding /Identity-H'
        + ' /DescendantFonts [' + descendant + '] /ToUnicode ' + toUnicode + ' >>');
      resources.push('/' + family + ' ' + reference);
    }
    return '<< ' + resources.join(' ') + ' >>';
  }
}
