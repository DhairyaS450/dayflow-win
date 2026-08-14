// OllamaProvider port — serves Ollama, LM Studio, and custom OpenAI-compatible
// endpoints. Frame-based transcription (~15 sampled screenshots) + multi-step
// card generation (summary → title → merge-check → merge).

import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { nativeImage } from 'electron'
import { settings } from '../lib/settings'
import { insertLLMCall } from '../db/storage'
import { formatHMMA } from '../lib/time'
import {
  ollamaFrameDescriptionPrompt,
  ollamaSegmentPrompt,
  ollamaSummaryPrompt,
  ollamaTitlePrompt,
  ollamaMergeCheckPrompt,
  ollamaMergeCardsPrompt
} from './prompts'
import {
  ProviderError,
  normalizeCategory,
  type BatchProvider,
  type ObservationInput,
  type ActivityCardData,
  type ActivityGenerationContext
} from './types'
import type { Observation } from '../../shared/types'

export type LocalEngine = 'ollama' | 'lmstudio' | 'custom'

export const LOCAL_DEFAULTS: Record<LocalEngine, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  custom: 'http://localhost:11434'
}

export const LOCAL_MODEL_PRESETS = {
  qwen3_vl_4b: {
    recommended: true,
    ollamaId: 'qwen3-vl:4b',
    lmstudioId: 'Qwen3-VL-4B-Instruct',
    pullCommand: 'ollama pull qwen3-vl:4b',
    lmstudioURL: 'https://model.lmstudio.ai/download/lmstudio-community/Qwen3-VL-4B-Instruct-GGUF'
  },
  qwen25_vl_3b: {
    recommended: false,
    ollamaId: 'qwen2.5vl:3b',
    lmstudioId: 'qwen2.5-vl-3b-instruct',
    pullCommand: 'ollama pull qwen2.5vl:3b',
    lmstudioURL: 'https://model.lmstudio.ai/download/lmstudio-community/Qwen2.5-VL-3B-Instruct-GGUF'
  }
} as const

/** Normalize a base URL to the chat-completions endpoint. */
export function chatCompletionsURL(base: string): string {
  let url = base.trim().replace(/\/+$/, '')
  url = url.replace(/([^:])\/{2,}/g, '$1/')
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  const u = new URL(url)
  const path = u.pathname.replace(/\/+$/, '')
  if (path === '' || path === '/') u.pathname = '/v1/chat/completions'
  else if (path.endsWith('/v1/chat/completions')) u.pathname = path
  else if (path.endsWith('/v1')) u.pathname = `${path}/chat/completions`
  else u.pathname = `${path}/v1/chat/completions`
  return u.toString()
}

function currentEngine(): LocalEngine {
  return settings.get<LocalEngine>('llmLocalEngine', 'ollama')
}

function currentModelId(): string {
  const saved = settings.get<string>('llmLocalModelId', '')
  if (saved) return saved
  const engine = currentEngine()
  return engine === 'lmstudio'
    ? LOCAL_MODEL_PRESETS.qwen3_vl_4b.lmstudioId
    : LOCAL_MODEL_PRESETS.qwen3_vl_4b.ollamaId
}

function baseURL(): string {
  return settings.get<string>('llmLocalBaseURL', LOCAL_DEFAULTS[currentEngine()])
}

function authHeader(): string | null {
  const engine = currentEngine()
  if (engine === 'lmstudio') return 'Bearer lm-studio'
  if (engine === 'custom') {
    const key = settings.get<string>('llmLocalAPIKey', '')
    if (key) return `Bearer ${key}`
  }
  return null
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

/** Lenient JSON extraction: direct parse, else first {...} or [...] substring. */
function lenientJSON<T>(text: string): T | null {
  const attempts: string[] = [text.trim()]
  const objStart = text.indexOf('{')
  const objEnd = text.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) attempts.push(text.slice(objStart, objEnd + 1))
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) attempts.push(text.slice(arrStart, arrEnd + 1))
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* next */
    }
  }
  return null
}

interface CallOptions {
  operation: string
  batchId?: number
  images?: string[] // base64 JPEGs
  expectJSON?: boolean
  maxAttempts?: number
  maxTokens?: number
  logRequestBody?: boolean
}

