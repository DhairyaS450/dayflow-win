// DailyRecapScheduler port: auto-generates the daily standup draft.
// Checks every 5 min; requires isDailyUnlocked, hour >= 4, and no standup for
// the current logical day. Source day: 1-3 days back with >= 180 min activity.

import { Notification } from 'electron'
import { randomUUID } from 'crypto'
import * as storage from '../db/storage'
import { settings } from '../lib/settings'
import { dayWindow, formatHMMA } from '../lib/time'
import { languageInstruction } from '../providers/prompts'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const MIN_SOURCE_MINUTES = 180
const LOOKBACK_DAYS = 3

interface StandupBullet {
  id: string
  text: string
}

interface StandupDraft {
  highlightsTitle: string
  highlights: StandupBullet[]
  tasksTitle: string
  tasks: StandupBullet[]
  blockersTitle: string
  blockersBody: string
  generation?: {
    provider: string
    runtime: string
    modelOrTool?: string
    sourceDay?: string
    generatedAt?: string
  }
}

let running = false
let timer: NodeJS.Timeout | null = null
let generateTextFn: ((prompt: string, maxTokens?: number) => Promise<string>) | null = null

export function startRecapScheduler(
  generateText: (prompt: string, maxTokens?: number) => Promise<string>
): void {
  generateTextFn = generateText
  if (timer) return
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  void check()
}

