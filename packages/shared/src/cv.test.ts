import { describe, expect, it } from 'vitest';
import { CV_TITLE_MAX_LENGTH, cvTitle, UpdateCvRequestSchema } from './cv';

describe('cvTitle', () => {
  it('trims the name and turns line breaks and runs of spaces into one space', () => {
    expect(cvTitle.parse('  Senior   Backend\n\tEngineer  ')).toBe('Senior Backend Engineer');
  });

  it('removes U+0000, which PostgreSQL text can’t store', () => {
    expect(cvTitle.parse('Back\u0000end')).toBe('Backend');
  });

  it('refuses a name that is empty once cleaned', () => {
    for (const blank of ['', '   ', '\n\t', '\u0000']) {
      const result = cvTitle.safeParse(blank);
      expect(result.success, JSON.stringify(blank)).toBe(false);
    }
    expect(cvTitle.safeParse('  ').error?.issues[0]?.message).toBe('Enter a name');
  });

  it('keeps names up to the limit and refuses longer ones', () => {
    expect(cvTitle.safeParse('a'.repeat(CV_TITLE_MAX_LENGTH)).success).toBe(true);
    expect(cvTitle.safeParse('a'.repeat(CV_TITLE_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('refuses anything that is not text, and `null`', () => {
    for (const value of [null, 7, {}, ['x']]) {
      expect(cvTitle.safeParse(value).success).toBe(false);
    }
  });
});

describe('UpdateCvRequestSchema', () => {
  it('takes a name next to the role and the text, each optional', () => {
    expect(UpdateCvRequestSchema.parse({})).toEqual({});
    expect(UpdateCvRequestSchema.parse({ title: ' Platform lead ' })).toEqual({
      title: 'Platform lead',
    });
  });

  it('keeps a clearable role distinct from a name that can’t be cleared', () => {
    expect(UpdateCvRequestSchema.parse({ targetRole: '' })).toEqual({ targetRole: null });
    expect(UpdateCvRequestSchema.safeParse({ title: '' }).success).toBe(false);
    expect(UpdateCvRequestSchema.safeParse({ title: null }).success).toBe(false);
  });

  it('refuses keys it doesn’t know, such as an owner', () => {
    expect(UpdateCvRequestSchema.safeParse({ title: 'x', userId: 'someone' }).success).toBe(false);
  });
});
