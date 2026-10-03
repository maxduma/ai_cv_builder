import { type CvContent, CV_LIMITS } from '@cv-builder/shared';
import { extractLinks, extractText, extractTextItems, getDocumentProxy, getMeta } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { breakLongWord, countPdfPages, createReactPdfCvRenderer } from './react-pdf-cv-renderer';

/** A4 in points, and the page's margins (56/64/52 px of the design at 96 dpi). */
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 42, side: 48, bottom: 39 };
const HEADINGS = ['SUMMARY', 'EXPERIENCE', 'EDUCATION', 'SKILLS'];

const CV: CvContent = {
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Senior Backend Engineer',
    email: 'alex.morgan@example.com',
    phone: '+351 912 345 678',
    location: 'Lisbon, Portugal',
    workSetup: 'Open to remote roles',
    links: [{ id: 'link-1', label: 'LinkedIn', url: 'linkedin.com/in/alexmorgan' }],
  },
  summary: 'Backend engineer with 7 years of experience building payment platforms.',
  experience: [
    {
      id: 'role-1',
      title: 'Senior Backend Engineer',
      company: 'Northpay',
      location: 'Lisbon',
      start: 'Mar 2021',
      end: '',
      current: true,
      bullets: [
        { id: 'b-1', text: 'Lead a team of 5 engineers owning the payments API.' },
        { id: 'b-2', text: 'Moved billing to event-driven services on Kafka.' },
      ],
    },
  ],
  education: [
    {
      id: 'edu-1',
      degree: 'BSc in Computer Science',
      school: 'University of Lisbon',
      location: '',
      start: '2012',
      end: '2016',
      details: 'Thesis on distributed payments.',
    },
  ],
  skills: [
    { id: 'skill-1', name: 'Go' },
    { id: 'skill-2', name: 'PostgreSQL' },
  ],
};

const WORDS =
  'designed reliable services reduced latency mentored engineers shipped features across payments billing and checkout'.split(
    ' ',
  );

/** Plain words up to `length` characters, varied by `seed`. */
function words(length: number, seed: number): string {
  let text = '';
  for (let index = seed; text.length < length; index += 1) {
    text += `${text ? ' ' : ''}${WORDS[index % WORDS.length]}`;
  }
  return text.slice(0, length).trim();
}

/**
 * The largest CV the schema allows, with unique markers to find every achievement, paragraphs
 * made of line breaks and a URL as long as allowed.
 */
function largestCv(): CvContent {
  const marker = (role: number, bullet: number) => `R${role}B${bullet}X`;
  return {
    ...CV,
    contact: {
      ...CV.contact,
      links: Array.from({ length: CV_LIMITS.links }, (_, index) => ({
        id: `link-${index}`,
        label: 'Website',
        url:
          index === 0
            ? `https://example.com/${'a-long-path-segment/'.repeat(20)}`.slice(0, CV_LIMITS.linkUrl)
            : `site${index}.example.com/profile`,
      })),
    },
    summary: Array.from({ length: 60 }, (_, line) => words(30, line))
      .join('\n')
      .slice(0, CV_LIMITS.summary),
    experience: Array.from({ length: CV_LIMITS.experience }, (_, role) => ({
      id: `role-${role}`,
      title: words(CV_LIMITS.title, role),
      company: words(CV_LIMITS.company, role + 1),
      location: words(CV_LIMITS.location, role + 2),
      start: 'January 2000',
      end: 'December 2024',
      current: false,
      bullets: Array.from({ length: CV_LIMITS.bullets }, (_, bullet) => ({
        id: `role-${role}-bullet-${bullet}`,
        text: `${marker(role, bullet)} ${words(CV_LIMITS.bullet - 12, role + bullet)}`,
      })),
    })),
    education: Array.from({ length: CV_LIMITS.education }, (_, entry) => ({
      id: `edu-${entry}`,
      degree: words(CV_LIMITS.degree, entry),
      school: words(CV_LIMITS.school, entry + 1),
      location: words(CV_LIMITS.location, entry + 2),
      start: '2000',
      end: '2004',
      details: Array.from({ length: 250 }, (_, line) => `d${line}`)
        .join('\n')
        .slice(0, CV_LIMITS.details),
    })),
    skills: Array.from({ length: CV_LIMITS.skills }, (_, skill) => ({
      id: `skill-${skill}`,
      name: `S${skill} ${words(CV_LIMITS.skill - 5, skill)}`.slice(0, CV_LIMITS.skill),
    })),
  };
}

const renderer = createReactPdfCvRenderer();

/** pdf.js takes over the bytes it reads, so each read gets its own copy. */
const copy = (pdf: Uint8Array) => new Uint8Array(pdf);

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const { text } = await extractText(copy(pdf), { mergePages: false });
  return text;
}

