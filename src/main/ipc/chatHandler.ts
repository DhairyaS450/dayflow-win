// Chat: Gemini function-calling loop (spec ui-weekly-chat.md §3.13.2 / §3.14.1).
// One IPC channel: 'chat:send'. Tool-call progress is emitted on 'chat:event'.

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as storage from '../db/storage'
import { dayWindow, dayInfoFor, formatHMMA } from '../lib/time'
import { secrets } from '../lib/secrets'
import { settings } from '../lib/settings'

const MODEL = 'gemini-3.1-flash-lite'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const MAX_TOOL_ROUNDS = 20
const PAYLOAD_LIMIT_BYTES = 800_000
const REQUEST_TIMEOUT_MS = 120_000

// ---------- Types ----------

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface ChatSendRequest {
  requestId?: string
  history?: ChatTurn[]
  recentSuggestions?: string[]
}

interface FunctionCall {
  name: string
  args?: Record<string, unknown>
}

interface GeminiPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: FunctionCall
  functionResponse?: { name: string; response: Record<string, unknown> }
}

interface GeminiContent {
  role?: string
  parts?: GeminiPart[]
}

type ToolResult = Record<string, unknown> & { summary: string }

type ChatEmit = (payload: Record<string, unknown>) => void

// ---------- Date helpers ----------

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const MONTHS_SHORT = MONTHS_FULL.map((m) => m.slice(0, 3))
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_SHORT = WEEKDAYS_FULL.map((w) => w.slice(0, 3))

function dateFromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/** "Wed, Aug 12" */
function fmtEEEMMMd(day: string): string {
  const d = dateFromDay(day)
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** "Aug 12" */
function fmtMMMd(day: string): string {
  const d = dateFromDay(day)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- Tool declarations (verbatim descriptions, spec §3.14.1) ----------

const TOOL_DECLARATIONS = [
  {
    name: 'fetchTimeline',
    description:
      'Fetch timeline cards for a single day or date range. Returns structured JSON cards including day, time range, title, summary, category, and optional detailed summaries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'Single day in YYYY-MM-DD format.' },
        startDate: { type: 'STRING', description: 'Range start day in YYYY-MM-DD format.' },
        endDate: { type: 'STRING', description: 'Range end day in YYYY-MM-DD format.' },
        includeDetailedSummary: {
          type: 'BOOLEAN',
          description: 'When true (default), include detailedSummary. Set false for very large windows.'
        },
        limit: {
          type: 'NUMBER',
          description: 'Optional row cap. If omitted, returns all matching rows.'
        }
      }
    }
  },
  {
    name: 'fetchObservations',
    description:
      "Fetch raw observations for a single day or date range. Returns structured JSON grouped by day, with each day's observations ordered chronologically.",
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'Single day in YYYY-MM-DD format.' },
        startDate: { type: 'STRING', description: 'Range start day in YYYY-MM-DD format.' },
        endDate: { type: 'STRING', description: 'Range end day in YYYY-MM-DD format.' },
        limit: {
          type: 'NUMBER',
          description: 'Optional row cap. If omitted, returns all matching rows.'
        }
      }
    }
  }
]

// ---------- Arg validation (spec §3.14.1) ----------

type RangeArgs =
  | { mode: 'single'; date: string }
  | { mode: 'range'; startDate: string; endDate: string }

type ValidationError = { error: { code: string; message: string } }

function validationError(message: string): ToolResult {
  return { summary: message, error: { code: 'validation_error', message } }
}

function resolveRange(args: Record<string, unknown>): RangeArgs | ValidationError {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
  const date = str(args.date)
  const startDate = str(args.startDate)
  const endDate = str(args.endDate)
  const hasRangePart = startDate !== null || endDate !== null
  if ((date && hasRangePart) || (!date && !(startDate && endDate))) {
    return { error: { code: 'validation_error', message: 'Provide either {date} OR {startDate, endDate}.' } }
  }
  const fmt = /^\d{4}-\d{2}-\d{2}$/
  for (const v of [date, startDate, endDate]) {
    if (v && !fmt.test(v)) {
      return { error: { code: 'validation_error', message: `Invalid date format '${v}'. Use YYYY-MM-DD.` } }
    }
  }
  if (date) return { mode: 'single', date }
  if ((startDate as string) > (endDate as string)) {
    return { error: { code: 'validation_error', message: 'startDate must be less than or equal to endDate.' } }
  }
  return { mode: 'range', startDate: startDate as string, endDate: endDate as string }
}

