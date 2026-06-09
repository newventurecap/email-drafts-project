import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chatComplete }                          from '../_shared/openai.ts'
import { fetchUnreadEmails, fetchThreadContext, createDraft, GmailMessage } from '../_shared/gmail.ts'
import { sendTelegram }                          from '../_shared/utils.ts'

const TELEGRAM_TOKEN  = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const ALLOWED_CHAT_ID = Number(Deno.env.get('ALLOWED_CHAT_ID')!)
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Prompts (mirrors the make.com blueprint logic) ────────────────────────────

const CLASSIFY_PROMPT = (email: GmailMessage) => `You are drafting email replies.

Given this inbound email, decide whether you need extra context (prior thread messages) to draft a correct reply.

Output EXACTLY in this format:
NEED_CONTEXT: yes|no
DRAFT:
<professional reply draft>

Rules:
- If the email is clearly a direct question/request and can be answered without prior context, use NEED_CONTEXT: no.
- If it references prior decisions, attachments you can't see, earlier promises, or ambiguous details, use NEED_CONTEXT: yes.
- Keep the draft concise, professional, and ready to send.

INBOUND EMAIL
From: ${email.from}
Subject: ${email.subject}
Body:
${email.body || email.snippet}`

const DRAFT_WITH_CONTEXT_PROMPT = (email: GmailMessage, context: string) => `Draft a professional reply to the INBOUND EMAIL, using CONTEXT if helpful.

Return ONLY the email reply body (no subject line, no preface).

INBOUND EMAIL
From: ${email.from}
Subject: ${email.subject}
Body:
${email.body || email.snippet}

CONTEXT (previous related messages)
${context}`

// ── State: track processed message IDs to avoid re-processing ─────────────────

async function isProcessed(messageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_drafts_processed_emails')
    .select('message_id')
    .eq('message_id', messageId)
    .single()
  return !!data
}

async function markProcessed(messageId: string, draftId: string | null, status: string): Promise<void> {
  await supabase.from('email_drafts_processed_emails').insert({
    message_id: messageId,
    draft_id:   draftId,
    status,
    processed_at: new Date().toISOString(),
  })
}

// ── Parse classify response ───────────────────────────────────────────────────

function parseClassify(text: string): { needContext: boolean; draft: string } {
  const lines      = text.split('\n')
  const contextLine = lines.find(l => l.startsWith('NEED_CONTEXT:')) ?? ''
  const needContext = contextLine.toLowerCase().includes('yes')
  const draftStart = lines.findIndex(l => l.startsWith('DRAFT:'))
  const draft      = draftStart >= 0 ? lines.slice(draftStart + 1).join('\n').trim() : ''
  return { needContext, draft }
}

// ── Process a single email ────────────────────────────────────────────────────

async function processEmail(email: GmailMessage): Promise<void> {
  console.log(`Processing: ${email.id} — ${email.subject}`)

  // Step 1: classify + draft in one call
  const { text: classifyText } = await chatComplete(
    [{ role: 'user', content: CLASSIFY_PROMPT(email) }],
    500,
  )
  const { needContext, draft: initialDraft } = parseClassify(classifyText)

  let finalDraft = initialDraft

  // Step 2: if context needed, fetch thread and call again
  if (needContext) {
    console.log(`Context needed for ${email.id}, fetching thread...`)
    const context = await fetchThreadContext(email.threadId)
    const { text: draftText } = await chatComplete(
      [{ role: 'user', content: DRAFT_WITH_CONTEXT_PROMPT(email, context) }],
      700,
    )
    finalDraft = draftText.trim()
  }

  if (!finalDraft) {
    console.error(`Empty draft for ${email.id}, skipping`)
    await markProcessed(email.id, null, 'error:empty_draft')
    return
  }

  // Step 3: create Gmail draft
  const draftId = await createDraft(email.from, email.subject, finalDraft, undefined, email.threadId)
  await markProcessed(email.id, draftId, 'ok')

  // Step 4: notify via Telegram
  const snippet = finalDraft.slice(0, 150).replace(/\n/g, ' ')
  await sendTelegram(
    TELEGRAM_TOKEN,
    ALLOWED_CHAT_ID,
    `Draft created\nFrom: ${email.from}\nSubject: ${email.subject}\n\nPreview: ${snippet}${finalDraft.length > 150 ? '...' : ''}`,
  )
  console.log(`Done: ${email.id} → draft ${draftId}`)
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Allow manual trigger with ?dry_run=true to list emails without creating drafts
  const url    = new URL(req.url)
  const dryRun = url.searchParams.get('dry_run') === 'true'

  try {
    const emails = await fetchUnreadEmails(10)
    console.log(`Found ${emails.length} unread emails`)

    if (dryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        emails:  emails.map(e => ({ id: e.id, from: e.from, subject: e.subject })),
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const results: { id: string; status: string }[] = []
    for (const email of emails) {
      if (await isProcessed(email.id)) {
        console.log(`Already processed: ${email.id}`)
        results.push({ id: email.id, status: 'skipped' })
        continue
      }
      try {
        await processEmail(email)
        results.push({ id: email.id, status: 'ok' })
      } catch (err) {
        console.error(`Error processing ${email.id}:`, err)
        await markProcessed(email.id, null, `error:${String(err).slice(0, 100)}`)
        results.push({ id: email.id, status: 'error' })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Handler error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
