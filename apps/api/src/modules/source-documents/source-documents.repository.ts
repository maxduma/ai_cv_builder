import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';

export const sourceDocumentColumns = {
  id: true,
  originalName: true,
  sizeBytes: true,
  pageCount: true,
  createdAt: true,
} satisfies Prisma.SourceDocumentSelect;

export type SourceDocumentRecord = Prisma.SourceDocumentGetPayload<{
  select: typeof sourceDocumentColumns;
}>;

export interface NewSourceDocument {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  storageKey: string;
  extractedText: string;
}

/** Data access for uploaded source files. A CV keeps one source document at a time. */
export function createSourceDocumentsRepository(prisma: PrismaClient) {
  /** Locks the user's CV row for the transaction; false if the user has no such CV. */
  async function lockCv(tx: Prisma.TransactionClient, userId: string, cvId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cvs WHERE id = ${cvId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  async function takeExisting(tx: Prisma.TransactionClient, userId: string, cvId: string) {
    const existing = await tx.sourceDocument.findMany({
      where: { cvId, userId },
      select: { storageKey: true },
    });
    if (existing.length > 0) {
      await tx.sourceDocument.deleteMany({ where: { cvId, userId } });
    }
    return existing.map((document) => document.storageKey);
  }

  /** A changed source counts as a change to the CV (it moves to the top of "My CVs"). */
  async function touchCv(tx: Prisma.TransactionClient, userId: string, cvId: string) {
    await tx.cv.update({
      where: { id_userId: { id: cvId, userId } },
      data: { updatedAt: new Date() },
    });
  }

  return {
    /**
     * Stores `document` as the CV's source document, replacing any previous one. Returns `null` if
     * the user has no such CV, otherwise the new record and the storage keys of the replaced files,
     * which the caller deletes once this transaction has committed.
     */
    replaceForCv(
      userId: string,
      cvId: string,
      document: NewSourceDocument,
    ): Promise<{ document: SourceDocumentRecord; replacedKeys: string[] } | null> {
      // The row lock serialises concurrent uploads, so a CV never ends up with two documents.
      return prisma.$transaction(async (tx) => {
        if (!(await lockCv(tx, userId, cvId))) return null;
        const replacedKeys = await takeExisting(tx, userId, cvId);
        const created = await tx.sourceDocument.create({
          data: { ...document, cvId, userId },
          select: sourceDocumentColumns,
        });
        await touchCv(tx, userId, cvId);
        return { document: created, replacedKeys };
      });
    },

    /** Removes the CV's source document. Returns the removed storage keys, or `null` if there's no such CV. */
    removeForCv(userId: string, cvId: string): Promise<string[] | null> {
      return prisma.$transaction(async (tx) => {
        if (!(await lockCv(tx, userId, cvId))) return null;
        const removedKeys = await takeExisting(tx, userId, cvId);
        if (removedKeys.length > 0) {
          await touchCv(tx, userId, cvId);
        }
        return removedKeys;
      });
    },
  };
}

export type SourceDocumentsRepository = ReturnType<typeof createSourceDocumentsRepository>;
