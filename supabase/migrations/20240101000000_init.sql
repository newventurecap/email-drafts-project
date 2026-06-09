-- Tracks Gmail message IDs that have been processed so we never re-draft the same email
create table if not exists processed_emails (
  message_id   text primary key,
  draft_id     text,
  status       text not null default 'ok',
  processed_at timestamptz not null default now()
);
