-- Quoted lines (">" / "|" prefixed) are other people's words; indexing them
-- double-counts text for ranking and lets ts_headline surface quotes as hits.
CREATE OR REPLACE FUNCTION message_search_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search := to_tsvector(
    'english',
    coalesce(NEW.subject, '') || ' ' ||
    regexp_replace(coalesce(NEW.body, ''), '(^|\n)[ \t]*(>|\|)[^\n]*', ' ', 'g')
  );
  RETURN NEW;
END $$;

-- Backfill: re-fires the UPDATE OF body trigger for every existing row.
UPDATE "message" SET body = body;
