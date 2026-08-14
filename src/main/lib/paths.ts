import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

// All Dayflow data lives under %APPDATA%/Dayflow (Electron userData).
// Mirrors macOS ~/Library/Application Support/Dayflow/.

export function dataRoot(): string {
  return app.getPath('userData')
}

export function recordingsDir(): string {
  const dir = join(dataRoot(), 'recordings')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function timelapsesDir(dateStr?: string): string {
  const dir = dateStr
    ? join(dataRoot(), 'timelapses', dateStr)
    : join(dataRoot(), 'timelapses')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function dbPath(): string {
  // Keeps the upstream filename for familiarity ("chunks" is legacy naming).
  return join(dataRoot(), 'chunks.sqlite')
}
