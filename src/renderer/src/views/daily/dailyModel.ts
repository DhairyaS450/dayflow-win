// Pure logic for the Daily (standup) view — ported from the macOS Dayflow app (MIT).
// All computation here is UI-free so it can be unit-tested and kept in parity
// with the Swift `computeDailyWorkflow` / `DailyRecapModels` sources.

import {
  parseTimeHMMA,
  logicalDayString,
  dayStart,
  MONTHS,
  MONTHS_SHORT,
  WEEKDAYS,
  WEEKDAYS_SHORT
} from '../../lib/time'
import type { TimelineCard, TimelineCategory, DayGoalPlan, DayGoalCategorySnapshot } from '../../../../shared/types'

/** Fixed Daily layout scale (the whole surface is drawn at 1.1×). */
export const DAILY_SCALE = 1.1

// ---------------------------------------------------------------------------
// Duration / date formatting helpers (§1.4)
// ---------------------------------------------------------------------------

/** "1h 5m" / "2h" / "45m" (rounded to whole minutes, min 0). */
export function formatDurationValue(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h > 0 && rest > 0) return `${h}h ${rest}m`
  if (h > 0) return `${h}h`
  return `${rest}m`
}

/** "1 time" / "3 times". */
export function formatCount(n: number): string {
  return n === 1 ? '1 time' : `${n} times`
}

/** "4 hours 30 minutes" / "1 hour" / "5 hours" / "45 minutes" (goal flow). */
export function formatLongDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  const hs = `${h} hour${h === 1 ? '' : 's'}`
  const ms = `${rest} minute${rest === 1 ? '' : 's'}`
  if (h > 0 && rest > 0) return `${hs} ${ms}`
  if (h > 0) return hs
  return ms
}

/** DaySummary title-case: "2 Hours 15 minutes" / "2 Hours" / "15 minutes" / "0 minutes". */
export function formatTitleCaseDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  const hs = `${h} Hour${h === 1 ? '' : 's'}`
  const ms = `${rest} minute${rest === 1 ? '' : 's'}`
  if (h > 0 && rest > 0) return `${hs} ${ms}`
  if (h > 0) return hs
  return ms
}

/** DaySummary lowercase: "2 hours 15 minutes" / "0 minutes". */
export function formatLowercaseDuration(minutes: number): string {
  return formatLongDuration(minutes)
}

/** Goal header compact hours: whole hours → "4", else 1-decimal "4.5". */
export function formatCompactHours(minutes: number): string {
  const m = Math.max(0, minutes)
  if (m % 60 === 0) return String(m / 60)
  return (m / 60).toFixed(1)
}

/** Goal header used-duration: "<60m" → "25 mins"; whole hours → "3 hours"; else "1h 20m". */
export function formatUsedDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (rest === 0) return `${h} hour${h === 1 ? '' : 's'}`
  return `${h}h ${rest}m`
}

/** Axis hour label: 9am / 12pm / 5pm (hour mod 24). */
export function axisHourLabel(hour: number): string {
  const h24 = ((hour % 24) + 24) % 24
  const ampm = h24 < 12 ? 'am' : 'pm'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return `${h12}${ampm}`
}

/** Whole days between the logical today and `day` (0 = today, 1 = yesterday…). */
export function daysAgo(day: string): number {
  const today = dayStart(logicalDayString()).getTime()
  const d = dayStart(day).getTime()
  return Math.round((today - d) / 86_400_000)
}

/** "Today, August 13" / "Wednesday, September 30". */
export function dailyDateTitle(day: string): string {
  const d = dayStart(day)
  if (day === logicalDayString()) return `Today, ${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Wed, Sep 30". */
export function shortDayLabel(day: string): string {
  const d = dayStart(day)
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

export function workflowHeading(day: string): string {
  const ago = daysAgo(day)
  if (ago === 0) return 'Today so far. Come back tomorrow for the full day view.'
  if (ago === 1) return 'Your workflow yesterday'
  return `Your workflow on ${shortDayLabel(day)}`
}

export function totalsTitle(day: string): string {
  const ago = daysAgo(day)
  if (ago === 0) return "Today's total so far"
  if (ago === 1) return "Yesterday's total"
  return `Total for ${shortDayLabel(day)}`
}

/** "Today" / "Yesterday" / "Last {Weekday}" (2–6 days ago) / "{EEEE, MMMM d}". */
export function standupDayLabelText(day: string): string {
  const ago = daysAgo(day)
  const d = dayStart(day)
  if (ago === 0) return 'Today'
  if (ago === 1) return 'Yesterday'
  if (ago >= 2 && ago <= 6) return `Last ${WEEKDAYS[d.getDay()]}`
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function highlightsTitleFor(sourceDay: string | null): string {
  if (!sourceDay) return 'Recent highlights'
  const label = standupDayLabelText(sourceDay)
  const ago = daysAgo(sourceDay)
  if (ago >= 0 && ago <= 6) return `${label}'s highlights`
  return `Highlights from ${label}`
}

