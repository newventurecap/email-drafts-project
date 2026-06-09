-- Move processed_emails to public schema with a prefixed name to avoid collisions.
-- This avoids needing to expose email_drafts schema in PostgREST dashboard settings.

CREATE TABLE IF NOT EXISTS public.email_drafts_processed_emails (
  message_id   text primary key,
  draft_id     text,
  status       text not null default 'ok',
  processed_at timestamptz not null default now()
);

-- Copy any existing rows (likely none, but just in case)
INSERT INTO public.email_drafts_processed_emails
  SELECT * FROM email_drafts.processed_emails
  ON CONFLICT (message_id) DO NOTHING;

DROP TABLE IF EXISTS email_drafts.processed_emails;
