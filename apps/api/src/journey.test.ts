import type { CvDetail, GenerationJobDto } from '@cv-builder/shared';
import pino from 'pino';
import { extractText } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { createReactPdfCvRenderer } from './integrations/pdf/react-pdf-cv-renderer';
import { createMockAnswerUpdater } from './modules/generation/answers/mock-answer-updater';
import { createGenerationWorker } from './modules/generation/generation.worker';
import { createMockCvGenerator } from './modules/generation/mock-cv-generator';
import { sendJson, signUp, startApp } from './test/start-app';

/**
 * The whole product in one test, over HTTP with real sessions, the real worker and the real PDF
 * renderer: sign up → create a CV → generate → answer a question → edit by hand → download the PDF.
 * Only Claude is replaced, by the development mocks (instant, no failures). Each piece has its own
 * tests; this one checks that they work together.
 */
describe('the whole flow', () => {
  it('takes a person from sign-up to a PDF with their own edit in it', async () => {
    const app = await startApp({ sessions: 'real', cvPdfRenderer: createReactPdfCvRenderer() });
    const { baseUrl } = app;
    const worker = createGenerationWorker({
      repository: app.repositories.generation,
      generator: createMockCvGenerator({ stepMs: 0, failRate: 0 }),
      answerUpdater: createMockAnswerUpdater({ stepMs: 0, failRate: 0 }),
      logger: pino({ level: 'silent' }),
    });
    const { cookie } = await signUp(baseUrl, { name: 'Alex Morgan', email: 'alex@example.com' });
    const headers = { Cookie: cookie };
    const getCv = async (id: string) =>
      (await (await fetch(`${baseUrl}/api/cvs/${id}`, { headers })).json()) as CvDetail;

    // 1. A draft from a target role and notes.
    const created = await sendJson(
      `${baseUrl}/api/cvs`,
      'POST',
      {
        targetRole: 'Platform Engineer',
        sourceText: 'Six years building internal platforms; led a team of four engineers.',
      },
      headers,
    );
    expect(created.status).toBe(201);
    const draft = (await created.json()) as CvDetail;
    expect(draft).toMatchObject({ status: 'draft', content: null, contentVersion: 0 });

    // 2. Generation: accepted at once, done by the worker, and the CV opens ready with questions.
    const started = await fetch(`${baseUrl}/api/cvs/${draft.id}/generations`, {
      method: 'POST',
      headers,
    });
    expect(started.status).toBe(202);
    const job = (await started.json()) as GenerationJobDto;
    expect((await getCv(draft.id)).status).toBe('generating');

    await worker.tick();

    const finished = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`, { headers });
    expect(await finished.json()).toMatchObject({ status: 'COMPLETED' });
    const generated = await getCv(draft.id);
    expect(generated.status).toBe('ready');
    expect(generated.content?.experience.length).toBeGreaterThan(0);
    expect(generated.contentVersion).toBe(1);
    const question = generated.questions.find((q) => q.section === 'experience');
    expect(question).toMatchObject({ status: 'open', itemId: expect.any(String) });

    // 3. An answer is applied to the entry it is about, in the background.
    const answered = await sendJson(
      `${baseUrl}/api/cvs/${draft.id}/questions/${question?.id}/answers`,
      'POST',
      { answer: 'Four engineers across two squads.' },
      headers,
    );
    expect(answered.status).toBe(202);
    await worker.tick();

    const afterAnswer = await getCv(draft.id);
    const role = afterAnswer.content?.experience.find((entry) => entry.id === question?.itemId);
    expect(role?.bullets.map((bullet) => bullet.text)).toContain(
      'Four engineers across two squads.',
    );
    expect(afterAnswer.questions.find((q) => q.id === question?.id)).toMatchObject({
      status: 'answered',
      update: { outcome: 'updated' },
    });
    expect(afterAnswer.contentVersion).toBe(2);

    // 4. The person edits by hand; the save is versioned.
    if (!afterAnswer.content) throw new Error('The CV has no content');
    const edited = {
      ...afterAnswer.content,
      summary: 'Platform engineer who moved the whole build pipeline to GitHub Actions.',
    };
    const saved = await sendJson(
      `${baseUrl}/api/cvs/${draft.id}/content`,
      'PUT',
      { baseVersion: afterAnswer.contentVersion, content: edited },
      headers,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ contentVersion: 3 });

    // 5. The PDF is the CV as saved: A4, with the edit and the answer as selectable text.
    const pdf = await fetch(`${baseUrl}/api/cvs/${draft.id}/pdf`, { headers });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    expect(text).toContain('moved the whole build pipeline to GitHub Actions');
    expect(text).toContain('Four engineers across two squads.');
    expect(text).toContain('EXPERIENCE');

    // 6. Another account can neither see the CV nor download it.
    const other = await signUp(baseUrl, { name: 'Sam Lee', email: 'sam@example.com' });
    const theirs = await fetch(`${baseUrl}/api/cvs/${draft.id}/pdf`, {
      headers: { Cookie: other.cookie },
    });
    expect(theirs.status).toBe(404);
    const theirList = await fetch(`${baseUrl}/api/cvs`, { headers: { Cookie: other.cookie } });
    expect(await theirList.json()).toEqual({ items: [] });
  });
});
