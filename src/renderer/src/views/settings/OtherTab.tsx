import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../state/store'
import { Section, Row, SecondaryButton, Toggle } from './SettingsUI'

// Settings → Other: launch at login, output language override, reset onboarding.

export default function OtherTab(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [language, setLanguage] = useState('')
  const [storedLanguage, setStoredLanguage] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)

  useEffect(() => {
    void (async () => {
      const [launch, lang] = await Promise.all([
        api.app.getLaunchAtLogin(),
        api.settings.get<string>('llmOutputLanguageOverride', '')
      ])
      setLaunchAtLogin(launch)
      setLanguage(lang)
      setStoredLanguage(lang)
      setLoaded(true)
    })()
  }, [])

  const toggleLaunch = (v: boolean): void => {
    setLaunchAtLogin(v)
    void api.app.setLaunchAtLogin(v)
  }

  const saveLanguage = (): void => {
    const v = language.trim()
    setStoredLanguage(v)
    setLanguage(v)
    void api.settings.set('llmOutputLanguageOverride', v)
  }

  const resetLanguage = (): void => {
    setLanguage('')
    setStoredLanguage('')
    void api.settings.set('llmOutputLanguageOverride', '')
  }

  const resetOnboarding = async (): Promise<void> => {
    setConfirmingReset(false)
    await api.settings.set('didOnboard', false)
    useStore.getState().setOnboarded(false)
  }

  const languageSaved = language.trim() === storedLanguage

  if (!loaded) return <div />

  return (
    <div className="st-tab">
      <Section title="App preferences" subtitle="General toggles for how Dayflow runs.">
        <Row
          label="Launch Dayflow at login"
          subtitle="Starts Dayflow in the background right after you sign in so capture can resume instantly."
          divider={false}
        >
          <Toggle checked={launchAtLogin} onChange={toggleLaunch} />
        </Row>
      </Section>

      <Section
        title="Output language override"
        subtitle="The default language is English. You can specify any language here (examples: English, 简体中文, Español, 日本語, 한국어, Français)."
      >
        <div className="st-inline-actions">
          <input
            className="st-field-input"
            style={{ maxWidth: 220 }}
            placeholder="English"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <SecondaryButton
            label={languageSaved ? 'Saved ✓' : 'Save'}
            disabled={languageSaved}
            onClick={saveLanguage}
          />
          <SecondaryButton label="Reset" onClick={resetLanguage} />
        </div>
      </Section>

      <Section title="Onboarding" subtitle="Run the first-launch setup flow again.">
        {!confirmingReset ? (
          <Row
            label="Reset onboarding"
            subtitle="Returns you to the setup flow immediately. Your timeline data is untouched."
            divider={false}
          >
            <SecondaryButton label="Reset onboarding" onClick={() => setConfirmingReset(true)} />
          </Row>
        ) : (
          <div className="st-confirm-box">
            <p className="st-confirm-title">Reset onboarding?</p>
            <p className="st-confirm-body">
              Dayflow will return to the first-run setup flow. Your timeline data is untouched.
            </p>
            <div className="st-inline-actions">
              <button className="st-destructive-btn" onClick={() => void resetOnboarding()}>
                Reset
              </button>
              <SecondaryButton label="Cancel" onClick={() => setConfirmingReset(false)} />
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
