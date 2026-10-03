import { describe, expect, it } from 'vitest';
import type { CvContent } from './cv-content';
import {
  cleanPdfFileName,
  cvDates,
  defaultPdfFileName,
  linkHref,
  PDF_FILE_NAME_MAX_LENGTH,
  toCvView,
} from './cv-view';

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
    links: [
      { id: 'link-1', label: 'LinkedIn', url: 'linkedin.com/in/alexmorgan' },
      { id: 'link-2', label: 'GitHub', url: 'https://github.com/alexmorgan' },
    ],
  },
  summary: 'Backend engineer with 7 years of experience.',
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
        { id: 'b-1', text: 'Lead a team of 5 engineers.' },
        { id: 'b-2', text: '   ' },
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
      details: '',
    },
  ],
  skills: [
    { id: 'skill-1', name: 'Go' },
    { id: 'skill-2', name: ' ' },
  ],
};

const withContact = (contact: Partial<CvContent['contact']>): CvContent => ({
  ...CV,
  contact: { ...CV.contact, ...contact },
});

describe('toCvView', () => {
  it('lays the CV out as its page shows it', () => {
    const view = toCvView(CV);

    expect(view.name).toBe('Alex Morgan');
    expect(view.headline).toBe('Senior Backend Engineer');
    expect(view.contact).toEqual([
      { key: 'email', text: 'alex.morgan@example.com', href: 'mailto:alex.morgan@example.com' },
      { key: 'phone', text: '+351 912 345 678', href: null },
      { key: 'location', text: 'Lisbon, Portugal', href: null },
      {
        key: 'link-link-1',
        text: 'linkedin.com/in/alexmorgan',
        href: 'https://linkedin.com/in/alexmorgan',
      },
      {
        key: 'link-link-2',
        text: 'https://github.com/alexmorgan',
        href: 'https://github.com/alexmorgan',
      },
      { key: 'work-setup', text: 'Open to remote roles', href: null },
    ]);
    expect(view.experience).toEqual([
      {
        id: 'role-1',
        title: 'Senior Backend Engineer',
        dates: 'Mar 2021 – Present',
        company: 'Northpay',
        location: 'Lisbon',
        bullets: [{ id: 'b-1', text: 'Lead a team of 5 engineers.' }],
      },
    ]);
    expect(view.education).toEqual([
      {
        id: 'edu-1',
        title: 'BSc in Computer Science',
        dates: '2012 – 2016',
        school: 'University of Lisbon',
        location: '',
        details: '',
      },
    ]);
    expect(view.skills).toEqual([{ id: 'skill-1', name: 'Go' }]);
  });

  it('fills in a missing name, job title and degree as the template does', () => {
    const view = toCvView({
      ...withContact({ firstName: ' ', lastName: '' }),
      experience: [{ ...CV.experience[0]!, title: '' }],
      education: [{ ...CV.education[0]!, degree: '  ' }],
    });

    expect(view.name).toBe('Your name');
    expect(view.experience[0]?.title).toBe('Job title');
    expect(view.education[0]?.title).toBe('Degree');
  });

  it('leaves blank contact items out', () => {
    const view = toCvView(
      withContact({ email: '', phone: ' ', location: '', workSetup: '', links: [] }),
    );

    expect(view.contact).toEqual([]);
  });

  it('reads one-line values as one line, as HTML shows them', () => {
    const view = toCvView({
      ...withContact({ headline: 'Senior\n  Backend\tEngineer' }),
      experience: [
        {
          ...CV.experience[0]!,
          bullets: [{ id: 'b-1', text: 'Line one\nline two\u0007 ' }],
        },
      ],
    });

    expect(view.headline).toBe('Senior Backend Engineer');
    expect(view.experience[0]?.bullets).toEqual([{ id: 'b-1', text: 'Line one line two' }]);
  });

  it('prints what the font has: composed accents, ordinary spaces, no invisible marks', () => {
    const view = toCvView({
      ...CV,
      contact: {
        ...CV.contact,
        firstName: 'Jose\u0301',
        lastName: 'Mu\u0308ller\u200b',
        headline: 'Backend\u2009Engineer\u202f(remote)\u200f',
      },
      summary: 'Full\u2011stack\u2010ready\u2003engineer.\ufeff',
    });

    expect(view.name).toBe('Jos\u00e9 M\u00fcller');
    expect(view.headline).toBe('Backend Engineer (remote)');
    expect(view.summary).toBe('Full-stack-ready engineer.');
  });

  it('leaves Cyrillic and ordinary no-break spaces alone', () => {
    const view = toCvView({ ...CV, summary: 'Їжак\u00a0і Ґанок — друзі.' });

    expect(view.summary).toBe('Їжак\u00a0і Ґанок — друзі.');
  });

  it('keeps line breaks in the summary and details, like CSS pre-line', () => {
    const view = toCvView({
      ...CV,
      summary: '  First   paragraph. \r\n\r\n  Second\tone.  ',
      education: [{ ...CV.education[0]!, details: 'Thesis: payments \n Grade: A' }],
    });

    expect(view.summary).toBe('First paragraph.\n\nSecond one.');
    expect(view.education[0]?.details).toBe('Thesis: payments\nGrade: A');
  });

  it('links an email only when it is a full address', () => {
    expect(toCvView(withContact({ email: 'alex@' })).contact[0]).toEqual({
      key: 'email',
      text: 'alex@',
      href: null,
    });
  });
});

