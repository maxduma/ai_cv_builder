import { describe, expect, it } from 'vitest';
import { guardHeadline } from './headline-guard';

const SOURCES = 'Jane Doe\nBackend Engineer at Northpay, 2021–present\nGo, PostgreSQL';

describe('guardHeadline', () => {
  it('clears a headline that is only the target role', () => {
    expect(guardHeadline('Senior Backend Engineer', 'Senior Backend Engineer', SOURCES)).toBe('');
  });

  it('compares without case, spacing or punctuation', () => {
    expect(guardHeadline('senior  backend-engineer', 'Senior Backend Engineer', SOURCES)).toBe('');
  });

  it('keeps it when the sources give that title themselves', () => {
    const sources = `${SOURCES}\nPromoted to Senior Backend Engineer in 2023`;

    expect(guardHeadline('Senior Backend Engineer', 'Senior Backend Engineer', sources)).toBe(
      'Senior Backend Engineer',
    );
  });

  it('finds the title in the sources across line breaks and PDF spacing', () => {
    const sources = 'Senior\nBackend  Engineer, Northpay';

    expect(guardHeadline('Senior Backend Engineer', 'Senior Backend Engineer', sources)).toBe(
      'Senior Backend Engineer',
    );
  });

  it('leaves a headline that differs from the target role alone', () => {
    expect(guardHeadline('Backend Engineer', 'Senior Backend Engineer', SOURCES)).toBe(
      'Backend Engineer',
    );
  });

  it('leaves an empty headline empty', () => {
    expect(guardHeadline('', 'Senior Backend Engineer', SOURCES)).toBe('');
  });

  it('works for titles in other scripts', () => {
    expect(guardHeadline('Інженер-програміст', 'інженер програміст', 'Досвід: тестувальник')).toBe(
      '',
    );
    expect(
      guardHeadline('Інженер-програміст', 'інженер програміст', 'Посада: Інженер програміст'),
    ).toBe('Інженер-програміст');
  });
});
