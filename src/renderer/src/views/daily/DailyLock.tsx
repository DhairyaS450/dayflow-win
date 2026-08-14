// Daily lock screen — 3-step access flow (spec §2.2). The macOS notification
// permission step is skipped on Windows (treated as granted), so the flow is
// intro → provider.

import { useMemo, useState } from 'react'
import {
  accessProgressText,
  DAILY_PROVIDERS,
  DAILY_REQUIRED_BATCHES,
  providerAvailability,
  type DailyRecapProviderId,
  type ProviderAvailabilityMap
} from './dailyModel'
import journalPreview from '../../assets/images/JournalPreview.png'
import './DailyLock.css'

const CONFETTI_COLORS = [
  '#FF6B6B',
  '#FFD93D',
  '#6BCB77',
  '#4D96FF',
  '#9B5DE5',
  '#FF8FAB',
  '#00C2FF',
  '#FFA41B',
  '#F72585',
  '#7AE582'
]

interface DailyLockProps {
  completedBatches: number
  step: 'intro' | 'provider'
  provider: DailyRecapProviderId
  availability: ProviderAvailabilityMap | null
  availabilityLoading: boolean
  onGranted: () => void
  onSelectProvider: (id: DailyRecapProviderId) => void
  onContinue: () => void
}

export default function DailyLock({
  completedBatches,
  step,
  provider,
  availability,
  availabilityLoading,
  onGranted,
  onSelectProvider,
  onContinue
}: DailyLockProps): React.JSX.Element {
  const [granted, setGranted] = useState(false)
  const [confettiKey, setConfettiKey] = useState(0)

  const hasMinimum = completedBatches >= DAILY_REQUIRED_BATCHES

  const unlock = (): void => {
    if (!hasMinimum || granted) return
    setGranted(true)
    setConfettiKey((k) => k + 1)
    window.setTimeout(onGranted, 1120)
  }

  const selectedAvail = providerAvailability(provider, availability)
  const continueDisabled = availability === null || availabilityLoading || !selectedAvail.isAvailable

  return (
    <div className="dl-root">
      <img className="dl-bg" src={journalPreview} alt="" />
      <div className="dl-content">
        <div className="dl-header">
          <span className="dl-wordmark">Dayflow Daily</span>
          <span className="dl-beta">BETA</span>
        </div>
        {step === 'intro' ? (
          <div className="dl-intro">
            <p className="dl-notice">
              Daily is a new way to visualize your day and turn it into a standup update fast.
            </p>
            <p className="dl-progress">
              Daily unlocks after 5 hours of analyzed timeline data.{' '}
              {accessProgressText(completedBatches)}
            </p>
            <button
              className="dl-unlock"
              data-granted={granted ? 'yes' : 'no'}
              disabled={!hasMinimum || granted}
              onClick={unlock}
            >
              {granted ? '✓ Daily Unlocked' : 'Unlock Daily'}
            </button>
          </div>
        ) : (
          <div className="dl-provider-panel">
            <h3 className="dl-provider-title">Pick your Daily provider</h3>
            <p className="dl-provider-sub">
              Choose how Daily generates your recap, or turn generation off. You can change this
              later.
            </p>
            {availabilityLoading && <span className="dl-spinner" />}
            <div className="dl-provider-rows">
              {DAILY_PROVIDERS.map((p) => {
                const avail = providerAvailability(p.id, availability)
                const selected = p.id === provider
                return (
                  <button
                    key={p.id}
                    className="dl-provider-row"
                    data-selected={selected ? 'yes' : 'no'}
                    disabled={!avail.isAvailable && p.id !== 'none'}
                    onClick={() => onSelectProvider(p.id)}
                  >
                    <span className="dl-provider-texts">
                      <span className="dl-provider-name">{p.displayName}</span>
                      <span
                        className="dl-provider-detail"
                        data-unavailable={avail.isAvailable ? 'no' : 'yes'}
                      >
                        {avail.detail}
                      </span>
                    </span>
                    <span className="dl-provider-radio" data-selected={selected ? 'yes' : 'no'}>
                      {selected ? '●' : '○'}
                    </span>
                  </button>
                )
              })}
            </div>
            <button className="dl-continue" disabled={continueDisabled} onClick={onContinue}>
              Continue to Daily
            </button>
          </div>
        )}
      </div>
      {confettiKey > 0 && <ConfettiBurst key={confettiKey} />}
    </div>
  )
}

/** Simple CSS confetti burst (spec §2.10, simplified). */
export function ConfettiBurst(): React.JSX.Element {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        x0: Math.random() * 120 - 60,
        x1: Math.random() * 440 - 220,
        x2: Math.random() * 680 - 340,
        y2: 200 + Math.random() * 160,
        spin: Math.random() * 720 - 360,
        delay: Math.random() * 0.12
      })),
    []
  )
  return (
    <div className="dl-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="dl-confetti-piece"
          style={
            {
              background: p.color,
              '--x0': `${p.x0}px`,
              '--x1': `${p.x1}px`,
              '--x2': `${p.x2}px`,
              '--y2': `${p.y2}px`,
              '--spin': `${p.spin}deg`,
              animationDelay: `${p.delay}s`
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
