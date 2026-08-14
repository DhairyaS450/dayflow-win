import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import './PausePill.css'

// Dynamic-Island-style morphing pause pill: idle (73w) → menu (250w) → paused (84w).

type PillState = 'idle' | 'menu' | 'paused'

export default function PausePill(): React.JSX.Element {
  const recording = useStore((s) => s.recording)
  const [menuOpen, setMenuOpen] = useState(false)
  const [, forceTick] = useState(0)

  const isPaused = recording.mode === 'pausedTimed' || recording.mode === 'pausedIndefinite'
  const isStopped = recording.mode === 'stopped'
  const state: PillState = isPaused || isStopped ? 'paused' : menuOpen ? 'menu' : 'idle'

  useEffect(() => {
    if (recording.mode !== 'pausedTimed') return
    const t = setInterval(() => {
      forceTick((n) => n + 1)
      void useStore.getState().refreshRecording()
    }, 1000)
    return () => clearInterval(t)
  }, [recording.mode])

  const pause = (duration: '15_mins' | '30_mins' | '1_hour' | 'indefinite'): void => {
    setMenuOpen(false)
    void api.recording.pause(duration)
  }

  const resume = (): void => {
    if (isStopped) void api.recording.start()
    else void api.recording.resume()
  }

  const statusText =
    recording.mode === 'pausedTimed' && recording.countdown
      ? `Dayflow paused for ${recording.countdown}`
      : recording.mode === 'pausedIndefinite'
        ? 'Dayflow paused indefinitely'
        : null

  return (
    <div className="pp-row">
      {statusText && <span className="pp-status">{statusText}</span>}
      <div className={`pp-pill ${state}`}>
        {state === 'idle' && (
          <button className="pp-main" onClick={() => setMenuOpen(true)}>
            <PauseIcon />
            <span className="pp-label">Pause</span>
          </button>
        )}
        {state === 'menu' && (
          <div className="pp-menu">
            <button className="pp-main" onClick={() => setMenuOpen(false)}>
              <PauseIcon />
              <span className="pp-label">Pause</span>
            </button>
            <div className="pp-chips">
              <button className="pp-chip infinity" onClick={() => pause('indefinite')}>
                ∞
              </button>
              <button className="pp-chip" onClick={() => pause('1_hour')}>
                1 Hour
              </button>
              <button className="pp-chip" onClick={() => pause('30_mins')}>
                30 Mins
              </button>
              <button className="pp-chip" onClick={() => pause('15_mins')}>
                15 Mins
              </button>
            </div>
          </div>
        )}
        {state === 'paused' && (
          <button className="pp-main resume" onClick={resume}>
            <PlayIcon />
            <span className="pp-label white">Resume</span>
          </button>
        )}
      </div>
    </div>
  )
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="#786655">
      <rect x="0" y="0" width="3.5" height="12" rx="1" />
      <rect x="6.5" y="0" width="3.5" height="12" rx="1" />
    </svg>
  )
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="white">
      <path d="M0 0 L10 6 L0 12 Z" />
    </svg>
  )
}
