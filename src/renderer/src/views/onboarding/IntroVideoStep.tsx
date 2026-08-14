import { useEffect, useRef } from 'react'
import introVideo from '../../assets/videos/DayflowOnboarding.mp4'

// Step 0 — full-bleed intro video. Pauses on the last frame, waits 2s, then
// advances. A Skip button (Windows-port addition) jumps ahead immediately.

export default function IntroVideoStep(props: { onDone: () => void }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const finished = useRef(false)
  const timer = useRef<number | null>(null)

  const finish = (): void => {
    if (finished.current) return
    finished.current = true
    props.onDone()
  }

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const handleEnded = (): void => {
    videoRef.current?.pause()
    timer.current = window.setTimeout(finish, 2000)
  }

  return (
    <div className="ob-video-step">
      <video
        ref={videoRef}
        className="ob-video"
        src={introVideo}
        autoPlay
        muted
        playsInline
        onEnded={handleEnded}
        onError={finish}
      />
      <button className="ob-video-skip" onClick={finish}>
        Skip
      </button>
    </div>
  )
}