describe('React-PDF CV renderer', () => {
  it('renders an A4 PDF with the fonts embedded', async () => {
    const pdf = await renderer.render(CV);

    expect(new TextDecoder().decode(pdf.data.slice(0, 5))).toBe('%PDF-');
    expect(pdf.pageCount).toBe(1);
    const document = await getDocumentProxy(copy(pdf.data));
    const page = await document.getPage(1);
    expect(page.view.map((value) => Number(value.toFixed(2)))).toEqual([0, 0, A4.width, A4.height]);
    await document.loadingTask.destroy();

    const bytes = Buffer.from(pdf.data).toString('latin1');
    expect(bytes).toContain('/FontFile2');
    expect(bytes).toMatch(/\/BaseFont \/[A-Z]{6}\+Geist-Regular/);
    expect(bytes).toMatch(/\/BaseFont \/[A-Z]{6}\+Geist-SemiBold/);
  });

  it('prints every section, in order, as selectable text', async () => {
    const pdf = await renderer.render(CV);
    const [text = ''] = await pageTexts(pdf.data);

    const expected = [
      'Alex Morgan',
      'Senior Backend Engineer',
      'alex.morgan@example.com',
      '+351 912 345 678',
      'Lisbon, Portugal',
      'linkedin.com/in/alexmorgan',
      'Open to remote roles',
      'SUMMARY',
      'Backend engineer with 7 years',
      'EXPERIENCE',
      'Mar 2021 – Present',
      'Northpay',
      'Lead a team of 5 engineers owning the payments API.',
      'Moved billing to event-driven services on Kafka.',
      'EDUCATION',
      'BSc in Computer Science',
      '2012 – 2016',
      'University of Lisbon',
      'Thesis on distributed payments.',
      'SKILLS',
      'Go',
      'PostgreSQL',
    ];
    let from = 0;
    for (const part of expected) {
      const at = text.indexOf(part, from);
      expect(at, `"${part}" after position ${from}`).toBeGreaterThanOrEqual(0);
      from = at + part.length;
    }
  });

  it('leaves empty sections out', async () => {
    const pdf = await renderer.render({ ...CV, summary: ' ', education: [], skills: [] });
    const [text = ''] = await pageTexts(pdf.data);

    expect(text).toContain('EXPERIENCE');
    expect(text).not.toContain('SUMMARY');
    expect(text).not.toContain('EDUCATION');
    expect(text).not.toContain('SKILLS');
  });

  it('links a full email address and web addresses', async () => {
    const pdf = await renderer.render(CV);
    expect((await extractLinks(copy(pdf.data))).links).toEqual([
      'mailto:alex.morgan@example.com',
      'https://linkedin.com/in/alexmorgan',
    ]);

    const partial = await renderer.render({ ...CV, contact: { ...CV.contact, email: 'alex@' } });
    expect((await extractLinks(copy(partial.data))).links).toEqual([
      'https://linkedin.com/in/alexmorgan',
    ]);
  });

  it('names the document after the person', async () => {
    const pdf = await renderer.render(CV);
    const { info } = await getMeta(copy(pdf.data));

    expect(info).toMatchObject({
      Title: 'Alex Morgan — CV',
      Author: 'Alex Morgan',
      Subject: 'Senior Backend Engineer',
      Creator: 'CV Builder',
      Producer: 'CV Builder',
    });
  });

  it('keeps Cyrillic text', async () => {
    const pdf = await renderer.render({
      ...CV,
      contact: { ...CV.contact, firstName: 'Олена', lastName: 'Ґудзь' },
      summary: 'Її досвід охоплює є-комерцію та платежі.',
    });
    const [text = ''] = await pageTexts(pdf.data);

    expect(text).toContain('Олена Ґудзь');
    expect(text).toContain('Її досвід охоплює є-комерцію та платежі.');
  });

  it(
    'paginates the largest CV the limits allow without losing or cutting anything',
    { timeout: 60_000 },
    async () => {
      const content = largestCv();
      const started = performance.now();
      const pdf = await renderer.render(content);
      const elapsed = performance.now() - started;

      expect(pdf.pageCount).toBeGreaterThan(1);
      expect(pdf.pageCount).toBe(await countPdfPages(pdf.data));
      // About 3 s on a laptop; this only catches a render that has become dramatically slower.
      expect(elapsed).toBeLessThan(20_000);

      // Every achievement once, in order.
      const text = (await pageTexts(pdf.data)).join('\n');
      let from = 0;
      for (const role of content.experience) {
        for (const bullet of role.bullets) {
          const marker = bullet.text.split(' ')[0]!;
          const at = text.indexOf(marker, from);
          expect(at, marker).toBeGreaterThanOrEqual(0);
          expect(text.indexOf(marker, at + 1), `${marker} twice`).toBe(-1);
          from = at;
        }
      }
      for (const skill of content.skills) {
        expect(text).toContain(skill.name.split(' ')[0]!);
      }

      const { items } = await extractTextItems(copy(pdf.data));
      items.forEach((page, index) => {
        const printed = page.filter((item) => item.str.trim());
        // Nothing past the right margin or into the top and bottom margins.
        for (const item of printed) {
          expect(item.x + item.width, `page ${index + 1}: "${item.str}"`).toBeLessThanOrEqual(
            A4.width - MARGIN.side + 0.5,
          );
          expect(item.y, `page ${index + 1}: "${item.str}"`).toBeGreaterThanOrEqual(MARGIN.bottom);
          expect(item.y + item.height).toBeLessThanOrEqual(A4.height - MARGIN.top + 0.5);
        }
        // A heading never ends a page.
        if (index < items.length - 1) {
          const last = printed.reduce((lowest, item) => (item.y < lowest.y ? item : lowest));
          expect(HEADINGS, `page ${index + 1} ends with "${last.str}"`).not.toContain(last.str);
        }
      });
    },
  );
});

describe('breakLongWord', () => {
  it('keeps ordinary words whole', () => {
    expect(breakLongWord('engineering')).toEqual(['engineering']);
    expect(breakLongWord('x'.repeat(59))).toEqual(['x'.repeat(59)]);
  });

  it('cuts a very long word into short pieces, after URL punctuation where it can', () => {
    const url = `https://example.com/${'segment/'.repeat(10)}end`;
    const pieces = breakLongWord(url);

    expect(pieces.join('')).toBe(url);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(30);
    for (const piece of pieces.slice(0, -1)) expect(piece).toMatch(/[/.\-_?&=]$/);
    expect(breakLongWord('x'.repeat(65))).toEqual(['x'.repeat(30), 'x'.repeat(30), 'x'.repeat(5)]);
  });
});
