-- Stable URL identity for threads: 12 hex chars of sha256("<show slug>:<earliest message's RFC id>").
-- Backfilled here for existing rows; pipeline/stages/load.ts recomputes it on every load with the
-- same expression. The default '' only exists so the loader can insert before messages land.
ALTER TABLE "thread" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';

UPDATE "thread" t
SET "slug" = coalesce(
    left(encode(sha256(convert_to(s."slug" || ':' || (
      SELECT m."message_id" FROM "message" m
      WHERE m."thread_id" = t."id" ORDER BY m."posted_at", m."id" LIMIT 1
    ), 'UTF8')), 'hex'), 12),
    '~' || t."id")  -- a thread whose messages are not loaded yet keeps a unique placeholder
FROM "show" s
WHERE s."id" = t."show_id";

ALTER TABLE "thread" ALTER COLUMN "slug" DROP DEFAULT;

CREATE UNIQUE INDEX "thread_show_id_slug_key" ON "thread"("show_id", "slug");
