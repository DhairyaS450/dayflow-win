import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import './ClaudeAuthBanner.css'

// Shown when the Claude CLI login has expired. Gives the user a one-click path
// back: open a terminal running `claude auth login`, then re-check and retry
// any batches that failed while signed out.

export default function ClaudeAuthBanner(): React.JSX.Element | null {
  const [needsAuth, setNeedsAuth] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async (): Promise<boolean> => {
    const provider = await api.settings.get<string>('selectedLLMProvider', 'gemini')
    if (provider !== 'chatgpt_claude') {
      setNeedsAuth(false)
      return true
    }
    const state = await api.providers.claudeAuth()
    const ok = state.installed && state.loggedIn
    setNeedsAuth(!ok)
    return ok
  }, [])

  useEffect(() => {
    void check()
    const off = api.on('claude:authRequired', () => setNeedsAuth(true))
    const timer = window.setInterval(() => void check(), 60_000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [check])

  if (!needsAuth) return null

  const signIn = async (): Promise<void> => {
    const res = await api.providers.claudeLogin()
    setMessage(res.message)
  }

  const retry = async (): Promise<void> => {
    setChecking(true)
    try {
      const ok = await check()
      if (ok) {
        setMessage(null)
        await api.analysisTriggerNow()
      } else {
        setMessage('Still signed out — finish the sign-in in the terminal window, then press Retry.')
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="claude-auth-banner">
      <span className="cab-dot" />
      <div className="cab-text">
        <span className="cab-title">Your Claude sign-in expired</span>
        <span className="cab-sub">
          {message ??
            'Dayflow can’t generate new timeline cards until you sign in again. Your recordings are safe and will be processed after you do.'}
        </span>
      </div>
      <button className="cab-primary" onClick={() => void signIn()}>
        Sign in to Claude
      </button>
      <button className="cab-secondary" disabled={checking} onClick={() => void retry()}>
        {checking ? 'Checking…' : 'Retry'}
      </button>
    </div>
  )
}