describe('cvDates', () => {
  it('joins the ends with an en dash, or shows the one that is filled in', () => {
    expect(cvDates('Jun 2018', 'Feb 2021', false)).toBe('Jun 2018 – Feb 2021');
    expect(cvDates('Mar 2021', 'Ignored', true)).toBe('Mar 2021 – Present');
    expect(cvDates('', '2016', false)).toBe('2016');
    expect(cvDates('2012', ' ', false)).toBe('2012');
    expect(cvDates('', '', false)).toBe('');
  });
});

describe('linkHref', () => {
  it('keeps web addresses and adds https:// to bare domains', () => {
    expect(linkHref('https://github.com/alex')).toBe('https://github.com/alex');
    expect(linkHref('http://alex.dev')).toBe('http://alex.dev');
    expect(linkHref('linkedin.com/in/alex')).toBe('https://linkedin.com/in/alex');
    expect(linkHref('www.alex-morgan.co.uk/work?tab=1#top')).toBe(
      'https://www.alex-morgan.co.uk/work?tab=1#top',
    );
  });

  it('prints anything else as plain text', () => {
    expect(linkHref('javascript:alert(1)')).toBeNull();
    expect(linkHref('ftp://files.example.com')).toBeNull();
    expect(linkHref('Portfolio')).toBeNull();
    expect(linkHref('my site.com')).toBeNull();
    expect(linkHref('alex@example.com')).toBeNull();
    expect(linkHref('')).toBeNull();
  });
});

describe('PDF file names', () => {
  it('suggests the name followed by CV', () => {
    expect(defaultPdfFileName(CV)).toBe('Alex_Morgan_CV');
    expect(defaultPdfFileName(withContact({ firstName: 'Mary Ann', lastName: 'Lee' }))).toBe(
      'Mary_Ann_Lee_CV',
    );
    expect(defaultPdfFileName(withContact({ firstName: 'Олена', lastName: 'Ґудзь' }))).toBe(
      'Олена_Ґудзь_CV',
    );
    expect(defaultPdfFileName(withContact({ firstName: '', lastName: ' ' }))).toBe('CV');
    expect(defaultPdfFileName(withContact({ firstName: 'A/B', lastName: 'C:D' }))).toBe('AB_CD_CV');
  });

  it('cleans a typed name the way the design does', () => {
    expect(cleanPdfFileName('Alex_Morgan_CV.pdf')).toBe('Alex_Morgan_CV');
    expect(cleanPdfFileName('My CV: "final" <v2>?')).toBe('My CV final v2');
    expect(cleanPdfFileName('Tab\there')).toBe('Tabhere');
    expect(cleanPdfFileName('Trailing space ')).toBe('Trailing space ');
    expect(cleanPdfFileName('x'.repeat(100))).toHaveLength(PDF_FILE_NAME_MAX_LENGTH);
  });

  it('never cuts a character in half', () => {
    const name = `${'x'.repeat(PDF_FILE_NAME_MAX_LENGTH - 1)}😀`;

    expect(cleanPdfFileName(name)).toBe('x'.repeat(PDF_FILE_NAME_MAX_LENGTH - 1));
  });
});
