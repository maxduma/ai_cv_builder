import { type ContentIssue, type CvContent, CvContentSchema } from '@cv-builder/shared';
import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { generationJobColumns } from '../generation/generation.repository';
import { cvQuestionColumns } from '../questions/questions.repository';
import { sourceDocumentColumns } from '../source-documents/source-documents.repository';

const latestFirst = { createdAt: 'desc' } as const;
/** A CV's status comes from its generation jobs; answer jobs only update its content. */
const generations = { kind: 'GENERATE' } as const;

// Explicit column lists. Only a single CV loads its `content`; lists never do (it can be large).
const summaryColumns = {
  id: true,
  title: true,
  targetRole: true,
  createdAt: true,
  updatedAt: true,
  // The latest generation decides the CV's status.
  generationJobs: { where: generations, orderBy: latestFirst, take: 1, select: { status: true } },
} satisfies Prisma.CvSelect;

const detailColumns = {
  ...summaryColumns,
  sourceText: true,
  content: true,
  contentVersion: true,
  sourceDocuments: { orderBy: latestFirst, take: 1, select: sourceDocumentColumns },
  generationJobs: {
    where: generations,
    orderBy: latestFirst,
    take: 1,
    select: generationJobColumns,
  },
  questions: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: cvQuestionColumns },
} satisfies Prisma.CvSelect;

export type CvSummaryRecord = Prisma.CvGetPayload<{ select: typeof summaryColumns }>;
export type CvDetailRecord = Prisma.CvGetPayload<{ select: typeof detailColumns }>;

export interface NewCv {
  title: string;
  targetRole: string | null;
  sourceText: string | null;
}

export type CvChanges = Partial<NewCv>;

export type SaveContentResult =
  | { kind: 'not_found' }
  | { kind: 'not_generated' }
  /** Someone else (another tab, an applied answer) wrote a newer version first. */
  | { kind: 'conflict'; content: CvContent; contentVersion: number }
  | { kind: 'invalid'; issues: ContentIssue[] }
  | { kind: 'saved'; contentVersion: number };

/** Data access for CVs. Every query is scoped to the owning user. */
export function createCvsRepository(prisma: PrismaClient) {
  /**
   * The CV with its relations, as of one moment: Prisma reads relations in separate queries, and
   * an answer applied between them would pair a question's finished update with older content.
   */
  function findForUser(userId: string, cvId: string): Promise<CvDetailRecord | null> {
    return prisma.$transaction(
      (tx) =>
        tx.cv.findUnique({
          where: { id_userId: { id: cvId, userId } },
          select: detailColumns,
        }),
      { isolationLevel: 'RepeatableRead' },
    );
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

    /**
     * Replaces the CV's content if it is still at `baseVersion`, with the row locked, so the
     * check and the write can't interleave with another save or an answer being applied.
     * `check` sees the stored content and reports what's wrong with the new one.
     */
    saveContent(
      userId: string,
      cvId: string,
      content: CvContent,
      baseVersion: number,
      check: (stored: CvContent) => ContentIssue[],
    ): Promise<SaveContentResult> {
      return prisma.$transaction(async (tx) => {
        const [cv] = await tx.$queryRaw<{ content: unknown; content_version: number }[]>`
          SELECT content, content_version FROM cvs
          WHERE id = ${cvId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        if (!cv) return { kind: 'not_found' } as const;
        // Content exists from version 1 on (the first generation writes it).
        if (cv.content_version === 0) return { kind: 'not_generated' } as const;

        // Stored content the schema refuses is a fault on our side (500), not a bad request (400).
        const parsed = CvContentSchema.safeParse(cv.content);
        if (!parsed.success) {
          throw new Error('The stored CV content does not match the schema', {
            cause: parsed.error,
          });
        }
        const stored = parsed.data;
        if (cv.content_version !== baseVersion) {
          return { kind: 'conflict', content: stored, contentVersion: cv.content_version } as const;
        }
        const issues = check(stored);
        if (issues.length > 0) return { kind: 'invalid', issues } as const;

        await tx.cv.update({
          where: { id_userId: { id: cvId, userId } },
          data: { content, contentVersion: { increment: 1 } },
        });
        return { kind: 'saved', contentVersion: baseVersion + 1 } as const;
      });
    },
  };
}

export type CvsRepository = ReturnType<typeof createCvsRepository>;
