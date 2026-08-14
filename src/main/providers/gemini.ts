// GeminiDirectProvider port. Screenshots are composited into a 1 fps compressed
// timeline video; the model's MM:SS timestamps are expanded by the screenshot
// interval to recover real time.

import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { settings } from '../lib/settings'
import { insertLLMCall } from '../db/storage'
import { generateVideoFromScreenshots } from '../analysis/videoProcessing'
import { transcriptionPrompt, cardGenerationPrompt } from './prompts'
import { formatHMMA } from '../lib/time'
import {
  ProviderError,
  normalizeCategory,
  type BatchProvider,
  type ObservationInput,
  type ActivityCardData,
  type ActivityGenerationContext
} from './types'
import type { Observation, Screenshot } from '../../shared/types'

const FILE_ENDPOINT = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const GEN_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const CAPACITY_CODES = new Set([403, 404, 429, 503])
const REQUEST_TIMEOUT_MS = 120_000

export type GeminiModel = 'gemini-3.5-flash' | 'gemini-3.1-flash-lite'

function modelOrder(): GeminiModel[] {
  const pref = settings.get<{ primary?: string }>('geminiSelectedModel_v3', {})
  if (pref.primary === 'gemini-3.1-flash-lite') return ['gemini-3.1-flash-lite']
  return ['gemini-3.5-flash', 'gemini-3.1-flash-lite']
}

type RetryStrategy = 'immediate' | 'shortBackoff' | 'longBackoff' | 'enhancedPrompt' | 'noRetry'

function classifyError(err: unknown): RetryStrategy {
  if (err instanceof SyntaxError) return 'immediate' // JSON decode
  if (err instanceof ProviderError && (err.domain === 'GeminiError' || err.domain === 'GeminiProvider')) {
    const c = err.code
    if (c === 429) return 'longBackoff'
    if (c >= 500 && c <= 599) return 'shortBackoff'
    if (c === 401 || c === 403) return 'noRetry'
    if (c === 7 || c === 9 || c === 10) return 'immediate'
    if (c >= 400 && c <= 499) return 'noRetry'
    return 'shortBackoff'
  }
  if (err instanceof Error && (err.name === 'AbortError' || /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND/i.test(err.message))) {
    return 'shortBackoff'
  }
  return 'shortBackoff'
}

