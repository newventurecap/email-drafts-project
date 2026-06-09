export const OPENAI_MODEL = 'gpt-4.1-mini'

function openaiHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')!}`,
    'Content-Type':  'application/json',
  }
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export type ChatResult = {
  text:      string
  elapsedMs: number
}

export async function chatComplete(
  messages:        ChatMessage[],
  max_tokens = 700,
): Promise<ChatResult> {
  const started = Date.now()

  const body = {
    model: OPENAI_MODEL,
    messages,
    max_tokens,
    store: false,
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: openaiHeaders(),
    body:    JSON.stringify(body),
  }).then(r => r.json())

  if (resp.error) throw new Error(resp.error.message ?? JSON.stringify(resp.error))

  const text = resp.choices?.[0]?.message?.content ?? 'No response.'
  return { text, elapsedMs: Date.now() - started }
}
