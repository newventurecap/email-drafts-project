# email-drafts-project

Automatically drafts Gmail replies using OpenAI. Runs on Supabase Edge Functions, polls every 15 minutes via pg_cron, and sends Telegram notifications when drafts are created.

## How it works

1. Polls Gmail inbox for unread emails every 15 minutes
2. For each new email, asks OpenAI to classify it and draft a reply in one call
3. If the model decides it needs prior context, fetches the last 2 thread messages and calls OpenAI again
4. Creates a Gmail draft (reply in the same thread)
5. Sends a Telegram notification with a preview of the draft

## Stack

- **Runtime**: Supabase Edge Functions (Deno)
- **AI**: OpenAI gpt-4.1-mini
- **Email**: Gmail API (OAuth2)
- **Notifications**: Telegram Bot
- **Scheduling**: pg_cron + pg_net (built into Supabase)
- **State**: `email_drafts.processed_emails` table (dedup guard)

## Setup

See [CLAUDE.md](CLAUDE.md) for full developer instructions including deployment, migrations, secrets, and testing commands.
