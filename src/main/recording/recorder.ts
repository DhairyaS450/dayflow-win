import { powerMonitor } from 'electron'
import { settings, SettingsKeys } from '../lib/settings'
import { nextScreenshotPath, saveScreenshot } from '../db/storage'
import { captureDisplayToFile } from './capture'
import { ActiveDisplayTracker } from './displayTracker'

// ScreenRecorder port: periodic JPEG screenshots (default 10 s interval).
// States: idle | starting | capturing | paused (system pause auto-resumes).

export type RecorderState = 'idle' | 'starting' | 'capturing' | 'paused'

const WAKE_RESUME_DELAY_MS = 5000
const UNLOCK_RESUME_DELAY_MS = 500

export class ScreenRecorder {
  state: RecorderState = 'idle'
  wantsRecording = false
  private timer: NodeJS.Timeout | null = null
  private currentDisplayId: number | null = null
  private requestedDisplayId: number | null = null
  private tracker = new ActiveDisplayTracker()
  private capturing = false

  private initialized = false

  /** Must be called after app 'ready' — touches screen + powerMonitor. */
  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.tracker.start()
    this.tracker.onChange((id) => this.handleActiveDisplayChange(id))
    this.registerPowerEvents()
  }

  private intervalMs(): number {
    const v = settings.get<number>(SettingsKeys.screenshotIntervalSeconds, 10)
    return (v > 0 ? v : 10) * 1000
  }

  setRecordingFlag(enabled: boolean): void {
    this.wantsRecording = enabled
    if (enabled) {
      this.start()
    } else {
      this.stop()
      if (this.state === 'paused') this.state = 'idle'
    }
  }

  start(): void {
    if (!this.wantsRecording) return
    if (this.state !== 'idle' && this.state !== 'paused') return
    this.state = 'starting'
    // Choose display: requested → tracker current → first (capture falls back internally).
    this.currentDisplayId = this.requestedDisplayId ?? this.tracker.activeDisplayId
    this.requestedDisplayId = null
    if (this.state !== 'starting') return
    this.state = 'capturing'
    this.startTimer()
    void this.captureTick()
  }

  stop(): void {
    this.stopTimer()
    this.currentDisplayId = null
    if (this.state !== 'paused') this.state = 'idle'
  }

  /** System pause (sleep/lock). Auto-resumes; never clears the user preference. */
  systemPause(): void {
    if (!this.wantsRecording) return
    this.stopTimer()
    this.state = 'paused'
  }

  private systemResume(delayMs: number): void {
    setTimeout(() => {
      if (this.state === 'paused' && this.wantsRecording) {
        this.state = 'idle'
        this.start()
      }
    }, delayMs)
  }

  private registerPowerEvents(): void {
    powerMonitor.on('suspend', () => this.systemPause())
    powerMonitor.on('resume', () => this.systemResume(WAKE_RESUME_DELAY_MS))
    powerMonitor.on('lock-screen', () => this.systemPause())
    powerMonitor.on('unlock-screen', () => this.systemResume(UNLOCK_RESUME_DELAY_MS))
  }

  private handleActiveDisplayChange(id: number): void {
    this.requestedDisplayId = id
    if (this.state !== 'capturing') return
    if (id === this.currentDisplayId) return
    // Next screenshot uses the new display.
    this.currentDisplayId = id
    this.requestedDisplayId = null
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => void this.captureTick(), this.intervalMs())
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async captureTick(): Promise<void> {
    if (this.state !== 'capturing' || this.capturing) return
    this.capturing = true
    const capturedAt = Math.floor(Date.now() / 1000)
    try {
      const filePath = nextScreenshotPath()
      const result = await captureDisplayToFile(this.currentDisplayId, filePath)
      if (result) {
        saveScreenshot(result.filePath, capturedAt, result.idleSeconds)
      }
    } catch (err) {
      console.error('[recorder] capture failed', err)
    } finally {
      this.capturing = false
    }
  }
}

export const screenRecorder = new ScreenRecorder()
