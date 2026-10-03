import { type CvContent, CV_LIMITS } from '@cv-builder/shared';

const WORDS =
  'designed reliable services reduced latency mentored engineers shipped features across payments billing and checkout'.split(
    ' ',
  );

/** Plain words up to `length` characters, varied by `seed`. */
export function words(length: number, seed: number): string {
  let text = '';
  for (let index = seed; text.length < length; index += 1) {
    text += `${text ? ' ' : ''}${WORDS[index % WORDS.length]}`;
  }
  return text.slice(0, length).trim();
}

/** The unique marker that starts each achievement of `largestCv`, to find it again. */
export const achievementMarker = (role: number, bullet: number) => `R${role}B${bullet}X`;

/**
 * The largest CV the schema allows, built on `base`: every list full and every field at its
 * length limit, with a unique marker on every achievement, paragraphs made of line breaks and a
 * URL as long as allowed.
 */
export function largestCv(base: CvContent): CvContent {
  return {
    ...base,
    contact: {
      ...base.contact,
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
        text: `${achievementMarker(role, bullet)} ${words(CV_LIMITS.bullet - 12, role + bullet)}`,
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
