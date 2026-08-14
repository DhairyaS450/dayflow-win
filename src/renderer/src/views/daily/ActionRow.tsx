// Action row — copy, regenerate, provider gear + picker popover (spec §2.5, §2.9).

import { useEffect, useRef, useState } from 'react'
import {
  DAILY_PROVIDERS,
  NO_PROVIDER_SELECTED_MESSAGE,
  providerAvailability,
  providerMeta,
  type DailyRecapProviderId,
  type ProviderAvailabilityMap
} from './dailyModel'
import copyIcon from '../../assets/images/Copy.svg'
import './ActionRow.css'

export type RegenState = 'idle' | 'regenerating' | 'regenerated' | 'noData'

interface ActionRowProps {
  hasEntry: boolean
  provider: DailyRecapProviderId
  availability: ProviderAvailabilityMap | null
  availabilityLoading: boolean
  regenState: RegenState
  onCopy: () => Promise<void> | void
  onRegenerate: () => void
  onSelectProvider: (id: DailyRecapProviderId) => void
  onRefreshAvailability: () => void
}

export default function ActionRow({
  hasEntry,
  provider,
  availability,
  availabilityLoading,
  regenState,
  onCopy,
  onRegenerate,
  onSelectProvider,
  onRefreshAvailability
}: ActionRowProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dots, setDots] = useState('.')
  const anchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (regenState !== 'regenerating') return
    const t = setInterval(() => {
      setDots((d) => (d === '...' ? '.' : d + '.'))
    }, 450)
    return () => clearInterval(t)
  }, [regenState])

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const copy = async (): Promise<void> => {
    await onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const currentAvail = providerAvailability(provider, availability)
  const regenDisabled =
    provider === 'none' || !currentAvail.isAvailable || regenState === 'regenerating'
  const regenTooltip =
    provider === 'none'
      ? NO_PROVIDER_SELECTED_MESSAGE
      : !currentAvail.isAvailable
        ? currentAvail.detail
        : 'Regenerate standup highlights'

  const regenLabel =
    regenState === 'regenerating'
      ? `Regenerating${dots}`
      : regenState === 'regenerated'
        ? 'Regenerated'
        : regenState === 'noData'
          ? 'No data'
          : 'Regenerate'

  return (
    <div className="ar-row">
      {hasEntry && (
        <button className="ar-pill ar-copy" onClick={() => void copy()}>
          <span className="ar-icon-slot">
            {copied ? (
              <span className="ar-check">✓</span>
            ) : (
              <img className="ar-copy-icon" src={copyIcon} alt="" />
            )}
          </span>
          <span className="ar-label ar-copy-label">{copied ? 'Copied' : 'Copy standup update'}</span>
        </button>
      )}
      <button
        className="ar-pill ar-regen"
        disabled={regenDisabled}
        title={regenTooltip}
        onClick={onRegenerate}
      >
        <span className="ar-icon-slot">
          {regenState === 'regenerating' ? (
            <span className="ar-spinner" />
          ) : regenState === 'regenerated' ? (
            <span className="ar-check">✓</span>
          ) : regenState === 'noData' ? (
            <span className="ar-check">!</span>
          ) : (
            <span className="ar-refresh">⟳</span>
          )}
        </span>
        <span className="ar-label ar-regen-label">{regenLabel}</span>
      </button>
      <div className="ar-gear-anchor" ref={anchorRef}>
        <button
          className="ar-gear"
          disabled={regenState === 'regenerating'}
          title={`Daily recap provider: ${providerMeta(provider).selectionLabel}`}
          onClick={() => {
            const opening = !pickerOpen
            setPickerOpen(opening)
            if (opening) onRefreshAvailability()
          }}
        >
          <GearIcon />
        </button>
        {pickerOpen && (
          <div className="ar-popover">
            <div className="ar-popover-header">
              <div>
                <div className="ar-popover-title">Daily recap provider</div>
                <div className="ar-popover-sub">
                  Choose how Daily generates this recap, or turn generation off.
                </div>
              </div>
              {availabilityLoading && <span className="ar-spinner ar-spinner-brown" />}
            </div>
            <div className="ar-popover-rows">
              {DAILY_PROVIDERS.map((p) => {
                const avail = providerAvailability(p.id, availability)
                const selected = p.id === provider
                return (
                  <button
                    key={p.id}
                    className="ar-provider-row"
                    data-selected={selected ? 'yes' : 'no'}
                    disabled={!avail.isAvailable && p.id !== 'none'}
                    onClick={() => {
                      onSelectProvider(p.id)
                      setPickerOpen(false)
                    }}
                  >
                    <span className="ar-provider-texts">
                      <span className="ar-provider-name">{p.displayName}</span>
                      <span
                        className="ar-provider-detail"
                        data-unavailable={avail.isAvailable ? 'no' : 'yes'}
                      >
                        {avail.detail}
                      </span>
                    </span>
                    <span className="ar-provider-radio" data-selected={selected ? 'yes' : 'no'}>
                      {selected ? '●' : '○'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GearIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#B46531" aria-hidden>
      <path d="M19.14 12.94a7.5 7.5 0 0 0 .06-.94 7.5 7.5 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.13.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64L4.82 11.06a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.6.22l2.39-.96c.49.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96c.24.1.5 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z" />
    </svg>
  )
}