function positiveLimit(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.floor(v)
  return n > 0 ? n : null
}

function rangeLabel(range: RangeArgs): string {
  return range.mode === 'single'
    ? fmtEEEMMMd(range.date)
    : `${fmtMMMd(range.startDate)} to ${fmtMMMd(range.endDate)}`
}

// ---------- Tool executors ----------

function execFetchTimeline(args: Record<string, unknown>): ToolResult {
  const range = resolveRange(args)
  if ('error' in range) return { summary: range.error.message, error: range.error }
  const includeDetailedSummary = args.includeDetailedSummary !== false // default true
  const limit = positiveLimit(args.limit)

  let cards =
    range.mode === 'single'
      ? storage.fetchTimelineCardsForDay(range.date)
      : storage.fetchTimelineCardsByTimeRange(
          dayWindow(range.startDate).startTs,
          dayWindow(range.endDate).endTs
        )
  if (limit !== null) cards = cards.slice(0, limit)

  let items: Record<string, unknown>[] = cards.map((c) => {
    const item: Record<string, unknown> = {
      day: c.day,
      startTime: c.startTimestamp,
      endTime: c.endTimestamp,
      title: c.title,
      summary: c.summary,
      category: c.category,
      subcategory: c.subcategory,
      distractionsCount: c.distractions?.length ?? 0
    }
    if (c.appSites && (c.appSites.primary || c.appSites.secondary)) {
      item.appSites = {
        ...(c.appSites.primary ? { primary: c.appSites.primary } : {}),
        ...(c.appSites.secondary ? { secondary: c.appSites.secondary } : {})
      }
    }
    if (includeDetailedSummary && c.detailedSummary) item.detailedSummary = c.detailedSummary
    return item
  })

  // 800KB payload guard: strip detailed summaries when the serialized items overflow.
  let truncated = false
  if (includeDetailedSummary && Buffer.byteLength(JSON.stringify(items), 'utf8') > PAYLOAD_LIMIT_BYTES) {
    items = items.map((it) => {
      const { detailedSummary: _omit, ...rest } = it
      return rest
    })
    truncated = true
  }

  let summary = `Fetched ${items.length} timeline card(s) for ${rangeLabel(range)}.`
  if (truncated) summary += ' Detailed summaries were omitted due to payload size.'

  return {
    request: {
      mode: range.mode,
      date: range.mode === 'single' ? range.date : null,
      startDate: range.mode === 'range' ? range.startDate : null,
      endDate: range.mode === 'range' ? range.endDate : null,
      includeDetailedSummary,
      limit
    },
    summary,
    itemCount: items.length,
    truncated,
    items
  }
}

function execFetchObservations(args: Record<string, unknown>): ToolResult {
  const range = resolveRange(args)
  if ('error' in range) return { summary: range.error.message, error: range.error }
  const limit = positiveLimit(args.limit)

  const window =
    range.mode === 'single'
      ? dayWindow(range.date)
      : { startTs: dayWindow(range.startDate).startTs, endTs: dayWindow(range.endDate).endTs }
  let rows = storage.fetchObservationsByTimeRange(window.startTs, window.endTs)
  if (limit !== null) rows = rows.slice(0, limit)

  // Group chronologically by 4 AM-boundary day.
  const byDay = new Map<string, { startTime: string; endTime: string; observation: string }[]>()
  for (const row of rows) {
    const day = dayInfoFor(new Date(row.startTs * 1000)).dayString
    let bucket = byDay.get(day)
    if (!bucket) {
      bucket = []
      byDay.set(day, bucket)
    }
    bucket.push({
      startTime: formatHMMA(row.startTs),
      endTime: formatHMMA(row.endTs),
      observation: row.observation
    })
  }
  const items = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, observations]) => ({ day, observations }))

  const summary = `Fetched ${rows.length} observation(s) for ${rangeLabel(range)} across ${items.length} day(s).`
  return {
    request: {
      mode: range.mode,
      date: range.mode === 'single' ? range.date : null,
      startDate: range.mode === 'range' ? range.startDate : null,
      endDate: range.mode === 'range' ? range.endDate : null,
      limit
    },
    summary,
    itemCount: rows.length,
    dayCount: items.length,
    truncated: false,
    items
  }
}