function delayFor(strategy: RetryStrategy, attempt: number): number {
  switch (strategy) {
    case 'immediate':
      return 0
    case 'shortBackoff':
      return Math.pow(2, attempt) * 2000
    case 'longBackoff':
      return Math.min(3, attempt + 1) * 1000
    case 'enhancedPrompt':
      return 1000
    case 'noRetry':
      return 0
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
}

function parseMMSS(v: string): number | null {
  const parts = v.trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

/** Extract first balanced JSON object from text (503 salvage). */
function extractBalancedJSON(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

interface GenerateArgs {
  model: string
  body: unknown
  operation: string
  batchId?: number
  callGroupId: string
  attempt: number
  apiKey: string
}

async function generateContent(args: GenerateArgs): Promise<string> {
  const url = `${GEN_BASE}/${args.model}:generateContent?key=${args.apiKey}`
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let status = 0
  let bodyText = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args.body),
      signal: controller.signal
    })
    status = res.status
    bodyText = await res.text()
    if (status >= 400) {
      // 503 salvage: valid payload streamed before failure
      if (status === 503) {
        const salvage = extractBalancedJSON(bodyText)
        if (salvage) {
          try {
            const parsed = JSON.parse(salvage)
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof text === 'string') {
              logCall(args, 'success', started, status, bodyText)
              return text
            }
          } catch {
            /* fall through */
          }
        }
      }
      let msg = `HTTP ${status}`
      try {
        const parsed = JSON.parse(bodyText)
        if (parsed?.error?.message) msg = parsed.error.message
      } catch {
        /* keep default */
      }
      logCall(args, 'failure', started, status, bodyText, msg)
      throw new ProviderError(msg, 'GeminiError', status)
    }
    const parsed = JSON.parse(bodyText)
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string') {
      logCall(args, 'failure', started, status, bodyText, 'Unexpected response format')
      throw new ProviderError('Unexpected response format', 'GeminiError', 7)
    }
    logCall(args, 'success', started, status, bodyText)
    return text
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof ProviderError) throw err
    logCall(args, 'failure', started, status, bodyText, err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function logCall(
  args: GenerateArgs,
  status: 'success' | 'failure',
  startedMs: number,
  httpStatus: number,
  responseBody: string,
  errorMessage?: string
): void {
  const cap = (s: string): string => (s.length > 65536 ? s.slice(0, 65536) : s)
  insertLLMCall({
    batchId: args.batchId ?? null,
    callGroupId: args.callGroupId,
    attempt: args.attempt,
    provider: 'gemini',
    model: args.model,
    operation: args.operation,
    status,
    latencyMs: Date.now() - startedMs,
    httpStatus: httpStatus || null,
    requestMethod: 'POST',
    requestURL: `${GEN_BASE}/${args.model}:generateContent?key=<redacted>`,
    requestBody: cap(JSON.stringify(args.body)),
    responseBody: cap(responseBody),
    errorMessage: errorMessage ?? null
  })
}

// ---------- File upload (resumable) ----------

async function uploadResumable(apiKey: string, data: Buffer, mimeType: string): Promise<string> {
  const startRes = await fetch(`${FILE_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Raw-Size': String(data.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'dayflow_video' } })
  })
  const uploadURL = startRes.headers.get('X-Goog-Upload-URL')
  if (!uploadURL) throw new ProviderError('No upload URL in response', 'GeminiError', 4)
  const putRes = await fetch(uploadURL, {
    method: 'PUT',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0'
    },
    body: new Uint8Array(data)
  })
  const text = await putRes.text()
  try {
    const parsed = JSON.parse(text)
    const uri = parsed?.file?.uri
    if (typeof uri === 'string') return uri
  } catch {
    /* fall through */
  }
  throw new ProviderError('Failed to parse upload response', 'GeminiError', 5)
}

async function getFileState(apiKey: string, fileURI: string): Promise<string> {
  const res = await fetch(`${fileURI}?key=${apiKey}`)
  const parsed = (await res.json()) as { state?: string }
  return parsed.state ?? 'UNKNOWN'
}

async function uploadAndAwait(apiKey: string, data: Buffer, mimeType: string): Promise<string> {
  let lastError: unknown = null
  for (let cycle = 0; cycle < 3; cycle++) {
    let uri: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        uri = await uploadResumable(apiKey, data, mimeType)
        break
      } catch (err) {
        lastError = err
        const transport =
          err instanceof Error && /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|abort/i.test(err.message)
        if (!transport) break
        await sleep(Math.pow(2, attempt + 1) * 1000)
      }
    }
    if (!uri) continue
    const deadline = Date.now() + 3 * 60 * 1000
    for (;;) {
      if (Date.now() > deadline) {
        lastError = new ProviderError('File processing timeout', 'GeminiError', 2)
        break
      }
      const state = await getFileState(apiKey, uri)
      if (state === 'ACTIVE') return uri
      if (state === 'FAILED') {
        lastError = new ProviderError('File processing failed', 'GeminiError', 2)
        break
      }
      await sleep(2000)
    }
  }
  throw lastError ?? new ProviderError('Upload failed', 'GeminiError', 3)
}

// ---------- Schemas ----------

const TRANSCRIPT_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      startTimestamp: { type: 'STRING' },
      endTimestamp: { type: 'STRING' },
      description: { type: 'STRING' }
    },
    required: ['startTimestamp', 'endTimestamp', 'description'],
    propertyOrdering: ['startTimestamp', 'endTimestamp', 'description']
  }
}

const CARD_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      startTime: { type: 'STRING' },
      endTime: { type: 'STRING' },
      category: { type: 'STRING' },
      subcategory: { type: 'STRING' },
      title: { type: 'STRING' },
      summary: { type: 'STRING' },
      detailedSummary: { type: 'STRING' },
      distractions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            startTime: { type: 'STRING' },
            endTime: { type: 'STRING' },
            title: { type: 'STRING' },
            summary: { type: 'STRING' }
          },
          required: ['startTime', 'endTime', 'title', 'summary'],
          propertyOrdering: ['startTime', 'endTime', 'title', 'summary']
        }
      },
      appSites: {
        type: 'OBJECT',
        properties: { primary: { type: 'STRING' }, secondary: { type: 'STRING' } },
        required: [],
        propertyOrdering: ['primary', 'secondary']
      }
    },
    required: ['startTime', 'endTime', 'category', 'subcategory', 'title', 'summary', 'detailedSummary'],
    propertyOrdering: [
      'startTime',
      'endTime',
      'category',
      'subcategory',
      'title',
      'summary',
      'detailedSummary',
      'distractions',
      'appSites'
    ]
  }
}

// ---------- Provider ----------

export class GeminiDirectProvider implements BatchProvider {
  constructor(private apiKey: string) {}

  async transcribeScreenshots(
    screenshots: { filePath: string; capturedAt: number }[],
    batchStartTs: number,
    batchId: number
  ): Promise<ObservationInput[]> {
    const sorted = screenshots.slice().sort((a, b) => a.capturedAt - b.capturedAt)
    const interval = settings.get<number>('screenshotIntervalSeconds', 10) || 10
    const videoDuration = sorted.length // 1 fps compressed
    const videoPath = join(tmpdir(), `dayflow_gemini_${randomUUID()}.mp4`)
    try {
      await generateVideoFromScreenshots(
        sorted.map((s, i) => ({
          id: i,
          capturedAt: s.capturedAt,
          filePath: s.filePath,
          fileSize: null,
          idleSecondsAtCapture: null,
          isDeleted: false
        })) as Screenshot[],
        videoPath,
        { fps: 1, maxOutputHeight: 720, bitrate: 1_200_000 }
      )
      const data = readFileSync(videoPath)
      const fileURI = await uploadAndAwait(this.apiKey, data, 'video/mp4')

      const prompt = transcriptionPrompt(mmss(videoDuration))
      const body = {
        contents: [
          {
            parts: [
              { file_data: { mime_type: 'video/mp4', file_uri: fileURI } },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 65536,
          mediaResolution: 'MEDIA_RESOLUTION_HIGH',
          responseMimeType: 'application/json',
          responseSchema: TRANSCRIPT_SCHEMA
        }
      }

      const callGroupId = randomUUID()
      const models = modelOrder()
      let modelIdx = 0
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const text = await generateContent({
            model: models[modelIdx],
            body,
            operation: 'transcribe',
            batchId,
            callGroupId,
            attempt: attempt + 1,
            apiKey: this.apiKey
          })
          const chunks = JSON.parse(text) as {
            startTimestamp: string
            endTimestamp: string
            description: string
          }[]
          const observations: ObservationInput[] = []
          for (const chunk of chunks) {
            const cs = parseMMSS(chunk.startTimestamp)
            const ce = parseMMSS(chunk.endTimestamp)
            if (cs === null || ce === null) continue
            if (cs < -10 || ce > videoDuration + 10) {
              throw new ProviderError('Timestamp exceeds video duration', 'GeminiError', 100)
            }
            observations.push({
              startTs: batchStartTs + Math.round(cs * interval),
              endTs: batchStartTs + Math.round(ce * interval),
              observation: chunk.description,
              metadata: null,
              llmModel: models[modelIdx]
            })
          }
          if (observations.length === 0) {
            throw new ProviderError('No activities identified in video', 'GeminiError', 101)
          }
          return observations
        } catch (err) {
          lastError = err
          if (
            err instanceof ProviderError &&
            CAPACITY_CODES.has(err.code) &&
            modelIdx < models.length - 1
          ) {
            modelIdx++
            continue // model fallback consumes no backoff
          }
          const strategy = classifyError(err)
          if (strategy === 'noRetry' || attempt === 2) throw err
          await sleep(delayFor(strategy, attempt))
        }
      }
      throw lastError ?? new ProviderError('Transcription failed', 'GeminiError', 8)
    } finally {
      rmSync(videoPath, { force: true })
    }
  }

  async generateActivityCards(
    windowObservations: Observation[],
    context: ActivityGenerationContext,
    batchId: number
  ): Promise<ActivityCardData[]> {
    const transcriptText = windowObservations
      .map((o) => `[${formatHMMA(o.startTs)} - ${formatHMMA(o.endTs)}]: ${o.observation}`)
      .join('\n')
    const existingCardsString = JSON.stringify(context.existingCards, null, 2)
    const basePrompt = cardGenerationPrompt(existingCardsString, transcriptText, context.categories)

    const callGroupId = randomUUID()
    const models = modelOrder()
    let modelIdx = 0
    let prompt = basePrompt
    let lastError: unknown = null

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 65536,
            responseMimeType: 'application/json',
            responseSchema: CARD_SCHEMA
          }
        }
        const text = await generateContent({
          model: models[modelIdx],
          body,
          operation: 'generate_activity_cards',
          batchId,
          callGroupId,
          attempt: attempt + 1,
          apiKey: this.apiKey
        })
        const rawCards = JSON.parse(text) as ActivityCardData[]
        const cards = rawCards.map((c) => ({
          ...c,
          category: normalizeCategory(c.category, context.categories)
        }))

        const coverageError = validateTimeCoverage(context.existingCards, cards)
        const durationError = validateDurations(cards)
        if (coverageError || durationError) {
          const blocks: string[] = []
          if (coverageError) {
            blocks.push(
              `TIME COVERAGE ERROR:\n${coverageError}\n\nYou MUST ensure your output cards collectively cover ALL time periods from the input cards. Do not drop any time segments.`
            )
          }
          if (durationError) {
            blocks.push(
              `DURATION ERROR:\n${durationError}\n\nREMINDER: All cards except the last one must be at least 10 minutes long. Please merge short activities into longer, more meaningful cards that tell a coherent story.`
            )
          }
          prompt = `${basePrompt}\n\nPREVIOUS ATTEMPT FAILED - CRITICAL REQUIREMENTS NOT MET:\n\n${blocks.join('\n\n')}\n\nPlease fix these issues and ensure your output meets all requirements.`
          await sleep(1000)
          continue
        }
        return cards
      } catch (err) {
        lastError = err
        if (
          err instanceof ProviderError &&
          CAPACITY_CODES.has(err.code) &&
          modelIdx < models.length - 1
        ) {
          modelIdx++
          continue
        }
        const strategy = classifyError(err)
        if (strategy === 'noRetry' || attempt === 3) throw err
        prompt = basePrompt // reset enhanced prompt on non-validation errors
        await sleep(delayFor(strategy, attempt))
      }
    }
    throw lastError ?? new ProviderError('Card generation failed after retries', 'GeminiError', 999)
  }

  async generateText(prompt: string, maxTokens = 8192): Promise<string> {
    const callGroupId = randomUUID()
    const models = modelOrder()
    let modelIdx = 0
    let lastError: unknown = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens }
        }
        const text = await generateContent({
          model: models[modelIdx],
          body,
          operation: 'generate_text',
          callGroupId,
          attempt: attempt + 1,
          apiKey: this.apiKey
        })
        return text.trim()
      } catch (err) {
        lastError = err
        if (
          err instanceof ProviderError &&
          CAPACITY_CODES.has(err.code) &&
          modelIdx < models.length - 1
        ) {
          modelIdx++
          continue
        }
        const strategy = classifyError(err)
        if (strategy === 'noRetry' || attempt === 3) throw err
        await sleep(delayFor(strategy, attempt))
      }
    }
    throw lastError ?? new ProviderError('Text generation failed', 'GeminiError', 8)
  }
}

// ---------- Card validation ----------

function timeToMinutes(v: string): number | null {
  const ampm = v.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/)
  if (ampm) {
    let h = parseInt(ampm[1], 10)
    const m = parseInt(ampm[2], 10)
    if (ampm[3] === 'PM' && h !== 12) h += 12
    if (ampm[3] === 'AM' && h === 12) h = 0
    return h * 60 + m
  }
  const mmssMatch = parseMMSS(v)
  if (mmssMatch !== null) return mmssMatch / 60
  return null
}

function cardRanges(cards: ActivityCardData[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const c of cards) {
    const s = timeToMinutes(c.startTime)
    let e = timeToMinutes(c.endTime)
    if (s === null || e === null) continue
    if (e < s) e += 24 * 60
    if (e - s < 0.1) continue
    out.push({ start: s, end: e })
  }
  return out
}

function validateTimeCoverage(
  input: ActivityCardData[],
  output: ActivityCardData[]
): string | null {
  if (input.length === 0) return null
  const FLEX = 3 // minutes
  const inputRanges = cardRanges(input).sort((a, b) => a.start - b.start)
  // Merge with 1-min adjacency slack
  const merged: { start: number; end: number }[] = []
  for (const r of inputRanges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  const outputRanges = cardRanges(output).sort((a, b) => a.start - b.start)
  const missing: string[] = []
  for (const range of merged) {
    let cursor = range.start
    let iterations = 0
    while (cursor < range.end - FLEX && iterations < 10_000) {
      iterations++
      const covering = outputRanges.find((o) => o.start <= cursor + FLEX && o.end > cursor)
      if (!covering) {
        const gapEnd = Math.min(
          range.end,
          outputRanges.find((o) => o.start > cursor)?.start ?? range.end
        )
        if (gapEnd - cursor > FLEX) {
          missing.push(`${Math.round(cursor)}-${Math.round(gapEnd)} min`)
        }
        cursor = gapEnd + 0.01
      } else {
        cursor = Math.max(covering.end, cursor + 0.01)
      }
    }
  }
  if (missing.length > 0) return `Missing coverage for time segments: ${missing.join(', ')}`
  return null
}

function validateDurations(cards: ActivityCardData[]): string | null {
  for (let i = 0; i < cards.length - 1; i++) {
    const s = timeToMinutes(cards[i].startTime)
    let e = timeToMinutes(cards[i].endTime)
    if (s === null || e === null) continue
    if (e < s) e += 24 * 60
    const dur = e - s
    if (dur < 10) {
      return `Card ${i + 1} '${cards[i].title}' is only ${dur.toFixed(1)} minutes long`
    }
  }
  return null
}

// ---------- Connection test ----------

export async function testGeminiConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey.trim()) return { ok: false, message: 'Invalid API key' }
  try {
    const res = await fetch(
      `${GEN_BASE}/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Please respond with exactly: Hi from Gemini!' }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
        })
      }
    )
    const text = await res.text()
    if (res.status === 401 || res.status === 403) {
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) return { ok: false, message: parsed.error.message }
      } catch {
        /* ignore */
      }
      return { ok: false, message: 'Invalid API key' }
    }
    if (res.status !== 200) return { ok: false, message: `Status code: ${res.status}` }
    const parsed = JSON.parse(text)
    const out = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
    return { ok: true, message: typeof out === 'string' ? out : 'Connected' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' }
  }
}
