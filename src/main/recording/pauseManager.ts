import { powerMonitor } from 'electron'
import { appState } from '../app/appState'

// PauseManager port. Durations: 15 min / 30 min / 1 hr / indefinite.
// Timed pauses do NOT persist recording-off; indefinite does.

export type PauseDuration = '15_mins' | '30_mins' | '1_hour' | 'indefinite'

const DURATION_SECONDS: Record<Exclude<PauseDuration, 'indefinite'>, number> = {
  '15_mins': 900,
  '30_mins': 1800,
  '1_hour': 3600
}

type Listener = () => void

export class PauseManager {
  pauseEndTime: number | null = null // epoch ms
  isPausedIndefinitely = false
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()

  private initialized = false

  /** Must be called after app 'ready' — touches powerMonitor. */
  init(): void {
    if (this.initialized) return
    this.initialized = true
    powerMonitor.on('resume', () => {
      if (this.pauseEndTime !== null && Date.now() >= this.pauseEndTime) {
        this.resume('wake_from_sleep')
      }
    })
  }

  onTick(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  pause(duration: PauseDuration, source: string): void {
    this.clearPauseState()
    if (duration === 'indefinite') {
      this.isPausedIndefinitely = true
      appState.setRecording(false, { analyticsReason: source, persistPreference: true })
    } else {
      this.pauseEndTime = Date.now() + DURATION_SECONDS[duration] * 1000
      this.timer = setInterval(() => {
        this.emit()
        if (this.pauseEndTime !== null && Date.now() >= this.pauseEndTime) {
          this.resume('timer_expired')
        }
      }, 1000)
      appState.setRecording(false, { analyticsReason: source, persistPreference: false })
    }
    this.emit()
  }

  resume(source: string): void {
    this.clearPauseState()
    appState.setRecording(true, { analyticsReason: source, persistPreference: true })
    this.emit()
  }

  clearPauseState(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.pauseEndTime = null
    this.isPausedIndefinitely = false
  }

  remainingSeconds(): number | null {
    if (this.pauseEndTime === null) return null
    return Math.max(0, Math.ceil((this.pauseEndTime - Date.now()) / 1000))
  }

  /** Countdown string M:SS, or null when not on a timed pause. */
  countdownText(): string | null {
    const s = this.remainingSeconds()
    if (s === null) return null
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec < 10 ? '0' : ''}${sec}`
  }

  mode(): 'pausedTimed' | 'pausedIndefinite' | 'active' | 'stopped' {
    if (this.pauseEndTime !== null) return 'pausedTimed'
    if (this.isPausedIndefinitely) return 'pausedIndefinite'
    return appState.isRecording ? 'active' : 'stopped'
  }
}

export const pauseManager = new PauseManager()
