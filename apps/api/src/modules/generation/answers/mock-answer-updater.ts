import { setTimeout as sleep } from 'node:timers/promises';
import { CV_LIMITS } from '@cv-builder/shared';
import { GenerationError } from '../cv-generator';
import { JOB_FAILURES } from '../generation.failures';
import type { AnswerRequest, AnswerUpdater } from './answer-input';
import type { AnswerUpdate } from './answer-update.schema';

interface Options {
  /** How long an update takes, so its progress can be seen. */
  stepMs?: number;
  /** Share of updates that fail (0–1), so the failure state can be tried out. */
  failRate?: number;
  random?: () => number;
}

/** How long a mock answer takes to apply, so its "Updating…" can be seen. */
const STEP_MS = 2_500;
/** Raise it to 1 to see the failure state: every update then fails. */
const FAIL_RATE = 0;

/** Answers the mock treats as too vague, to try out the follow-up question. */
const VAGUE = /^(not sure|idk|\?+)$/i;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/i;
/** Punctuation that ends the sentence, not the address: "Email me at alex@example.com." */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

/**
 * The development stand-in for Claude's answer updates, used when `ANTHROPIC_API_KEY` is not set.
 * It turns the answer into simple, predictable changes to the question's section (a new bullet,
 * a degree, a work setup...), so the whole flow can be tried without the API.
 */
export function createMockAnswerUpdater({
  stepMs = STEP_MS,
  failRate = FAIL_RATE,
  random = Math.random,
}: Options = {}): AnswerUpdater {
  return {
    async apply(request, { signal }) {
      await sleep(stepMs, undefined, { signal });
      if (random() < failRate) throw new GenerationError(JOB_FAILURES.aiUnavailable);

      const answer = request.answer.trim();
      if (VAGUE.test(answer) && request.followUp === null) {
        return emptyUpdate(request, 'Could you give one specific detail, like a number or a name?');
      }
      return mockUpdate(request, answer);
    },
  };
}

function emptyUpdate(request: AnswerRequest, followUp = ''): AnswerUpdate {
  switch (request.question.section) {
    case 'contact':
      return {
        followUp,
        contact: {
          firstName: '',
          lastName: '',
          headline: '',
          email: '',
          phone: '',
          location: '',
          workSetup: '',
          addLinks: [],
        },
      };
    case 'summary':
      return { followUp, summary: '' };
    case 'experience':
      return { followUp, experience: [] };
    case 'education':
      return { followUp, education: [] };
    case 'skills':
      return { followUp, addSkills: [] };
    case 'general':
      return { followUp, summary: '', addSkills: [] };
  }
}

function mockUpdate(request: AnswerRequest, answer: string): AnswerUpdate {
  const { section, itemId } = request.question;
  const update = emptyUpdate(request);
  const appended = `${request.cv.summary} ${answer}`.trim().slice(0, CV_LIMITS.summary);

  if ('contact' in update) {
    const email = EMAIL.exec(answer)?.[0].replace(TRAILING_PUNCTUATION, '');
    const url = email ? undefined : URL.exec(answer)?.[0].replace(TRAILING_PUNCTUATION, '');
    if (email) update.contact.email = email;
    else if (url) update.contact.addLinks = [{ label: 'Website', url }];
    else update.contact.workSetup = answer.slice(0, CV_LIMITS.workSetup);
  } else if ('experience' in update) {
    const bullet = answer.slice(0, CV_LIMITS.bullet);
    update.experience = [
      {
        id: itemId ?? '',
        title: itemId ? '' : answer.slice(0, CV_LIMITS.title),
        company: '',
        location: '',
        start: '',
        end: '',
        current: 'keep',
        editBullets: [],
        addBullets: itemId ? [bullet] : [],
      },
    ];
  } else if ('education' in update) {
    update.education = [
      {
        id: itemId ?? '',
        degree: itemId ? '' : answer.slice(0, CV_LIMITS.degree),
        school: '',
        location: '',
        start: '',
        end: '',
        details: itemId ? answer.slice(0, CV_LIMITS.details) : '',
      },
    ];
  } else if (section === 'skills' && 'addSkills' in update) {
    update.addSkills = answer
      .split(/[,;\n]/)
      .map((skill) => skill.trim().slice(0, CV_LIMITS.skill))
      .filter(Boolean)
      .slice(0, CV_LIMITS.skills);
  } else if ('summary' in update) {
    update.summary = appended;
  }
  return update;
}
