ALTER TABLE "Ticket"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("number"::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce("subject", '')), 'B')
  ) STORED;

CREATE INDEX "Ticket_searchVector_idx" ON "Ticket" USING GIN ("searchVector");

ALTER TABLE "Message"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("bodyMarkdown", ''))
  ) STORED;

CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");
