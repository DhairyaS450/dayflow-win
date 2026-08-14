import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, categoryColor, blendToWhite } from '../../state/store'
import { logicalDayString, weekDays, dayStart, WEEKDAYS_SHORT } from '../../lib/time'
import {
  positionCards,
  cardY,
  cardHeight,
  WEEK_PPM,
  WEEK_CONTENT_HEIGHT,
  HOUR_LABELS,
  FAILED_TITLE
} from './layout'
import type { TimelineCard } from '../../../../shared/types'
import './WeekGrid.css'

export default function WeekGrid(): React.JSX.Element {
  const weekCards = useStore((s) => s.weekCards)
  const categories = useStore((s) => s.categories)
  const selectedWeekStart = useStore((s) => s.selectedWeekStart)
  const selectedCardId = useStore((s) => s.selectedCardId)
  const selectCard = useStore((s) => s.selectCard)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const days = useMemo(() => weekDays(selectedWeekStart), [selectedWeekStart])
  const today = logicalDayString()

  const cardsByDay = useMemo(() => {
    const map = new Map<string, TimelineCard[]>()
    for (const day of days) map.set(day, [])
    for (const card of weekCards) {
      if (map.has(card.day)) map.get(card.day)!.push(card)
    }
    return map
  }, [weekCards, days])

  useEffect(() => {
    void useStore.getState().loadWeekCards()
  }, [selectedWeekStart])

  useEffect(() => {
    setRevealed(false)
    const el = scrollRef.current
    if (!el) return
    // Scroll near earliest content or now − 60min if week contains today
    let targetMin = 4 * 60
    if (days.includes(today)) {
      const now = new Date()
      let m = now.getHours() * 60 + now.getMinutes() - 4 * 60
      if (m < 0) m += 24 * 60
      targetMin = Math.max(0, m - 60)
    } else {
      let earliest = Infinity
      for (const card of weekCards) {
        if (card.startTs) {
          const d = new Date(card.startTs * 1000)
          let m = d.getHours() * 60 + d.getMinutes() - 4 * 60
          if (m < 0) m += 24 * 60
          earliest = Math.min(earliest, m)
        }
      }
      targetMin = earliest === Infinity ? 0 : Math.max(0, earliest - 60)
    }
    el.scrollTop = targetMin * WEEK_PPM
    const t = setTimeout(() => setRevealed(true), 30)
    return () => clearTimeout(t)
  }, [selectedWeekStart, weekCards.length > 0])

  useEffect(() => {
    const t = setInterval(() => void useStore.getState().loadWeekCards(), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="week-root">
      <div className="week-header-row">
        <div className="week-gutter-spacer" />
        {days.map((day) => {
          const d = dayStart(day)
          const isToday = day === today
          return (
            <div key={day} className="week-header-cell">
              <span className="week-header-name">{WEEKDAYS_SHORT[d.getDay()]}</span>
              <span className={`week-header-num${isToday ? ' today' : ''}`}>{d.getDate()}</span>
            </div>
          )
        })}
      </div>
      <div className={`week-scroll${revealed ? ' revealed' : ''}`} ref={scrollRef}>
        <div className="week-canvas" style={{ height: WEEK_CONTENT_HEIGHT }}>
          {HOUR_LABELS.map((label, i) => (
            <div key={i} className="week-hour-slot" style={{ top: i * 111 }}>
              <span className="week-hour-label">{label}</span>
              <div className="week-hour-line" />
            </div>
          ))}
          <div className="week-columns" onClick={() => selectCard(null)}>
            {days.map((day, di) => {
              const positioned = positionCards(cardsByDay.get(day) ?? [])
              return (
                <div key={day} className={`week-col${di > 0 ? ' bordered' : ''}`}>
                  {positioned.map((p) => {
                    const failed = p.card.title === FAILED_TITLE
                    const accent = categoryColor(categories, p.card.category)
                    const fill = blendToWhite(accent, 0.88)
                    const border = blendToWhite(accent, 0.62)
                    const selected = selectedCardId === p.card.id
                    const hovered = hoveredId === p.card.id
                    const height = cardHeight(p.startMin, p.endMin, WEEK_PPM, 16)
                    const compact = p.rawEndMin - p.rawStartMin < 24 || height < 40
                    return (
                      <div
                        key={p.card.id}
                        className={`week-card${failed ? ' failed' : ''}${hovered ? ' hovered' : ''}${compact ? ' compact' : ''}`}
                        style={{
                          top: cardY(p.startMin, WEEK_PPM),
                          minHeight: height,
                          height: hovered ? 'auto' : height,
                          background: failed ? undefined : fill,
                          borderColor: failed ? undefined : selected ? accent : border,
                          borderWidth: selected ? 1 : 0.5,
                          zIndex: hovered ? 10 : selected ? 6 : 1
                        }}
                        onMouseEnter={() => setHoveredId(p.card.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={(e) => {
                          e.stopPropagation()
                          selectCard(selected ? null : p.card.id)
                        }}
                      >
                        {!failed && (
                          <div className="week-card-accent" style={{ background: accent }} />
                        )}
                        <span className={`week-card-title${hovered ? ' expanded' : ''}`}>
                          {p.card.title}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
