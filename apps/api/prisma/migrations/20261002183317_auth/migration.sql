-- Accounts created before authentication existed have no password, so nobody could ever log in
-- to them (only the local demo user existed). Remove them first; their CVs, generation jobs and
-- source documents go with them through the cascading foreign keys.
DELETE FROM "users";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" TEXT NOT NULL,
ALTER COLUMN "name" SET NOT NULL;