export function tasksTitleFor(targetDay: string): string {
  const label = standupDayLabelText(targetDay)
  const ago = daysAgo(targetDay)
  if (ago === 0 || ago === 1) return `${label}'s tasks`
  return `Tasks for ${label}`
}

// ---------------------------------------------------------------------------
// Access gating (§2.1)
// ---------------------------------------------------------------------------

export const DAILY_REQUIRED_BATCHES = 20 // 5 hours / 15-minute batches

/** "0h / 5h" · "45m / 5h" · "3h / 5h" · "3h 15m / 5h" (capped at requirement). */
export function accessProgressText(completedBatches: number): string {
  const mins = Math.min(Math.max(0, completedBatches) * 15, DAILY_REQUIRED_BATCHES * 15)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  let t: string
  if (mins === 0) t = '0h'
  else if (h === 0) t = `${m}m`
  else if (m === 0) t = `${h}h`
  else t = `${h}h ${m}m`
  return `${t} / 5h`
}

// ---------------------------------------------------------------------------
// Workflow grid computation (§2.4, §2.7)
// ---------------------------------------------------------------------------

export interface WorkflowCell {
  occupancy: number // 0..1
  title: string | null // best card title for the tooltip
  durationMinutes: number // full card duration for the tooltip
}

export interface WorkflowRow {
  key: string
  name: string
  colorHex: string
  cells: WorkflowCell[]
}

export interface WorkflowMarker {
  startMinute: number
  endMinute: number
  title: string
}

export interface WorkflowTotal {
  name: string
  colorHex: string
  minutes: number
}

export interface WorkflowStats {
  contextSwitches: number
  interruptions: number
  focusedMinutes: number
  distractedMinutes: number
  transitionMinutes: number
}

export interface DailyWorkflow {
  windowStart: number // minutes (day-normalized, may exceed 1440)
  windowEnd: number
  slotCount: number
  hourTicks: number[] // hour values, windowStart/60 .. windowEnd/60
  rows: WorkflowRow[] // distraction category row already filtered out
  isPlaceholder: boolean
  showDistractionStrip: boolean
  markers: WorkflowMarker[]
  totals: WorkflowTotal[]
  stats: WorkflowStats
}

const FALLBACK_PALETTE = ['B984FF', '6AADFF', 'FF5950', 'A0AEC0']

export const PLACEHOLDER_ROWS: { name: string; colorHex: string }[] = [
  { name: 'Work', colorHex: '#B984FF' },
  { name: 'Personal', colorHex: '#6AADFF' },
  { name: 'Distraction', colorHex: '#FF5950' },
  { name: 'Idle', colorHex: '#A0AEC0' }
]

/** Deterministic fallback color for unknown categories (djb2 over utf8 bytes). */
export function fallbackCategoryColor(key: string): string {
  let hash = 5381
  const bytes = new TextEncoder().encode(key)
  for (const b of bytes) hash = (Math.imul(hash, 33) + b) | 0
  return `#${FALLBACK_PALETTE[Math.abs(hash) % 4]}`
}

export function categoryKey(name: string): string {
  const k = name.trim().toLowerCase()
  return k.length === 0 ? 'uncategorized' : k
}

export function displayCategoryName(name: string): string {
  const t = name.trim()
  return t.length === 0 ? 'Uncategorized' : t
}

function isDistractionKey(key: string): boolean {
  return key === 'distraction' || key === 'distractions'
}

interface NormCard {
  start: number // day-normalized minutes (< 240 shifted +1440)
  end: number
  key: string
  card: TimelineCard
}

/** Grid normalization: minutes < 240 (+1440); end ≤ start → end += 1440. */
function normalizeGridCards(cards: TimelineCard[]): NormCard[] {
  const out: NormCard[] = []
  for (const card of cards) {
    const s0 = parseTimeHMMA(card.startTimestamp)
    const e0 = parseTimeHMMA(card.endTimestamp)
    if (s0 === null || e0 === null) continue
    let s = s0 < 240 ? s0 + 1440 : s0
    let e = e0 < 240 ? e0 + 1440 : e0
    if (e <= s) e += 1440
    out.push({ start: s, end: e, key: categoryKey(card.category), card })
  }
  return out
}

