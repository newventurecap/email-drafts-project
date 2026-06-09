// Gmail API helpers using OAuth2 refresh token flow

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE  = 'https://gmail.googleapis.com/gmail/v1/users/me'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.token
  }

  const clientId     = Deno.env.get('GMAIL_CLIENT_ID')!
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET')!
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN')!

  const res  = await fetch(GMAIL_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`Token refresh failed: ${json.error_description ?? json.error}`)

  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return cachedToken.token
}

function gmailHeaders(token: string): Record<string, string> {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export type GmailMessage = {
  id:        string
  threadId:  string
  messageId: string  // value of the Message-ID header, used for In-Reply-To threading
  from:      string
  subject:   string
  body:      string
  snippet:   string
  date:      string
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return atob(base64)
  } catch {
    return ''
  }
}

function extractBody(payload: Record<string, unknown>): string {
  const parts = payload.parts as Record<string, unknown>[] | undefined
  if (parts) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain') {
        const data = (part.body as Record<string, unknown>)?.data as string
        if (data) return decodeBase64Url(data)
      }
    }
    const data = (parts[0]?.body as Record<string, unknown>)?.data as string
    if (data) return decodeBase64Url(data)
  }
  const data = (payload.body as Record<string, unknown>)?.data as string
  return data ? decodeBase64Url(data) : ''
}

function headerVal(headers: { name: string; value: string }[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export async function fetchUnreadEmails(maxResults = 10): Promise<GmailMessage[]> {
  const token = await getAccessToken()
  const listRes = await fetch(
    `${GMAIL_API_BASE}/messages?q=in:inbox newer_than:1d -category:promotions -category:updates -category:social -category:forums&maxResults=${maxResults}`,
    { headers: gmailHeaders(token) },
  )
  const listJson = await listRes.json()
  if (!listJson.messages) return []

  const messages = await Promise.all(
    listJson.messages.map(async (m: { id: string }) => {
      const res  = await fetch(`${GMAIL_API_BASE}/messages/${m.id}?format=full`, { headers: gmailHeaders(token) })
      const full = await res.json()
      const hdrs = (full.payload?.headers ?? []) as { name: string; value: string }[]
      return {
        id:        full.id,
        threadId:  full.threadId,
        messageId: headerVal(hdrs, 'Message-ID'),
        from:      headerVal(hdrs, 'From'),
        subject:   headerVal(hdrs, 'Subject'),
        body:      extractBody(full.payload ?? {}),
        snippet:   full.snippet ?? '',
        date:      headerVal(hdrs, 'Date'),
      }
    }),
  )
  return messages
}

// Returns true if the user has already manually replied to this email in the thread
export async function hasBeenReplied(email: GmailMessage): Promise<boolean> {
  const token = await getAccessToken()
  const res   = await fetch(
    `${GMAIL_API_BASE}/threads/${email.threadId}?format=metadata`,
    { headers: gmailHeaders(token) },
  )
  const thread = await res.json()
  const msgs   = (thread.messages ?? []) as { id: string; labelIds: string[] }[]
  const idx    = msgs.findIndex(m => m.id === email.id)
  if (idx === -1) return false
  // Any SENT message appearing after this one in the thread means the user already replied
  return msgs.slice(idx + 1).some(m => m.labelIds?.includes('SENT'))
}

export async function fetchThreadContext(threadId: string, maxMessages = 2): Promise<string> {
  const token   = await getAccessToken()
  const res     = await fetch(`${GMAIL_API_BASE}/threads/${threadId}?format=full`, { headers: gmailHeaders(token) })
  const thread  = await res.json()
  const msgs    = (thread.messages ?? []) as Record<string, unknown>[]
  const context = msgs.slice(0, -1).slice(-maxMessages)
  return context.map(m => {
    const hdrs    = (m.payload as Record<string, unknown>)?.headers as { name: string; value: string }[] ?? []
    const from    = headerVal(hdrs, 'From')
    const subject = headerVal(hdrs, 'Subject')
    const body    = extractBody((m.payload ?? {}) as Record<string, unknown>)
    return `From: ${from}\nSubject: ${subject}\n\n${body || (m.snippet as string ?? '')}`
  }).join('\n\n---\n\n')
}

export async function createDraft(
  to:        string,
  subject:   string,
  body:      string,
  original:  { messageId: string; from: string; date: string; body: string } | undefined,
  threadId?: string,
): Promise<string> {
  const token = await getAccessToken()

  function toBase64Url(str: string): string {
    const bytes = new TextEncoder().encode(str)
    let binary  = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function encodeHeader(value: string): string {
    if (/^[\x00-\x7F]*$/.test(value)) return value
    const bytes = new TextEncoder().encode(value)
    let binary  = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `=?UTF-8?B?${btoa(binary)}?=`
  }

  const subjectLine = subject.startsWith('Re:') ? subject : `Re: ${subject}`
  const headers     = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subjectLine)}`,
    original?.messageId ? `In-Reply-To: ${original.messageId}` : '',
    original?.messageId ? `References: ${original.messageId}` : '',
  ].filter(Boolean).join('\r\n')

  // Quote the original email below the reply
  const quotedOriginal = original
    ? `\n\nOn ${original.date}, ${original.from} wrote:\n` +
      (original.body || '').split('\n').map(l => `> ${l}`).join('\n')
    : ''

  const raw = toBase64Url(`${headers}\r\n\r\n${body}${quotedOriginal}`)

  const draftBody: Record<string, unknown> = { message: { raw } }
  if (threadId) draftBody.message = { ...draftBody.message as object, threadId }

  const res  = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method:  'POST',
    headers: gmailHeaders(token),
    body:    JSON.stringify(draftBody),
  })
  const json = await res.json()
  if (json.error) throw new Error(`Create draft failed: ${json.error.message}`)
  return json.id
}
