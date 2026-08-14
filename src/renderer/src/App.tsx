import { useEffect } from 'react'
import { useStore } from './state/store'
import Sidebar from './components/Sidebar'
import TimelineView from './views/timeline/TimelineView'
import DailyView from './views/daily/DailyView'
import WeeklyView from './views/weekly/WeeklyView'
import ChatView from './views/chat/ChatView'
import SettingsView from './views/settings/SettingsView'
import ReportView from './views/report/ReportView'
import OnboardingFlow from './views/onboarding/OnboardingFlow'
import { api } from './lib/api'
import mainBackground from './assets/images/MainUIBackground.png'
import logo from './assets/images/DayflowLogoMainApp.png'
import './App.css'

export default function App(): React.JSX.Element {
  const tab = useStore((s) => s.tab)
  const onboarded = useStore((s) => s.onboarded)

  useEffect(() => {
    void useStore.getState().initOnboarded()
    void useStore.getState().loadCategories()
    void useStore.getState().refreshRecording()
    void useStore.getState().loadCards()
    const offRecording = api.on('recording:changed', () => {
      void useStore.getState().refreshRecording()
    })
    const offTimeline = api.on('timeline:changed', () => {
      void useStore.getState().loadCards()
      if (useStore.getState().timelineMode === 'week') void useStore.getState().loadWeekCards()
    })
    const offCategories = api.on('categories:changed', () => {
      void useStore.getState().loadCategories()
    })
    return () => {
      offRecording()
      offTimeline()
      offCategories()
    }
  }, [])

  if (onboarded === null) {
    return <div className="app-loading" />
  }

  if (!onboarded) {
    return <OnboardingFlow />
  }

  return (
    <div className="app-root">
      <div className="titlebar-drag" />
      <img className="app-wallpaper" src={mainBackground} alt="" />
      <div className="app-scrim" />
      <div className="app-layout">
        <div className="app-left">
          <div className="app-logo-area">
            <img className="app-logo" src={logo} alt="Dayflow" />
          </div>
          <div className="app-sidebar-area">
            <Sidebar />
          </div>
        </div>
        <div className="app-panel">
          {tab === 'timeline' && <TimelineView />}
          {tab === 'daily' && <DailyView />}
          {tab === 'weekly' && <WeeklyView />}
          {tab === 'chat' && <ChatView />}
          {tab === 'report' && <ReportView />}
          {tab === 'settings' && <SettingsView />}
        </div>
      </div>
    </div>
  )
}
