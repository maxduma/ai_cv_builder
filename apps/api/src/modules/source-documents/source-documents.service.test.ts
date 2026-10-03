import { describe, expect, it } from 'vitest';
import { cleanFileName, hasPdfSignature } from './source-documents.service';

describe('cleanFileName', () => {
  it.each([
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Users\\alex\\CV.pdf', 'CV.pdf'],
    ['a\u0000b\nc.pdf', 'abc.pdf'],
    // C1 controls, and the bidi override that would show "CV‮fdp.exe" as "CVexe.pdf".
    ['a\u0085b\u009bc.pdf', 'abc.pdf'],
    ['CV\u202efdp.exe', 'CVfdp.exe'],
    ['  CV.pdf  ', 'CV.pdf'],
    ['   ', 'CV.pdf'],
    ['\u0000', 'CV.pdf'],
  ])('cleans %j to %j', (name, cleaned) => {
    expect(cleanFileName(name)).toBe(cleaned);
  });

  it('keeps names in any script, emoji sequences included', () => {
    expect(cleanFileName('Résumé — Олекса 👨‍👩‍👧.pdf')).toBe('Résumé — Олекса 👨‍👩‍👧.pdf');
  });

  it('cuts a long name between characters, never through one', () => {
    const cleaned = cleanFileName('😀'.repeat(300));

    expect(Array.from(cleaned)).toHaveLength(255);
    // No half of a surrogate pair left at the end.
    expect(cleaned.at(-1)).toBe('\uDE00');
    expect(cleaned.at(-2)).toBe('\uD83D');
  });
});

describe('hasPdfSignature', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('finds the header where PDF readers look for it, in the first 1024 bytes', () => {
    expect(hasPdfSignature(bytes('%PDF-1.7\n'))).toBe(true);
    expect(hasPdfSignature(bytes(`${' '.repeat(500)}%PDF-1.4`))).toBe(true);
    expect(hasPdfSignature(bytes(`${' '.repeat(1_100)}%PDF-1.4`))).toBe(false);
    expect(hasPdfSignature(bytes('MZ not a PDF'))).toBe(false);
  });

  it('reads a view into a larger buffer, as uploads arrive', () => {
    const buffer = Buffer.from(`${'x'.repeat(2_000)}%PDF-1.7 body`);

    expect(hasPdfSignature(buffer.subarray(2_000))).toBe(true);
    expect(hasPdfSignature(buffer.subarray(0, 1_000))).toBe(false);
  });
});
