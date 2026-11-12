import { getSettings } from '@/lib/settings'
import { buildPartCaption, buildSummaryText, type PartMeta, type SummaryMeta } from '@/lib/telegram-captions'

export interface TgResult<T = any> {
  ok: boolean
  result?: T
  description?: string
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

export interface DetectedChat {
  id: string
  title: string
  type: string
  /** true when this chat is the currently-configured storage chat (resolved via getChat) */
  configured?: boolean
}

export interface DetectResult {
  chats: DetectedChat[]
  /** non-fatal diagnostic info (e.g. webhook conflicts, unreachable configured chat) */
  notice?: string
}

export async function tgCall(method: string, body?: Record<string, unknown>, form?: FormData, timeoutMs = 120_000): Promise<TgResult> {
  const settings = await getSettings()
  if (!settings.tgBotToken) throw new Error('Bot token is not configured. Set it in Admin → Storage.')
  const url = `https://api.telegram.org/bot${settings.tgBotToken}/${method}`
  const doFetch = () => fetch(url, {
    method: 'POST',
    body: form ? form : body ? JSON.stringify(body) : undefined,
    headers: form ? undefined : { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })

  let attempts = 0
  while (attempts < 3) {
    attempts++
    let res: Response
    try {
      res = await doFetch()
    } catch {
      // one retry on network blip
      try {
        res = await doFetch()
      } catch {
        throw new Error(`Could not reach api.telegram.org (${method}). Check the server's network connection and try again.`)
      }
    }

    let data: TgResult
    try {
      data = (await res.json()) as TgResult
    } catch {
      throw new Error(`Telegram API returned a non-JSON response (HTTP ${res.status}) for ${method}.`)
    }

    // Rate-limit backoff on HTTP 429
    if (res.status === 429 || (!data.ok && data.parameters?.retry_after)) {
      const waitSec = Math.min(data.parameters?.retry_after || 5, 30)
      if (attempts < 3) {
        await new Promise(r => setTimeout(r, (waitSec + 1) * 1000))
        continue
      }
    }

    return data
  }

  throw new Error(`Telegram API rate limit exceeded for ${method}.`)
}

export async function getMe() {
  const r = await tgCall('getMe')
  if (!r.ok || !r.result) throw new Error(r.description || 'getMe failed')
  return r.result as { id: number; username: string; first_name: string }
}

/** Upload a buffer as a document to the storage chat. Returns telegram file_id + message_id */
export async function uploadPartToTelegram(
  buffer: Buffer,
  filename: string,
  index: number,
  total: number,
  originalName: string,
  meta?: PartMeta
): Promise<{ fileId: string; messageId: number }> {
  const settings = await getSettings()
  const chatId = settings.tgStorageChatId
  if (!chatId) throw new Error('Storage chat is not configured. Go to Admin → Storage and complete the setup wizard.')
  const form = new FormData()
  form.append('chat_id', chatId)
  if (meta) {
    // rich, organized caption: uploader, folder, sizes, checksum, internal id…
    form.append('caption', buildPartCaption({ ...meta, partIndex: index, partTotal: total, partSize: buffer.length }))
    form.append('parse_mode', 'HTML')
  } else {
    form.append('caption', `📦 ${originalName} — part ${index + 1}/${total}`)
  }
  form.append('document', new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), filename)
  const r = await tgCall('sendDocument', undefined, form)
  if (!r.ok || !r.result?.document?.file_id) {
    const desc = r.description || 'sendDocument failed'
    if (desc.includes('chat not found')) throw new Error('Telegram says "chat not found" — the storage chat ID is wrong, or the bot has not been added there / has not pressed Start.')
    throw new Error(desc)
  }
  return { fileId: r.result.document.file_id, messageId: r.result.message_id }
}

const filePathCache = new Map<string, { path: string; exp: number }>()
const FILE_PATH_TTL = 45 * 60 * 1000

export async function getTelegramFileUrl(fileId: string): Promise<string> {
  const settings = await getSettings()
  const cached = filePathCache.get(fileId)
  if (cached && cached.exp > Date.now()) {
    return `https://api.telegram.org/file/bot${settings.tgBotToken}/${cached.path}`
  }
  const r = await tgCall('getFile', { file_id: fileId })
  if (!r.ok || !r.result?.file_path) throw new Error(r.description || 'getFile failed (is the file larger than 20MB per part?)')
  filePathCache.set(fileId, { path: r.result.file_path, exp: Date.now() + FILE_PATH_TTL })
  return `https://api.telegram.org/file/bot${settings.tgBotToken}/${r.result.file_path}`
}

/** Post the organized summary card for a finished upload. Returns the message id (null on failure). 8s timeout — never blocks an upload for long. */
export async function sendStorageSummary(meta: SummaryMeta): Promise<number | null> {
  const settings = await getSettings()
  const chatId = settings.tgStorageChatId
  if (!chatId) return null
  const r = await tgCall(
    'sendMessage',
    { chat_id: chatId, text: buildSummaryText(meta), parse_mode: 'HTML', disable_web_page_preview: true },
    undefined,
    8_000
  )
  return r.ok && r.result?.message_id ? r.result.message_id : null
}

/** Re-render an existing summary card from current app state. 8s timeout, best effort. */
export async function editStorageSummary(chatId: string, messageId: number, meta: SummaryMeta): Promise<boolean> {
  const r = await tgCall(
    'editMessageText',
    { chat_id: chatId, message_id: messageId, text: buildSummaryText(meta), parse_mode: 'HTML', disable_web_page_preview: true },
    undefined,
    8_000
  )
  return !!r.ok
}

export async function deleteTelegramMessage(chatId: string, messageId: number) {
  try {
    await tgCall('deleteMessage', { chat_id: chatId, message_id: messageId })
  } catch {
    // best effort
  }
}

export async function sendTestMessage(chatIdOverride?: string): Promise<void> {
  const settings = await getSettings()
  const chatId = (chatIdOverride || '').trim() || settings.tgStorageChatId
  if (!chatId) {
    throw new Error('No chat ID provided and none is configured. Pick a detected chat or type one in the Storage chat ID field first.')
  }
  const r = await tgCall('sendMessage', {
    chat_id: chatId,
    text: `✅ ValencyStudio File Manager — connection successful!\nThe bot can now store files in this chat.`,
    parse_mode: 'HTML',
  })
  if (!r.ok) {
    const desc = r.description || 'sendMessage failed'
    if (desc.includes('chat not found')) throw new Error('Chat not found. Make sure the bot is an admin of the channel/group, or press START in the bot\'s private chat first.')
    if (desc.includes('not enough rights')) throw new Error('The bot does not have permission to post in this chat. Promote it to admin with "Post messages" rights.')
    throw new Error(desc)
  }
}

/**
 * Detect chats the bot can reach.
 *
 * Two sources, merged:
 *  1. The currently-configured storage chat (via getChat) — always reliable, even if
 *     nobody has messaged the bot recently. getUpdates only covers the LAST 24h of
 *     unconsumed activity, so relying on it alone made the wizard show "No chats found"
 *     for perfectly-valid, already-configured chats.
 *  2. Recent bot activity (getUpdates) — picks up private chats / groups the bot has seen.
 *
 * Never throws for scan failures; problems are reported via `notice` instead so the
 * wizard can still show the configured chat plus a clear diagnostic.
 */
export async function detectChats(): Promise<DetectResult> {
  const settings = await getSettings()
  const chats: DetectedChat[] = []
  const notices: string[] = []
  const seen = new Set<string>()

  // 1) Resolve the configured storage chat (e.g. seeded from env) — the reliable path
  if (settings.tgStorageChatId) {
    try {
      const r = await tgCall('getChat', { chat_id: settings.tgStorageChatId })
      if (r.ok && r.result?.id !== undefined) {
        const c = r.result
        const id = String(c.id)
        seen.add(id)
        chats.push({
          id,
          title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || `Chat ${c.id}`,
          type: c.type || 'unknown',
          configured: true,
        })
      } else {
        notices.push(
          `The configured chat ID ${settings.tgStorageChatId} could not be resolved by Telegram (${r.description || 'getChat failed'}) — the bot may have been removed from that chat.`
        )
      }
    } catch (e: any) {
      notices.push(e?.message || 'getChat failed for the configured chat.')
    }
  }

  // 2) Recent activity scan (last 24h of unconsumed updates)
  try {
    const r = await tgCall('getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member', 'chat_member', 'edited_message', 'edited_channel_post'] })
    if (r.ok) {
      const updates: any[] = r.result || []
      const visit = (chat: any) => {
        if (!chat || chat.id === undefined) return
        const id = String(chat.id)
        if (seen.has(id)) return
        seen.add(id)
        chats.push({
          id,
          title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || `Chat ${chat.id}`,
          type: chat.type || 'unknown',
        })
      }
      for (const u of updates) {
        if (u.message?.chat) visit(u.message.chat)
        if (u.edited_message?.chat) visit(u.edited_message.chat)
        if (u.channel_post?.chat) visit(u.channel_post.chat)
        if (u.edited_channel_post?.chat) visit(u.edited_channel_post.chat)
        if (u.my_chat_member?.chat) visit(u.my_chat_member.chat)
        if (u.chat_member?.chat) visit(u.chat_member.chat)
      }
    } else {
      const desc = r.description || 'getUpdates failed'
      notices.push(/webhook/i.test(desc)
        ? `Recent-activity scan is blocked by an active Telegram webhook (${desc}). Run deleteWebhook if this app is the only consumer of the bot.`
        : `Recent-activity scan failed: ${desc}`)
    }
  } catch (e: any) {
    notices.push(`Recent-activity scan failed: ${e?.message || 'getUpdates failed'}`)
  }

  return { chats, notice: notices.length ? notices.join(' ') : undefined }
}
