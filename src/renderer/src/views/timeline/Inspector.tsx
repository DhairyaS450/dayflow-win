import { useMemo, useState } from 'react'
import { useStore, categoryColor } from '../../state/store'
import { api, mediaURL } from '../../lib/api'
import { FAILED_TITLE } from './layout'
import categorySwapIcon from '../../assets/images/CategorySwapButton.png'
import SlideshowModal from './SlideshowModal'
import './Inspector.css'

export default function Inspector(): React.JSX.Element {
  const cards = useStore((s) => s.cards)
  const weekCards = useStore((s) => s.weekCards)
  const mode = useStore((s) => s.timelineMode)
  const categories = useStore((s) => s.categories)
  const selectedCardId = useStore((s) => s.selectedCardId)
  const recording = useStore((s) => s.recording)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [slideshowOpen, setSlideshowOpen] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const pool = mode === 'day' ? cards : weekCards
  const card = useMemo(
    () => pool.find((c) => c.id === selectedCardId) ?? null,
    [pool, selectedCardId]
  )

  if (!card) {
    return (
      <div className="inspector-empty">
        {pool.length > 0 ? (
          <span className="inspector-empty-main">Select an activity to view details</span>
        ) : recording.isRecording ? (
          <>
            <span className="inspector-empty-title">No cards yet</span>
            <span className="inspector-empty-body">
              Cards are generated about every 15 minutes. If Dayflow is on and no cards show up
              within 30 minutes, please report a bug.
            </span>
          </>
        ) : (
          <>
            <span className="inspector-empty-title">Recording is off</span>
            <span className="inspector-empty-body">
              Dayflow recording is currently turned off, so cards aren&rsquo;t being produced.
            </span>
          </>
        )}
      </div>
    )
  }

  const failed = card.title === FAILED_TITLE
  const accent = categoryColor(categories, card.category)

  const retry = async (): Promise<void> => {
    if (!card.batchId || retrying) return
    setRetrying(true)
    try {
      await api.batches.reprocessBatch(card.batchId)
    } finally {
      setRetrying(false)
    }
  }

  const deleteCard = async (): Promise<void> => {
    if (!card.recordId) return
    await api.timeline.deleteCard(card.recordId)
    useStore.getState().selectCard(null)
  }

  const changeCategory = async (name: string): Promise<void> => {
    if (!card.recordId) return
    await api.timeline.updateCardCategory(card.recordId, name)
    setPickerOpen(false)
  }

  const detailed =
    card.detailedSummary && card.detailedSummary !== card.summary ? card.detailedSummary : null

  return (
    <div className="inspector">
      {pickerOpen && (
        <div className="inspector-picker">
          <div className="inspector-picker-pills">
            {[...categories].sort((a, b) => (a.name === card.category ? -1 : b.name === card.category ? 1 : 0)).map((cat) => {
              const selected = cat.name.toLowerCase() === card.category.toLowerCase()
              return (
                <button
                  key={cat.id}
                  className={`inspector-picker-pill${selected ? ' selected' : ''}${cat.isIdle && !selected ? ' idle' : ''}`}
                  onClick={() => void changeCategory(cat.name)}
                >
                  <span className="filter-dot" style={{ background: cat.colorHex }} />
                  <span>{cat.name}</span>
                </button>
              )
            })}
          </div>
          <div className="inspector-picker-divider" />
          <p className="inspector-picker-help">
            To help Dayflow organize your activities more accurately, try adding more details to
            the descriptions in your categories.
          </p>
        </div>
      )}

      <div className="inspector-scroll">
        <div className="inspector-header">
          <span className="inspector-title selectable">{card.title}</span>
          <div className="inspector-meta-row">
            <span className="inspector-time-pill">
              {card.startTimestamp} - {card.endTimestamp}
            </span>
            <span className="inspector-flex" />
            {!failed && (
              <>
                <span className="inspector-cat-badge">
                  <span className="filter-dot" style={{ background: accent, width: 8, height: 8 }} />
                  {card.category}
                </span>
                <button className="inspector-swap-btn" onClick={() => setPickerOpen((v) => !v)}>
                  <img src={categorySwapIcon} alt="Change category" width={24} height={24} />
                </button>
              </>
            )}
            {failed && (
              <button
                className={`inspector-retry${retrying ? ' processing' : ''}`}
                onClick={() => void retry()}
              >
                {retrying ? 'Processing' : 'Retry ⟳'}
              </button>
            )}
          </div>
        </div>

        {!failed && (
          <button className="inspector-media" onClick={() => setSlideshowOpen(true)}>
            <div className="inspector-media-thumb">
              {card.videoSummaryURL ? (
                <video src={mediaURL(card.videoSummaryURL)} muted preload="metadata" />
              ) : (
                <div className="inspector-media-placeholder">🖼</div>
              )}
            </div>
            <span className="inspector-play">▶</span>
          </button>
        )}

        <div className="inspector-summary selectable">
          <span className="inspector-section-header">SUMMARY</span>
          <p className="inspector-summary-text">{card.summary}</p>
          {detailed && (
            <>
              <span className="inspector-section-header">DETAILED SUMMARY</span>
              <p className="inspector-summary-text pre">{formatDetailed(detailed)}</p>
            </>
          )}
        </div>
      </div>

      <div className="inspector-rate-footer">
        {deleteArmed ? (
          <button
            className="inspector-delete confirm"
            onClick={() => void deleteCard()}
            onBlur={() => setDeleteArmed(false)}
          >
            Confirm
          </button>
        ) : (
          <button
            className="inspector-delete"
            onClick={() => {
              setDeleteArmed(true)
              setTimeout(() => setDeleteArmed(false), 2000)
            }}
          >
            Delete
          </button>
        )}
        <span className="inspector-flex" />
        <span className="inspector-rate-label">Rate this summary</span>
        <button className="inspector-thumb" title="Good summary">
          👍
        </button>
        <button className="inspector-thumb down" title="Bad summary">
          👎
        </button>
      </div>

      {slideshowOpen && card.startTs && card.endTs && (
        <SlideshowModal
          title={card.title}
          startTs={card.startTs}
          endTs={card.endTs}
          videoPath={card.videoSummaryURL}
          onClose={() => setSlideshowOpen(false)}
        />
      )}
    </div>
  )
}

/** Insert newlines before time ranges in single-paragraph detailed summaries. */
function formatDetailed(text: string): string {
  if (text.includes('\n')) return text
  return text.replace(/(?!^)(\d{1,2}:\d{2}\s?[AP]M\s?-\s?\d{1,2}:\d{2}\s?[AP]M)/g, '\n$1')
}
