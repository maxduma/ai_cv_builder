import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCvView } from '@cv-builder/shared';
import { Font, renderToBuffer } from '@react-pdf/renderer';
import { getDocumentProxy } from 'unpdf';
import { CvPdfDocument, PDF_FONT_FAMILY } from './cv-pdf-document';
import type { CvPdfRenderer } from './cv-pdf-renderer';

/** A plain path: react-pdf would take a `file://` string for a URL and try to fetch it. */
const FONT_DIR = fileURLToPath(new URL('./fonts/', import.meta.url));

/** Words at least this long (in practice URLs) get break points, so they can't overflow a line. */
const LONG_WORD = 60;
const LONG_WORD_PIECE = 30;
/** Not after `-`: React-PDF adds a hyphen at the break, which would print `--`. */
const URL_BREAK_AFTER = ['/', '.', '_', '?', '&', '='];

/**
 * React-PDF hyphenates English words by default; the page doesn't (nor does the HTML preview), so
 * a word stays whole. Only a very long one is cut into pieces, preferably after URL punctuation,
 * as the alternative is running past the margin. React-PDF draws a hyphen where it breaks one.
 */
export function breakLongWord(word: string): string[] {
  if (word.length < LONG_WORD) return [word];
  const pieces: string[] = [];
  let rest = word;
  while (rest.length > LONG_WORD_PIECE) {
    const window = rest.slice(0, LONG_WORD_PIECE);
    const punctuation = Math.max(...URL_BREAK_AFTER.map((mark) => window.lastIndexOf(mark)));
    const end = punctuation >= LONG_WORD_PIECE / 2 ? punctuation + 1 : LONG_WORD_PIECE;
    pieces.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  pieces.push(rest);
  return pieces;
}

let fontsRegistered = false;

/** React-PDF's font list is global; registering twice would only add duplicates. */
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: join(FONT_DIR, 'Geist-Regular.ttf'), fontWeight: 400 },
      { src: join(FONT_DIR, 'Geist-Medium.ttf'), fontWeight: 500 },
      { src: join(FONT_DIR, 'Geist-SemiBold.ttf'), fontWeight: 600 },
      { src: join(FONT_DIR, 'Geist-Bold.ttf'), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(breakLongWord);
  fontsRegistered = true;
}

const FONT_WEIGHTS = [400, 500, 600, 700];

/**
 * The letters CVs are written in: Basic Latin to Latin Extended-B, Cyrillic with its supplement,
 * and Latin Extended Additional. Ligature glyphs (U+FB00 and up: ﬁ, ﬂ) are left out on purpose,
 * see `primeGlyphCaches`.
 */
const PRIMED_RANGES: [from: number, to: number][] = [
  [0x20, 0x24f],
  [0x400, 0x52f],
  [0x1e00, 0x1eff],
];

let glyphCachesPrimed: Promise<void> | null = null;

/**
 * Gives the letters of the fonts a glyph of their own, with their own text mapping, before any PDF
 * is drawn. React-PDF keeps one fontkit font per weight for as long as the process lives, and
 * fontkit caches each glyph with the code points of whoever asked for it first. The first PDF that
 * prints an accented letter (ü, ž, Ş) asks for its base letter as a part of the composite glyph,
 * with no code point, so "u" is cached as a glyph that stands for no character: every later PDF
 * then lacks the text mapping for "u", and the letter copies as a control character or is lost to
 * text extraction. Asking for each letter first rules that out.
 *
 * Only letters, never ligatures: a glyph that the font builds from several characters ("fi" in
 * "first") must be cached by the layout itself, with all of its code points. A ligature glyph
 * cached here with one code point (ﬁ) would make the layout count a character too few after every
 * "fi", and lines would break in the middle of words.
 */
function primeGlyphCaches(): Promise<void> {
  glyphCachesPrimed ??= (async () => {
    for (const fontWeight of FONT_WEIGHTS) {
      const descriptor = { fontFamily: PDF_FONT_FAMILY, fontWeight, fontStyle: 'normal' } as const;
      await Font.load(descriptor);
      const font = Font.getFont(descriptor).data;
      if (!font) throw new Error(`The PDF font (weight ${fontWeight}) did not load`);
      for (const codePoint of font.characterSet) {
        if (PRIMED_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to)) {
          font.glyphForCodePoint(codePoint);
        }
      }
    }
  })().catch((error: unknown) => {
    // Try again with the next PDF instead of failing every one from now on.
    glyphCachesPrimed = null;
    throw error;
  });
  return glyphCachesPrimed;
}

/**
 * How many pages a PDF has. pdf.js may take over the buffer it is given and rejects Node Buffers
 * (which `renderToBuffer` returns), so it reads a plain copy.
 */
export async function countPdfPages(pdf: Uint8Array): Promise<number> {
  const document = await getDocumentProxy(new Uint8Array(pdf), { verbosity: 0 });
  try {
    return document.numPages;
  } finally {
    await document.loadingTask.destroy();
  }
}

/**
 * Renders CVs with React-PDF: the design's CV template with Geist embedded (Latin, Cyrillic),
 * A4 pages and real text. Rendering is CPU work on this thread; see docs/architecture.md (PDF export) for timings.
 */
export function createReactPdfCvRenderer(): CvPdfRenderer {
  registerFonts();
  return {
    async render(content) {
      await primeGlyphCaches();
      const data = await renderToBuffer(<CvPdfDocument view={toCvView(content)} />);
      return { data, pageCount: await countPdfPages(data) };
    },
  };
}
