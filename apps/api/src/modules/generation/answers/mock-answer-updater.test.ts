import {
  ANSWER_MAX_LENGTH,
  type CvContent,
  CvContentSchema,
  GENERATION_ISSUE_SECTIONS,
} from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { applyAnswerChanges } from './answer-changes';
import type { AnswerRequest } from './answer-input';
import { ANSWER_UPDATE_SCHEMAS, type AnswerSection } from './answer-update.schema';
import { createMockAnswerUpdater } from './mock-answer-updater';

const silent = pino({ level: 'silent' });

const CV: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: '',
    phone: '',
    location: 'Lisbon',
    links: [],
  },
  summary: 'Builds payment systems.',
  experience: [
    {
      id: 'e1',
      title: 'Backend Engineer',
      company: 'Northpay',
      location: 'Lisbon',
      start: '2021',
      end: '',
      current: true,
      bullets: [{ id: 'b1', text: 'Led the payments API.' }],
    },
  ],
  education: [
    {
      id: 'ed1',
      degree: 'BSc Computer Science',
      school: 'University of Lisbon',
      location: '',
      start: '2014',
      end: '2017',
      details: '',
    },
  ],
  skills: [{ id: 's1', name: 'Go' }],
});

const VAGUE_FOLLOW_UP = 'Could you give one specific detail, like a number or a name?';

function request(
  section: AnswerSection,
  answer: string,
  { itemId = null, followUp = null }: { itemId?: string | null; followUp?: string | null } = {},
): AnswerRequest {
  return {
    targetRole: 'Senior Backend Engineer',
    question: {
      section,
      kind: 'incomplete',
      target: 'Experience · Northpay',
      itemId,
      question: 'What did you achieve at Northpay?',
      why: 'Results show the impact you can have as a senior engineer.',
    },
    answer,
    followUp,
    previousAnswer: followUp === null ? null : 'Not sure.',
    cv: CV,
  };
}

const hooks = (signal = new AbortController().signal) => ({ signal, log: silent });

// Above any fail rate: never fails.
const updater = createMockAnswerUpdater({ stepMs: 0, failRate: 0.5, random: () => 1 });
const apply = (req: AnswerRequest) => updater.apply(req, hooks());

const noRole = {
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: 'keep',
  editBullets: [],
  addBullets: [],
};
const noSchool = { degree: '', school: '', location: '', start: '', end: '', details: '' };
const noContact = {
  firstName: '',
  lastName: '',
  headline: '',
  email: '',
  phone: '',
  location: '',
  workSetup: '',
  addLinks: [],
};

