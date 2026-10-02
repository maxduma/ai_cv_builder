import type { PrismaClient } from '../../db/prisma';
import { Prisma } from '../../generated/prisma/client';

// The password hash is not among these: only `findCredentialsByEmail` reads it.
const userColumns = {
  id: true,
  email: true,
  name: true,
} satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof userColumns }>;

export interface UserCredentials extends UserRecord {
  passwordHash: string;
}

export interface NewUser {
  /** Normalised (trimmed, lowercased) by the caller: the unique index is case-sensitive. */
  email: string;
  name: string;
  passwordHash: string;
}

export type CreateUserResult = { kind: 'created'; user: UserRecord } | { kind: 'email_taken' };

/** Data access for user accounts. */
export function createUsersRepository(prisma: PrismaClient) {
  return {
    /**
     * Creates an account, or reports that the email is taken. The unique index decides, so two
     * concurrent sign-ups with one email can't both succeed.
     */
    async create(user: NewUser): Promise<CreateUserResult> {
      try {
        const created = await prisma.user.create({ data: user, select: userColumns });
        return { kind: 'created', user: created };
      } catch (error) {
        // `email` is the only unique column besides the generated id.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { kind: 'email_taken' };
        }
        throw error;
      }
    },

    /** For checking a login: the only query that reads the password hash. */
    findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
      return prisma.user.findUnique({
        where: { email },
        select: { ...userColumns, passwordHash: true },
      });
    },

    findById(id: string): Promise<UserRecord | null> {
      return prisma.user.findUnique({ where: { id }, select: userColumns });
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