function anchorMiniRange(
  ms: number,
  me: number,
  ps: number,
  pe: number
): { start: number; end: number } {
  let e0 = me
  if (e0 <= ms) e0 += 1440
  let best: { start: number; end: number } | null = null
  let bestDist = Infinity
  for (const off of [0, 1440, -1440]) {
    const cs = ms + off
    const ce = e0 + off
    let dist: number
    if (ce > ps && cs < pe) dist = 0
    else if (cs >= pe) dist = cs - pe
    else dist = ps - ce
    if (dist < bestDist) {
      bestDist = dist
      best = { start: cs, end: ce }
    }
  }
  if (!best || best.end <= best.start || best.end <= ps || best.start >= pe) {
    // Collapse to a 1-minute sliver clamped inside the parent.
    const s = Math.min(Math.max(best ? best.start : ps, ps), Math.max(ps, pe - 1))
    return { start: s, end: s + 1 }
  }
  return best
}

export function computeDailyWorkflow(
  cards: TimelineCard[],
  categories: TimelineCategory[]
): DailyWorkflow {
  const norm = normalizeGridCards(cards)

  // Window (§2.4.1)
  let windowStart = 540
  let windowEnd = 1260
  if (norm.length > 0) {
    const first = Math.min(...norm.map((c) => c.start))
    const last = Math.max(...norm.map((c) => c.end))
    windowStart = Math.floor(first / 60) * 60
    windowEnd = Math.max(windowStart + 720, Math.ceil(last / 60) * 60)
  }
  const slotCount = Math.max(1, Math.round((windowEnd - windowStart) / 15))
  const firstHour = Math.floor(windowStart / 60)
  const lastHour = Math.ceil(windowEnd / 60)
  const hourTicks: number[] = []
  for (let h = firstHour; h <= Math.max(lastHour, firstHour + 1); h++) hourTicks.push(h)

  // Rows (§2.4.2)
  const userCats = categories
    .filter((c) => !c.isSystem && categoryKey(c.name) !== 'system')
    .slice()
    .sort((a, b) => a.order - b.order)
  const allCatKeys = new Set(categories.map((c) => categoryKey(c.name)))
  const unknownKeys = Array.from(
    new Set(norm.map((c) => c.key).filter((k) => !allCatKeys.has(k)))
  ).sort()

  interface RowDef {
    key: string
    name: string
    colorHex: string
    isIdle: boolean
  }
  const rowDefs: RowDef[] = [
    ...userCats.map((c) => ({
      key: categoryKey(c.name),
      name: displayCategoryName(c.name),
      colorHex: c.colorHex,
      isIdle: c.isIdle
    })),
    ...unknownKeys.map((k) => ({
      key: k,
      name: k === 'uncategorized' ? 'Uncategorized' : k.charAt(0).toUpperCase() + k.slice(1),
      colorHex: fallbackCategoryColor(k),
      isIdle: false
    }))
  ]

  const isPlaceholder = rowDefs.length === 0
  const showDistractionStrip =
    !isPlaceholder &&
    (rowDefs.some((r) => isDistractionKey(r.key)) || norm.some((c) => isDistractionKey(c.key)))

  const byKey = new Map<string, NormCard[]>()
  for (const c of norm) {
    const arr = byKey.get(c.key)
    if (arr) arr.push(c)
    else byKey.set(c.key, [c])
  }

  const buildCells = (key: string): WorkflowCell[] => {
    const catCards = byKey.get(key) ?? []
    const cells: WorkflowCell[] = []
    for (let i = 0; i < slotCount; i++) {
      const slotStart = windowStart + i * 15
      const slotEnd = slotStart + 15
      let total = 0
      let bestOverlap = 0
      let best: NormCard | null = null
      for (const c of catCards) {
        const overlap = Math.min(c.end, slotEnd) - Math.max(c.start, slotStart)
        if (overlap > 0) {
          total += overlap
          if (overlap > bestOverlap) {
            bestOverlap = overlap
            best = c
          }
        }
      }
      cells.push({
        occupancy: Math.min(1, Math.max(0, total / 15)),
        title: best ? best.card.title : null,
        durationMinutes: best ? best.end - best.start : 0
      })
    }
    return cells
  }

  const rows: WorkflowRow[] = isPlaceholder
    ? PLACEHOLDER_ROWS.map((r) => ({
        key: categoryKey(r.name),
        name: r.name,
        colorHex: r.colorHex,
        cells: Array.from({ length: slotCount }, () => ({
          occupancy: 0,
          title: null,
          durationMinutes: 0
        }))
      }))
    : rowDefs
        .filter((r) => !isDistractionKey(r.key))
        .map((r) => ({ key: r.key, name: r.name, colorHex: r.colorHex, cells: buildCells(r.key) }))

  // Distraction markers (§2.4.4)
  const rawMarkers: WorkflowMarker[] = []
  for (const c of norm) {
    if (isDistractionKey(c.key)) {
      rawMarkers.push({ startMinute: c.start, endMinute: c.end, title: c.card.title })
    }
    for (const mini of c.card.distractions ?? []) {
      const ms = parseTimeHMMA(mini.startTime)
      const me = parseTimeHMMA(mini.endTime)
      if (ms === null || me === null) continue
      const anchored = anchorMiniRange(ms, me, c.start, c.end)
      rawMarkers.push({ startMinute: anchored.start, endMinute: anchored.end, title: mini.title })
    }
  }
  // Clip to window, then merge blocks overlapping or within 2 minutes.
  const clipped = rawMarkers
    .map((m) => ({
      ...m,
      startMinute: Math.max(m.startMinute, windowStart),
      endMinute: Math.min(m.endMinute, windowEnd)
    }))
    .filter((m) => m.endMinute > m.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute)
  const markers: WorkflowMarker[] = []
  let curTitles: string[] = []
  for (const m of clipped) {
    const cur = markers[markers.length - 1]
    if (cur && m.startMinute <= cur.endMinute + 2) {
      cur.endMinute = Math.max(cur.endMinute, m.endMinute)
      if (!curTitles.includes(m.title)) {
        curTitles.push(m.title)
        cur.title = curTitles.join(', ')
      }
    } else {
      curTitles = [m.title]
      markers.push({ ...m })
    }
  }

  // Totals (§2.4.6) — full card durations per category, category order.
  const totals: WorkflowTotal[] = []
  for (const r of rowDefs) {
    const catCards = byKey.get(r.key) ?? []
    const minutes = catCards.reduce((acc, c) => acc + (c.end - c.start), 0)
    if (minutes > 0) totals.push({ name: r.name, colorHex: r.colorHex, minutes })
  }

  // Stat chips math (§2.4.7) — computed for parity; not rendered.
  const idleKeys = new Set(
    categories.filter((c) => c.isIdle).map((c) => categoryKey(c.name))
  )
  const segments = norm
    .map((c) => ({
      ...c,
      start: Math.max(c.start, windowStart),
      end: Math.min(c.end, windowEnd)
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let contextSwitches = 0
  let interruptions = 0
  let focusedMinutes = 0
  let distractedMinutes = 0
  let transitionMinutes = 0
  let maxEnd = -Infinity
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (i > 0 && segments[i - 1].key !== seg.key) contextSwitches++
    if ((seg.card.distractions?.length ?? 0) >= 1) interruptions++
    const dur = seg.end - seg.start
    if (idleKeys.has(seg.key)) distractedMinutes += dur
    else focusedMinutes += dur
    if (maxEnd !== -Infinity) {
      const gap = seg.start - maxEnd
      if (gap > 0) transitionMinutes += gap
    }
    maxEnd = Math.max(maxEnd === -Infinity ? seg.end : maxEnd, seg.end)
  }

  return {
    windowStart,
    windowEnd,
    slotCount,
    hourTicks,
    rows,
    isPlaceholder,
    showDistractionStrip,
    markers,
    totals,
    stats: { contextSwitches, interruptions, focusedMinutes, distractedMinutes, transitionMinutes }
  }
}

// ---------------------------------------------------------------------------
// Standup draft model (§2.8)
// ---------------------------------------------------------------------------

export const NOT_GENERATED_MESSAGE =
  'Daily data has not been generated yet. If this is unexpected, please report a bug.'
export const TODAY_NOT_GENERATED_MESSAGE = "Today's daily recap will be generated tomorrow morning."
export const INSUFFICIENT_HISTORY_MESSAGE =
  'Not enough captured activity in the previous 3 days to generate a standup.'
export const NO_PROVIDER_SELECTED_MESSAGE =
  'No Daily provider is selected. Click the gear button above, then choose a provider to turn recap generation back on.'

const PLACEHOLDER_MESSAGES = [
  NOT_GENERATED_MESSAGE,
  TODAY_NOT_GENERATED_MESSAGE,
  INSUFFICIENT_HISTORY_MESSAGE,
  NO_PROVIDER_SELECTED_MESSAGE
]

export interface StandupItem {
  id: string
  text: string
}

export interface StandupGeneration {
  provider: string
  runtime: string
  modelOrTool?: string
  sourceDay?: string
  generatedAt?: string
}

export interface DailyStandupDraft {
  highlightsTitle: string
  highlights: StandupItem[]
  tasksTitle: string
  tasks: StandupItem[]
  blockersTitle: string
  blockersBody: string
  generation?: StandupGeneration
}

export function uid(): string {
  return crypto.randomUUID()
}

export type DraftKind = 'default' | 'insufficientHistory' | 'noProviderSelected' | 'entry'

export function makeDefaultDraft(): DailyStandupDraft {
  return {
    highlightsTitle: "Yesterday's highlights",
    highlights: [{ id: uid(), text: NOT_GENERATED_MESSAGE }],
    tasksTitle: "Today's tasks",
    tasks: [{ id: uid(), text: NOT_GENERATED_MESSAGE }],
    blockersTitle: 'Blockers',
    blockersBody: NOT_GENERATED_MESSAGE
  }
}

export function makeInsufficientHistoryDraft(): DailyStandupDraft {
  return {
    highlightsTitle: 'Recent highlights',
    highlights: [{ id: uid(), text: INSUFFICIENT_HISTORY_MESSAGE }],
    tasksTitle: 'Tasks',
    tasks: [{ id: uid(), text: INSUFFICIENT_HISTORY_MESSAGE }],
    blockersTitle: 'Blockers',
    blockersBody: INSUFFICIENT_HISTORY_MESSAGE
  }
}

export function makeNoProviderDraft(): DailyStandupDraft {
  return {
    highlightsTitle: "Yesterday's highlights",
    highlights: [{ id: uid(), text: NO_PROVIDER_SELECTED_MESSAGE }],
    tasksTitle: "Today's tasks",
    tasks: [{ id: uid(), text: NO_PROVIDER_SELECTED_MESSAGE }],
    blockersTitle: 'Blockers',
    blockersBody: NO_PROVIDER_SELECTED_MESSAGE
  }
}

/** Decode a persisted payload; null on failure. */
export function decodeStandupPayload(json: string): DailyStandupDraft | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) return null
    const items = (v: unknown): StandupItem[] => {
      if (!Array.isArray(v)) return []
      return v
        .map((it) => {
          if (typeof it === 'string') return { id: uid(), text: it }
          if (typeof it === 'object' && it !== null) {
            const rec = it as Record<string, unknown>
            return {
              id: typeof rec.id === 'string' ? rec.id : uid(),
              text: typeof rec.text === 'string' ? rec.text : ''
            }
          }
          return null
        })
        .filter((x): x is StandupItem => x !== null)
    }
    const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)
    const gen = raw.generation
    let generation: StandupGeneration | undefined
    if (typeof gen === 'object' && gen !== null) {
      const g = gen as Record<string, unknown>
      generation = {
        provider: str(g.provider, 'legacyDayflow'),
        runtime: str(g.runtime, 'app'),
        modelOrTool: typeof g.modelOrTool === 'string' ? g.modelOrTool : undefined,
        sourceDay: typeof g.sourceDay === 'string' ? g.sourceDay : undefined,
        generatedAt: typeof g.generatedAt === 'string' ? g.generatedAt : undefined
      }
    } else {
      generation = { provider: 'legacyDayflow', runtime: 'app' }
    }
    return {
      highlightsTitle: str(raw.highlightsTitle, "Yesterday's highlights"),
      highlights: items(raw.highlights),
      tasksTitle: str(raw.tasksTitle, "Today's tasks"),
      tasks: items(raw.tasks),
      blockersTitle: str(raw.blockersTitle, 'Blockers'),
      blockersBody: str(raw.blockersBody, ''),
      generation
    }
  } catch {
    return null
  }
}

