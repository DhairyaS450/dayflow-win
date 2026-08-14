import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import ProvidersTab from './ProvidersTab'
import RecordingPrivacyTab from './RecordingPrivacyTab'
import StorageTab from './StorageTab'
import DataTab from './DataTab'
import OtherTab from './OtherTab'
import './Settings.css'

// Settings surface: left tab sidebar + content column on the paper background.

type TabId = 'providers' | 'privacy' | 'storage' | 'data' | 'other'

const TABS: { id: TabId; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'privacy', label: 'Recording & Privacy' },
  { id: 'storage', label: 'Storage' },
  { id: 'data', label: 'Data' },
  { id: 'other', label: 'Other' }
]

export default function SettingsView(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('providers')
  const [version, setVersion] = useState('')

  useEffect(() => {
    void api.app.version().then(setVersion)
  }, [])

  return (
    <div className="st-root">
      <aside className="st-sidebar">
        <h1 className="st-title">Settings</h1>
        <nav className="st-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`st-tab-btn${tab === t.id ? ' selected' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="st-sidebar-footer">
          {version && <span className="st-version">Dayflow v{version}</span>}
          <button
            className="st-release-link"
            onClick={() =>
              void api.app.openExternal('https://github.com/JerryZLiu/Dayflow/releases')
            }
          >
            Release notes ↗
          </button>
        </div>
      </aside>
      <div className="st-content" key={tab}>
        {tab === 'providers' && <ProvidersTab />}
        {tab === 'privacy' && <RecordingPrivacyTab />}
        {tab === 'storage' && <StorageTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'other' && <OtherTab />}
      </div>
    </div>
  )
}
