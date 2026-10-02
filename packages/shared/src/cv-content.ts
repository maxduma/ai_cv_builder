import { z } from 'zod';

const id = z.string().min(1).max(64);
const text = (maxLength: number) => z.string().max(maxLength);

/**
 * The structured CV document stored in `cvs.content` (version 1). It follows the CV template in
 * the design; every write is validated against it, whether the content comes from the AI or the
 * editor. Unknown keys are stripped.
 */
export const CvContentSchema = z.object({
  version: z.literal(1),
  contact: z.object({
    firstName: text(80),
    lastName: text(80),
    headline: text(160),
    email: text(254),
    phone: text(40),
    location: text(120),
    links: z.array(z.object({ id, label: text(40), url: text(300) })).max(10),
  }),
  summary: text(2_000),
  experience: z
    .array(
      z.object({
        id,
        title: text(160),
        company: text(160),
        location: text(120),
        start: text(40),
        end: text(40),
        current: z.boolean(),
        bullets: z.array(z.object({ id, text: text(500) })).max(15),
      }),
    )
    .max(30),
  education: z
    .array(
      z.object({
        id,
        degree: text(160),
        school: text(160),
        location: text(120),
        start: text(40),
        end: text(40),
        details: text(500),
      }),
    )
    .max(15),
  skills: z.array(z.object({ id, name: text(60) })).max(80),
});

export type CvContent = z.infer<typeof CvContentSchema>;
