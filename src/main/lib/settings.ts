import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

// JSON-file settings store — the port's replacement for macOS UserDefaults.
// Synchronous, tiny, safe: writes are atomic-ish (write temp then rename not
// needed at this size; a torn write loses only preferences).

type SettingsMap = Record<string, unknown>

let cache: SettingsMap | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): SettingsMap {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as SettingsMap
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(cache ?? {}, null, 2), 'utf-8')
  } catch (err) {
    console.error('[settings] persist failed', err)
  }
}

export const settings = {
  get<T>(key: string, fallback: T): T {
    const map = load()
    const v = map[key]
    return v === undefined ? fallback : (v as T)
  },
  getOptional<T>(key: string): T | undefined {
    const map = load()
    return map[key] as T | undefined
  },
  set(key: string, value: unknown): void {
    const map = load()
    if (value === undefined) delete map[key]
    else map[key] = value
    persist()
  },
  delete(key: string): void {
    const map = load()
    delete map[key]
    persist()
  },
  all(): SettingsMap {
    return { ...load() }
  }
}

// Settings keys used by the pipeline (parity with upstream UserDefaults keys)
export const SettingsKeys = {
  screenshotIntervalSeconds: 'screenshotIntervalSeconds',
  isRecording: 'isRecording',
  showDockIcon: 'showDockIcon',
  didOnboard: 'didOnboard',
  lastRunBuild: 'lastRunBuild',
  idleResetSecondsOverride: 'idleResetSecondsOverride',
  idleResetMinutes: 'idleResetMinutes',
  privacyBlockedApps: 'recordingPrivacyBlockedApplicationIdentifiers',
  privacyDidSeedDefaults: 'recordingPrivacyDidSeedDefaultSecretApps',
  saveTimelapses: 'saveTimelapsesToDisk',
  launchAtLogin: 'launchAtLogin'
} as const
