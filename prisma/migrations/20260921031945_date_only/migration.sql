-- AlterTable
ALTER TABLE "message" ADD COLUMN     "date_only" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "thread" ADD COLUMN     "started_date_only" BOOLEAN NOT NULL DEFAULT false;
