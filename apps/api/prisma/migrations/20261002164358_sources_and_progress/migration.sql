-- AlterTable
ALTER TABLE "cvs" ADD COLUMN     "source_text" TEXT;

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "progress_step" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "source_documents" ADD COLUMN     "page_count" INTEGER;
