import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import { weekStartOf, logicalDayString, dayStart } from '../../lib/time'
import TimelineHeader from './TimelineHeader'
import FilterBar from './FilterBar'
import DayCanvas from './DayCanvas'
import WeekGrid from './WeekGrid'
import Inspector from './Inspector'
import CategoryEditor from './CategoryEditor'
import { makeDayClipboardText, makeWeekClipboardText } from './clipboard'
import copyIcon from '../../assets/images/Copy.svg'
import type { TimelineCard } from '../../../../shared/types'
import './TimelineView.css'

export default function TimelineView(): React.JSX.Element {
  const mode = useStore((s) => s.timelineMode)
  const selectedCardId = useStore((s) => s.selectedCardId)
  const [editorOpen, setEditorOpen] = useState(false)

  const showInspector = mode === 'day' || selectedCardId !== null

  return (
    <div className="tl-root">
      <div className="tl-left">
        <TimelineHeader />
        <FilterBar onEditCategories={() => setEditorOpen(true)} />
        {mode === 'day' ? <DayCanvas /> : <WeekGrid />}
        <TimelineFooter />
      </div>
      {showInspector && (
        <>
          <div className="tl-divider" />
          <div className="tl-inspector" style={{ width: mode === 'day' ? 358 : 340 }}>
            <Inspector />
          </div>
        </>
      )}
      {editorOpen && <CategoryEditor onClose={() => setEditorOpen(false)} />}
    </div>
  )
}

function TimelineFooter(): React.JSX.Element {
  const mode = useStore((s) => s.timelineMode)
  const cards = useStore((s) => s.cards)
  const weekCards = useStore((s) => s.weekCards)
  const selectedDay = useStore((s) => s.selectedDay)
  const selectedWeekStart = useStore((s) => s.selectedWeekStart)
  const [weekHours, setWeekHours] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  useEffect(() => {
    const load = async (): Promise<void> => {
      const ws = weekStartOf(logicalDayString())
      const start = dayStart(ws)
      const end = new Date(start.getTime())
      end.setDate(end.getDate() + 7)
      const minutes = await api.timeline.minutesTracked(
        Math.floor(start.getTime() / 1000),
        Math.floor(end.getTime() / 1000)
      )
      setWeekHours(Math.round(minutes / 60))
    }
    void load()
    const t = setInterval(() => void load(), 120_000)
    return () => clearInterval(t)
  }, [cards.length])

  const copy = async (): Promise<void> => {
    let text: string
    if (mode === 'day') {
      text = makeDayClipboardText(selectedDay, cards)
    } else {
      const byDay = new Map<string, TimelineCard[]>()
      for (const card of weekCards) {
        if (!byDay.has(card.day)) byDay.set(card.day, [])
        byDay.get(card.day)!.push(card)
      }
      text = makeWeekClipboardText(selectedWeekStart, byDay)
    }
    await api.timeline.copyToClipboard(text)
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  return (
    <div className="tl-footer">
      <span className="tl-footer-hours">
        <b>{weekHours} hours</b>
        {mode === 'day' ? ' tracked this week' : ' of activities tracked this week'}
      </span>
      <span className="tl-footer-flex" />
      <button className="tl-copy-btn" onClick={() => void copy()}>
        {copyState === 'copied' ? (
          <>✓ Copied</>
        ) : (
          <>
            <img src={copyIcon} alt="" width={11.5} height={11.5} />
            Copy timeline
          </>
        )}
      </button>
    </div>
  )
}