export function encodeStandupPayload(draft: DailyStandupDraft): string {
  return JSON.stringify(draft)
}

/** Clipboard text (§2.8.5). */
export function standupClipboardText(draft: DailyStandupDraft): string {
  const clean = (items: string[]): string[] =>
    items
      .map((t) => t.trim())
      .filter(
        (t) =>
          t.length > 0 && !PLACEHOLDER_MESSAGES.some((m) => m.toLowerCase() === t.toLowerCase())
      )
  const bullets = (items: string[]): string => {
    const c = clean(items)
    return (c.length > 0 ? c : ['None right now']).map((t) => `- ${t}`).join('\n')
  }
  return [
    draft.highlightsTitle,
    bullets(draft.highlights.map((i) => i.text)),
    '',
    draft.tasksTitle,
    bullets(draft.tasks.map((i) => i.text)),
    '',
    draft.blockersTitle,
    bullets(draft.blockersBody.split('\n'))
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Daily recap providers (§2.9)
// ---------------------------------------------------------------------------

export type DailyRecapProviderId = 'dayflow' | 'claude' | 'chatgpt' | 'gemini' | 'local' | 'none'

export interface DailyProviderMeta {
  id: DailyRecapProviderId
  displayName: string
  pickerSubtitle: string
  selectionLabel: string
}

export const DAILY_PROVIDERS: DailyProviderMeta[] = [
  {
    id: 'dayflow',
    displayName: 'Dayflow backend',
    pickerSubtitle: "Uses Dayflow's hosted service for best performance.",
    selectionLabel: 'Dayflow backend'
  },
  { id: 'claude', displayName: 'Claude', pickerSubtitle: 'Claude Opus', selectionLabel: 'Claude Opus' },
  { id: 'chatgpt', displayName: 'ChatGPT', pickerSubtitle: 'GPT-5.4', selectionLabel: 'GPT-5.4' },
  {
    id: 'gemini',
    displayName: 'Gemini',
    pickerSubtitle: 'Gemini 3.5 Flash',
    selectionLabel: 'Gemini 3.5 Flash'
  },
  {
    id: 'local',
    displayName: 'Local',
    pickerSubtitle: 'Uses Ollama, LM Studio, or another local-compatible server on this PC.',
    selectionLabel: 'Local'
  },
  {
    id: 'none',
    displayName: 'No provider',
    pickerSubtitle: 'Turns off Daily recap generation until you pick another provider.',
    selectionLabel: 'No provider selected (Daily off)'
  }
]

export const DAILY_PROVIDER_SETTING_KEY = 'dailyRecapProvider_v1'
export const DAILY_UNLOCKED_SETTING_KEY = 'isDailyUnlocked'

export function providerMeta(id: DailyRecapProviderId): DailyProviderMeta {
  return DAILY_PROVIDERS.find((p) => p.id === id) ?? DAILY_PROVIDERS[DAILY_PROVIDERS.length - 1]
}

export function providerCanGenerate(id: DailyRecapProviderId): boolean {
  return id !== 'none'
}

export interface ProviderAvailability {
  isAvailable: boolean
  detail: string
}

export type ProviderAvailabilityMap = Partial<Record<DailyRecapProviderId, ProviderAvailability>>

export function providerAvailability(
  id: DailyRecapProviderId,
  map: ProviderAvailabilityMap | null
): ProviderAvailability {
  const entry = map?.[id]
  if (entry) return entry
  return { isAvailable: true, detail: providerMeta(id).pickerSubtitle }
}

// ---------------------------------------------------------------------------
// Daily recap prompt + lenient response parsing (providers.md §11.3)
// ---------------------------------------------------------------------------

const LOCAL_RECAP_PROMPT = `# Daily Recap Prompt

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

function compactTime(hmma: string): string {
  return hmma.replace(/\s+/g, '').toLowerCase()
}

export function makeRecapCardsText(day: string, cards: TimelineCard[]): string {
  if (cards.length === 0) return `No timeline activities were recorded for ${day}.`
  const lines: string[] = [`Timeline activities for ${day}:`, '']
  cards.forEach((card, i) => {
    const title = card.title.trim().length > 0 ? card.title.trim() : card.summary.trim()
    lines.push(
      `${i + 1}. ${compactTime(card.startTimestamp)} - ${compactTime(card.endTimestamp)}: ${title}`
    )
    const summary = card.summary.trim()
    if (summary.length > 0 && summary !== title) lines.push(`   ${summary}`)
  })
  return lines.join('\n')
}

export function makeRecapPrompt(day: string, cards: TimelineCard[]): string {
  const cardsText = makeRecapCardsText(day, cards)
  return `${LOCAL_RECAP_PROMPT}

You only have timeline cards for this day. The log is incomplete by nature, so prefer omission over guessing.

Activity log:

${cardsText}

## Output format

Return ONLY valid JSON, no markdown fences, no preamble. Use this exact schema:

{
  "done": ["first bullet", "second bullet", "..."],
  "next": "one sentence or null"
}

Return exactly one JSON object and nothing before or after it.`
}

/** Extract the first balanced `{...}` (string/escape aware). */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export interface RecapResult {
  done: string[]
  next: string | null
}

/** Lenient parse of the `{"done": [...], "next": ...}` response. Null → invalid. */
export function parseRecapResponse(raw: string): RecapResult | null {
  let text = raw.trim()
  const marker = '---END_THINKING---'
  const mi = text.indexOf(marker)
  if (mi >= 0) text = text.slice(mi + marker.length).trim()
  text = text
    .replace(/^```[a-zA-Z]*[ \t]*\r?\n/, '')
    .replace(/\r?\n```[ \t]*$/, '')
    .trim()
  const candidate = extractBalancedObject(text) ?? text
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const rec = parsed as Record<string, unknown>
  if (!('done' in rec) && !('next' in rec)) return null

  const done: string[] = []
  const pushDone = (v: unknown): void => {
    if (v === null || v === undefined) return
    const t = String(v).trim()
    if (t.length === 0 || t.toLowerCase() === 'null') return
    if (!done.includes(t)) done.push(t)
  }
  if (Array.isArray(rec.done)) rec.done.forEach(pushDone)
  else if (rec.done !== undefined) pushDone(rec.done)

  let next: string | null = null
  const usable = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const t = String(v).trim()
    if (t.length === 0 || t.toLowerCase() === 'null') return null
    return t
  }
  if (Array.isArray(rec.next)) {
    for (const v of rec.next) {
      const t = usable(v)
      if (t) {
        next = t
        break
      }
    }
  } else {
    next = usable(rec.next)
  }
  return { done: done.slice(0, 5), next }
}

// ---------------------------------------------------------------------------
// Day goal plan defaults & day-summary metrics (§4.1, §4.4)
// ---------------------------------------------------------------------------

export const DEFAULT_FOCUS_TARGET_MINUTES = 270
export const DEFAULT_DISTRACTION_LIMIT_MINUTES = 120

function snapshotOf(c: TimelineCategory): DayGoalCategorySnapshot {
  return { categoryID: c.id, name: c.name, colorHex: c.colorHex, sortOrder: c.order }
}

export function defaultGoalPlan(day: string, categories: TimelineCategory[]): DayGoalPlan {
  const now = Math.floor(Date.now() / 1000)
  const focus = categories.filter(
    (c) => !c.isSystem && !c.isIdle && !isDistractionKey(categoryKey(c.name))
  )
  const distraction = categories.filter((c) => isDistractionKey(categoryKey(c.name)))
  return {
    day,
    focusTargetMinutes: DEFAULT_FOCUS_TARGET_MINUTES,
    distractionLimitMinutes: DEFAULT_DISTRACTION_LIMIT_MINUTES,
    focusCategories: focus.map(snapshotOf),
    distractionCategories: distraction.map(snapshotOf),
    isSkipped: false,
    createdAt: now,
    updatedAt: now
  }
}

function resolveSnapshot(
  s: DayGoalCategorySnapshot,
  categories: TimelineCategory[]
): DayGoalCategorySnapshot {
  const byId = categories.find((c) => c.id === s.categoryID)
  const byName =
    byId ?? categories.find((c) => categoryKey(c.name) === categoryKey(s.name)) ?? null
  if (!byName) return s
  return snapshotOf(byName)
}

/** Reuse the most recent saved plan for a new day (§4.1 carriedForward). */
export function carriedForwardPlan(
  base: DayGoalPlan,
  day: string,
  categories: TimelineCategory[]
): DayGoalPlan {
  const sameDay = base.day === day
  return {
    day,
    focusTargetMinutes: base.focusTargetMinutes,
    distractionLimitMinutes: base.distractionLimitMinutes,
    focusCategories: base.focusCategories.map((s) => resolveSnapshot(s, categories)),
    distractionCategories: base.distractionCategories.map((s) => resolveSnapshot(s, categories)),
    isSkipped: sameDay ? base.isSkipped : false,
    createdAt: sameDay ? base.createdAt : 0,
    updatedAt: sameDay ? base.updatedAt : 0
  }
}

export interface CategoryDuration {
  key: string
  name: string
  colorHex: string
  minutes: number
}

export interface DaySummaryMetrics {
  categoryDurations: CategoryDuration[]
  totalCaptured: number
  totalFocus: number
  totalDistracted: number
  distractedRatio: number
}

interface SummaryInterval {
  start: number
  end: number
  key: string
}

/** Right-rail normalization (§4.4): 4 AM → minute 0, overlap-removed, system excluded. */
function summaryIntervals(
  cards: TimelineCard[],
  categories: TimelineCategory[]
): SummaryInterval[] {
  const systemKeys = new Set(
    categories.filter((c) => c.isSystem).map((c) => categoryKey(c.name))
  )
  systemKeys.add('system')
  const raw = cards
    .map((card) => {
      const s0 = parseTimeHMMA(card.startTimestamp)
      const e0 = parseTimeHMMA(card.endTimestamp)
      if (s0 === null || e0 === null) return null
      let s = s0 >= 240 ? s0 - 240 : s0 + 1200
      let e = e0 >= 240 ? e0 - 240 : e0 + 1200
      if (e < s) e += 1440
      s = Math.min(Math.max(s, 0), 1440)
      e = Math.min(Math.max(e, 0), 1440)
      if (e <= s) return null
      return { start: s, end: e, key: categoryKey(card.category), recordId: card.recordId ?? 0 }
    })
    .filter((x): x is SummaryInterval & { recordId: number } => x !== null)
    .sort(
      (a, b) =>
        a.start - b.start || b.end - b.start - (a.end - a.start) || a.recordId - b.recordId
    )
  const out: SummaryInterval[] = []
  let coveredUntil = 0
  for (const iv of raw) {
    const s = Math.max(iv.start, coveredUntil)
    if (s >= iv.end) continue
    coveredUntil = Math.max(coveredUntil, iv.end)
    if (systemKeys.has(iv.key)) continue
    out.push({ start: s, end: iv.end, key: iv.key })
  }
  return out
}

function planKeys(
  snapshots: DayGoalCategorySnapshot[],
  categories: TimelineCategory[]
): Set<string> {
  const keys = new Set<string>()
  for (const s of snapshots) {
    const cat = categories.find((c) => c.id === s.categoryID)
    keys.add(categoryKey(cat ? cat.name : s.name))
  }
  return keys
}

export function computeDaySummary(
  cards: TimelineCard[],
  categories: TimelineCategory[],
  plan: DayGoalPlan | null
): DaySummaryMetrics {
  const intervals = summaryIntervals(cards, categories)
  const perKey = new Map<string, number>()
  for (const iv of intervals) {
    perKey.set(iv.key, (perKey.get(iv.key) ?? 0) + (iv.end - iv.start))
  }
  const catByKey = new Map(categories.map((c) => [categoryKey(c.name), c]))
  const categoryDurations: CategoryDuration[] = Array.from(perKey.entries())
    .map(([key, minutes]) => {
      const cat = catByKey.get(key)
      return {
        key,
        name: cat ? cat.name : key === 'uncategorized' ? 'Uncategorized' : key,
        colorHex: cat ? cat.colorHex : '#E5E7EB',
        minutes
      }
    })
    .sort((a, b) => {
      if (b.minutes !== a.minutes) return b.minutes - a.minutes
      const oa = catByKey.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER
      const ob = catByKey.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER
      if (oa !== ob) return oa - ob
      return a.name.localeCompare(b.name)
    })
  const totalCaptured = intervals.reduce((acc, iv) => acc + (iv.end - iv.start), 0)
  let totalFocus = 0
  let totalDistracted = 0
  if (plan) {
    const focusKeys = planKeys(plan.focusCategories, categories)
    const distractionKeys = planKeys(plan.distractionCategories, categories)
    for (const iv of intervals) {
      const dur = iv.end - iv.start
      if (focusKeys.has(iv.key)) totalFocus += dur
      if (distractionKeys.has(iv.key)) totalDistracted += dur
    }
  }
  const distractedRatio =
    totalCaptured > 0 ? Math.min(1, Math.max(0, totalDistracted / totalCaptured)) : 0
  return { categoryDurations, totalCaptured, totalFocus, totalDistracted, distractedRatio }
}

/** Per-category minutes for goal-flow reference stats (same normalization). */
export function categoryMinutesForCards(
  cards: TimelineCard[],
  categories: TimelineCategory[]
): Map<string, number> {
  const intervals = summaryIntervals(cards, categories)
  const map = new Map<string, number>()
  for (const iv of intervals) map.set(iv.key, (map.get(iv.key) ?? 0) + (iv.end - iv.start))
  return map
}

/** Sum a per-key minutes map over a snapshot selection. */
export function minutesForSnapshots(
  map: Map<string, number>,
  snapshots: DayGoalCategorySnapshot[],
  categories: TimelineCategory[]
): number {
  const keys = planKeys(snapshots, categories)
  let total = 0
  for (const k of keys) total += map.get(k) ?? 0
  return total
}
