-- ── Dedicated schema so this project's tables never collide with others ────────
create schema if not exists email_drafts;

-- ── Move processed_emails into the email_drafts schema ────────────────────────
-- Drop the public table created in the first migration and recreate under the schema
drop table if exists public.processed_emails;

create table if not exists email_drafts.processed_emails (
  message_id   text primary key,
  draft_id     text,
  status       text not null default 'ok',
  processed_at timestamptz not null default now()
);

-- ── Expose the schema to the Supabase REST API ─────────────────────────────────
-- Required so supabase-js can query email_drafts.* via the service role
comment on schema email_drafts is 'email-drafts-project isolated schema';

-- ── Auto-polling via pg_cron + pg_net ─────────────────────────────────────────
-- Requires pg_cron and pg_net (both enabled by default on Supabase)
-- Polls every 15 minutes; adjust the cron expression to change frequency.

-- Replace <SUPABASE_SERVICE_ROLE_KEY> with your project's service_role key before running.
-- The cron job calls the edge function from within Supabase's own infrastructure.
-- To apply: run this block manually in the Supabase SQL editor or via psycopg2 after substituting the key.
--
-- select cron.schedule(
--   'email-drafts-poll',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://wuffujljaklxumkdeaeu.supabase.co/functions/v1/gmail-reply-drafter',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
--       'Content-Type',  'application/json'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
