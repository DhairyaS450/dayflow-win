import { useStore } from '../../state/store'
import { api } from '../../lib/api'

// Minimal placeholder while the full onboarding flow is built.
export default function OnboardingFlow(): React.JSX.Element {
  const setOnboarded = useStore((s) => s.setOnboarded)
  const finish = async (): Promise<void> => {
    await api.settings.set('didOnboard', true)
    setOnboarded(true)
    await api.recording.start()
  }
  return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 44 }}>Welcome to Dayflow</h1>
      <p style={{ marginTop: 16 }}>Full onboarding flow lands in a later build step.</p>
      <button
        style={{
          marginTop: 24,
          padding: '10px 24px',
          background: '#FF6B05',
          color: 'white',
          borderRadius: 12,
          fontSize: 16
        }}
        onClick={() => void finish()}
      >
        Get started
      </button>
    </div>
  )
}
