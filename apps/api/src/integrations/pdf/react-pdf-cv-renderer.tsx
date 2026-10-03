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
 * A4 pages and real text. Rendering is CPU work on this thread; see the README for timings.
 */
export function createReactPdfCvRenderer(): CvPdfRenderer {
  registerFonts();
  return {
    async render(content) {
      const data = await renderToBuffer(<CvPdfDocument view={toCvView(content)} />);
      return { data, pageCount: await countPdfPages(data) };
    },
  };
}
