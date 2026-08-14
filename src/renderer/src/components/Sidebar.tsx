import { useStore, type Tab } from '../state/store'
import timelineIcon from '../assets/images/TimelineIcon.png'
import dailyIcon from '../assets/images/DailyIcon.svg'
import weeklyIcon from '../assets/images/WeeklyIcon.svg'
import chatIcon from '../assets/images/ChatIcon.svg'
import iconBackground from '../assets/images/IconBackground.png'
import './Sidebar.css'

interface Item {
  tab: Tab
  label: string
  icon?: string
  glyph?: string
}

const ITEMS: Item[] = [
  { tab: 'timeline', label: 'Timeline', icon: timelineIcon },
  { tab: 'daily', label: 'Daily', icon: dailyIcon },
  { tab: 'weekly', label: 'Weekly', icon: weeklyIcon },
  { tab: 'chat', label: 'Chat', icon: chatIcon },
  { tab: 'report', label: 'Report', glyph: '💬' },
  { tab: 'settings', label: 'Settings', glyph: '⚙' }
]

export default function Sidebar(): React.JSX.Element {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)

  return (
    <nav className="sidebar">
      {ITEMS.map((item) => {
        const selected = tab === item.tab
        return (
          <button
            key={item.tab}
            className={`sidebar-item${selected ? ' selected' : ''}`}
            onClick={() => setTab(item.tab)}
          >
            <span className="sidebar-icon-wrap">
              {selected && <img className="sidebar-icon-bg" src={iconBackground} alt="" />}
              {item.icon ? (
                <img
                  className={`sidebar-icon${selected ? ' tint-selected' : ' tint-unselected'}`}
                  src={item.icon}
                  alt=""
                />
              ) : (
                <span className={`sidebar-glyph${selected ? ' selected' : ''}`}>{item.glyph}</span>
              )}
            </span>
            <span className={`sidebar-label${selected ? ' selected' : ''}`}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
