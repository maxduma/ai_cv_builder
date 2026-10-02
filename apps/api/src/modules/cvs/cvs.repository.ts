import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { generationJobColumns } from '../generation/generation.repository';
import { sourceDocumentColumns } from '../source-documents/source-documents.repository';

const latestFirst = { createdAt: 'desc' } as const;

// Explicit column lists. Only a single CV loads its `content`; lists never do (it can be large).
const summaryColumns = {
  id: true,
  title: true,
  targetRole: true,
  createdAt: true,
  updatedAt: true,
  // The latest job decides the CV's status.
  generationJobs: { orderBy: latestFirst, take: 1, select: { status: true } },
} satisfies Prisma.CvSelect;

const detailColumns = {
  ...summaryColumns,
  sourceText: true,
  content: true,
  sourceDocuments: { orderBy: latestFirst, take: 1, select: sourceDocumentColumns },
  generationJobs: { orderBy: latestFirst, take: 1, select: generationJobColumns },
} satisfies Prisma.CvSelect;

export type CvSummaryRecord = Prisma.CvGetPayload<{ select: typeof summaryColumns }>;
export type CvDetailRecord = Prisma.CvGetPayload<{ select: typeof detailColumns }>;

export interface NewCv {
  title: string;
  targetRole: string | null;
  sourceText: string | null;
}

export type CvChanges = Partial<NewCv>;

/** Data access for CVs. Every query is scoped to the owning user. */
export function createCvsRepository(prisma: PrismaClient) {
  function findForUser(userId: string, cvId: string): Promise<CvDetailRecord | null> {
    return prisma.cv.findUnique({
      where: { id_userId: { id: cvId, userId } },
      select: detailColumns,
    });
  }

  return {
    listForUser(userId: string): Promise<CvSummaryRecord[]> {
      return prisma.cv.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: summaryColumns,
      });
    },

    findForUser,

    async existsForUser(userId: string, cvId: string): Promise<boolean> {
      const count = await prisma.cv.count({ where: { id: cvId, userId } });
      return count > 0;
    },

    create(userId: string, cv: NewCv): Promise<CvDetailRecord> {
      return prisma.cv.create({
        data: { ...cv, userId },
        select: detailColumns,
      });
    },

    /** Applies `changes` to the user's CV; `null` if the user has no such CV. */
    async update(userId: string, cvId: string, changes: CvChanges): Promise<CvDetailRecord | null> {
      if (Object.keys(changes).length > 0) {
        const { count } = await prisma.cv.updateMany({
          where: { id: cvId, userId },
          data: changes,
        });
        if (count === 0) return null;
      }
      return findForUser(userId, cvId);
    },
  };
}

export type CvsRepository = ReturnType<typeof createCvsRepository>;
