import { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import {
  addDays,
  headerDayLabel,
  weekLabel,
  logicalDayString,
  weekStartOf,
  MONTHS,
  ymd
} from '../../lib/time'
import leftArrow from '../../assets/images/LeftArrow.png'
import rightArrow from '../../assets/images/RightArrow.png'
import calendarIcon from '../../assets/images/CalendarIcon.png'
import PausePill from './PausePill'
import './TimelineHeader.css'

export default function TimelineHeader(): React.JSX.Element {
  const mode = useStore((s) => s.timelineMode)
  const setMode = useStore((s) => s.setTimelineMode)
  const selectedDay = useStore((s) => s.selectedDay)
  const setSelectedDay = useStore((s) => s.setSelectedDay)
  const selectedWeekStart = useStore((s) => s.selectedWeekStart)
  const setSelectedWeekStart = useStore((s) => s.setSelectedWeekStart)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const today = logicalDayString()
  const currentWeekStart = weekStartOf(today)
  const atLatest = mode === 'day' ? selectedDay >= today : selectedWeekStart >= currentWeekStart
  const showToday = mode === 'day' ? selectedDay !== today : selectedWeekStart !== currentWeekStart

  const navigate = (delta: number): void => {
    if (mode === 'day') {
      const next = addDays(selectedDay, delta)
      if (next <= today) setSelectedDay(next)
    } else {
      const next = addDays(selectedWeekStart, delta * 7)
      if (next <= currentWeekStart) setSelectedWeekStart(next)
    }
  }

  const goToday = (): void => {
    if (mode === 'day') setSelectedDay(today)
    else setSelectedWeekStart(currentWeekStart)
  }

  const dateLabel = mode === 'day' ? headerDayLabel(selectedDay) : weekLabel(selectedWeekStart)

  return (
    <div className="tl-header">
      <div className="tl-header-leading">
        <button className="tl-nav-arrow" onClick={() => navigate(-1)}>
          <img src={leftArrow} alt="Previous" width={24} height={24} />
        </button>
        <button
          className="tl-nav-arrow"
          disabled={atLatest}
          onClick={() => navigate(1)}
          style={{ opacity: atLatest ? 0.35 : 1 }}
        >
          <img src={rightArrow} alt="Next" width={24} height={24} />
        </button>
        <div className="tl-cal-anchor">
          <button
            className={`tl-cal-pill${calendarOpen ? ' open' : ''}`}
            onClick={() => setCalendarOpen((v) => !v)}
          >
            <img src={calendarIcon} alt="Calendar" width={16} height={16} />
          </button>
          {calendarOpen && (
            <CalendarPopover
              mode={mode}
              selectedDay={selectedDay}
              selectedWeekStart={selectedWeekStart}
              onSelectDay={(d) => {
                setSelectedDay(d)
                setCalendarOpen(false)
              }}
              onSelectWeek={(w) => {
                setSelectedWeekStart(w)
                setCalendarOpen(false)
              }}
              onClose={() => setCalendarOpen(false)}
            />
          )}
        </div>
        <div className="tl-mode-toggle">
          <div className={`tl-mode-highlight ${mode}`} />
          <button
            className={`tl-mode-segment${mode === 'day' ? ' selected' : ''}`}
            onClick={() => setMode('day')}
          >
            Day
          </button>
          <button
            className={`tl-mode-segment${mode === 'week' ? ' selected' : ''}`}
            onClick={() => {
              setMode('week')
              void useStore.getState().loadWeekCards()
            }}
          >
            Week
          </button>
        </div>
        {showToday && (
          <button className="tl-today-btn" onClick={goToday}>
            Today
          </button>
        )}
        <span className="tl-date-label">{dateLabel}</span>
      </div>
      <div className="tl-header-trailing">
        <PausePill />
      </div>
    </div>
  )
}

interface CalendarPopoverProps {
  mode: 'day' | 'week'
  selectedDay: string
  selectedWeekStart: string
  onSelectDay: (day: string) => void
  onSelectWeek: (weekStart: string) => void
  onClose: () => void
}

function CalendarPopover(props: CalendarPopoverProps): React.JSX.Element {
  const anchor = props.mode === 'day' ? props.selectedDay : props.selectedWeekStart
  const [y0, m0] = anchor.split('-').map(Number)
  const [viewYear, setViewYear] = useState(y0)
  const [viewMonth, setViewMonth] = useState(m0 - 1) // 0-based
  const today = logicalDayString()

  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const mondayOffset = (first.getDay() + 6) % 7
    const start = new Date(viewYear, viewMonth, 1 - mondayOffset, 12)
    const cells: { day: string; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getTime())
      d.setDate(d.getDate() + i)
      cells.push({ day: ymd(d), inMonth: d.getMonth() === viewMonth })
    }
    // Trim trailing full weeks outside the month
    while (cells.length > 7 && cells.slice(-7).every((c) => !c.inMonth)) cells.splice(-7)
    return cells
  }, [viewYear, viewMonth])

  const shiftMonth = (delta: number): void => {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const weeks: { day: string; inMonth: boolean }[][] = []
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7))

  return (
    <>
      <div className="tl-cal-catcher" onClick={props.onClose} />
      <div className="tl-cal-popover">
        <div className="tl-cal-month-row">
          <span className="tl-cal-month">{`${MONTHS[viewMonth]} ${viewYear}`}</span>
          <div className="tl-cal-chevrons">
            <button onClick={() => shiftMonth(-1)}>‹</button>
            <button onClick={() => shiftMonth(1)}>›</button>
          </div>
        </div>
        <div className="tl-cal-weekdays">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="tl-cal-grid">
          {weeks.map((week, wi) => {
            const weekStart = week[0].day
            const weekSelected = props.mode === 'week' && weekStart === props.selectedWeekStart
            return (
              <div key={wi} className={`tl-cal-week${weekSelected ? ' selected' : ''}`}>
                {week.map((cell) => {
                  const disabled = cell.day > today
                  const selected = props.mode === 'day' && cell.day === props.selectedDay
                  const num = Number(cell.day.split('-')[2])
                  return (
                    <button
                      key={cell.day}
                      className={`tl-cal-day${selected ? ' selected' : ''}${
                        !cell.inMonth || disabled ? ' dim' : ''
                      }${weekSelected ? ' in-week' : ''}`}
                      disabled={disabled}
                      onClick={() => {
                        if (props.mode === 'day') props.onSelectDay(cell.day)
                        else props.onSelectWeek(weekStart <= weekStartOf(today) ? weekStart : weekStartOf(today))
                      }}
                    >
                      {num}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export function copyTimelineHandler(): void {
  void api.timeline.copyToClipboard('')
}
