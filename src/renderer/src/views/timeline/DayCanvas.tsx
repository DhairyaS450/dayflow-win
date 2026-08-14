import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, categoryColor } from '../../state/store'
import { logicalDayString, formatHMMA } from '../../lib/time'
import {
  positionCards,
  cardY,
  cardHeight,
  DAY_PPM,
  DAY_CONTENT_HEIGHT,
  HOUR_LABELS,
  FAILED_TITLE
} from './layout'
import { api } from '../../lib/api'
import ThinkingSpinner from './ThinkingSpinner'
import Favicon from '../../components/Favicon'
import './DayCanvas.css'

export default function DayCanvas(): React.JSX.Element {
  const cards = useStore((s) => s.cards)
  const categories = useStore((s) => s.categories)
  const selectedDay = useStore((s) => s.selectedDay)
  const selectedCardId = useStore((s) => s.selectedCardId)
  const selectCard = useStore((s) => s.selectCard)
  const recording = useStore((s) => s.recording)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
  const isToday = selectedDay === logicalDayString()

  const positioned = useMemo(() => positionCards(cards), [cards])

  // Auto-scroll: 2 hours before now at 25% from top (today only)
  useEffect(() => {
    setRevealed(false)
    const el = scrollRef.current
    if (!el) return
    if (isToday) {
      const now = new Date()
      let minutes = now.getHours() * 60 + now.getMinutes() - 4 * 60
      if (minutes < 0) minutes += 24 * 60
      const target = Math.max(0, (minutes - 120) * DAY_PPM - el.clientHeight * 0.25)
      el.scrollTop = target
    } else {
      el.scrollTop = 0
    }
    const t = setTimeout(() => setRevealed(true), 30)
    return () => clearTimeout(t)
  }, [selectedDay, isToday])

  // Refresh every 60s
  useEffect(() => {
    const t = setInterval(() => void useStore.getState().loadCards(), 60_000)
    return () => clearInterval(t)
  }, [])

  // Status card (recording projection) — today only
  const statusCard = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    let nowMin = now.getHours() * 60 + now.getMinutes() - 4 * 60
    if (nowMin < 0) nowMin += 24 * 60
    let start = nowMin - 7.5
    let end = start + 15
    // Push after any card it intersects
    for (const p of positioned) {
      if (start < p.endMin && end > p.startMin) {
        start = p.endMin
        end = Math.min(start + 15, start + 40)
      }
    }
    start = Math.max(0, start)
    end = Math.min(24 * 60, Math.max(end, start + 4))
    if (end - start > 40) end = start + 40
    return { start, end }
  }, [isToday, positioned])

  return (
    <div className={`day-canvas-scroll${revealed ? ' revealed' : ''}`} ref={scrollRef}>
      <div className="day-canvas" style={{ height: DAY_CONTENT_HEIGHT }}>
        {HOUR_LABELS.map((label, i) => (
          <div key={i} className="day-hour-slot" style={{ top: i * 168 }}>
            <span className="day-hour-label" onClick={() => selectCard(null)}>
              {label}
            </span>
            <div className="day-hour-line" />
          </div>
        ))}
        <div className="day-card-area" onClick={() => selectCard(null)}>
          {positioned.map((p, idx) => {
            const failed = p.card.title === FAILED_TITLE
            const accent = categoryColor(categories, p.card.category)
            const height = cardHeight(p.startMin, p.endMin, DAY_PPM, 10)
            const durationMin = p.rawEndMin - p.rawStartMin
            const selected = selectedCardId === p.card.id
            const compact = durationMin < 13
            return (
              <div
                key={p.card.id}
                className={`day-card${failed ? ' failed' : ''}${selected ? ' selected' : ''}${compact ? ' compact' : ''}`}
                style={{
                  top: cardY(p.startMin, DAY_PPM),
                  height,
                  ...(selected
                    ? {
                        boxShadow: `inset 0 0 0 1.5px ${failed ? '#FF291C' : accent}`
                      }
                    : {}),
                  animationDelay: `${idx * 30}ms`
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  selectCard(selected ? null : p.card.id)
                }}
              >
                {!failed && <div className="day-card-accent" style={{ background: accent }} />}
                {durationMin >= 10 && (
                  <div className="day-card-content">
                    {!failed && (
                      <Favicon
                        domain={p.card.appSites?.primary ?? p.card.appSites?.secondary}
                        size={18}
                      />
                    )}
                    <span className="day-card-title">{p.card.title}</span>
                    <span className="day-card-spacer" />
                    {p.card.isBackupGenerated && (
                      <span
                        className="day-card-backup"
                        title="This card fell back to a lower-quality Gemini model due to rate limiting, so output quality may be lower."
                      >
                        !
                      </span>
                    )}
                    <span className="day-card-time">
                      {p.card.startTimestamp} - {p.card.endTimestamp}
                    </span>
                  </div>
                )}
                {failed && durationMin >= 10 && (
                  <div className="day-card-failed-status">Click to retry from the panel →</div>
                )}
              </div>
            )
          })}
          {statusCard && (
            <StatusCard
              start={statusCard.start}
              end={statusCard.end}
              mode={recording.mode}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StatusCard(props: { start: number; end: number; mode: string }): React.JSX.Element {
  const height = Math.max(10, (props.end - props.start) * DAY_PPM - 2)
  const active = props.mode === 'active'
  const showText = height >= 24
  const stopped = props.mode === 'stopped'
  return (
    <div
      className={`day-status-card${active ? ' active' : ' inactive'}`}
      style={{ top: cardY(props.start, DAY_PPM), height }}
      onClick={(e) => {
        e.stopPropagation()
        if (!active) {
          void api.recording[stopped ? 'start' : 'resume']()
        }
      }}
      role={active ? undefined : 'button'}
    >
      {active ? (
        <>
          <ThinkingSpinner palette="status" scale={0.5} />
          {showText && <span className="day-status-text">Generating your next card</span>}
        </>
      ) : (
        <>
          <span className="day-status-icon">{stopped ? '▶' : '⏸'}</span>
          {showText && (
            <span className="day-status-text paused">
              {stopped
                ? "Dayflow isn't recording. Click 'Resume' to generate new activity cards."
                : "Dayflow is paused. Click 'Resume' to generate new activity cards."}
            </span>
          )}
        </>
      )}
    </div>
  )
}

export function nowTimeLabel(): string {
  return formatHMMA(Math.floor(Date.now() / 1000))
}
