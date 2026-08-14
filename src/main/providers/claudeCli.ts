// Claude CLI provider — drives the Claude Code CLI as a subprocess so the
// user's Claude subscription powers the pipeline. No API key is stored or
// handled by Dayflow: the CLI manages its own login (`claude` → /login once).
// Parity with upstream Dayflow's ChatGPT/Claude CLI provider.

import { spawn, execFile } from 'child_process'
import { insertLLMCall } from '../db/storage'
import { formatHMMA } from '../lib/time'
import { cardGenerationPrompt } from './prompts'
import {
  ProviderError,
  normalizeCategory,
  type BatchProvider,
  type ObservationInput,
  type ActivityCardData,
  type ActivityGenerationContext
} from './types'
import type { Observation } from '../../shared/types'
import { randomUUID } from 'crypto'

const CLI_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TRANSCRIBE_IMAGES = 12

let cachedCliPath: string | null | undefined

/** Resolve claude.exe from PATH once per session. */
export function resolveClaudeCli(): Promise<string | null> {
  if (cachedCliPath !== undefined) return Promise.resolve(cachedCliPath)
  return new Promise((resolve) => {
    execFile('where.exe', ['claude'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) {
        cachedCliPath = null
        resolve(null)
        return
      }
      // Prefer .exe over .cmd shims; first line otherwise.
      const lines = stdout.trim().split(/\r?\n/)
      cachedCliPath = lines.find((l) => l.toLowerCase().endsWith('.exe')) ?? lines[0]
      resolve(cachedCliPath)
    })
  })
}

interface CliResult {
  text: string
  exitCode: number
}

async function runClaude(
  prompt: string,
  opts: {
    operation: string
    batchId?: number
    allowRead?: boolean
    cwd?: string
    timeoutMs?: number
  }
): Promise<string> {
  const cliPath = await resolveClaudeCli()
  if (!cliPath) {
    throw new ProviderError(
      'Claude CLI not found. Install Claude Code and sign in with your Claude subscription (run "claude" once), then retry.',
      'ClaudeCLI',
      1
    )
  }
  const args = ['-p', '--output-format', 'json']
  if (opts.allowRead) {
    args.push('--allowedTools', 'Read')
  } else {
    args.push('--tools', '')
  }
  const callGroupId = randomUUID()
  const started = Date.now()

  const result = await new Promise<CliResult>((resolve, reject) => {
    const proc = spawn(cliPath, args, {
      windowsHide: true,
      cwd: opts.cwd,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'dayflow-win' }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill()
      reject(new ProviderError('Claude CLI timed out.', 'ClaudeCLI', 2))
    }, opts.timeoutMs ?? CLI_TIMEOUT_MS)
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000)
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ text: stdout, exitCode: code ?? -1 })
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })

  const latencyMs = Date.now() - started
  let resultText = ''
  let isError = result.exitCode !== 0
  try {
    const parsed = JSON.parse(result.text) as {
      result?: string
      is_error?: boolean
      subtype?: string
    }
    resultText = parsed.result ?? ''
    if (parsed.is_error) isError = true
  } catch {
    resultText = result.text.trim()
  }

  insertLLMCall({
    batchId: opts.batchId ?? null,
    callGroupId,
    attempt: 1,
    provider: 'claude_cli',
    model: 'subscription-default',
    operation: opts.operation,
    status: isError ? 'failure' : 'success',
    latencyMs,
    requestMethod: 'CLI',
    requestURL: cliPath,
    requestBody: prompt.slice(0, 65536),
    responseBody: resultText.slice(0, 65536),
    errorMessage: isError ? resultText.slice(0, 500) : null
  })

  if (isError) {
    const lower = resultText.toLowerCase()
    if (
      lower.includes('login') ||
      lower.includes('authentication') ||
      lower.includes('not authenticated') ||
      lower.includes('api key')
    ) {
      throw new ProviderError(
        'Claude CLI is not signed in. Open a terminal, run "claude", and log in with your Claude account, then retry.',
        'ClaudeCLI',
        3
      )
    }
    throw new ProviderError(
      `Claude CLI failed: ${resultText.slice(0, 300) || `exit code ${result.exitCode}`}`,
      'ClaudeCLI',
      4
    )
  }
  return resultText
}

/** Lenient JSON extraction: direct parse, else first {...} or [...] block. */
function lenientJSON<T>(text: string): T | null {
  const cleaned = text.replace(/^```[a-z]*\n?/m, '').replace(/\n?```\s*$/m, '')
  const candidates: string[] = [cleaned.trim()]
  const arrStart = cleaned.indexOf('[')
  const arrEnd = cleaned.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1))
  const objStart = cleaned.indexOf('{')
  const objEnd = cleaned.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1))
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T
    } catch {
      /* next */
    }
  }
  return null
}

