import { SOURCE_TEXT_MAX_LENGTH, TARGET_ROLE_MAX_LENGTH } from '@cv-builder/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSavedForm, hasUnsentInput, readSavedForm, writeSavedForm } from './saved-form';

const USER = '0199a000-0000-7000-8000-00000000000a';
const OTHER_USER = '0199a000-0000-7000-8000-00000000000b';
const CV = '0199a000-0000-7000-8000-0000000000c1';
const VALUES = { role: 'Staff Platform Engineer', text: 'Six years building internal platforms.' };

/** The tab's storage, which Node doesn't have. */
function fakeStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    ...overrides,
  };
  return { storage, data };
}

let data: Map<string, string>;

beforeEach(() => {
  const fake = fakeStorage();
  data = fake.data;
  vi.stubGlobal('window', { sessionStorage: fake.storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saved create form', () => {
  it('brings back what was typed for the same account and draft', () => {
    writeSavedForm(USER, null, VALUES);

    expect(readSavedForm(USER, null)).toEqual(VALUES);
  });

  it('keeps a form for an existing draft apart from one for a new CV', () => {
    writeSavedForm(USER, CV, VALUES);

    expect(readSavedForm(USER, CV)).toEqual(VALUES);
    expect(readSavedForm(USER, null)).toBeNull();
    expect(readSavedForm(USER, '0199a000-0000-7000-8000-0000000000c2')).toBeNull();
  });

  it('never shows one account’s text to another', () => {
    writeSavedForm(USER, null, VALUES);

    expect(readSavedForm(OTHER_USER, null)).toBeNull();
  });

  it('removes the entry when the form is empty', () => {
    writeSavedForm(USER, null, VALUES);
    writeSavedForm(USER, null, { role: '', text: '' });

    expect(data.size).toBe(0);
    expect(readSavedForm(USER, null)).toBeNull();
  });

  it('forgets the entry when asked', () => {
    writeSavedForm(USER, null, VALUES);
    clearSavedForm();

    expect(readSavedForm(USER, null)).toBeNull();
  });

  it('ignores an entry it cannot read', () => {
    for (const raw of [
      'not json',
      'null',
      '{"userId":"x"}',
      JSON.stringify({ ...VALUES, userId: USER, cvId: null, text: 5 }),
    ]) {
      data.set('cvb:create-form', raw);

      expect(readSavedForm(USER, null)).toBeNull();
    }
  });

  it('keeps what it brings back within the form’s limits', () => {
    writeSavedForm(USER, null, {
      role: 'x'.repeat(TARGET_ROLE_MAX_LENGTH + 50),
      text: 'y'.repeat(SOURCE_TEXT_MAX_LENGTH + 50),
    });

    const restored = readSavedForm(USER, null);

    expect(restored?.role).toHaveLength(TARGET_ROLE_MAX_LENGTH);
    expect(restored?.text).toHaveLength(SOURCE_TEXT_MAX_LENGTH);
  });

  it('works without storage: private windows and blocked site data', () => {
    const blocked = () => {
      throw new DOMException('Access denied', 'SecurityError');
    };
    vi.stubGlobal('window', {
      sessionStorage: fakeStorage({ getItem: blocked, setItem: blocked, removeItem: blocked })
        .storage,
    });

    expect(() => writeSavedForm(USER, null, VALUES)).not.toThrow();
    expect(() => clearSavedForm()).not.toThrow();
    expect(readSavedForm(USER, null)).toBeNull();
  });
});

describe('hasUnsentInput', () => {
  const sent = { role: 'Data Engineer', text: 'Six years with Spark.' };

  it('is false while the form matches what the server has', () => {
    expect(hasUnsentInput(sent, sent)).toBe(false);
    expect(hasUnsentInput({ role: '', text: '' }, { role: '', text: '' })).toBe(false);
  });

  it('is true once the person types something new', () => {
    expect(hasUnsentInput({ ...sent, role: 'Data Platform Engineer' }, sent)).toBe(true);
    expect(hasUnsentInput({ ...sent, text: `${sent.text} More.` }, sent)).toBe(true);
    expect(hasUnsentInput(sent, { role: '', text: '' })).toBe(true);
  });

  it('compares as the server stores text: without surrounding whitespace', () => {
    expect(hasUnsentInput({ role: '  Data Engineer ', text: `${sent.text}\n` }, sent)).toBe(false);
  });
});
