import { safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { app } from 'electron'

// API key store — DPAPI-encrypted via Electron safeStorage (Windows equivalent
// of the macOS Keychain usage upstream). Never log key material.

type SecretsMap = Record<string, string> // provider id -> base64(encrypted)

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function load(): SecretsMap {
  try {
    return JSON.parse(readFileSync(secretsPath(), 'utf-8')) as SecretsMap
  } catch {
    return {}
  }
}

function persist(map: SecretsMap): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(secretsPath(), JSON.stringify(map), 'utf-8')
}

export const secrets = {
  store(provider: string, value: string): boolean {
    try {
      const map = load()
      if (safeStorage.isEncryptionAvailable()) {
        map[provider] = safeStorage.encryptString(value).toString('base64')
      } else {
        map[provider] = Buffer.from(value, 'utf-8').toString('base64')
      }
      persist(map)
      return true
    } catch (err) {
      console.error('[secrets] store failed', err)
      return false
    }
  },
  retrieve(provider: string): string | null {
    try {
      const map = load()
      const enc = map[provider]
      if (!enc) return null
      const buf = Buffer.from(enc, 'base64')
      if (safeStorage.isEncryptionAvailable()) {
        try {
          return safeStorage.decryptString(buf)
        } catch {
          return buf.toString('utf-8') // stored unencrypted fallback
        }
      }
      return buf.toString('utf-8')
    } catch {
      return null
    }
  },
  delete(provider: string): void {
    try {
      const map = load()
      delete map[provider]
      persist(map)
    } catch {
      /* ignore */
    }
  },
  exists(provider: string): boolean {
    return this.retrieve(provider) !== null
  }
}
