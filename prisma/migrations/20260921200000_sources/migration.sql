-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('usenet', 'forum', 'capsule');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('public', 'metadata_only');

-- CreateEnum
CREATE TYPE "OriginalStatus" AS ENUM ('live', 'offline', 'unknown');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('post', 'compiled_document');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('second', 'minute', 'day', 'unknown');

-- CreateEnum
CREATE TYPE "AssociationStatus" AS ENUM ('accepted', 'context', 'excluded', 'needs_review');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'imported', 'linked', 'skipped');

-- CreateEnum
CREATE TYPE "ContributionKind" AS ENUM ('review', 'observation', 'editorial', 'grade', 'quote', 'summary', 'unknown');

-- DropIndex
DROP INDEX "archive_newsgroup_key";

-- AlterTable
ALTER TABLE "archive" ADD COLUMN     "source_id" INTEGER;

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "date_precision" "DatePrecision",
ADD COLUMN     "source_record_id" INTEGER;

-- AlterTable
ALTER TABLE "thread" ADD COLUMN     "import_key" TEXT;

-- CreateTable
CREATE TABLE "source" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "community_key" TEXT NOT NULL,
    "home_url" TEXT,
    "custodian" TEXT,
    "collection_url" TEXT,
    "original_status" "OriginalStatus" NOT NULL DEFAULT 'unknown',
    "original_checked_at" TIMESTAMP(3),
    "publication" "PublicationStatus" NOT NULL DEFAULT 'public',
    "notes" TEXT[],
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "coverage_from" DATE,
    "coverage_to" DATE,
    "date_precision_counts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_length" BIGINT,
    "format" TEXT NOT NULL,
    "download_url" TEXT,
    "custodian" TEXT,
    "captured_at" TIMESTAMP(3),
    "retrieved_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_record" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "record_id" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "thread_external_id" TEXT,
    "identity_method" TEXT,
    "original_url" TEXT,
    "title" TEXT NOT NULL,
    "author_name" TEXT,
    "author_external_id" TEXT,
    "poster_key" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_date" DATE,
    "date_precision" "DatePrecision" NOT NULL,
    "date_timezone" TEXT,
    "date_raw" TEXT,
    "date_derivation" TEXT,
    "newsgroups" TEXT[],
    "references" TEXT[],
    "in_reply_to" TEXT,
    "body" TEXT NOT NULL,
    "body_length" INTEGER NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "has_content_conflict" BOOLEAN NOT NULL DEFAULT false,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    "spam_reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "source_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation" (
    "id" SERIAL NOT NULL,
    "observation_id" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "artifact_id" INTEGER NOT NULL,
    "locator" TEXT NOT NULL,
    "byte_offset" BIGINT,
    "byte_length" INTEGER,
    "original_url" TEXT,
    "captured_page_url" TEXT,
    "captured_at" TIMESTAMP(3),
    "retrieved_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "content_sha256" TEXT NOT NULL,
    "raw_sha256" TEXT,
    "warc_record_id" TEXT,
    "archive_collection_id" TEXT,
    "archive_url" TEXT,
    "differs_from_record" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_show" (
    "record_id" INTEGER NOT NULL,
    "show_id" INTEGER NOT NULL,
    "episode_id" INTEGER,
    "status" "AssociationStatus" NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" INTEGER,
    "reason" TEXT,
    "conversation_key" TEXT,
    "in_era" BOOLEAN NOT NULL DEFAULT true,
    "import_status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "message_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_show_pkey" PRIMARY KEY ("record_id","show_id")
);