function executeTool(name: string, args: Record<string, unknown>): ToolResult {
  try {
    if (name === 'fetchTimeline') return execFetchTimeline(args)
    if (name === 'fetchObservations') return execFetchObservations(args)
    return {
      summary: `Unknown tool '${name}'.`,
      error: { code: 'unknown_tool', message: `Unknown tool '${name}'.` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { summary: `Tool failed: ${message}`, error: { code: 'validation_error', message } }
  }
}

// ---------- System instruction (spec §3.13.2, verbatim; Windows wording) ----------

function buildSystemInstruction(recentSuggestions?: string[]): string {
  const now = new Date()
  const currentDate = `${WEEKDAYS_FULL[now.getDay()]}, ${MONTHS_FULL[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
  const currentTime = formatHMMA(Math.floor(now.getTime() / 1000))
  const F = '```'

  let text = `You are the AI assistant inside Dayflow, a Windows app that records what people do on their computer and builds a semantic timeline of their day. You have deep visibility into the user's work patterns — what they built, where they got stuck, how they spent their time. Use that context to give answers that feel like a well-informed colleague, not a generic chatbot.

Current date: ${currentDate}
Current time: ${currentTime}
Day boundary: Days start at 4:00 AM (not midnight). "Yesterday" means the previous 4 AM–4 AM window.

---

## TOOLS & DATA INTEGRITY

You have two read-only tools:

1. **fetchTimeline** — Structured activity cards with titles, categories, and durations. Use this for summaries, standups, time breakdowns, and "what did I do" questions.
2. **fetchObservations** — Raw screen observations. Use this for detailed questions like "what was I reading at 2pm" or "which tabs were open during that meeting."

Rules:
- Always call a tool when the user asks about their activity. Never fabricate or assume data.
- If a tool returns no rows, say so clearly. Don't fill gaps with guesses.
- If a tool fails, explain what happened and suggest a narrower time range.
- For large time windows (full week+), use \`includeDetailedSummary=false\` to avoid oversized payloads.
- Default to fetchTimeline unless the user needs observation-level detail.

---

## HANDLING USER INTENT

**Format vs. content corrections:**
If the user provides an example of their preferred format (e.g., a standup template), treat it as a *structural template*. Re-fetch or reuse the existing data and apply the new structure to it. Do not echo back the example content as if it were the answer.
If the user is correcting formatting only, reuse previously fetched facts when available and do not import facts from the example.

**Clarifications and retries:**
When the user says things like "no, I meant..." or "try again but...", re-read their original request in light of the correction. Don't start from scratch — adjust your previous response.

**Implicit context:**
- "standup notes" → use Yesterday / Today / Blockers format unless the user has shown a different preference
- "what did I do" → fetchTimeline for the relevant day
- "how much time" → fetchTimeline, aggregate by category
- "was I productive" → compare Work vs Distraction/Idle time
- "show me" or "what was on screen" → fetchObservations

---

## RESPONSE STYLE

- **Brief and scannable.** A few key points, not a wall of text. Bullets are fine when they help.
- **High-level by default.** Summarize the shape of the day — don't list every 15-minute card unless asked.
- **Human-readable durations.** "About an hour," "a couple hours," "most of the afternoon." Not "47 minutes" or "2820 seconds."
- **No internal details.** Never mention raw timestamps, table names, SQL, schema, or tool internals.
- **Adapt to demonstrated preferences.** If the user shows you how they want something formatted, match that structure going forward. Update the Style memory field accordingly.

---

## MEMORY

You may receive an existing \`## User Memory\` block. Use it to maintain lightweight, durable context across conversations.

Fields:
- **Profile:** Stable user context relevant to Dayflow (role, work patterns, team).
- **Style:** A set of format preferences **keyed by question type**. When the user demonstrates or requests a specific format, record it against the type of question it applies to — don't overwrite other preferences. Different question types can (and should) have different styles.

Example:
${F}memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | weekly_summary=detailed with metrics | default=brief, scannable
${F}

When the user shows a preferred format, identify which question type it belongs to and add or update just that key. Preferences for one type (e.g., standups) should never affect another (e.g., weekly summaries).

**Example flow:**

User's current memory:
${F}memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: default=brief, scannable
${F}

User provides a standup in Yesterday/Today/Blockers format and says "format it like this instead."

Your response should use that structure for the standup data, and your memory block should become:
${F}memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | default=brief, scannable
${F}

If the user later says "for weekly summaries, give me more detail with metrics," update to:
${F}memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | weekly_summary=detailed with metrics | default=brief, scannable
${F}

Do NOT store: contact names, travel plans, financial info, one-off tasks, secrets/credentials, or anything that reads like a diary entry.

---

## RESPONSE FORMAT

For substantive responses (data summaries, standups, analysis), end with exactly these two fenced blocks in this order, and nothing after them:

${F}suggestions
["Question 1?", "Question 2?", "Question 3?"]
${F}

${F}memory
Profile: <stable user context>
Style: <key=value pairs as shown above>
${F}

Rules:
- The \`suggestions\` block is required for substantive responses.
- The \`suggestions\` block must be valid JSON: an array of 3-4 strings.
- Always include the \`memory\` block, even if unchanged.
- Frame each suggestion as a question the user could ask Dayflow.
- Every suggestion must be answerable using only the user's recorded Dayflow activity/data.
- Do not suggest anything that requires external information, browsing, recommendations, planning help, outreach, document creation, or any other action outside analyzing the existing data.
- Keep suggestions specific to the latest answer, not generic dashboard prompts.
- Keep suggestion text short (<50 chars) and varied.
- Include:
- one **deeper** question that digs further into the same topic
- one **adjacent** question that explores a nearby angle
- one **surprising** question that is still grounded in the actual data
- Do not repeat recent suggestions or obvious variants of them.
- Do not write suggestion questions as markdown bullets.
- Do not place suggestion questions in the main response body.
- Do not output any text after the \`memory\` block.
- For quick clarifications, acknowledgments, or corrections, omit the \`suggestions\` block and include only the \`memory\` block.
- Do not add headings like "Suggestions", "Memory", "### Suggestions", or "### Memory".
- Emit only the fenced \`suggestions\` block and fenced \`memory\` block after the main answer.`

  const recents = (recentSuggestions ?? [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(-9)
  if (recents.length > 0) {
    text += `\n\n## Recent Suggestions To Avoid\n${recents.map((s) => `- ${s.trim()}`).join('\n')}`
  }
  return text
}

// ---------- Gemini transport ----------

async function generate(apiKey: string, body: Record<string, unknown>): Promise<GeminiContent> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    if (res.status >= 400) {
      let msg = `Gemini request failed (HTTP ${res.status}).`
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } }
        if (parsed?.error?.message) msg = parsed.error.message
      } catch {
        /* keep default */
      }
      const err = new Error(msg) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    const parsed = JSON.parse(text) as { candidates?: { content?: GeminiContent }[] }
    const content = parsed.candidates?.[0]?.content
    if (!content) throw new Error('Gemini returned an empty response.')
    return content
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Function-calling loop ----------

async function runChat(apiKey: string, req: ChatSendRequest, emit: ChatEmit): Promise<string> {
  const history = Array.isArray(req.history) ? req.history : []
  const contents: GeminiContent[] = history
    .filter((t) => t && typeof t.content === 'string' && t.content.trim().length > 0)
    .map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }]
    }))
  if (contents.length === 0) throw new Error('Nothing to send.')

  const systemInstruction = buildSystemInstruction(req.recentSuggestions)
  let useThinking = true

  emit({ type: 'status', stage: 'thinking' })

  for (let round = 0; ; round++) {
    const makeBody = (): Record<string, unknown> => ({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        ...(useThinking ? { thinkingConfig: { thinkingLevel: 'medium' } } : {})
      }
    })

    let content: GeminiContent | null = null
    for (let attempt = 0; attempt < 3 && content === null; attempt++) {
      try {
        content = await generate(apiKey, makeBody())
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0
        if (status === 400 && useThinking) {
          useThinking = false // some models reject thinkingConfig — drop it and retry
          continue
        }
        if ((status === 429 || (status >= 500 && status <= 599)) && attempt < 2) {
          await sleep(2000)
          continue
        }
        throw err
      }
    }
    if (content === null) throw new Error('Gemini request failed.')

    const parts = content.parts ?? []
    const calls = parts
      .filter((p) => p.functionCall && typeof p.functionCall.name === 'string')
      .map((p) => p.functionCall as FunctionCall)

    if (calls.length === 0) {
      emit({ type: 'status', stage: 'answering' })
      return parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text as string)
        .join('')
    }

    if (round >= MAX_TOOL_ROUNDS) {
      throw new Error(
        'The assistant exceeded the maximum tool-call rounds. Please try a narrower query.'
      )
    }

    emit({ type: 'status', stage: 'runningTools' })
    contents.push({ role: 'model', parts })

    const responseParts: GeminiPart[] = []
    for (const call of calls) {
      const callId = randomUUID()
      const args = call.args ?? {}
      emit({
        type: 'toolStart',
        callId,
        name: call.name,
        command: `${call.name} ${JSON.stringify(args)}`
      })
      const result = executeTool(call.name, args)
      const failed = typeof result.error === 'object' && result.error !== null
      emit({ type: 'toolEnd', callId, name: call.name, summary: result.summary, ok: !failed })
      responseParts.push({ functionResponse: { name: call.name, response: result } })
    }
    contents.push({ role: 'user', parts: responseParts })
  }
}

