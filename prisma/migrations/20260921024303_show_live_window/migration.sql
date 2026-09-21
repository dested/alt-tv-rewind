-- DropIndex
DROP INDEX "message_search_idx";

-- AlterTable
ALTER TABLE "message" ALTER COLUMN "search" DROP DEFAULT;

-- AlterTable
ALTER TABLE "show" ADD COLUMN     "live_window_days" INTEGER NOT NULL DEFAULT 10;