function logicalDayString(date = new Date()): string {
  const d = new Date(date.getTime())
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDaysStr(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  date.setDate(date.getDate() + delta)
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function check(): Promise<void> {
  if (running || !generateTextFn) return
  running = true
  try {
    // Auto-unlock Daily once 5 analyzed hours (20 completed 15-min batches) exist.
    if (!settings.get<boolean>('isDailyUnlocked', false)) {
      if (storage.countCompletedAnalysisBatches() >= 20) {
        settings.set('isDailyUnlocked', true)
      } else {
        return
      }
    }
    if (new Date().getHours() < 4) return
    const targetDay = logicalDayString()
    if (storage.fetchDailyStandup(targetDay)) return

    // Consumed source days
    const consumed = new Set<string>()
    for (const entry of storage.fetchRecentDailyStandups(20, null)) {
      try {
        const draft = JSON.parse(entry.payloadJSON) as StandupDraft
        if (draft.generation?.sourceDay) consumed.add(draft.generation.sourceDay)
      } catch {
        /* ignore */
      }
    }

    let sourceDay: string | null = null
    for (let back = 1; back <= LOOKBACK_DAYS; back++) {
      const candidate = addDaysStr(targetDay, -back)
      if (consumed.has(candidate)) continue
      const { startTs, endTs } = dayWindow(candidate)
      if (storage.fetchTotalMinutesTracked(startTs, endTs) >= MIN_SOURCE_MINUTES) {
        sourceDay = candidate
        break
      }
    }
    if (!sourceDay) return

    const prompt = makeRecapPrompt(sourceDay)
    const raw = await generateTextFn(prompt, 8192)
    const parsed = parseRecapResponse(raw)
    if (!parsed) return

    const draft: StandupDraft = {
      highlightsTitle: "Yesterday's highlights",
      highlights: parsed.done.map((text) => ({ id: randomUUID(), text })),
      tasksTitle: "Today's tasks",
      tasks: parsed.next ? [{ id: randomUUID(), text: parsed.next }] : [],
      blockersTitle: 'Blockers',
      blockersBody: '',
      generation: {
        provider: settings.get<string>('selectedLLMProvider', 'gemini'),
        runtime:
          settings.get<string>('selectedLLMProvider', 'gemini') === 'ollama'
            ? 'local_llm'
            : 'gemini_direct',
        sourceDay,
        generatedAt: new Date().toISOString()
      }
    }
    storage.saveDailyStandup(targetDay, JSON.stringify(draft))
    if (storage.fetchDailyStandup(targetDay)) {
      new Notification({
        title: 'Daily recap ready',
        body: 'Your standup draft for today is ready in the Daily tab.'
      }).show()
    }
  } catch (err) {
    console.error('[recap] generation failed', err)
  } finally {
    running = false
  }
}

function makeRecapPrompt(day: string): string {
  const cards = storage.fetchTimelineCardsForDay(day)
  let cardsText: string
  if (cards.length === 0) {
    cardsText = `No timeline activities were recorded for ${day}.`
  } else {
    const lines = cards.map((c, i) => {
      const range =
        c.startTs && c.endTs ? `${formatHMMA(c.startTs)} - ${formatHMMA(c.endTs)}` : ''
      const main = c.title || c.summary
      const extra = c.summary && c.summary !== main ? `\n   ${c.summary}` : ''
      return `${i + 1}. ${range}: ${main}${extra}`
    })
    cardsText = `Timeline activities for ${day}:\n\n${lines.join('\n')}`
  }
  const lang = languageInstruction(true)
  const languageSection = lang ? `## Language\n\n${lang}\n\n` : ''
  return `${RECAP_PROMPT}

You only have timeline cards for this day. The log is incomplete by nature, so prefer omission over guessing.

Activity log:

${cardsText}

${languageSection}## Output format

Return ONLY valid JSON, no markdown fences, no preamble. Use this exact schema:

{
  "done": ["first bullet", "second bullet", "..."],
  "next": "one sentence or null"
}

Return exactly one JSON object and nothing before or after it.`
}

function parseRecapResponse(raw: string): { done: string[]; next: string | null } | null {
  let text = raw.trim()
  const thinkingIdx = text.indexOf('---END_THINKING---')
  if (thinkingIdx >= 0) text = text.slice(thinkingIdx + '---END_THINKING---'.length)
  text = text.replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text
  try {
    const parsed = JSON.parse(candidate) as { done?: unknown; next?: unknown }
    if (parsed.done === undefined && parsed.next === undefined) return null
    const doneArr = Array.isArray(parsed.done) ? parsed.done : parsed.done != null ? [parsed.done] : []
    const done = [...new Set(doneArr.map((d) => String(d).trim()).filter((d) => d && d !== 'null'))].slice(0, 5)
    let next: string | null = null
    if (Array.isArray(parsed.next)) next = parsed.next.length ? String(parsed.next[0]).trim() : null
    else if (parsed.next != null && parsed.next !== 'null') next = String(parsed.next).trim() || null
    if (done.length === 0 && !next) return null
    return { done, next }
  } catch {
    return null
  }
}

// Daily recap selection/writing guidance — ported from the MIT-licensed upstream prompt.
const RECAP_PROMPT = `# Daily Recap Prompt

You are the person whose activity log this is, writing a quick end-of-day recap for yourself.
Your future self doesn't need a diary. You need the 3-5 things that actually moved the needle today so you can look back and know what happened.

Read the log, find the real accomplishments, and write them up the way you'd tell a friend: "here's what I actually got done today."

## Selection rules

- Put 0 to 5 items in "done" based on evidence quality.
- Do NOT pad to reach 5. If only two things were genuinely meaningful, return two.
- If nothing high-confidence exists, return an empty "done" array.

## What counts as an accomplishment

An accomplishment is something that has a clear before and after. You finished it, decided it, figured it out, or made something real. Anything where the state of the world changed because of what you did.

Examples across roles:
- A founder closed a conversation, sent a launch, locked in a positioning decision.
- A student finished a problem set, nailed down a thesis argument, submitted an application.
- A designer shipped a comp, got approval on a flow, resolved a UX question with evidence.
- An engineer fixed a bug, landed a feature, unblocked a dependency.

Not accomplishments: browsing, reading without a takeaway, meetings that ended without a decision, half-started tasks with no checkpoint.

## Writing rules

- Each item: one sentence, 8-20 words max. If it's over 20, split or trim.
- Lead with what changed or what you decided, not the process of getting there.
- Write like a real person. Plain, direct, no filler.
- Banned words: leverage, surface, actionable, facilitate, optimize (unless literally about an optimizer), deep-dive, synergy, align (unless about visual alignment).
- If something sounds like a consultant or a report generator wrote it, rewrite it in your own words.
- Use only evidence from the log. Do not invent or assume details.
- Name concrete things: the pricing page, the midterm essay, the onboarding flow, the partner deal. Not vague categories.
- Include a number when it adds real signal (a metric, count, %, dollar amount, word count). If the log has a useful number, use it. Don't force one in.
- If a useful number from the log matters, include it in the bullet.

## What to skip

- Browsing, entertainment, social media scrolling, side distractions.
- Low-signal process noise: "build succeeded," "synced files," "opened app."
- Tool and workflow internals your future self won't care about: file names, class names, git/PR activity, IDE details, batch IDs.
- Don't mention AI tools by name (Claude, ChatGPT, Cursor, Copilot) unless the work was explicitly about that tool. The accomplishment is the output, not the tool.
- No em dashes. No hype. No self-praise.

## Tomorrow / next section

- Include "next" (exactly 1 item) only when the log shows a specific task that was clearly started but unfinished, or a concrete next step explicitly discussed or planned during the day.
- Do not speculate. If nothing in the log points to a specific carryover task, set "next" to null.
- The bar: could you point to a specific moment in the log where this next step was set up? If not, leave it out.

## Examples

Good bullets:
- "Fixed the webhook retry bug that was dropping ~12% of partner callbacks."
- "Finished the pricing page FAQ and got sign-off from Lisa."
- "Narrowed the signup drop-off to the email verification step, 41% abandon rate."
- "Submitted the constitutional law essay, 2,800 words."
- "Locked in the 'automatic work journal' positioning after testing five alternatives."
- "Got verbal yes from the Acme partnership, sending the agreement tomorrow."
- "Finalized the onboarding flow redesign, down from 7 screens to 4."

Bad bullets and why:
- "Updated AuthService.swift and pushed three commits." -> Implementation details nobody needs.
- "Surfaced conversion leakage insights and drafted actionable recommendations." -> Consultant-speak. What did you actually find?
- "Spent a focused session analyzing churn patterns to derive strategic retention insights." -> Describes the process, not the result. What did the analysis show?
- "Did some research on competitors." -> Too vague. What did you learn? What did you decide?
- "Had a productive brainstorm with the team." -> What came out of it?`
