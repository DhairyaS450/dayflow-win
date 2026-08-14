// Weekly dashboard snapshot builders (spec §2.6–§2.11).

import type { TimelineCard, TimelineCategory } from '../../../../shared/types'
import { parseTimeHMMA, dayStart, addDays, MONTHS_SHORT } from '../../lib/time'
import {
  foldKey,
  dashKey,
  djb2Color,
  DONUT_PALETTE,
  cardSpan,
  buildCategoryLookup,
  isSystemOrIdleCard,
  dashCategoryInfo,
  isDistractionCard,
  rawAppSource,
  prettyAppName,
  appAccentColor,
  durationTextDash,
  durationTextSankey,
  weeklyActivityWindow,
  hourLabelsFor,
  type CategoryLookup,
  type FactSpan,
  type ActivityWindow,
  type HourLabel
} from './weeklyData'

// Axis labels use "Thur" — upstream quirk, preserved.
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'] as const
export const DAY_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
] as const

// ---------------------------------------------------------------------------
// Prepared week context (dashboard builders)

export interface WeekFact {
  card: TimelineCard
  dayIndex: number
  span: FactSpan
  catKey: string
  appName: string
  appKey: string
}

export interface WeekContext {
  facts: WeekFact[]
  lookup: CategoryLookup
  days: string[]
}

export function prepareWeek(
  cards: TimelineCard[],
  categories: TimelineCategory[],
  days: string[]
): WeekContext {
  const lookup = buildCategoryLookup(categories)
  const dayIndex = new Map(days.map((d, i) => [d, i] as const))
  const facts: WeekFact[] = []
  for (const card of cards) {
    const di = dayIndex.get(card.day)
    if (di === undefined) continue
    if (isSystemOrIdleCard(card, lookup)) continue
    const span = cardSpan(card)
    if (!span) continue
    const appName = prettyAppName(rawAppSource(card))
    facts.push({
      card,
      dayIndex: di,
      span,
      catKey: dashKey(card.category),
      appName,
      appKey: dashKey(appName)
    })
  }
  facts.sort((a, b) => a.dayIndex - b.dayIndex || a.span.start - b.span.start)
  return { facts, lookup, days }
}

// ---------------------------------------------------------------------------
// §2.6 Weekly distribution (donut)

export interface DonutItem {
  key: string
  name: string
  colorHex: string
  minutes: number
}

export interface DonutSnapshot {
  items: DonutItem[]
  totalMinutes: number
}

