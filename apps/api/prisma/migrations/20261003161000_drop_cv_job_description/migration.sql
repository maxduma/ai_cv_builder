-- AlterTable
-- `job_description` was never read or written: tailoring a CV to a job description is out of scope.
ALTER TABLE "cvs" DROP COLUMN "job_description";
