-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('reaction', 'prediction', 'theory', 'question', 'trivia', 'quote', 'news', 'meta', 'offtopic', 'spam');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('loved', 'liked', 'mixed', 'disliked', 'hated', 'neutral');

-- CreateEnum
CREATE TYPE "PredictionOutcome" AS ENUM ('came_true', 'did_not', 'unknown');

-- CreateEnum
CREATE TYPE "EpisodeRelation" AS ENUM ('live', 'retro');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tvmaze_id" INTEGER,
    "premiered" DATE,
    "ended" DATE,
    "network" TEXT,
    "summary" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season" (
    "id" SERIAL NOT NULL,
    "show_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "premiered" DATE,
    "ended" DATE,
    "episode_count" INTEGER NOT NULL DEFAULT 0,
    "live_message_count" INTEGER NOT NULL DEFAULT 0,
    "retro_message_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode" (
    "id" SERIAL NOT NULL,
    "show_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "season_number" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "air_date" DATE NOT NULL,
    "air_stamp" TIMESTAMP(3),
    "runtime" INTEGER,
    "summary" TEXT,
    "image_url" TEXT,
    "tvmaze_id" INTEGER,
    "tvmaze_rating" DOUBLE PRECISION,
    "live_thread_count" INTEGER NOT NULL DEFAULT 0,
    "live_message_count" INTEGER NOT NULL DEFAULT 0,
    "live_poster_count" INTEGER NOT NULL DEFAULT 0,
    "retro_thread_count" INTEGER NOT NULL DEFAULT 0,
    "retro_message_count" INTEGER NOT NULL DEFAULT 0,
    "usenet_score" DOUBLE PRECISION,
    "recap" TEXT,
    "recap_model" TEXT,

    CONSTRAINT "episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive" (
    "id" SERIAL NOT NULL,
    "show_id" INTEGER NOT NULL,
    "newsgroup" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "thread_count" INTEGER NOT NULL DEFAULT 0,
    "spam_count" INTEGER NOT NULL DEFAULT 0,
    "first_post_at" TIMESTAMP(3),
    "last_post_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poster" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "thread_count" INTEGER NOT NULL DEFAULT 0,
    "prediction_count" INTEGER NOT NULL DEFAULT 0,
    "prediction_hits" INTEGER NOT NULL DEFAULT 0,
    "first_post_at" TIMESTAMP(3),
    "last_post_at" TIMESTAMP(3),

    CONSTRAINT "poster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread" (
    "id" SERIAL NOT NULL,
    "show_id" INTEGER NOT NULL,
    "archive_id" INTEGER NOT NULL,
    "root_message_id" INTEGER,
    "subject" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_post_at" TIMESTAMP(3) NOT NULL,
    "message_count" INTEGER NOT NULL,
    "poster_count" INTEGER NOT NULL,
    "max_depth" INTEGER NOT NULL,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    "kind" "ThreadKind",
    "sentiment" "Sentiment",
    "hot_take" BOOLEAN,
    "controversy" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "pull_quote" TEXT,
    "pull_quote_message_id" INTEGER,
    "prediction_claim" TEXT,
    "prediction_outcome" "PredictionOutcome",
    "classified_at" TIMESTAMP(3),
    "classify_model" TEXT,

    CONSTRAINT "thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_episode" (
    "thread_id" INTEGER NOT NULL,
    "episode_id" INTEGER NOT NULL,
    "relation" "EpisodeRelation" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "thread_episode_pkey" PRIMARY KEY ("thread_id","episode_id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SERIAL NOT NULL,
    "archive_id" INTEGER NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "poster_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "parent_ref" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "message_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    -- hand-written: full-text index over subject + body (Prisma cannot express generated columns)
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("subject", '') || ' ' || coalesce("body", ''))) STORED,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- hand-written: GIN index for the generated tsvector
CREATE INDEX "message_search_idx" ON "message" USING GIN ("search");

-- CreateTable
CREATE TABLE "daily_volume" (
    "show_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "message_count" INTEGER NOT NULL,
    "thread_count" INTEGER NOT NULL,

    CONSTRAINT "daily_volume_pkey" PRIMARY KEY ("show_id","day")
);

-- CreateTable
CREATE TABLE "phrase" (
    "id" SERIAL NOT NULL,
    "show_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "episode_slug" TEXT,
    "first_message_id" INTEGER,
    "first_at" TIMESTAMP(3),
    "total_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "phrase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phrase_monthly" (
    "phrase_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "phrase_monthly_pkey" PRIMARY KEY ("phrase_id","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "show_slug_key" ON "show"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "show_tvmaze_id_key" ON "show"("tvmaze_id");

-- CreateIndex
CREATE UNIQUE INDEX "season_show_id_number_key" ON "season"("show_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "episode_show_id_slug_key" ON "episode"("show_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "episode_show_id_season_number_number_key" ON "episode"("show_id", "season_number", "number");

-- CreateIndex
CREATE UNIQUE INDEX "archive_newsgroup_key" ON "archive"("newsgroup");

-- CreateIndex
CREATE UNIQUE INDEX "poster_key_key" ON "poster"("key");

-- CreateIndex
CREATE INDEX "poster_message_count_idx" ON "poster"("message_count");

-- CreateIndex
CREATE UNIQUE INDEX "thread_root_message_id_key" ON "thread"("root_message_id");

-- CreateIndex
CREATE INDEX "thread_show_id_started_at_idx" ON "thread"("show_id", "started_at");

-- CreateIndex
CREATE INDEX "thread_show_id_message_count_idx" ON "thread"("show_id", "message_count");

-- CreateIndex
CREATE INDEX "thread_show_id_controversy_idx" ON "thread"("show_id", "controversy");

-- CreateIndex
CREATE INDEX "thread_show_id_kind_idx" ON "thread"("show_id", "kind");

-- CreateIndex
CREATE INDEX "thread_episode_episode_id_relation_confidence_idx" ON "thread_episode"("episode_id", "relation", "confidence");

-- CreateIndex
CREATE INDEX "message_thread_id_posted_at_idx" ON "message"("thread_id", "posted_at");

-- CreateIndex
CREATE INDEX "message_poster_id_posted_at_idx" ON "message"("poster_id", "posted_at");

-- CreateIndex
CREATE INDEX "message_archive_id_posted_at_idx" ON "message"("archive_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_archive_id_message_id_key" ON "message"("archive_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "phrase_show_id_slug_key" ON "phrase"("show_id", "slug");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive" ADD CONSTRAINT "archive_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_episode" ADD CONSTRAINT "thread_episode_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_episode" ADD CONSTRAINT "thread_episode_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_poster_id_fkey" FOREIGN KEY ("poster_id") REFERENCES "poster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_volume" ADD CONSTRAINT "daily_volume_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phrase" ADD CONSTRAINT "phrase_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phrase_monthly" ADD CONSTRAINT "phrase_monthly_phrase_id_fkey" FOREIGN KEY ("phrase_id") REFERENCES "phrase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