// ---------- Registration ----------

// ---------- Claude CLI chat path ----------

/** Compact digest of the last N days' timeline cards for CLI chat context. */
function buildActivityDigest(days = 7): string {
  const now = new Date()
  const sections: string[] = []
  for (let back = 0; back < days; back++) {
    const d = new Date(now.getTime())
    d.setDate(d.getDate() - back)
    if (d.getHours() < 4) d.setDate(d.getDate() - 1)
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const cards = storage.fetchTimelineCardsForDay(day)
    if (cards.length === 0) continue
    const lines = cards.map(
      (c) => `- ${c.startTimestamp}-${c.endTimestamp} [${c.category}] ${c.title}: ${c.summary}`
    )
    sections.push(`## ${day}\n${lines.join('\n')}`)
  }
  let digest = sections.join('\n\n')
  if (digest.length > 100_000) digest = digest.slice(0, 100_000) + '\n[digest truncated]'
  return digest || 'No timeline activity recorded yet.'
}

async function runClaudeCliChat(req: ChatSendRequest, emit: ChatEmit): Promise<string> {
  const { claudeCliChat } = await import('../providers/claudeCli')
  const history = Array.isArray(req.history) ? req.history : []
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') throw new Error('Nothing to send.')
  const prior = history.slice(0, -1)
  const nowStr = new Date().toLocaleString('en-US')
  const systemContext = `You are Dayflow's assistant. Dayflow is a Windows app that records the user's screen locally and turns it into a timeline of activity cards. Answer questions about the user's activity using the digest below. Be concise, specific, and use markdown. Current date/time: ${nowStr}. Days run 4 AM to 4 AM.

Activity digest (last 7 days):

${buildActivityDigest()}`
  emit({ type: 'status', stage: 'thinking' })
  return claudeCliChat(systemContext, prior, last.content)
}

