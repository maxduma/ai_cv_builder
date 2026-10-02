-- Rename the job statuses in place, so existing jobs keep theirs. (Prisma would generate a
-- drop-and-recreate of the type instead, which fails on existing rows.) The column default
-- follows the rename, because enum values are stored by reference.
ALTER TYPE "generation_job_status" RENAME VALUE 'QUEUED' TO 'PENDING';
ALTER TYPE "generation_job_status" RENAME VALUE 'RUNNING' TO 'PROCESSING';
ALTER TYPE "generation_job_status" RENAME VALUE 'SUCCEEDED' TO 'COMPLETED';

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "issues" JSONB;
