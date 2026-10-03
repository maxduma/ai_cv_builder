import type { CvContent } from '@cv-builder/shared';

/** Line units that fill one A4 page of the CV template (the design's calibration). */
const LINES_PER_PAGE = 50;
/** The name, headline, contact line and rule above the first section. */
const HEADER_LINES = 7;
/** A section's heading and the space above it. */
const SECTION_LINES = 2.2;
const ROLE_LINES = 2.6;
const BULLET_GAP_LINES = 0.15;
const EDUCATION_LINES = 2.4;
const SKILL_ROW_LINES = 1.1;
const SKILLS_PER_ROW = 8;
/** Characters per wrapped line, at the page's text size and measure. */
const SUMMARY_CHARS_PER_LINE = 100;
const BULLET_CHARS_PER_LINE = 98;

/** How many lines a text wraps to: at least one, even when it is short. */
function lines(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.trim().length / charsPerLine));
}

/**
 * How long the CV runs on A4, from the design's line-count heuristic (`edEstimate`) rather than
 * by measuring the rendered page, so it is cheap enough to run on every keystroke and works
 * where the preview isn't shown (the phone layout has none). `pages` is how many pages the
 * content needs; `fill` is the share of the first page it uses, from 0 to 1.
 *
 * Every section is counted even when empty, as the editor's preview shows a hint in its place.
 */
export function estimatePages(content: CvContent): { pages: number; fill: number } {
  let units = HEADER_LINES;

  units += SECTION_LINES;
  units += content.summary.trim() ? lines(content.summary, SUMMARY_CHARS_PER_LINE) : 1;

  units += SECTION_LINES;
  for (const role of content.experience) {
    units += ROLE_LINES;
    for (const bullet of role.bullets) {
      if (bullet.text.trim()) units += lines(bullet.text, BULLET_CHARS_PER_LINE) + BULLET_GAP_LINES;
    }
  }

  units += SECTION_LINES;
  for (const entry of content.education) {
    units += EDUCATION_LINES + (entry.details.trim() ? 1 : 0);
  }

  // Blank skills aren't printed, so they take no room.
  const skills = content.skills.filter((skill) => skill.name.trim()).length;
  units += SECTION_LINES + Math.max(1, Math.ceil(skills / SKILLS_PER_ROW)) * SKILL_ROW_LINES;

  const ratio = units / LINES_PER_PAGE;
  return { pages: Math.max(1, Math.ceil(ratio)), fill: Math.min(1, ratio) };
}

/** "A4 · 1 page", "A4 · 2 pages": the page count beside the preview and in the phone's save bar. */
export function pageLabel(pages: number): string {
  return `A4 · ${pages} ${pages === 1 ? 'page' : 'pages'}`;
}