async function callChatAPI(prompt: string, opts: CallOptions): Promise<string> {
  const url = chatCompletionsURL(baseURL())
  const { maxAttempts = 3, maxTokens = 4000, logRequestBody = true } = opts
  const callGroupId = randomUUID()
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const started = Date.now()
    let status = 0
    let bodyText = ''
    try {
      const userContent: unknown[] = [{ type: 'text', text: prompt }]
      for (const b64 of opts.images ?? []) {
        userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })
      }
      const messages: unknown[] = []
      if (!opts.images?.length) {
        messages.push({
          role: 'system',
          content: [
            {
              type: 'text',
              text: opts.expectJSON
                ? 'You are a helpful assistant. Always respond with valid JSON.'
                : 'You are a helpful assistant.'
            }
          ]
        })
      }
      messages.push({ role: 'user', content: userContent })
      const body = {
        model: currentModelId(),
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const auth = authHeader()
      if (auth) headers.Authorization = auth

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        })
        status = res.status
        bodyText = await res.text()
      } finally {
        clearTimeout(timer)
      }

      if (status !== 200) {
        throw new ProviderError(`Local API error (${status}): ${bodyText.slice(0, 500)}`, 'OllamaProvider', 4)
      }
      const parsed = JSON.parse(bodyText) as { choices?: { message?: { content?: string } }[] }
      const content = parsed.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new ProviderError('The local AI returned an unexpected response', 'OllamaProvider', 8)
      }
      insertLLMCall({
        batchId: opts.batchId ?? null,
        callGroupId,
        attempt: attempt + 1,
        provider: currentEngine(),
        model: currentModelId(),
        operation: opts.operation,
        status: 'success',
        latencyMs: Date.now() - started,
        httpStatus: status,
        requestMethod: 'POST',
        requestURL: url,
        requestBody: logRequestBody ? prompt.slice(0, 65536) : null,
        responseBody: bodyText.slice(0, 65536)
      })
      return content
    } catch (err) {
      lastError = err
      insertLLMCall({
        batchId: opts.batchId ?? null,
        callGroupId,
        attempt: attempt + 1,
        provider: currentEngine(),
        model: currentModelId(),
        operation: opts.operation,
        status: 'failure',
        latencyMs: Date.now() - started,
        httpStatus: status || null,
        requestMethod: 'POST',
        requestURL: url,
        requestBody: logRequestBody ? prompt.slice(0, 65536) : null,
        responseBody: bodyText.slice(0, 65536) || null,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
      if (attempt < maxAttempts - 1) await sleep(Math.pow(2, attempt) * 2000)
    }
  }
  throw lastError ?? new ProviderError('Failed to connect to local AI model', 'OllamaProvider', 4)
}

function loadDownscaledBase64(filePath: string, maxHeight = 720, quality = 85): string | null {
  try {
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return null
    const size = img.getSize()
    if (size.height <= maxHeight) {
      return readFileSync(filePath).toString('base64')
    }
    const resized = img.resize({ height: maxHeight })
    return resized.toJPEG(quality).toString('base64')
  } catch {
    return null
  }
}

function stripUserReferences(text: string): string {
  return text.replace(/\b(The user|A user)\b/gi, '').trim()
}