describe('mock answer updater', () => {
  it('adds the answer as a bullet to the role a question is about', async () => {
    const output = await apply(
      request('experience', 'Cut settlement from 2 days to 4 hours.', { itemId: 'e1' }),
    );

    expect(output).toEqual({
      followUp: '',
      experience: [{ ...noRole, id: 'e1', addBullets: ['Cut settlement from 2 days to 4 hours.'] }],
    });
  });

  it('adds a role named by the answer when a question is about no role', async () => {
    const output = await apply(request('experience', 'Staff Engineer at Ledgerly'));

    expect(output).toEqual({
      followUp: '',
      experience: [{ ...noRole, id: '', title: 'Staff Engineer at Ledgerly' }],
    });
  });

  it('puts the answer in the details of the school a question is about, or adds a degree', async () => {
    expect(await apply(request('education', 'Thesis on fraud.', { itemId: 'ed1' }))).toEqual({
      followUp: '',
      education: [{ ...noSchool, id: 'ed1', details: 'Thesis on fraud.' }],
    });
    expect(await apply(request('education', 'MSc Data Science'))).toEqual({
      followUp: '',
      education: [{ ...noSchool, id: '', degree: 'MSc Data Science' }],
    });
  });

  it('adds each skill the answer lists', async () => {
    expect(await apply(request('skills', 'Rust, Terraform;Kubernetes\n\n  PostgreSQL ,'))).toEqual({
      followUp: '',
      addSkills: ['Rust', 'Terraform', 'Kubernetes', 'PostgreSQL'],
    });
  });

  it('appends the answer to the summary, for a summary or a general question', async () => {
    const summary = 'Builds payment systems. I lead a team of four.';

    expect(await apply(request('summary', ' I lead a team of four. '))).toEqual({
      followUp: '',
      summary,
    });
    expect(await apply(request('general', 'I lead a team of four.'))).toEqual({
      followUp: '',
      summary,
      addSkills: [],
    });
  });

  it('takes an email, else a link, else a way of working from a contact answer', async () => {
    expect(await apply(request('contact', 'alex@example.com or alexmorgan.dev'))).toEqual({
      followUp: '',
      contact: { ...noContact, email: 'alex@example.com' },
    });
    expect(await apply(request('contact', 'See https://www.alexmorgan.dev/work'))).toEqual({
      followUp: '',
      contact: {
        ...noContact,
        addLinks: [{ label: 'Website', url: 'https://www.alexmorgan.dev/work' }],
      },
    });
    expect(await apply(request('contact', 'Open to remote roles'))).toEqual({
      followUp: '',
      contact: { ...noContact, workSetup: 'Open to remote roles' },
    });
  });

  it('gives contact changes that pass the check against the answer', async () => {
    for (const answer of ['alex@example.com', 'linkedin.com/in/alexmorgan']) {
      const req = request('contact', answer);
      const update = ANSWER_UPDATE_SCHEMAS.contact.parse(await apply(req));

      expect(applyAnswerChanges(req, update)).toMatchObject({ kind: 'changes' });
    }
  });

  it.each(['not sure', 'IDK', '??'])(
    'asks for more detail about “%s” on the first round only',
    async (answer) => {
      expect(await apply(request('experience', answer, { itemId: 'e1' }))).toEqual({
        followUp: VAGUE_FOLLOW_UP,
        experience: [],
      });
      expect(
        await apply(request('experience', answer, { itemId: 'e1', followUp: VAGUE_FOLLOW_UP })),
      ).toEqual({
        followUp: '',
        experience: [{ ...noRole, id: 'e1', addBullets: [answer] }],
      });
    },
  );

  describe.each(GENERATION_ISSUE_SECTIONS)('for the %s section', (section) => {
    const itemId = section === 'experience' ? 'e1' : section === 'education' ? 'ed1' : null;

    it.each([
      ['a short answer', 'Mentored two engineers'],
      ['the longest answer', 'Mentored two engineers and ran the on-call rota. '.repeat(25)],
      ['a vague answer', 'not sure'],
    ])('returns an update that fits its schema, from %s', async (_, text) => {
      const answer = text.slice(0, ANSWER_MAX_LENGTH);

      for (const req of [
        request(section, answer, { itemId }),
        request(section, answer),
        request(section, answer, { itemId, followUp: VAGUE_FOLLOW_UP }),
      ]) {
        expect(ANSWER_UPDATE_SCHEMAS[section].safeParse(await apply(req)).error).toBeUndefined();
      }
    });
  });

  it('lists no more skills than the section’s schema allows', async () => {
    const answer = Array.from({ length: 90 }, (_, index) => `Tool ${index + 1}`).join(', ');

    const output = await apply(request('skills', answer));

    expect(ANSWER_UPDATE_SCHEMAS.skills.safeParse(output).error).toBeUndefined();
  });

  it('fails as often as it is told to', async () => {
    const failing = createMockAnswerUpdater({ stepMs: 0, failRate: 0.5, random: () => 0.25 });

    await expect(failing.apply(request('summary', 'An answer.'), hooks())).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'AI_UNAVAILABLE',
    });
  });

  it('can be told to always fail, to try the failure state', async () => {
    const failing = createMockAnswerUpdater({ stepMs: 0, failRate: 1 });

    await expect(failing.apply(request('summary', 'An answer.'), hooks())).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'AI_UNAVAILABLE',
      userMessage: 'The AI service isn’t available right now. Try again in a few minutes.',
    });
  });

  it('stops when the job is aborted', async () => {
    const controller = new AbortController();
    const slow = createMockAnswerUpdater({ stepMs: 60_000, failRate: 0 });

    const applying = slow.apply(request('summary', 'An answer.'), hooks(controller.signal));
    controller.abort();

    await expect(applying).rejects.toMatchObject({ name: 'AbortError' });
  });
});
