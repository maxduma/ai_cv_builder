import { setTimeout as sleep } from 'node:timers/promises';
import { type CvContent, GENERATION_STEP_COUNT } from '@cv-builder/shared';
import { type CvGenerator, GenerationError } from './cv-generator';
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

/**
 * Stand-in for the Claude generator until it is wired up: it walks through the real steps and
 * returns clearly labelled sample content built from the target role.
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
          throw new GenerationError('AI_TIMEOUT', 'The AI service didn’t respond in time.');
        }
      }
      return sampleContent(input);
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
      links: [],
    },
    summary: `Sample content for a ${input.targetRole} CV. AI generation isn’t connected yet, so this draft was written by a placeholder.`,
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
