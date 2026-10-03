import { describe, expect, it } from 'vitest';
import { arrangeOwnedCv, expectEveryRequestRefused } from '../test/isolation';
import { startAppWithTwoAccounts } from '../test/start-app';

// Every endpoint with a CV, job or question id, with real session cookies. The same checks run
// against PostgreSQL in db/repositories.postgres.test.ts.
describe('user isolation', () => {
  it('answers 404 to another account on every request, and changes nothing', async () => {
    const app = await startAppWithTwoAccounts();
    const cv = await arrangeOwnedCv(app.baseUrl, app.owner, app.repositories);
    const before = structuredClone(app.db);
    const files = [...app.files.keys()];
    const extracted = app.extractorCalls.length;

    await expectEveryRequestRefused(app.baseUrl, cv, app.other.cookie);

    expect(app.db).toEqual(before);
    expect([...app.files.keys()]).toEqual(files);
    expect(app.extractorCalls).toHaveLength(extracted);
    expect(app.pdfRenderCalls).toEqual([]);
  });

  it('answers 401 to every request without a session, and changes nothing', async () => {
    const app = await startAppWithTwoAccounts();
    const cv = await arrangeOwnedCv(app.baseUrl, app.owner, app.repositories);
    const before = structuredClone(app.db);

    await expectEveryRequestRefused(app.baseUrl, cv, null);

    expect(app.db).toEqual(before);
    expect(app.pdfRenderCalls).toEqual([]);
  });
});
