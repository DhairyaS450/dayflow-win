import { useEffect, useRef, useState } from 'react'
import { api, mediaURL } from '../../lib/api'
import { formatHMMA } from '../../lib/time'
import type { Screenshot } from '../../../../shared/types'
import './SlideshowModal.css'

// Screenshot slideshow / timelapse playback modal.

const SPEEDS = [20, 40, 60]

export default function SlideshowModal(props: {
  title: string
  startTs: number
  endTs: number
  videoPath: string | null
  onClose: () => void
}): React.JSX.Element {
  const [shots, setShots] = useState<Screenshot[]>([])
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    void api.timeline.screenshotsInRange(props.startTs, props.endTs).then((s) => {
      if (s.length === 0) setError('No screenshots are available for this activity range.')
      setShots(s)
    })
  }, [props.startTs, props.endTs])

  // Playback: advance through screenshots in capture-time order, scaled by speed.
  useEffect(() => {
    if (!playing || shots.length < 2) return
    const speed = SPEEDS[speedIdx]
    const current = shots[frame]
    const next = shots[(frame + 1) % shots.length]
    const gap =
      frame + 1 < shots.length ? Math.max(0.2, next.capturedAt - current.capturedAt) : 1
    const delay = (gap / speed) * 1000
    timerRef.current = window.setTimeout(() => {
      setFrame((f) => (f + 1) % shots.length)
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [playing, frame, shots, speedIdx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const current = shots[frame]

  return (
    <div className="ssm-scrim" onClick={props.onClose}>
      <div className="ssm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssm-header">
          <div>
            <div className="ssm-title">{props.title}</div>
            <div className="ssm-subtitle">
              {formatHMMA(props.startTs)} to {formatHMMA(props.endTs)}
            </div>
          </div>
          <button className="ssm-close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="ssm-stage" onClick={() => setPlaying((p) => !p)}>
          {props.videoPath ? (
            <video
              src={mediaURL(props.videoPath)}
              autoPlay
              loop
              controls
              className="ssm-video"
            />
          ) : error ? (
            <span className="ssm-error">{error}</span>
          ) : current ? (
            <img src={mediaURL(current.filePath)} alt="" className="ssm-frame" />
          ) : (
            <span className="ssm-loading">Preparing timelapse...</span>
          )}
          {!props.videoPath && !playing && current && (
            <span className="ssm-play-overlay">▶</span>
          )}
          {!props.videoPath && current && (
            <button
              className="ssm-speed-chip"
              onClick={(e) => {
                e.stopPropagation()
                setSpeedIdx((i) => (i + 1) % SPEEDS.length)
              }}
            >
              {SPEEDS[speedIdx]}x
            </button>
          )}
        </div>
        {!props.videoPath && shots.length > 1 && (
          <div className="ssm-scrubber">
            <input
              type="range"
              min={0}
              max={shots.length - 1}
              value={frame}
              onChange={(e) => {
                setPlaying(false)
                setFrame(Number(e.target.value))
              }}
            />
            <span className="ssm-time-chip">
              {current ? formatHMMA(current.capturedAt) : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
