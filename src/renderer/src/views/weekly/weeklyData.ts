// Weekly dashboard shared primitives — port of the macOS Weekly builders (MIT).
// See docs/specs/ui-weekly-chat.md §0 for the source-of-truth rules.

import type { TimelineCard, TimelineCategory } from '../../../../shared/types'
import { parseTimeHMMA } from '../../lib/time'

// ---------------------------------------------------------------------------
// §0.3 Category key normalization

/** Donut/Overview normalization: trim → fold diacritics → lowercase (spaces kept). */
export function foldKey(name: string): string {
  return name
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Dashboard normalization: fold, non-alphanumerics → '-', split and join with '_'. */
export function dashKey(name: string): string {
  return foldKey(name)
    .replace(/[^a-z0-9]/g, '-')
    .split('-')
    .filter(Boolean)
    .join('_')
}

// ---------------------------------------------------------------------------
// §0.4 djb2 fallback color hash (64-bit wrapping like Swift Int)

const MASK64 = (1n << 64n) - 1n
const SIGN64 = 1n << 63n

export const DONUT_PALETTE: readonly string[] = ['93BCFF', 'DE9DFC', '6CDACD', 'FFA189', 'BFB6AE']
export const DASH_PALETTE: readonly string[] = [
  '93BCFF',
  'DE9DFC',
  '6CDACD',
  'FFA189',
  'FFC6B7',
  'BFB6AE'
]

export function djb2Color(key: string, palette: readonly string[]): string {
  let hash = 5381n
  const bytes = new TextEncoder().encode(key)
  for (const b of bytes) {
    hash = ((hash << 5n) + hash + BigInt(b)) & MASK64
  }
  let signed = hash >= SIGN64 ? hash - (MASK64 + 1n) : hash
  if (signed < 0n) signed = -signed
  return palette[Number(signed % BigInt(palette.length))]
}

// ---------------------------------------------------------------------------
// §0.2 Timeline card time parsing (4AM → 28:00 window)

export interface FactSpan {
  /** minutes since midnight, values in [240, 2880) */
  start: number
  end: number
  minutes: number
}

export function cardSpan(card: TimelineCard): FactSpan | null {
  const s = parseTimeHMMA(card.startTimestamp)
  const e = parseTimeHMMA(card.endTimestamp)
  if (s === null || e === null) return null
  const adjStart = s < 240 ? s + 1440 : s
  let adjEnd = e < 240 ? e + 1440 : e
  if (adjEnd <= adjStart) adjEnd += 1440
  const minutes = Math.max(Math.round(adjEnd - adjStart), 0)
  if (minutes <= 0) return null
  return { start: adjStart, end: adjEnd, minutes }
}

// ---------------------------------------------------------------------------
// Category lookups (§0.3 firstCategoryLookup)

export interface CategoryLookup {
  byFoldKey: Map<string, TimelineCategory>
  byDashKey: Map<string, TimelineCategory>
}

export function buildCategoryLookup(categories: TimelineCategory[]): CategoryLookup {
  const sorted = [...categories].sort((a, b) => a.order - b.order)
  const byFoldKey = new Map<string, TimelineCategory>()
  const byDashKey = new Map<string, TimelineCategory>()
  for (const c of sorted) {
    const fk = foldKey(c.name)
    if (!byFoldKey.has(fk)) byFoldKey.set(fk, c)
    const dk = dashKey(c.name)
    if (!byDashKey.has(dk)) byDashKey.set(dk, c)
  }
  return { byFoldKey, byDashKey }
}

// §0.5 System/Idle filtering
export function isSystemOrIdleCard(card: TimelineCard, lookup: CategoryLookup): boolean {
  const key = dashKey(card.category)
  const cat = lookup.byDashKey.get(key)
  if (cat && (cat.isSystem || cat.isIdle)) return true
  return key === 'system' || key === 'idle'
}

export interface CategoryInfo {
  key: string
  name: string
  colorHex: string
  order: number
}

/** Dashboard-builder category display info (name, uppercased color, order). */
export function dashCategoryInfo(card: TimelineCard, lookup: CategoryLookup): CategoryInfo {
  const key = dashKey(card.category)
  const cat = lookup.byDashKey.get(key)
  const trimmed = card.category.trim()
  const name = cat?.name ?? (trimmed || 'Uncategorized')
  let colorHex = (cat?.colorHex ?? '').replace('#', '').toUpperCase()
  if (!colorHex) colorHex = cat ? 'BFB6AE' : djb2Color(key, DASH_PALETTE)
  return { key, name, colorHex, order: cat?.order ?? Number.MAX_SAFE_INTEGER }
}

// ---------------------------------------------------------------------------
// §0.6 Distraction detection

export function isDistractionCard(card: TimelineCard): boolean {
  if (card.distractions && card.distractions.length > 0) return true
  const text =
    `${card.category} ${card.subcategory} ${card.title} ${card.summary}`.toLowerCase()
  return text.includes('distraction') || text.includes('distracted')
}

// ---------------------------------------------------------------------------
// §0.7 App identity

const KNOWN_APPS = [
  'ChatGPT',
  'Claude',
  'Codex',
  'Cursor',
  'Xcode',
  'Dayflow',
  'Figma',
  'Slack',
  'Zoom',
  'YouTube',
  'Reddit',
  'Substack',
  'Notion',
  'Linear',
  'GitHub',
  'Safari',
  'Chrome',
  'Calendar',
  'Mail',
  'Messages'
]

const PRETTY_RULES: ReadonlyArray<readonly [string, string]> = [
  ['chatgpt', 'ChatGPT'],
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
  ['xcode', 'Xcode'],
  ['dayflow', 'Dayflow'],
  ['figma', 'Figma'],
  ['slack', 'Slack'],
  ['zoom', 'Zoom'],
  ['meet.google', 'Meet'],
  ['google meet', 'Meet'],
  ['youtube', 'YouTube'],
  ['reddit', 'Reddit'],
  ['twitter', 'X'],
  ['x.com', 'X'],
  ['substack', 'Substack'],
  ['notion', 'Notion'],
  ['linear', 'Linear'],
  ['github', 'GitHub'],
  ['safari', 'Safari'],
  ['chrome', 'Chrome'],
  ['calendar', 'Calendar'],
  ['mail', 'Mail'],
  ['messages', 'Messages'],
  ['maps', 'Maps'],
  ['clickup', 'ClickUp'],
  ['runway', 'Runway'],
  ['flora', 'Flora']
]

// Ordered list — substring matching, earlier entries win (faithful to upstream).
const APP_ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['chatgpt', '333333'],
  ['claude', 'D97757'],
  ['codex', '111111'],
  ['cursor', '111111'],
  ['xcode', '4085FD'],
  ['dayflow', 'FF7A2F'],
  ['figma', 'FF7262'],
  ['slack', '36C5F0'],
  ['zoom', '4085FD'],
  ['meet', '34A853'],
  ['youtube', 'FF0000'],
  ['reddit', 'FF613C'],
  ['x', '111111'],
  ['substack', 'FF6E3E'],
  ['notion', '111111'],
  ['linear', '5E6AD2'],
  ['github', '24292F'],
  ['safari', '2E8BFF'],
  ['chrome', '4285F4'],
  ['calendar', 'A29993'],
  ['mail', '4F8EF7'],
  ['messages', '38D06E'],
  ['other', 'D9D9D9']
]

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function rawAppSource(card: TimelineCard): string {
  const primary = card.appSites?.primary?.trim()
  if (primary) return primary
  const secondary = card.appSites?.secondary?.trim()
  if (secondary) return secondary
  const text = `${card.title} ${card.summary}`.toLowerCase()
  for (const app of KNOWN_APPS) {
    if (text.includes(app.toLowerCase())) return app
  }
  return 'Other'
}