export class OllamaProvider implements BatchProvider {
  async transcribeScreenshots(
    screenshots: { filePath: string; capturedAt: number }[],
    batchStartTs: number,
    batchId: number
  ): Promise<ObservationInput[]> {
    const sorted = screenshots.slice().sort((a, b) => a.capturedAt - b.capturedAt)
    const stride = Math.max(1, Math.floor(sorted.length / 15))
    const sampled = sorted.filter((_, i) => i % stride === 0).slice(0, 15)
    if (sampled.length === 0) {
      throw new ProviderError('No screenshots to transcribe', 'OllamaProvider', 11)
    }
    const first = sampled[0].capturedAt
    const durationSeconds = Math.max(1, sampled[sampled.length - 1].capturedAt - first)
    const interval = settings.get<number>('screenshotIntervalSeconds', 10) || 10

    // Frame descriptions — 1 attempt each; failures skip the frame.
    const described: { offset: number; description: string }[] = []
    for (const shot of sampled) {
      const b64 = loadDownscaledBase64(shot.filePath)
      if (!b64) continue
      try {
        const desc = await callChatAPI(ollamaFrameDescriptionPrompt(), {
          operation: 'describe_frame',
          batchId,
          images: [b64],
          maxAttempts: 1,
          logRequestBody: false
        })
        described.push({ offset: shot.capturedAt - first, description: desc.trim() })
      } catch {
        /* skip frame */
      }
    }
    if (described.length === 0) {
      throw new ProviderError(
        'Failed to describe any screenshots. Please check that Ollama/LMStudio is running.',
        'OllamaProvider',
        11
      )
    }

    // Segment merge with coverage validation.
    const formatted = described.map((d) => `[${mmss(d.offset)}] ${d.description}`).join('\n')
    const basePrompt = ollamaSegmentPrompt(described.length, mmss(durationSeconds), formatted)
    let prompt = basePrompt
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await callChatAPI(prompt, {
          operation: 'segment_video_activity',
          batchId,
          expectJSON: true,
          maxAttempts: 1
        })
        type Seg = { startTimestamp: string; endTimestamp: string; description: string }
        const parsed = lenientJSON<{ segments?: Seg[] } | Seg[]>(text)
        const segments = Array.isArray(parsed) ? parsed : parsed?.segments
        if (!segments || segments.length === 0) throw new Error('No segments in response')
        const observations: ObservationInput[] = []
        let covered = 0
        for (const seg of segments) {
          const s = parseMMSS(seg.startTimestamp)
          const e = parseMMSS(seg.endTimestamp)
          if (s === null || e === null) continue
          if (s < -30 || e > durationSeconds + 30) continue // tolerance: skip, not fatal
          observations.push({
            startTs: batchStartTs + Math.max(0, s),
            endTs: batchStartTs + Math.min(e, durationSeconds),
            observation: seg.description,
            metadata: null,
            llmModel: currentModelId()
          })
          covered += Math.max(0, Math.min(e, durationSeconds) - Math.max(0, s))
        }
        if (observations.length === 0) {
          throw new ProviderError(
            'Screenshots failed to process - check Ollama/LMStudio logs or report a bug.',
            'OllamaProvider',
            11
          )
        }
        if (observations.length > 5) {
          throw new ProviderError('Too many segments returned', 'OllamaProvider', 13)
        }
        const coverage = covered / durationSeconds
        if (coverage < 0.8) {
          prompt = `${basePrompt}\n\nPREVIOUS ATTEMPT FAILED — Your segments only covered ${Math.round(coverage * 100)}% of the ${mmss(durationSeconds)} video.\nMerge adjacent snapshots or extend segment boundaries so the segments cover at least 80% of the runtime without inventing events.`
          continue
        }
        return observations
      } catch (err) {
        if (attempt === 1) break
        prompt = `${basePrompt}\n\nPREVIOUS ATTEMPT FAILED — The response was invalid (error: ${err instanceof Error ? err.message : String(err)}). Respond with ONLY the JSON object described above. Ensure it contains a "reasoning" string and a "segments" array with 2-5 items covering at least 80% of the video.`
      }
    }

    // Fallback: one observation per frame description.
    return described.map((d, i) => {
      const next = described[i + 1]
      const end = Math.min(
        d.offset + interval,
        next ? next.offset : durationSeconds,
        durationSeconds
      )
      return {
        startTs: batchStartTs + d.offset,
        endTs: batchStartTs + Math.max(end, d.offset + 1),
        observation: d.description,
        metadata: null,
        llmModel: currentModelId()
      }
    })
  }

  async generateActivityCards(
    _windowObservations: Observation[],
    context: ActivityGenerationContext,
    batchId: number
  ): Promise<ActivityCardData[]> {
    // Ollama uses only the new batch's observations (upstream asymmetry).
    const observations = context.batchObservations
    if (observations.length === 0) {
      throw new ProviderError('No observations available for card generation', 'OllamaProvider', 16)
    }
    const observationsText = observations
      .map(
        (o) =>
          `[${formatHMMA(o.startTs)} - ${formatHMMA(o.endTs)}]: ${stripUserReferences(o.observation)}`
      )
      .join('\n\n')

    // Step 1: summary + category + appSites
    type SummaryResponse = {
      summary?: string
      category?: string
      app_sites?: { primary?: string | null; secondary?: string | null }
    }
    let summaryResp: SummaryResponse | null = null
    const summaryBase = ollamaSummaryPrompt(observationsText, context.categories)
    let summaryPrompt = summaryBase
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await callChatAPI(summaryPrompt, {
          operation: 'generate_summary',
          batchId,
          expectJSON: true,
          maxAttempts: 1
        })
        const parsed = lenientJSON<SummaryResponse>(text)
        if (!parsed?.summary || !parsed?.category) throw new Error('missing summary/category')
        summaryResp = parsed
        break
      } catch (err) {
        summaryPrompt = `${summaryBase}\n\nPREVIOUS ATTEMPT FAILED — The response was invalid (error: ${err instanceof Error ? err.message : String(err)}). Respond with ONLY the JSON object described above. Ensure it contains "reasoning", "summary", "category", and "app_sites" fields.`
      }
    }
    if (!summaryResp) {
      throw new ProviderError('Failed to generate summary from local AI', 'OllamaProvider', 12)
    }

    // Step 2: title
    let title = ''
    const titleBase = ollamaTitlePrompt(observations.map((o) => stripUserReferences(o.observation)))
    let titlePrompt = titleBase
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await callChatAPI(titlePrompt, {
        operation: 'generate_title',
        batchId,
        maxAttempts: 1
      })
      title = text.split('\n')[0].trim().replace(/^["']|["']$/g, '').replace(/^title:\s*/i, '')
      if (title) break
      titlePrompt = `${titleBase}\n\nPREVIOUS ATTEMPT FAILED — Respond with ONLY the title text on a single line. Do not include JSON or quotes.`
    }
    if (!title) title = 'Activity session'

    const appSites = summaryResp.app_sites
      ? {
          primary: summaryResp.app_sites.primary?.trim() || null,
          secondary: summaryResp.app_sites.secondary?.trim() || null
        }
      : null

    const newCard: ActivityCardData = {
      startTime: formatHMMA(observations[0].startTs),
      endTime: formatHMMA(observations[observations.length - 1].endTs),
      category: normalizeCategory(summaryResp.category ?? '', context.categories),
      subcategory: '',
      title,
      summary: summaryResp.summary ?? '',
      detailedSummary: '',
      distractions: null,
      appSites
    }

    // Step 3/4: merge with the last existing card?
    const existing = context.existingCards.slice()
    const last = existing[existing.length - 1]
    if (last) {
      const lastDuration = spanMinutes(last.startTime, last.endTime)
      const gap = gapMinutes(last.endTime, newCard.startTime)
      const combined = spanMinutes(last.startTime, newCard.endTime)
      if (lastDuration < 40 && gap <= 5 && combined <= 60) {
        try {
          const checkText = await callChatAPI(ollamaMergeCheckPrompt(last, newCard), {
            operation: 'evaluate_card_merge',
            batchId,
            expectJSON: true,
            maxAttempts: 3
          })
          const check = lenientJSON<{ combine?: boolean }>(checkText)
          if (check?.combine === true) {
            const mergeText = await callChatAPI(ollamaMergeCardsPrompt(last, newCard), {
              operation: 'merge_cards',
              batchId,
              expectJSON: true,
              maxAttempts: 3
            })
            const mergeResp = lenientJSON<{ title?: string; summary?: string }>(mergeText)
            if (mergeResp?.title && mergeResp?.summary) {
              const merged: ActivityCardData = {
                startTime: last.startTime,
                endTime: newCard.endTime,
                category: last.category,
                subcategory: last.subcategory,
                title: mergeResp.title,
                summary: mergeResp.summary,
                detailedSummary: last.detailedSummary,
                distractions: last.distractions,
                appSites: last.appSites ?? newCard.appSites
              }
              if (spanMinutes(merged.startTime, merged.endTime) <= 60) {
                existing[existing.length - 1] = merged
                return existing
              }
            }
          }
        } catch {
          /* merge is best-effort */
        }
      }
    }
    existing.push(newCard)
    return existing
  }

  async generateText(prompt: string, maxTokens = 4000): Promise<string> {
    return callChatAPI(prompt, { operation: 'generate_text', maxTokens })
  }
}

function toMinutes(v: string): number | null {
  const m = v.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  if (m[3] === 'PM' && h !== 12) h += 12
  if (m[3] === 'AM' && h === 12) h = 0
  return h * 60 + parseInt(m[2], 10)
}

function spanMinutes(start: string, end: string): number {
  const s = toMinutes(start)
  let e = toMinutes(end)
  if (s === null || e === null) return 0
  if (e < s) e += 24 * 60
  return e - s
}

function gapMinutes(prevEnd: string, nextStart: string): number {
  const e = toMinutes(prevEnd)
  let s = toMinutes(nextStart)
  if (e === null || s === null) return 0
  if (s < e) s += 24 * 60
  return s - e
}

/** Connection tester for settings/onboarding UI. */
export async function testLocalConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const provider = new OllamaProvider()
    const text = await provider.generateText('Please respond with exactly: OK', 50)
    return { ok: true, message: text.trim() }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' }
  }
}
