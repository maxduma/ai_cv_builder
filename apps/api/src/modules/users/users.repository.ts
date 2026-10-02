import type { PrismaClient } from '../../db/prisma';

export function createUsersRepository(prisma: PrismaClient) {
  return {
    /** Returns the user with this email, creating it first if it doesn't exist. */
    upsertByEmail(email: string, name: string) {
      return prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name },
        select: { id: true, email: true },
      });
    },
  };
}
