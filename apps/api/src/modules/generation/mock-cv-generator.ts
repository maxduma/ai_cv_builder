import { setTimeout as sleep } from 'node:timers/promises';
import { type CvContent, GENERATION_STEP_COUNT, type GenerationIssue } from '@cv-builder/shared';
import { type CvGenerator, GenerationError } from './cv-generator';
import { JOB_FAILURES } from './generation.failures';
import type { GenerationInput } from './generation.input';

interface Options {
  /** How long each of the four steps takes. */
  stepMs: number;
  /** Share of runs that fail (0–1), so the failure screen can be tried out. */
  failRate: number;
  random?: () => number;
}

/** Fails while "writing your experience", where the design's failure example stops. */
const FAILING_STEP = 2;

/** Questions like the design's, one per kind of answer, so the questions flow can be tried. */
const SAMPLE_ISSUES: GenerationIssue[] = [
  {
    section: 'experience',
    kind: 'incomplete',
    target: 'Experience · Sample company',
    itemId: 'experience-1',
    question: 'How many people were on the team you led at Sample company?',
    why: 'A team size shows the scope of the role.',
  },
  {
    section: 'education',
    kind: 'missing',
    target: 'Education',
    question: 'Do you have a degree or certificate to add?',
    why: 'Your draft has no Education section yet. Most recruiters look for one.',
  },
  {
    section: 'contact',
    kind: 'missing',
    target: 'Contact details',
    question: 'Which ways of working are you open to?',
    why: 'Recruiters often filter by this. It appears next to your contact details.',
  },
];

/**
 * The development stand-in for the Claude generator, used when `ANTHROPIC_API_KEY` is not set
 * (production requires the key). It walks through the real steps and returns clearly labelled
 * sample content built from the target role, with sample questions.
 */
export function createMockCvGenerator({
  stepMs,
  failRate,
  random = Math.random,
}: Options): CvGenerator {
  return {
    async generate(input, { signal, onStep }) {
      const fails = random() < failRate;

      for (let step = 0; step < GENERATION_STEP_COUNT; step += 1) {
        await onStep(step);
        await sleep(stepMs, undefined, { signal });
        if (fails && step === FAILING_STEP) {
          throw new GenerationError(JOB_FAILURES.aiTimeout);
        }
      }
      return { content: sampleContent(input), issues: SAMPLE_ISSUES };
    },
  };
}

function sampleContent(input: GenerationInput): CvContent {
  return {
    version: 1,
    contact: {
      firstName: '',
      lastName: '',
      headline: input.targetRole,
      email: '',
      phone: '',
      location: '',
      workSetup: '',
      links: [],
    },
    summary: `Sample content for a ${input.targetRole} CV. This draft was written by the development mock because no Anthropic API key is set.`,
    experience: [
      {
        id: 'experience-1',
        title: input.targetRole,
        company: 'Sample company',
        location: '',
        start: '2021',
        end: '',
        current: true,
        bullets: [
          {
            id: 'experience-1-bullet-1',
            text: 'Placeholder achievement: the real draft will be written from your CV and notes.',
          },
        ],
      },
    ],
    education: [],
    skills: [],
  };
}
