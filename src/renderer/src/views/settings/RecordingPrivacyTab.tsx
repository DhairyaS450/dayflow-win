import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Section, Row, PrimaryButton, Metadata, Segmented } from './SettingsUI'

// Settings → Recording & Privacy: screenshot interval + blocked applications.

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60]

export default function RecordingPrivacyTab(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [interval, setIntervalSec] = useState(10)
  const [blockedText, setBlockedText] = useState('')
  const [blockedCount, setBlockedCount] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      const [sec, blocked] = await Promise.all([
        api.settings.get<number>('screenshotIntervalSeconds', 10),
        api.settings.get<string[]>('recordingPrivacyBlockedApplicationIdentifiers', [])
      ])
      setIntervalSec(sec)
      const list = Array.isArray(blocked) ? blocked : []
      setBlockedText(list.join('\n'))
      setBlockedCount(list.length)
      setLoaded(true)
    })()
  }, [])

  const changeInterval = (sec: number): void => {
    setIntervalSec(sec)
    void api.settings.set('screenshotIntervalSeconds', sec)
  }

  const saveBlocked = (): void => {
    const list = Array.from(
      new Set(
        blockedText
          .split('\n')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0)
      )
    )
    setBlockedCount(list.length)
    setBlockedText(list.join('\n'))
    void api.settings.set('recordingPrivacyBlockedApplicationIdentifiers', list)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return <div />

  return (
    <div className="st-tab">
      <Section title="Recording" subtitle="How often Dayflow captures your screen.">
        <Row
          label="Screenshot interval"
          subtitle="Shorter intervals give richer timelines and use more disk."
          divider={false}
        >
          <Segmented<string>
            options={INTERVAL_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }))}
            value={String(INTERVAL_OPTIONS.includes(interval) ? interval : 10)}
            onChange={(v) => changeInterval(Number(v))}
          />
        </Row>
      </Section>

      <Section
        title="Recording privacy"
        subtitle="Choose apps Dayflow should hide from screenshots."
        trailing={<Metadata>{blockedCount} blocked</Metadata>}
      >
        <p className="st-intro-text">
          One app per line, using the process executable name (for example{' '}
          <code className="st-code">1password.exe</code> or{' '}
          <code className="st-code">keepass.exe</code>). Windows of blocked apps are hidden from
          captures.
        </p>
        <textarea
          className="st-blocked-editor"
          placeholder={'1password.exe\nkeepass.exe\nsignal.exe'}
          value={blockedText}
          onChange={(e) => setBlockedText(e.target.value)}
          spellCheck={false}
        />
        <div className="st-inline-actions">
          <PrimaryButton label={saved ? 'Saved ✓' : 'Save blocked apps'} onClick={saveBlocked} />
        </div>
      </Section>
    </div>
  )
}
