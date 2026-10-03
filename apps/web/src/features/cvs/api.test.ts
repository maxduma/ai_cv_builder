import type { CvDetail, CvListResponse, CvSummary } from '@cv-builder/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { cacheRenamedCv, cvKeys, forgetCv } from './api';

const summary = (id: string, title: string): CvSummary => ({
  id,
  title,
  targetRole: title,
  status: 'ready',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
});

const LIST: CvListResponse = {
  items: [summary('cv-1', 'Backend Engineer'), summary('cv-2', 'Data Engineer')],
};

function clientWithList(list: CvListResponse = LIST) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(cvKeys.list(), list);
  return queryClient;
}

describe('cacheRenamedCv', () => {
  const renamed = {
    ...summary('cv-2', 'For Fieldline'),
    updatedAt: '2026-10-03T12:00:00.000Z',
  } as CvDetail;

  it('gives the card its new name, in the same place, and touches nothing else', () => {
    const queryClient = clientWithList();

    cacheRenamedCv(queryClient, renamed);

    expect(queryClient.getQueryData<CvListResponse>(cvKeys.list())).toEqual({
      items: [
        summary('cv-1', 'Backend Engineer'),
        // The role stays: only the name and the time of the change are new.
        {
          ...summary('cv-2', 'Data Engineer'),
          title: 'For Fieldline',
          updatedAt: renamed.updatedAt,
        },
      ],
    });
  });

  it('marks the CV’s own page stale, so it is fetched again when something shows it', () => {
    const queryClient = clientWithList();
    queryClient.setQueryData(cvKeys.detail('cv-2'), { ...renamed, title: 'Data Engineer' });

    cacheRenamedCv(queryClient, renamed);

    expect(queryClient.getQueryState(cvKeys.detail('cv-2'))?.isInvalidated).toBe(true);
  });

  it('does nothing when the list was never loaded', () => {
    const queryClient = new QueryClient();

    cacheRenamedCv(queryClient, renamed);

    expect(queryClient.getQueryData(cvKeys.list())).toBeUndefined();
  });
});

describe('forgetCv', () => {
  it('takes the CV out of the list and forgets its page', async () => {
    const queryClient = clientWithList();
    queryClient.setQueryData(cvKeys.detail('cv-1'), summary('cv-1', 'Backend Engineer'));
    queryClient.setQueryData(cvKeys.detail('cv-2'), summary('cv-2', 'Data Engineer'));

    await forgetCv(queryClient, 'cv-1');

    expect(queryClient.getQueryData<CvListResponse>(cvKeys.list())).toEqual({
      items: [summary('cv-2', 'Data Engineer')],
    });
    expect(queryClient.getQueryData(cvKeys.detail('cv-1'))).toBeUndefined();
    expect(queryClient.getQueryData(cvKeys.detail('cv-2'))).toBeDefined();
  });

  it('cancels a list fetch that started before the delete, which would put the CV back', async () => {
    const queryClient = clientWithList();
    let answer!: (list: CvListResponse) => void;
    // The poll that was in flight: it left before the DELETE, so its answer still has the CV.
    const staleFetch = queryClient
      .fetchQuery({
        queryKey: cvKeys.list(),
        staleTime: 0,
        queryFn: () => new Promise<CvListResponse>((resolve) => (answer = resolve)),
      })
      .catch(() => undefined);

    await forgetCv(queryClient, 'cv-1');
    answer(LIST);
    await staleFetch;

    expect(
      queryClient.getQueryData<CvListResponse>(cvKeys.list())?.items.map((cv) => cv.id),
    ).toEqual(['cv-2']);
  });

  it('does nothing to a list that was never loaded', async () => {
    const queryClient = new QueryClient();

    await forgetCv(queryClient, 'cv-1');

    expect(queryClient.getQueryData(cvKeys.list())).toBeUndefined();
  });
});