export function prettyAppName(raw: string): string {
  const lower = raw.toLowerCase()
  for (const [needle, name] of PRETTY_RULES) {
    if (lower.includes(needle)) return name
  }
  let cleaned = raw.split(/[,;|\n]/)[0]
  cleaned = cleaned
    .replace(/^https:\/\//i, '')
    .replace(/^http:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^com\.apple\./i, '')
    .trim()
  if (cleaned.includes('.') && !cleaned.includes(' ')) {
    cleaned = titleCase(cleaned.split('.')[0])
  } else {
    cleaned = titleCase(cleaned)
  }
  return cleaned || 'Other'
}

export function appAccentColor(prettyName: string): string {
  const lower = prettyName.toLowerCase()
  for (const [needle, hex] of APP_ACCENTS) {
    if (lower.includes(needle)) return hex
  }
  return djb2Color(lower, DASH_PALETTE)
}

// ---------------------------------------------------------------------------
// §0.8 Duration text helpers

/** Dashboard builder: "Xh Ym" / "Xh" / "Zm". */
export function durationTextDash(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min) % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** Overview/treemap variant: "Xhr Ym" / "Xhr" / "Zm". */
export function durationTextHr(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min) % 60
  if (h > 0 && m > 0) return `${h}hr ${m}m`
  if (h > 0) return `${h}hr`
  return `${m}m`
}

/** Sankey variant: "Xhr Ymin" if hours > 0 else "Ymin". */
export function durationTextSankey(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min) % 60
  return h > 0 ? `${h}hr ${m}min` : `${m}min`
}

// ---------------------------------------------------------------------------
// §2.8 weeklyActivityWindow

export interface ActivityWindow {
  start: number
  end: number
}

export function weeklyActivityWindow(spans: FactSpan[]): ActivityWindow {
  if (spans.length === 0) return { start: 540, end: 1320 }
  let earliest = Infinity
  let latest = -Infinity
  for (const s of spans) {
    earliest = Math.min(earliest, s.start)
    latest = Math.max(latest, s.end)
  }
  let start = Math.max(240, earliest - 30)
  let end = Math.min(1680, latest + 30)
  start = Math.floor(start / 15) * 15
  end = Math.ceil(end / 15) * 15
  if (end === 1440) end = 1680
  if (end <= start) end = Math.min(1680, start + 15)
  return { start, end }
}

/** "9am", "12pm", "1:30pm" style label for a minute-of-day value. */
export function minuteLabel(min: number): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const ampm = h24 < 12 ? 'am' : 'pm'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return m > 0 ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`
}

export interface HourLabel {
  minute: number
  text: string
}

export function hourLabelsFor(window: ActivityWindow): HourLabel[] {
  const first = Math.ceil(window.start / 60) * 60
  const last = Math.floor(window.end / 60) * 60
  const out: HourLabel[] = []
  for (let m = first; m <= last; m += 60) out.push({ minute: m, text: minuteLabel(m) })
  return out
}

// ---------------------------------------------------------------------------
// Color helpers

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return `rgba(191, 182, 174, ${alpha})`
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function lerpHex(fromHex: string, toHex: string, t: number): string {
  const f = fromHex.replace('#', '')
  const to = toHex.replace('#', '')
  const c = (s: string, i: number): number => parseInt(s.slice(i, i + 2), 16)
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t)
  const to2 = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${to2(mix(c(f, 0), c(to, 0)))}${to2(mix(c(f, 2), c(to, 2)))}${to2(mix(c(f, 4), c(to, 4)))}`
}
