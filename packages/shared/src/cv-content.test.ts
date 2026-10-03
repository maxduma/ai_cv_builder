import { describe, expect, it } from 'vitest';
import {
  type CvContent,
  CvContentSchema,
  contentEditIssues,
  INVALID_EMAIL_MESSAGE,
  savableContent,
} from './cv-content';

const CV: CvContent = {
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: '',
    email: 'alex@example.com',
    phone: '',
    location: '',
    workSetup: '',
    links: [],
  },
  summary: '',
  experience: [],
  education: [],
  skills: [{ id: 'skill-1', name: 'Go' }],
};

const withEmail = (cv: CvContent, email: string): CvContent => ({
  ...cv,
  contact: { ...cv.contact, email },
});

describe('CvContentSchema', () => {
  it('reads content stored before the work setup field existed', () => {
    const stored = JSON.parse(JSON.stringify(CV)) as { contact: Record<string, unknown> };
    delete stored.contact.workSetup;

    expect(CvContentSchema.parse(stored)).toEqual(CV);
  });

  it('rejects U+0000, which PostgreSQL JSONB cannot store', () => {
    const result = CvContentSchema.safeParse({ ...CV, summary: 'Hello\u0000' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['summary']);
  });

  it('rejects ids used twice in a list', () => {
    const result = CvContentSchema.safeParse({
      ...CV,
      skills: [
        { id: 'skill-1', name: 'Go' },
        { id: 'skill-1', name: 'Rust' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['skills', 1, 'id']);
  });

  it('explains limits in words', () => {
    const result = CvContentSchema.safeParse({ ...CV, summary: 'x'.repeat(2_001) });

    expect(result.error?.issues[0]?.message).toBe('Use at most 2000 characters.');
  });
});

describe('contentEditIssues', () => {
  it('checks an email that changed', () => {
    expect(contentEditIssues(CV, withEmail(CV, 'alex@'))).toEqual([
      { path: ['contact', 'email'], message: INVALID_EMAIL_MESSAGE },
    ]);
    expect(contentEditIssues(CV, withEmail(CV, ''))).toEqual([]);
    expect(contentEditIssues(CV, withEmail(CV, 'sam@northpay.io'))).toEqual([]);
  });

  it('leaves a stored value alone, so it never blocks other edits', () => {
    const stored = withEmail(CV, 'alex at example dot com');

    expect(contentEditIssues(stored, { ...stored, summary: 'New summary.' })).toEqual([]);
  });
});

describe('CvContentSchema storable text', () => {
  it('rejects half of a surrogate pair, which JSONB cannot store, and keeps whole emoji', () => {
    expect(CvContentSchema.safeParse({ ...CV, summary: 'Cut \uD83D' }).success).toBe(false);
    expect(
      CvContentSchema.safeParse({ ...CV, skills: [{ id: 'skill\u0000', name: 'Go' }] }).success,
    ).toBe(false);
    expect(CvContentSchema.safeParse({ ...CV, summary: 'Ships fast 🚀' }).success).toBe(true);
  });
});

describe('savableContent', () => {
  it('fits lists that merged edits pushed over their limits, keeping what was stored', () => {
    const before = {
      ...CV,
      skills: Array.from({ length: 79 }, (_, i) => ({ id: `s${i}`, name: `Skill ${i}` })),
    };
    const after = {
      ...before,
      skills: [...before.skills, { id: 'new-1', name: 'Rust' }, { id: 'new-2', name: 'Zig' }],
    };

    expect(savableContent(before, after).skills.map((skill) => skill.id)).toEqual([
      ...before.skills.map((skill) => skill.id),
      'new-1',
    ]);
  });

  it('puts an invalid edit back and keeps the rest', () => {
    const draft = { ...withEmail(CV, 'alex@'), summary: 'New summary.' };

    expect(savableContent(CV, draft)).toEqual({ ...CV, summary: 'New summary.' });
    expect(savableContent(CV, CV)).toBe(CV);
  });
});
