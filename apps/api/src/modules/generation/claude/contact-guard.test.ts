import { describe, expect, it } from 'vitest';
import { guardContactDetails } from './contact-guard';
import type { AiCvDraft } from './cv-draft.schema';

type Contact = AiCvDraft['contact'];

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    headline: 'Backend Engineer',
    email: '',
    phone: '',
    location: 'Lisbon',
    workSetup: '',
    links: [],
    ...overrides,
  };
}

const link = (url: string, label = 'Link') => ({ label, url });

describe('guardContactDetails', () => {
  it('keeps details that appear in the sources', () => {
    const details = contact({
      email: 'jane.doe@example.com',
      phone: '+351 912 345 678',
      links: [link('https://github.com/janedoe', 'GitHub')],
    });

    const result = guardContactDetails(
      details,
      'Jane Doe · jane.doe@example.com · +351 912 345 678 · github.com/janedoe',
    );

    expect(result).toEqual({ contact: details, cleared: [] });
  });

  it('clears an email the sources don’t have, and names the field', () => {
    const result = guardContactDetails(
      contact({ email: 'jane.doe@gmail.com', location: 'Lisbon' }),
      'Jane Doe, Lisbon. jane@northpay.com',
    );

    expect(result.contact.email).toBe('');
    expect(result.contact.location).toBe('Lisbon');
    expect(result.cleared).toEqual(['email']);
  });

  it('clears a phone and drops links the sources don’t have', () => {
    const kept = link('linkedin.com/in/janedoe', 'LinkedIn');

    const result = guardContactDetails(
      contact({
        phone: '+44 20 7946 0958',
        links: [kept, link('https://github.com/jane-doe', 'GitHub')],
      }),
      'Jane Doe — linkedin.com/in/janedoe — +351 912 345 678',
    );

    expect(result.contact.phone).toBe('');
    expect(result.contact.links).toEqual([kept]);
    expect(result.cleared).toEqual(['phone', 'links']);
  });

  it('leaves empty fields alone', () => {
    const result = guardContactDetails(contact(), 'Nothing about contacts here.');

    expect(result.cleared).toEqual([]);
  });

  it('doesn’t change the contact it was given', () => {
    const details = contact({ email: 'invented@example.com', links: [link('example.com/x')] });

    guardContactDetails(details, 'No contacts.');

    expect(details.email).toBe('invented@example.com');
    expect(details.links).toHaveLength(1);
  });

  describe('matches a detail written differently than in the sources', () => {
    it.each([
      [
        'a URL with scheme, www. and a trailing slash',
        'https://www.linkedin.com/in/x/',
        'linkedin.com/in/x',
      ],
      ['a URL without them', 'linkedin.com/in/x', 'https://www.linkedin.com/in/x/'],
      ['a URL in another case', 'https://GitHub.com/JaneDoe', 'github.com/janedoe'],
      [
        'a URL the PDF split over two lines',
        'https://janedoe.dev/portfolio',
        'janedoe.dev/port\nfolio',
      ],
    ])('%s', (_, url, source) => {
      const result = guardContactDetails(contact({ links: [link(url)] }), `Links: ${source}.`);

      expect(result.cleared).toEqual([]);
      expect(result.contact.links).toEqual([link(url)]);
    });

    it.each([
      ['another case', 'Jane.Doe@Example.com', 'jane.doe@example.com'],
      ['a mailto: prefix', 'mailto:jane.doe@example.com', 'jane.doe@example.com'],
      ['a line break from the PDF', 'jane.doe@example.com', 'jane.doe@exam\nple.com'],
      ['spaces from the PDF', 'jane.doe@example.com', 'jane . doe @ example . com'],
      ['a hyphen the PDF added at a line end', 'jane@northpay.com', 'jane@north-\npay.com'],
      ['its own hyphen at a line end', 'jean-luc@example.com', 'jean-\nluc@example.com'],
      ['a soft hyphen from the PDF', 'jane@northpay.com', 'jane@north\u00ADpay.com'],
    ])('an email with %s', (_, email, source) => {
      const result = guardContactDetails(contact({ email }), `Email: ${source}`);

      expect(result.cleared).toEqual([]);
      expect(result.contact.email).toBe(email);
    });

    it.each([
      ['other formatting', '+351 912 345 678', '(+351) 912-345-678'],
      ['a line break from the PDF', '+351 912 345 678', 'Phone: +351 912\n345 678'],
      ['the country code left out', '912 345 678', '+351 912 345 678'],
    ])('a phone with %s', (_, phone, source) => {
      const result = guardContactDetails(contact({ phone }), source);

      expect(result.cleared).toEqual([]);
      expect(result.contact.phone).toBe(phone);
    });
  });

  describe('still clears', () => {
    it('a phone whose country code the model added', () => {
      const result = guardContactDetails(
        contact({ phone: '+351 912 345 678' }),
        'Tel. 912 345 678',
      );

      expect(result.cleared).toEqual(['phone']);
    });

    it('a phone without digits that the sources don’t have', () => {
      const result = guardContactDetails(contact({ phone: 'On request' }), 'Jane Doe');

      expect(result.cleared).toEqual(['phone']);
    });

    it('a link built from a username', () => {
      const result = guardContactDetails(
        contact({ links: [link('https://github.com/janedoe')] }),
        'GitHub: janedoe',
      );

      expect(result.cleared).toEqual(['links']);
    });

    it.each(['', 'https://', '   '])('a link without an address (%j)', (url) => {
      const result = guardContactDetails(contact({ links: [link(url, 'LinkedIn')] }), 'LinkedIn');

      expect(result.contact.links).toEqual([]);
      expect(result.cleared).toEqual(['links']);
    });
  });
});
