import { useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import logo from '../../assets/images/DayflowLogoMainApp.png'
import type { ProviderChoice } from './ProviderChoiceStep'

// Final step. "Launch Dayflow" creates the sample onboarding card, then runs
// the completion contract: didOnboard=true → setOnboarded(true) → start recording.

async function onboardingSummary(provider: ProviderChoice | null): Promise<string> {
  const tail =
    'Dayflow now quietly captures your screen and turns it into timeline cards like this one. ' +
    'Let it run in the background for an hour or two, then check back to see your day take shape.'
  if (provider === 'gemini') {
    return `Set up Dayflow and connected Google Gemini. ${tail}`
  }
  if (provider === 'ollama') {
    const engine = await api.settings.get<string>('llmLocalEngine', 'ollama')
    const engineName =
      engine === 'lmstudio'
        ? 'LM Studio'
        : engine === 'custom'
          ? 'a custom OpenAI-compatible server'
          : 'Ollama'
    return `Set up Dayflow with a local model through ${engineName}. Everything is processed privately on this PC — nothing leaves your computer. ${tail}`
  }
  return `Set up Dayflow! ${tail}`
}

export default function CompletionStep(props: {
  provider: ProviderChoice | null
}): React.JSX.Element {
  const [launching, setLaunching] = useState(false)

  const launch = async (): Promise<void> => {
    if (launching) return
    setLaunching(true)
    try {
      // Sample card is a nicety — never block launch on it.
      try {
        const cats = await api.categories.load()
        const firstCategory = cats.find((c) => !c.isIdle)?.name ?? 'Work'
        const summary = await onboardingSummary(props.provider)
        await api.onboarding.createCard(firstCategory, summary)
      } catch {
        /* ignore */
      }
      await api.settings.set('didOnboard', true)
      useStore.getState().setOnboarded(true)
      await api.recording.start()
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="ob-step ob-completion-step">
      <img className="ob-completion-logo" src={logo} alt="" />
      <h1 className="ob-serif-heading dark">You are ready to go!</h1>
      <p className="ob-completion-body">
        To get useful insights, let Dayflow run in the background for an hour or two to gather
        enough context, then check back in.
      </p>
      <button
        className="ob-primary-btn ob-launch-btn"
        disabled={launching}
        onClick={() => void launch()}
      >
        {launching ? 'Launching…' : 'Launch Dayflow'}
      </button>
    </div>
  )
}