export function buildDonut(
  cards: TimelineCard[],
  categories: TimelineCategory[],
  days: string[]
): DonutSnapshot {
  const lookup = buildCategoryLookup(categories)
  const daySet = new Set(days)
  const acc = new Map<
    string,
    { name: string; colorHex: string; order: number; minutes: number }
  >()
  for (const card of cards) {
    if (!daySet.has(card.day)) continue
    const key = foldKey(card.category)
    const cat = lookup.byFoldKey.get(key)
    if (cat && (cat.isSystem || cat.isIdle)) continue
    if (key === 'system' || key === 'idle') continue
    const span = cardSpan(card)
    if (!span) continue
    let entry = acc.get(key)
    if (!entry) {
      const trimmed = card.category.trim()
      const name = cat?.name ?? (trimmed || 'Uncategorized')
      let colorHex = (cat?.colorHex ?? '').replace('#', '')
      if (!colorHex) colorHex = djb2Color(key, DONUT_PALETTE)
      entry = { name, colorHex, order: cat?.order ?? Number.MAX_SAFE_INTEGER, minutes: 0 }
      acc.set(key, entry)
    }
    entry.minutes += span.minutes
  }
  let items = [...acc.entries()]
    .map(([key, e]) => ({ key, name: e.name, colorHex: e.colorHex, order: e.order, minutes: e.minutes }))
    .filter((i) => i.minutes > 0)
  if (items.length === 0) return { items: [], totalMinutes: 0 }
  items.sort(
    (a, b) =>
      b.minutes - a.minutes ||
      a.order - b.order ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
  if (items.length > 5) {
    const top = items.slice(0, 4)
    const restMinutes = items.slice(4).reduce((s, i) => s + i.minutes, 0)
    top.push({
      key: 'other',
      name: 'Other',
      colorHex: 'BFB6AE',
      order: Number.MAX_SAFE_INTEGER,
      minutes: restMinutes
    })
    items = top
  }
  const totalMinutes = items.reduce((s, i) => s + i.minutes, 0)
  return {
    items: items.map(({ key, name, colorHex, minutes }) => ({ key, name, colorHex, minutes })),
    totalMinutes
  }
}

// ---------------------------------------------------------------------------
// §2.7 Context shift and distractions comparison

export interface ContextDayPoint {
  label: string
  shifts: number
  distracted: number
}

export interface ContextSnapshot {
  days: ContextDayPoint[]
  insight: string
}

export function buildContextCharts(ctx: WeekContext): ContextSnapshot {
  const days: ContextDayPoint[] = []
  for (let di = 0; di < 7; di++) {
    const dayFacts = ctx.facts.filter((f) => f.dayIndex === di)
    let shifts = 0
    for (let i = 1; i < dayFacts.length; i++) {
      if (dayFacts[i].catKey !== dayFacts[i - 1].catKey) shifts++
    }
    let distracted = 0
    for (const f of dayFacts) {
      if (f.card.distractions && f.card.distractions.length > 0) {
        for (const d of f.card.distractions) {
          if (parseTimeHMMA(d.startTime) !== null) distracted++
        }
      } else if (isDistractionCard(f.card)) {
        distracted++
      }
    }
    days.push({ label: DAY_LABELS[di], shifts, distracted })
  }
  let bestIdx = 0
  let bestTotal = -1
  for (let i = 0; i < days.length; i++) {
    const t = days[i].shifts + days[i].distracted
    if (t > bestTotal) {
      bestTotal = t
      bestIdx = i
    }
  }
  const insight =
    bestTotal <= 0
      ? 'No context shift or distraction pattern was detected in this week.'
      : `${DAY_FULL[bestIdx]} had the most interruptions, with ${days[bestIdx].shifts} context shifts and ${days[bestIdx].distracted} distractions.`
  return { days, insight }
}

// ---------------------------------------------------------------------------
// §2.8 Your workflow this week

export interface WorkflowCell {
  name: string | null
  colorHex: string | null
  minutes: number
  occupancy: number
}

export interface WorkflowTotal {
  id: string
  name: string
  minutes: number
  text: string
  colorHex: string
}

export interface WorkflowSnapshot {
  window: ActivityWindow
  slotCount: number
  rows: { label: string; cells: WorkflowCell[] }[]
  totals: WorkflowTotal[]
  hourLabels: HourLabel[]
}

interface Bucket {
  id: string
  name: string
  colorHex: string
}

function workflowBucket(f: WeekFact, lookup: CategoryLookup): Bucket {
  const info = dashCategoryInfo(f.card, lookup)
  if (f.catKey.includes('distraction') || info.name.toLowerCase().includes('distraction')) {
    return { id: 'distraction', name: 'Distraction', colorHex: 'FF5950' }
  }
  return { id: f.catKey, name: info.name, colorHex: info.colorHex }
}

export function buildWorkflow(ctx: WeekContext): WorkflowSnapshot {
  const window = weeklyActivityWindow(ctx.facts.map((f) => f.span))
  const slotCount = Math.max(1, Math.round((window.end - window.start) / 15))

  const rows = DAY_LABELS.map((label, di) => {
    const dayFacts = ctx.facts.filter((f) => f.dayIndex === di)
    const slotBuckets: (Map<string, { name: string; colorHex: string; minutes: number }> | null)[] =
      new Array(slotCount).fill(null)
    for (const f of dayFacts) {
      const b = workflowBucket(f, ctx.lookup)
      const s = Math.max(f.span.start, window.start)
      const e = Math.min(f.span.end, window.end)
      if (e <= s) continue
      const first = Math.max(0, Math.floor((s - window.start) / 15))
      const last = Math.min(slotCount - 1, Math.floor((e - window.start - 0.001) / 15))
      for (let i = first; i <= last; i++) {
        const slotStart = window.start + i * 15
        const ov = Math.min(e, slotStart + 15) - Math.max(s, slotStart)
        if (ov <= 0) continue
        let map = slotBuckets[i]
        if (!map) {
          map = new Map()
          slotBuckets[i] = map
        }
        const cur = map.get(b.id)
        if (cur) cur.minutes += ov
        else map.set(b.id, { name: b.name, colorHex: b.colorHex, minutes: ov })
      }
    }
    const cells: WorkflowCell[] = slotBuckets.map((map) => {
      if (!map || map.size === 0) return { name: null, colorHex: null, minutes: 0, occupancy: 0 }
      let total = 0
      let best: { name: string; colorHex: string; minutes: number } | null = null
      for (const e of map.values()) {
        total += e.minutes
        if (
          !best ||
          e.minutes > best.minutes ||
          (e.minutes === best.minutes && e.name.localeCompare(best.name) < 0)
        ) {
          best = e
        }
      }
      return {
        name: best!.name,
        colorHex: best!.colorHex,
        minutes: Math.round(total),
        occupancy: Math.min(1, total / 15)
      }
    })
    return { label, cells }
  })

  const totalsMap = new Map<string, { name: string; colorHex: string; minutes: number }>()
  for (const f of ctx.facts) {
    const b = workflowBucket(f, ctx.lookup)
    const cur = totalsMap.get(b.id)
    if (cur) cur.minutes += f.span.minutes
    else totalsMap.set(b.id, { name: b.name, colorHex: b.colorHex, minutes: f.span.minutes })
  }
  const totals: WorkflowTotal[] = [...totalsMap.entries()]
    .filter(([, t]) => t.minutes > 0)
    .sort((a, b) => b[1].minutes - a[1].minutes || a[1].name.localeCompare(b[1].name))
    .slice(0, 7)
    .map(([id, t]) => ({
      id,
      name: t.name,
      minutes: t.minutes,
      text: durationTextDash(t.minutes),
      colorHex: t.colorHex
    }))

  return { window, slotCount, rows, totals, hourLabels: hourLabelsFor(window) }
}

// ---------------------------------------------------------------------------
// §2.9 Focus and distraction heat map

export interface HeatmapSnapshot {
  window: ActivityWindow
  endMinute: number
  bucketCount: number
  rows: { label: string; values: number[] }[]
  hourLabels: HourLabel[]
}

const HEATMAP_ROW_OFFSETS = [6, 0, 1, 2, 3, 4, 5] as const
const HEATMAP_ROW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'] as const

export function buildHeatmap(ctx: WeekContext): HeatmapSnapshot {
  const window = weeklyActivityWindow(ctx.facts.map((f) => f.span))
  const bucketCount = Math.max(1, Math.ceil((window.end - window.start) / 5))
  const endMinute = window.start + bucketCount * 5

  const bucketFor = (minute: number): number =>
    Math.max(0, Math.min(bucketCount - 1, Math.floor((minute - window.start) / 5)))

  const dayValues = (di: number): number[] => {
    const facts = ctx.facts.filter((f) => f.dayIndex === di)
    const focus = new Array<number>(bucketCount).fill(0)
    const dist = new Array<number>(bucketCount).fill(0)
    const switchPressure = new Array<number>(bucketCount).fill(0)

    const addInterval = (arr: number[], s: number, e: number, sign = 1): void => {
      const cs = Math.max(s, window.start)
      const ce = Math.min(e, endMinute)
      if (ce <= cs) return
      const first = Math.max(0, Math.floor((cs - window.start) / 5))
      const last = Math.min(bucketCount - 1, Math.floor((ce - window.start - 0.001) / 5))
      for (let i = first; i <= last; i++) {
        const bs = window.start + i * 5
        const ov = Math.min(ce, bs + 5) - Math.max(cs, bs)
        if (ov > 0) arr[i] += sign * ov
      }
    }

    let prevSig: string | null = null
    let prevEnd: number | null = null
    for (const f of facts) {
      const sig = `${f.catKey}|${f.appKey}`
      if (prevSig !== null && prevEnd !== null) {
        const gap = f.span.start - prevEnd
        if (gap <= 20 && sig !== prevSig) switchPressure[bucketFor(f.span.start)] += 1
      }
      prevSig = sig
      prevEnd = f.span.end

      const catSub = `${f.card.category} ${f.card.subcategory}`.toLowerCase()
      const hasEmbedded = !!(f.card.distractions && f.card.distractions.length > 0)
      const fullDistraction =
        catSub.includes('distraction') ||
        catSub.includes('distracted') ||
        (isDistractionCard(f.card) && !hasEmbedded)

      if (fullDistraction) {
        addInterval(dist, f.span.start, f.span.end)
        continue
      }
      addInterval(focus, f.span.start, f.span.end)
      for (const d of f.card.distractions ?? []) {
        const ds = parseTimeHMMA(d.startTime)
        const de = parseTimeHMMA(d.endTime)
        if (ds === null || de === null) continue
        let best: [number, number] | null = null
        let bestScore = Infinity
        for (const shift of [0, 1440]) {
          const cs = ds + shift
          let ce = de + shift
          if (ce <= cs) ce += 1440
          const score = Math.abs(cs - f.span.start) + 0.1 * Math.abs(f.span.end - ce)
          if (score < bestScore) {
            bestScore = score
            best = [cs, ce]
          }
        }
        if (!best) continue
        const s2 = Math.max(best[0], f.span.start - 2)
        const e2 = Math.min(best[1], f.span.end + 2)
        if (e2 <= s2) continue
        addInterval(dist, s2, e2)
        addInterval(focus, s2, e2, -1)
      }
    }

    // Scores
    const cleanFocus = focus.map((f0, i) => f0 >= 3 && dist[i] < 1)
    const runLen = new Array<number>(bucketCount).fill(0)
    let i = 0
    while (i < bucketCount) {
      if (!cleanFocus[i]) {
        i++
        continue
      }
      let j = i
      while (j < bucketCount && cleanFocus[j]) j++
      for (let k = i; k < j; k++) runLen[k] = j - i
      i = j
    }
    const raw = new Array<number>(bucketCount).fill(0)
    for (let b = 0; b < bucketCount; b++) {
      const focusRatio = Math.max(0, Math.min(1, focus[b] / 5))
      const distRatio = Math.max(0, Math.min(1, dist[b] / 5))
      const sustainedBoost = Math.min(1, runLen[b] / 6)
      const focusStrength = focusRatio * (0.35 + 0.65 * sustainedBoost)
      const distStrength = Math.min(1, distRatio * 1.25)
      const switchStrength = Math.min(1, switchPressure[b] / 2) * 0.22
      raw[b] = Math.max(-1, Math.min(1, distStrength + switchStrength - focusStrength))
    }
    // Smoothing (focused cells only)
    const values = raw.slice()
    for (let b = 0; b < bucketCount; b++) {
      if (raw[b] >= 0) continue
      let count = 0
      let sum = 0
      for (let n = b - 1; n <= b + 1; n++) {
        if (n < 0 || n >= bucketCount) continue
        if (raw[n] < 0) {
          count++
          sum += raw[n]
        }
      }
      if (count >= 2) {
        const avg = sum / count
        values[b] = Math.max(-1, Math.min(1, 0.55 * raw[b] + 0.45 * avg))
      }
    }
    return values
  }

  const rows = HEATMAP_ROW_OFFSETS.map((di, r) => ({
    label: HEATMAP_ROW_LABELS[r],
    values: dayValues(di)
  }))

  return { window, endMinute, bucketCount, rows, hourLabels: hourLabelsFor(window) }
}

// ---------------------------------------------------------------------------
// §2.10 Most used per category (treemap)

export interface TreemapApp {
  key: string
  name: string
  minutes: number
  changeText: string | null
  changeColor: string | null
}

export interface TreemapCategory {
  key: string
  name: string
  accent: string
  minutes: number
  apps: TreemapApp[]
}

export interface TreemapSnapshot {
  categories: TreemapCategory[]
}

export function buildTreemap(ctx: WeekContext, prevCtx: WeekContext): TreemapSnapshot {
  const catMap = new Map<
    string,
    { name: string; colorHex: string; minutes: number; apps: Map<string, { name: string; minutes: number }> }
  >()
  for (const f of ctx.facts) {
    let c = catMap.get(f.catKey)
    if (!c) {
      const info = dashCategoryInfo(f.card, ctx.lookup)
      c = { name: info.name, colorHex: info.colorHex, minutes: 0, apps: new Map() }
      catMap.set(f.catKey, c)
    }
    c.minutes += f.span.minutes
    let a = c.apps.get(f.appKey)
    if (!a) {
      a = { name: f.appName, minutes: 0 }
      c.apps.set(f.appKey, a)
    }
    a.minutes += f.span.minutes
  }
  const prev = new Map<string, number>()
  for (const f of prevCtx.facts) {
    const k = `${f.catKey}|${f.appKey}`
    prev.set(k, (prev.get(k) ?? 0) + f.span.minutes)
  }
  const categories: TreemapCategory[] = [...catMap.entries()]
    .sort(
      (a, b) =>
        b[1].minutes - a[1].minutes ||
        a[1].name.toLowerCase().localeCompare(b[1].name.toLowerCase())
    )
    .slice(0, 5)
    .map(([key, c]) => ({
      key,
      name: c.name,
      accent: c.colorHex,
      minutes: c.minutes,
      apps: [...c.apps.entries()]
        .sort(
          (a, b) =>
            b[1].minutes - a[1].minutes ||
            a[1].name.toLowerCase().localeCompare(b[1].name.toLowerCase())
        )
        .slice(0, 8)
        .map(([ak, a]) => {
          const p = prev.get(`${key}|${ak}`) ?? 0
          let changeText: string | null = null
          let changeColor: string | null = null
          if (p > 0) {
            const delta = a.minutes - p
            if (delta > 0) {
              changeText = `+ ${delta}m`
              changeColor = '3AA34C'
            } else if (delta < 0) {
              changeText = `- ${-delta}m`
              changeColor = 'DE2121'
            } else {
              changeText = '0m'
              changeColor = '8D8C8A'
            }
          }
          return { key: ak, name: a.name, minutes: a.minutes, changeText, changeColor }
        })
    }))
  return { categories }
}

// ---------------------------------------------------------------------------
// §2.11 Weekly breakdown (sankey)

export interface SankeyBucket {
  key: string
  name: string
  colorHex: string
  minutes: number
}

export interface SankeyLinkData {
  from: string
  to: string
  minutes: number
}

export interface SankeySnapshot {
  sourceName: string
  totalMinutes: number
  categories: SankeyBucket[]
  apps: SankeyBucket[]
  links: SankeyLinkData[]
}

function collapseBuckets(
  buckets: SankeyBucket[],
  maxVisible: number,
  otherColor: string
): SankeyBucket[] {
  buckets.sort(
    (a, b) =>
      b.minutes - a.minutes || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
  if (buckets.length <= maxVisible) return buckets
  const top = buckets.slice(0, maxVisible - 1)
  let otherMinutes = buckets.slice(maxVisible - 1).reduce((s, b) => s + b.minutes, 0)
  const realOtherIdx = top.findIndex((b) => b.key === 'other')
  if (realOtherIdx >= 0) {
    otherMinutes += top[realOtherIdx].minutes
    top.splice(realOtherIdx, 1)
  }
  top.push({ key: 'other', name: 'Other', colorHex: otherColor, minutes: otherMinutes })
  return top
}

export function buildSankey(ctx: WeekContext, weekStartDay: string): SankeySnapshot {
  const start = dayStart(weekStartDay)
  const end = dayStart(addDays(weekStartDay, 6))
  const sourceName =
    start.getMonth() === end.getMonth()
      ? `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}-${end.getDate()}`
      : `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}-${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`

  if (ctx.facts.length === 0) {
    return { sourceName, totalMinutes: 0, categories: [], apps: [], links: [] }
  }

  const catAcc = new Map<string, SankeyBucket>()
  const appAcc = new Map<string, SankeyBucket>()
  for (const f of ctx.facts) {
    let c = catAcc.get(f.catKey)
    if (!c) {
      const info = dashCategoryInfo(f.card, ctx.lookup)
      c = { key: f.catKey, name: info.name, colorHex: info.colorHex, minutes: 0 }
      catAcc.set(f.catKey, c)
    }
    c.minutes += f.span.minutes
    let a = appAcc.get(f.appKey)
    if (!a) {
      a = { key: f.appKey, name: f.appName, colorHex: appAccentColor(f.appName), minutes: 0 }
      appAcc.set(f.appKey, a)
    }
    a.minutes += f.span.minutes
  }

  const categories = collapseBuckets([...catAcc.values()], 6, 'BFB6AE')
  const apps = collapseBuckets([...appAcc.values()], 10, 'D9D9D9')
  const visibleCats = new Set(categories.map((c) => c.key))
  const visibleApps = new Set(apps.map((a) => a.key))

  const linkAcc = new Map<string, SankeyLinkData>()
  for (const f of ctx.facts) {
    const from = visibleCats.has(f.catKey) ? f.catKey : 'other'
    const to = visibleApps.has(f.appKey) ? f.appKey : 'other'
    const id = `${from}-${to}`
    let l = linkAcc.get(id)
    if (!l) {
      l = { from, to, minutes: 0 }
      linkAcc.set(id, l)
    }
    l.minutes += f.span.minutes
  }
  const links = [...linkAcc.values()]
    .filter((l) => l.minutes > 0)
    .sort((a, b) => a.from.localeCompare(b.from) || b.minutes - a.minutes)

  const totalMinutes = categories.reduce((s, c) => s + c.minutes, 0)
  return { sourceName, totalMinutes, categories, apps, links }
}

export function sankeyMetric(minutes: number): string {
  return durationTextSankey(minutes)
}

export function sankeyPercent(minutes: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.max(1, Math.round((minutes / total) * 100))}%`
}
