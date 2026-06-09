# email-drafts-project — Claude Code Guide

## What this project does
Polls Gmail for unread inbox emails, uses OpenAI to classify and draft a reply (fetching thread context when needed), creates a Gmail draft, and sends a Telegram notification.

## Project structure

```
supabase/
  functions/
    _shared/
      openai.ts       — OpenAI chat completions wrapper (gpt-4.1-mini)
      gmail.ts        — Gmail API: fetch unread, thread context, create draft
      utils.ts        — Telegram sendMessage helper
    gmail-reply-drafter/
      index.ts        — Main edge function handler
  migrations/
    20240101000000_init.sql          — (superseded, replaced by migration below)
    20240102000000_schema_and_cron.sql — email_drafts schema + cron job
scripts/
  get_gmail_token.py  — One-time Gmail OAuth refresh token helper
.env                  — All credentials (never committed)
```

## Supabase isolation
All tables live in the **`email_drafts` schema** — never in `public` — so they don't collide with other projects on the same Supabase instance (wuffujljaklxumkdeaeu).

| Table | Schema | Purpose |
|-------|--------|---------|
| `processed_emails` | `email_drafts` | Dedup guard — stores processed Gmail message IDs |

The edge function connects with `{ db: { schema: 'email_drafts' } }` so all `supabase.from()` calls target that schema automatically.

## Auto-polling
A `pg_cron` job (`email-drafts-poll`) fires every 15 minutes and calls the edge function via `pg_net`. To change frequency, update the cron expression in `20240102000000_schema_and_cron.sql` and re-run the migration.

To check or cancel the cron job in Postgres:
```sql
-- list jobs
select * from cron.job;

-- remove job
select cron.unschedule('email-drafts-poll');
```

## Environment variables (`.env`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_PASSWORD
OPENAI_API_KEY
TELEGRAM_BOT_TOKEN
ALLOWED_CHAT_ID
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
```

## Supabase secrets (edge function sees these)
Set with `supabase secrets set KEY=value`. Required secrets:
`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_ID`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase at runtime.

## Deploy
```bash
supabase link --project-ref wuffujljaklxumkdeaeu
supabase functions deploy gmail-reply-drafter --no-verify-jwt
```

## Run SQL migrations
```bash
.venv/bin/python3 - <<'EOF'
import os, psycopg2
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(".env")
ref = os.getenv("SUPABASE_URL").split("//")[1].split(".")[0]
conn = psycopg2.connect(host=f"db.{ref}.supabase.co", port=5432,
    dbname="postgres", user="postgres",
    password=os.getenv("SUPABASE_DB_PASSWORD"), sslmode="require")
conn.autocommit = True
cur = conn.cursor()
cur.execute(Path("supabase/migrations/<filename>.sql").read_text())
conn.close()
EOF
```

## Manual trigger / testing
```bash
# Dry run — list unread emails, no drafts created
curl "https://wuffujljaklxumkdeaeu.supabase.co/functions/v1/gmail-reply-drafter?dry_run=true" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# Full run — process all unread, create drafts, notify Telegram
curl -X POST "https://wuffujljaklxumkdeaeu.supabase.co/functions/v1/gmail-reply-drafter" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Testing checklist (Claude can verify without user)
1. **Dry run** — curl with `?dry_run=true`, check email list returned
2. **Gmail drafts** — use Gmail MCP `list_drafts` to confirm drafts appeared
3. **Telegram** — call `getUpdates` on the bot API to verify notifications sent
4. **DB state** — query `email_drafts.processed_emails` via psycopg2 to check status

## Logic flow (mirrors make.com blueprint)
1. Fetch unread inbox emails (max 10 per run)
2. Skip already-processed message IDs
3. For each email → single OpenAI call: classify + draft together
   - Parses `NEED_CONTEXT: yes|no` and the initial draft from the response
4. If `NEED_CONTEXT: yes` → fetch thread context → second OpenAI call for final draft
5. Create Gmail draft (reply in same thread)
6. Send Telegram notification with preview
7. Record message ID in `email_drafts.processed_emails`

## Prompts
Stored inline in `gmail-reply-drafter/index.ts` as `CLASSIFY_PROMPT` and `DRAFT_WITH_CONTEXT_PROMPT`. Edit there to tune behaviour.
