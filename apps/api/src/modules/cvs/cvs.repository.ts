import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';

// Explicit column lists: `content` is never loaded by these queries (it can be large).
const summaryColumns = {
  id: true,
  title: true,
  targetRole: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CvSelect;

const detailColumns = { ...summaryColumns, jobDescription: true } satisfies Prisma.CvSelect;

export type CvSummaryRecord = Prisma.CvGetPayload<{ select: typeof summaryColumns }>;
export type CvDetailRecord = Prisma.CvGetPayload<{ select: typeof detailColumns }>;

export interface NewCv {
  title: string;
  targetRole?: string;
  jobDescription?: string;
}

/** Data access for CVs. Every query is scoped to the owning user. */
export function createCvsRepository(prisma: PrismaClient) {
  return {
    listForUser(userId: string): Promise<CvSummaryRecord[]> {
      return prisma.cv.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: summaryColumns,
      });
    },

    findForUser(userId: string, cvId: string): Promise<CvDetailRecord | null> {
      return prisma.cv.findUnique({
        where: { id_userId: { id: cvId, userId } },
        select: detailColumns,
      });
    },

    create(userId: string, cv: NewCv): Promise<CvDetailRecord> {
      return prisma.cv.create({
        data: { ...cv, userId },
        select: detailColumns,
      });
    },
  };
}

export type CvsRepository = ReturnType<typeof createCvsRepository>;
