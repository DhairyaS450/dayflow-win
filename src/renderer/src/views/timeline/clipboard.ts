// Timeline clipboard formats — parity with upstream TimelineClipboardFormatter.

import type { TimelineCard } from '../../../../shared/types'
import { fullDayLabel, weekLabel, weekDays } from '../../lib/time'

function entryBlock(index: number, card: TimelineCard): string {
  const range =
    card.startTimestamp && card.endTimestamp
      ? `${card.startTimestamp} – ${card.endTimestamp}`
      : card.startTimestamp || card.endTimestamp
  const lines: string[] = [`${index}. ${range} — ${card.title}`]
  lines.push(`   ${card.category}`)
  const blocks: string[] = [lines.join('\n')]
  if (card.summary) {
    const summaryLines = card.summary.split('\n')
    if (summaryLines.length === 1) blocks.push(`   Summary: ${card.summary}`)
    else blocks.push(`   Summary:\n${summaryLines.map((l) => `      ${l}`).join('\n')}`)
  }
  if (card.detailedSummary && card.detailedSummary !== card.summary) {
    const detailLines = card.detailedSummary.split('\n')
    if (detailLines.length === 1) blocks.push(`   Details: ${card.detailedSummary}`)
    else blocks.push(`   Details:\n${detailLines.map((l) => `      ${l}`).join('\n')}`)
  }
  return blocks.join('\n\n')
}

export function makeDayClipboardText(day: string, cards: TimelineCard[]): string {
  const header = `Dayflow timeline · ${fullDayLabel(day)}`
  if (cards.length === 0) {
    return `${header}\n\nNo timeline activities were recorded for this day.`
  }
  const entries = cards.map((c, i) => entryBlock(i + 1, c))
  return [header, ...entries].join('\n\n')
}

export function makeWeekClipboardText(
  weekStartDay: string,
  cardsByDay: Map<string, TimelineCard[]>
): string {
  const header = `Dayflow timeline · ${weekLabel(weekStartDay)}`
  const sections: string[] = [header]
  let any = false
  for (const day of weekDays(weekStartDay)) {
    const cards = cardsByDay.get(day)
    if (!cards || cards.length === 0) continue
    any = true
    const entries = cards.map((c, i) => entryBlock(i + 1, c))
    sections.push([fullDayLabel(day), ...entries].join('\n\n'))
  }
  if (!any) return `${header}\n\nNo timeline activities were recorded for this week.`
  return sections.join('\n\n')
}
