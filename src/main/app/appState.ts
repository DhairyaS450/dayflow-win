import { settings, SettingsKeys } from '../lib/settings'

// AppState port: single source of truth for the recording flag.

type Listener = (enabled: boolean, reason: string) => void

class AppState {
  isRecording = false
  private persistenceEnabled = false
  private listeners = new Set<Listener>()

  enablePersistence(): void {
    this.persistenceEnabled = true
  }

  setRecording(
    enabled: boolean,
    opts: { analyticsReason?: string; persistPreference?: boolean } = {}
  ): void {
    const { analyticsReason = 'unknown', persistPreference = true } = opts
    if (this.isRecording === enabled) return
    this.isRecording = enabled
    if (this.persistenceEnabled && persistPreference) {
      settings.set(SettingsKeys.isRecording, enabled)
    }
    for (const fn of this.listeners) fn(enabled, analyticsReason)
  }

  onRecordingChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  savedRecordingPreference(): boolean {
    return settings.get<boolean>(SettingsKeys.isRecording, true) // default ON
  }
}

export const appState = new AppState()
