import { createCvsRepository } from '../modules/cvs/cvs.repository';
import { createGenerationRepository } from '../modules/generation/generation.repository';
import { createSourceDocumentsRepository } from '../modules/source-documents/source-documents.repository';
import { createUsersRepository } from '../modules/users/users.repository';
import type { PrismaClient } from './prisma';

/** All data access, built once at startup. Tests pass in-memory implementations instead. */
export function createRepositories(prisma: PrismaClient) {
  return {
    users: createUsersRepository(prisma),
    cvs: createCvsRepository(prisma),
    sourceDocuments: createSourceDocumentsRepository(prisma),
    generation: createGenerationRepository(prisma),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
