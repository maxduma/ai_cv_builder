-- CreateEnum
CREATE TYPE "generation_job_kind" AS ENUM ('GENERATE', 'APPLY_ANSWER');

-- CreateEnum
CREATE TYPE "cv_question_status" AS ENUM ('OPEN', 'SKIPPED', 'ANSWERED', 'DISMISSED');

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "kind" "generation_job_kind" NOT NULL DEFAULT 'GENERATE',
ADD COLUMN     "question_id" UUID;

-- CreateTable
CREATE TABLE "cv_questions" (
    "id" UUID NOT NULL,
    "cv_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "item_id" TEXT,
    "question" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "status" "cv_question_status" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "follow_up" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cv_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cv_questions_cv_id_position_idx" ON "cv_questions"("cv_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "cv_questions_id_cv_id_key" ON "cv_questions"("id", "cv_id");

-- CreateIndex
CREATE INDEX "generation_jobs_question_id_created_at_idx" ON "generation_jobs"("question_id", "created_at");

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_question_id_cv_id_fkey" FOREIGN KEY ("question_id", "cv_id") REFERENCES "cv_questions"("id", "cv_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_questions" ADD CONSTRAINT "cv_questions_cv_id_user_id_fkey" FOREIGN KEY ("cv_id", "user_id") REFERENCES "cvs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: until now, a CV's questions lived only in its generation job's `issues`. Copy those of
-- each CV's latest job, when that job completed, as open questions. Prisma fills `id` and
-- `updated_at` itself, so they are set here (random UUIDs are as valid as v7 ones).
INSERT INTO "cv_questions" ("id", "cv_id", "user_id", "position", "section", "kind", "target", "question", "why", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), j."cv_id", j."user_id", e.ord - 1, e.v->>'section', e.v->>'kind',
       e.v->>'target', e.v->>'question', e.v->>'why', 'OPEN', now(), now()
FROM (
    SELECT DISTINCT ON ("cv_id") "cv_id", "user_id", "status", "issues"
    FROM "generation_jobs"
    ORDER BY "cv_id", "created_at" DESC, "id" DESC
) j
CROSS JOIN LATERAL jsonb_array_elements(j."issues") WITH ORDINALITY AS e(v, ord)
WHERE j."status" = 'COMPLETED' AND jsonb_typeof(j."issues") = 'array';