export function registerChatHandler(broadcast: (channel: string, payload?: unknown) => void): void {
  ipcMain.handle('chat:send', async (_e, req: ChatSendRequest) => {
    const requestId = typeof req?.requestId === 'string' ? req.requestId : null
    const emit: ChatEmit = (payload) => broadcast('chat:event', { requestId, ...payload })
    const apiKey = secrets.retrieve('gemini')
    const provider = settings.get<string>('selectedLLMProvider', 'gemini')

    // Claude CLI path: chosen provider, or fallback when no Gemini key exists.
    if (provider === 'chatgpt_claude' || !apiKey?.trim()) {
      const { resolveClaudeCli } = await import('../providers/claudeCli')
      if (await resolveClaudeCli()) {
        try {
          const text = await runClaudeCliChat(req ?? {}, emit)
          return { ok: true, text }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          emit({ type: 'error', message })
          return { ok: false, error: message }
        }
      }
      if (!apiKey?.trim()) {
        return {
          ok: false,
          error:
            'No chat runtime available. Add a Gemini API key in Settings, or install the Claude CLI and sign in with your Claude subscription.'
        }
      }
    }

    try {
      const text = await runChat(apiKey!.trim(), req ?? {}, emit)
      return { ok: true, text }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit({ type: 'error', message })
      return { ok: false, error: message }
    }
  })
}
