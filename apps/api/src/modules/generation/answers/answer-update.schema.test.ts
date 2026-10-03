import { CV_LIMITS, GENERATION_ISSUE_SECTIONS } from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_UPDATE_FORMATS,
  ANSWER_UPDATE_SCHEMAS,
  type AnswerSection,
  type RoleChanges,
} from './answer-update.schema';

type Schema = Record<string, unknown>;

const SECTIONS = [...GENERATION_ISSUE_SECTIONS];

/**
 * The schema of a field in a section's format, e.g. `field('experience', 'experience', 'current')`
 * (lists are looked into).
 */
function field(section: AnswerSection, ...path: string[]): Schema {
  return path.reduce<Schema>((node, key) => {
    const object = node.type === 'array' ? (node.items as Schema) : node;
    return (object.properties as Record<string, Schema>)[key] ?? {};
  }, ANSWER_UPDATE_FORMATS[section].schema);
}

/** Every object in the schema, with its path. */
function objects(node: Schema, path = '$'): [string, Schema][] {
  const own: [string, Schema][] = node.type === 'object' ? [[path, node]] : [];
  const properties = Object.entries((node.properties ?? {}) as Record<string, Schema>);
  return [
    ...own,
    ...properties.flatMap(([key, child]) => objects(child, `${path}.${key}`)),
    ...(node.items ? objects(node.items as Schema, `${path}[]`) : []),
  ];
}

const ROLE: RoleChanges = {
  id: 'experience-1',
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: 'keep',
  editBullets: [],
  addBullets: [],
};

describe('ANSWER_UPDATE_SCHEMAS', () => {
  it('has a schema and a format for each section a question can be about, and no other', () => {
    expect(new Set(Object.keys(ANSWER_UPDATE_SCHEMAS))).toEqual(new Set(SECTIONS));
    expect(new Set(Object.keys(ANSWER_UPDATE_FORMATS))).toEqual(new Set(SECTIONS));
    expect(Object.keys(ANSWER_UPDATE_SCHEMAS)).toHaveLength(SECTIONS.length);
  });

  it.each([
    ['contact', ['followUp', 'contact']],
    ['summary', ['followUp', 'summary']],
    ['experience', ['followUp', 'experience']],
    ['education', ['followUp', 'education']],
    ['skills', ['followUp', 'addSkills']],
    ['general', ['followUp', 'summary', 'addSkills']],
  ] as const)('lets an answer about %s change only that section', (section, keys) => {
    expect(Object.keys(ANSWER_UPDATE_SCHEMAS[section].shape)).toEqual(keys);
    expect(Object.keys(ANSWER_UPDATE_FORMATS[section].schema.properties as Schema)).toEqual(keys);
  });

  it('refuses unknown keys, missing keys and nulls', () => {
    const summary = ANSWER_UPDATE_SCHEMAS.summary;
    const experience = ANSWER_UPDATE_SCHEMAS.experience;

    expect(summary.safeParse({ followUp: '', summary: '' }).success).toBe(true);
    expect(summary.safeParse({ followUp: '', summary: '', addSkills: ['Go'] }).success).toBe(false);
    expect(summary.safeParse({ summary: 'Engineer.' }).success).toBe(false);
    expect(summary.safeParse({ followUp: null, summary: '' }).success).toBe(false);
    expect(experience.safeParse({ followUp: '', experience: [ROLE] }).success).toBe(true);
    expect(
      experience.safeParse({ followUp: '', experience: [{ ...ROLE, bullets: [] }] }).success,
    ).toBe(false);
    expect(
      experience.safeParse({ followUp: '', experience: [{ ...ROLE, current: true }] }).success,
    ).toBe(false);
  });

  it('allows a stored CV’s limits and no more', () => {
    const { summary, skills, experience } = ANSWER_UPDATE_SCHEMAS;
    const full = (length: number) => 'x'.repeat(length);

    expect(summary.safeParse({ followUp: '', summary: full(CV_LIMITS.summary) }).success).toBe(
      true,
    );
    expect(summary.safeParse({ followUp: '', summary: full(CV_LIMITS.summary + 1) }).success).toBe(
      false,
    );
    const addSkills = (count: number) => Array.from({ length: count }, () => 'Go');
    expect(skills.safeParse({ followUp: '', addSkills: addSkills(CV_LIMITS.skills) }).success).toBe(
      true,
    );
    expect(
      skills.safeParse({ followUp: '', addSkills: addSkills(CV_LIMITS.skills + 1) }).success,
    ).toBe(false);
    const role = (bullet: string) => ({
      followUp: '',
      experience: [{ ...ROLE, addBullets: [bullet] }],
    });
    expect(experience.safeParse(role(full(CV_LIMITS.bullet))).success).toBe(true);
    expect(experience.safeParse(role(full(CV_LIMITS.bullet + 1))).success).toBe(false);
  });
});

describe('ANSWER_UPDATE_FORMATS', () => {
  it.each(SECTIONS)('is just the JSON schema for %s, without the helper’s `parse`', (section) => {
    expect(Object.keys(ANSWER_UPDATE_FORMATS[section])).toEqual(['type', 'schema']);
    expect(ANSWER_UPDATE_FORMATS[section].type).toBe('json_schema');
  });

  it.each(SECTIONS)(
    'is strict and inline for %s, with nothing structured outputs don’t support',
    (section) => {
      const { schema } = ANSWER_UPDATE_FORMATS[section];

      for (const [path, object] of objects(schema)) {
        expect(object.additionalProperties, path).toBe(false);
        expect(object.required, path).toEqual(Object.keys(object.properties as Schema));
      }
      const json = JSON.stringify(schema);
      for (const keyword of [
        '$schema',
        '$ref',
        '$defs',
        'format',
        'pattern',
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
        'default',
        'anyOf',
        'oneOf',
        'allOf',
        'const',
        'minimum',
        'maximum',
        'null',
      ]) {
        expect(json).not.toContain(`"${keyword}"`);
      }
    },
  );

  it('holds a role’s `current` to keep, yes or no', () => {
    expect(field('experience', 'experience', 'current')).toMatchObject({
      type: 'string',
      enum: ['keep', 'yes', 'no'],
    });
  });

  it('tells the model each limit in the field’s description', () => {
    expect(field('summary', 'followUp').description).toMatch(/\n\n\{maxLength: 300\}$/);
    expect(field('general', 'summary').description).toMatch(/\n\n\{maxLength: 2000\}$/);
    expect(field('experience', 'experience').description).toMatch(/\n\n\{maxItems: 30\}$/);
    expect(field('experience', 'experience', 'addBullets').description).toMatch(
      /\n\n\{maxItems: 15\}$/,
    );
    expect(field('contact', 'contact', 'addLinks', 'url').description).toMatch(
      /\n\n\{maxLength: 300\}$/,
    );
    expect(field('skills', 'addSkills').description).toMatch(/\n\n\{maxItems: 80\}$/);
  });
});