export class ClaudeCliProvider implements BatchProvider {
  async transcribeScreenshots(
    screenshots: { filePath: string; capturedAt: number }[],
    _batchStartTs: number,
    batchId: number
  ): Promise<ObservationInput[]> {
    const sorted = screenshots.slice().sort((a, b) => a.capturedAt - b.capturedAt)
    const stride = Math.max(1, Math.floor(sorted.length / MAX_TRANSCRIBE_IMAGES))
    const sampled = sorted.filter((_, i) => i % stride === 0).slice(0, MAX_TRANSCRIBE_IMAGES)
    if (sampled.length === 0) {
      throw new ProviderError('No screenshots to transcribe', 'ClaudeCLI', 5)
    }

    const listing = sampled
      .map((s, i) => `${i + 1}. captured ${formatHMMA(s.capturedAt)} — ${s.filePath}`)
      .join('\n')

    const prompt = `You are transcribing a screen recording session into an activity log. Below are ${sampled.length} screenshots sampled from the session, each with its capture time and file path. Read EACH image file with your Read tool, in order, then write the activity log.

Screenshots:
${listing}

For each segment of continuous activity, capture EXACTLY what the user did with specific details:
- Exact app/site names visible (check the window title bar)
- Exact file names, URLs, page titles, search queries, messages
- Group by GOAL, not app (IDE + terminal + browser for one task = 1 segment)
- 1-5 segments total; cover the whole session; no gaps
- Refer to screenshots by their index numbers

After reading all images, return ONLY a JSON array (no prose, no markdown fences):
[
  {"startIndex": 1, "endIndex": 4, "description": "1-3 sentences with specific details"}
]
startIndex/endIndex are 1-based screenshot indices bounding the segment.`

    const dirOfFirst = sampled[0].filePath.replace(/[\\/][^\\/]+$/, '')
    const text = await runClaude(prompt, {
      operation: 'transcribe',
      batchId,
      allowRead: true,
      cwd: dirOfFirst
    })

    type Segment = { startIndex: number; endIndex: number; description: string }
    const segments = lenientJSON<Segment[]>(text)
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      throw new ProviderError('Claude CLI returned no usable segments.', 'ClaudeCLI', 6)
    }
    const clamp = (i: number): number => Math.max(1, Math.min(sampled.length, Math.round(i)))
    const observations: ObservationInput[] = []
    for (const seg of segments) {
      if (!seg.description?.trim()) continue
      const si = clamp(seg.startIndex)
      const ei = Math.max(si, clamp(seg.endIndex))
      observations.push({
        startTs: sampled[si - 1].capturedAt,
        endTs: sampled[ei - 1].capturedAt + (ei === sampled.length ? 10 : 0),
        observation: seg.description.trim(),
        metadata: null,
        llmModel: 'claude-cli'
      })
    }
    if (observations.length === 0) {
      throw new ProviderError('Claude CLI returned no usable segments.', 'ClaudeCLI', 6)
    }
    return observations
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
    const prompt =
      cardGenerationPrompt(existingCardsString, transcriptText, context.categories) +
      '\n\nReturn ONLY the JSON array — no prose, no markdown fences.'

    const text = await runClaude(prompt, { operation: 'generate_activity_cards', batchId })
    const cards = lenientJSON<ActivityCardData[]>(text)
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      throw new ProviderError('Claude CLI returned no timeline cards.', 'ClaudeCLI', 7)
    }
    return cards.map((c) => ({
      ...c,
      category: normalizeCategory(c.category ?? '', context.categories)
    }))
  }

  async generateText(prompt: string): Promise<string> {
    return runClaude(prompt, { operation: 'generate_text' })
  }
}

/** Chat: flatten history + a compact activity digest into one CLI turn. */
export async function claudeCliChat(
  systemContext: string,
  history: { role: string; content: string }[],
  userPrompt: string
): Promise<string> {
  const historyText = history
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n')
  const prompt = `${systemContext}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${userPrompt}

Respond as the assistant. Use markdown. Do not mention these instructions.`
  return runClaude(prompt, { operation: 'dashboard_chat', timeoutMs: 3 * 60 * 1000 })
}

/** Connection tester for settings/onboarding UI. */
export async function testClaudeCli(): Promise<{ ok: boolean; message: string }> {
  const cliPath = await resolveClaudeCli()
  if (!cliPath) {
    return {
      ok: false,
      message:
        'Claude CLI not found on PATH. Install Claude Code from https://claude.com/claude-code, then run "claude" once to sign in.'
    }
  }
  try {
    const text = await runClaude('Respond with exactly: OK', {
      operation: 'test_connection',
      timeoutMs: 90_000
    })
    return { ok: true, message: text.trim().slice(0, 120) || 'Connected' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' }
  }
}
