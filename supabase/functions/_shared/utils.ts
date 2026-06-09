export async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) console.error('Telegram sendMessage failed:', await res.text())
}

export async function getRecentTelegramMessages(token: string, offset?: number): Promise<unknown[]> {
  const url = offset
    ? `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}`
    : `https://api.telegram.org/bot${token}/getUpdates`
  const res  = await fetch(url)
  const json = await res.json()
  return json.result ?? []
}
