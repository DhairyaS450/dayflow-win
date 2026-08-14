// Timeline layout math shared by Day and Week views.

import type { TimelineCard } from '../../../../shared/types'
import { minutesSince4AM } from '../../lib/time'

export const DAY_PPM = 2.8 // 168 px/hour
export const WEEK_PPM = 1.85 // 111 px/hour
export const DAY_CONTENT_HEIGHT = 24 * 168
export const WEEK_CONTENT_HEIGHT = 24 * 111

export interface PositionedCard {
  card: TimelineCard
  startMin: number // minutes since 4 AM (display, post overlap-trim)
  endMin: number
  rawStartMin: number
  rawEndMin: number
}

export function positionCards(cards: TimelineCard[]): PositionedCard[] {
  let positioned: PositionedCard[] = []
  for (const card of cards) {
    const s = minutesSince4AM(card.startTimestamp)
    let e = minutesSince4AM(card.endTimestamp)
    if (s === null || e === null) continue
    if (e < s) e += 24 * 60
    positioned.push({ card, startMin: s, endMin: e, rawStartMin: s, rawEndMin: e })
  }
  positioned.sort((a, b) => a.startMin - b.startMin)

  // Overlap resolution: trim the LARGER of any overlapping pair (display only).
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i]
        const b = positioned[j]
        if (a.endMin <= b.startMin || b.endMin <= a.startMin) continue
        const aDur = a.endMin - a.startMin
        const bDur = b.endMin - b.startMin
        const larger = aDur >= bDur ? a : b
        const smaller = aDur >= bDur ? b : a
        if (smaller.startMin >= larger.startMin && smaller.endMin <= larger.endMin) {
          // Fully contained: larger keeps its longer side.
          const topSide = smaller.startMin - larger.startMin
          const bottomSide = larger.endMin - smaller.endMin
          if (topSide >= bottomSide) larger.endMin = smaller.startMin
          else larger.startMin = smaller.endMin
        } else if (larger.startMin < smaller.startMin) {
          larger.endMin = smaller.startMin
        } else {
          larger.startMin = smaller.endMin
        }
        changed = true
      }
    }
    positioned = positioned.filter((p) => p.endMin - p.startMin > 0)
    if (!changed) break
  }
  return positioned
}

export function cardY(startMin: number, ppm: number): number {
  return startMin * ppm + 1
}

export function cardHeight(startMin: number, endMin: number, ppm: number, minHeight: number): number {
  return Math.max(minHeight, (endMin - startMin) * ppm - 2)
}

export const HOUR_LABELS: string[] = Array.from({ length: 24 }, (_, i) => {
  const hour24 = (4 + i) % 24
  let h = hour24 % 12
  if (h === 0) h = 12
  return `${h}:00 ${hour24 >= 12 ? 'PM' : 'AM'}`
})

export const FAILED_TITLE = 'Processing failed'