-- CreateTable
CREATE TABLE "contribution" (
    "id" SERIAL NOT NULL,
    "record_id" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "kind" "ContributionKind" NOT NULL,
    "attribution" TEXT,
    "text" TEXT NOT NULL,
    "text_sha256" TEXT NOT NULL,
    "span_start" INTEGER NOT NULL,
    "span_end" INTEGER NOT NULL,
    "extraction_status" TEXT NOT NULL,
    "publication" "PublicationStatus" NOT NULL DEFAULT 'metadata_only',

    CONSTRAINT "contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_source" (
    "message_id" INTEGER NOT NULL,
    "record_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "message_source_pkey" PRIMARY KEY ("message_id","record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_key_key" ON "source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_source_id_path_key" ON "artifact"("source_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "source_record_record_id_key" ON "source_record"("record_id");

-- CreateIndex
CREATE INDEX "source_record_canonical_id_idx" ON "source_record"("canonical_id");

-- CreateIndex
CREATE INDEX "source_record_source_id_posted_date_idx" ON "source_record"("source_id", "posted_date");

-- CreateIndex
CREATE INDEX "source_record_source_id_external_id_idx" ON "source_record"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "source_record_source_id_thread_external_id_idx" ON "source_record"("source_id", "thread_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "observation_observation_id_key" ON "observation"("observation_id");

-- CreateIndex
CREATE INDEX "observation_record_id_idx" ON "observation"("record_id");

-- CreateIndex
CREATE INDEX "record_show_show_id_status_idx" ON "record_show"("show_id", "status");

-- CreateIndex
CREATE INDEX "record_show_show_id_episode_id_idx" ON "record_show"("show_id", "episode_id");

-- CreateIndex
CREATE INDEX "record_show_show_id_conversation_key_idx" ON "record_show"("show_id", "conversation_key");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_record_id_ordinal_key" ON "contribution"("record_id", "ordinal");

-- CreateIndex
CREATE INDEX "message_source_by_record_idx" ON "message_source"("record_id");

-- CreateIndex
CREATE INDEX "archive_source_id_idx" ON "archive"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "archive_show_id_newsgroup_key" ON "archive"("show_id", "newsgroup");

-- CreateIndex
CREATE INDEX "message_source_record_id_idx" ON "message"("source_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_show_id_import_key_key" ON "thread"("show_id", "import_key");

-- AddForeignKey
ALTER TABLE "archive" ADD CONSTRAINT "archive_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation" ADD CONSTRAINT "observation_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "source_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation" ADD CONSTRAINT "observation_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_show" ADD CONSTRAINT "record_show_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "source_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_show" ADD CONSTRAINT "record_show_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_show" ADD CONSTRAINT "record_show_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "source_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_source" ADD CONSTRAINT "message_source_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_source" ADD CONSTRAINT "message_source_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "source_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written backfill: every legacy archive becomes a legacy Source so each
-- existing post has a community ("alt.tv.seinfeld") the UI can name. No
-- retrieval or capture timestamps are invented — the one-newsgroup pipeline
-- never recorded them; artifact rows are added later by `pipeline sources
-- inventory`, which hashes the local mbox at verification time.
INSERT INTO "source" ("key", "kind", "name", "community_key", "home_url", "custodian", "collection_url",
                      "original_status", "publication", "notes", "legacy",
                      "record_count", "coverage_from", "coverage_to")
SELECT 'usenet-' || replace(a."newsgroup", '.', '-'),
       'usenet'::"SourceKind",
       a."newsgroup",
       a."newsgroup",
       'https://groups.google.com/g/' || a."newsgroup",
       'Internet Archive (usenet-alt collection)',
       'https://archive.org/details/usenet-alt',
       'unknown'::"OriginalStatus",
       'public'::"PublicationStatus",
       ARRAY['Loaded by the one-newsgroup pipeline from the usenet-alt mbox; download time was not recorded.'],
       true,
       a."message_count",
       (a."first_post_at" AT TIME ZONE 'UTC')::date,
       (a."last_post_at" AT TIME ZONE 'UTC')::date
FROM "archive" a
ON CONFLICT ("key") DO NOTHING;

UPDATE "archive" a SET "source_id" = s."id"
FROM "source" s
WHERE s."key" = 'usenet-' || replace(a."newsgroup", '.', '-') AND a."source_id" IS NULL;
