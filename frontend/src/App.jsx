import { useCallback, useRef, useState } from 'react'
import { analyze } from './api/client'
import { HowItWorks } from './components/HowItWorks'
import { useCamera } from './hooks/useCamera'
import { useElapsed } from './hooks/useElapsed'
import { rejectionReason } from './lib/analysis'
import { comparisonOf, heldFrom } from './lib/comparison'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { CompareScreen } from './screens/CompareScreen'
import { CameraBlockedScreen } from './screens/CameraBlockedScreen'
import { CameraReviewScreen } from './screens/CameraReviewScreen'
import { CameraScreen } from './screens/CameraScreen'
import { ProblemScreen } from './screens/ProblemScreen'
import { UploadScreen } from './screens/UploadScreen'
import { VerdictScreen } from './screens/VerdictScreen'

/**
 * There is one flow through VeraLens, so this is a state machine rather than a
 * router: nine screens, one of which is on screen at a time. No URL is worth
 * deep-linking to — a verdict only exists for as long as the photo that
 * produced it is still in the browser.
 *
 *   idle ─┬─ (file chosen) ───────────────→ analyzing ─┬→ verdict ──┐
 *         └─ camera → review ─────────────→ analyzing  ├→ compare   │
 *         └─ camera-blocked                            ├→ problem   │
 *                    ▲                                 └→ idle      │
 *                    └─────────── "compare with another" ───────────┘
 *
 * A Comparison is the one branch that needs two Analyses alive at once, and
 * `held` is the whole of that: exactly one parked aside, never a list. There is
 * no history screen and nothing is persisted — held dies with the tab, like
 * every other Analysis here.
 */
export default function App() {
  const [phase, setPhase] = useState('idle')
  const [photo, setPhoto] = useState(null)
  const [result, setResult] = useState(null)
  const [held, setHeld] = useState(null)
  const [problem, setProblem] = useState(null)
  const [rejection, setRejection] = useState(null)
  const [blockReason, setBlockReason] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [startedAt, setStartedAt] = useState(null)

  const camera = useCamera()
  const abortRef = useRef(null)
  const elapsed = useElapsed(phase === 'analyzing' ? startedAt : null)

  // A ref beside the state because runAnalysis reads it at the moment the
  // response lands, and a closure captured before "compare with another" was
  // pressed would still think this is a first Analysis.
  const heldRef = useRef(null)
  const hold = useCallback((next) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  // One object URL at a time. The browser holds the only copy of the submitted
  // photo — the backend keeps the Face Crop and the heatmap, never the original.
  const adopt = useCallback((file, fromCamera) => {
    const next = {
      file,
      url: URL.createObjectURL(file),
      fromCamera,
      capturedAt: new Date().toTimeString().slice(0, 5),
    }
    setPhoto((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return next
    })
    return next
  }, [])

  /**
   * Always called from a click handler, never from an effect: StrictMode
   * double-invokes effects in development, and the backend serialises the GPU,
   * so a duplicated POST would queue a second 70-second analysis behind the
   * first rather than being deduplicated.
   */
  const runAnalysis = useCallback(async (subject) => {
    setResult(null)
    setProblem(null)
    setStartedAt(performance.now())
    setPhase('analyzing')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const analysis = await analyze(subject.file, { signal: controller.signal })
      setResult(analysis)
      // Holding an Analysis is what makes this the second half of a Comparison.
      // Nothing else distinguishes the two runs.
      setPhase(heldRef.current ? 'compare' : 'verdict')
    } catch (error) {
      if (error.kind === 'aborted') return
      setProblem({ kind: error.kind, detail: error.message })
      setPhase('problem')
    } finally {
      abortRef.current = null
    }
  }, [])

  const restart = useCallback(() => {
    abortRef.current?.abort()
    camera.stop()
    setPhoto((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
    // The held photo's object URL is the browser's only copy of it, and
    // nothing else will free it — restart is where a Comparison ends.
    if (heldRef.current) URL.revokeObjectURL(heldRef.current.photo.url)
    hold(null)
    setResult(null)
    setProblem(null)
    setRejection(null)
    setPhase('idle')
  }, [camera, hold])

  /**
   * Park this Analysis and go back for a second photo. `photo` is cleared
   * without revoking its URL — the held slot owns it now, and adopt() only
   * revokes what is still in `photo`.
   */
  const startComparison = useCallback(() => {
    if (!photo || !result) return
    hold(heldFrom(photo, result))
    setPhoto(null)
    setResult(null)
    setRejection(null)
    setPhase('idle')
  }, [hold, photo, result])

  /** Give up on the second photo and go back to the first one's verdict. */
  const abandonComparison = useCallback(() => {
    const parked = heldRef.current
    if (!parked) return restart()
    setPhoto((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return parked.photo
    })
    setResult(parked.result)
    hold(null)
    setProblem(null)
    setPhase('verdict')
  }, [hold, restart])

  /** Keep the held Analysis, drop the failed second photo, choose another. */
  const retrySecondPhoto = useCallback(() => {
    setPhoto((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
    setResult(null)
    setProblem(null)
    setPhase('idle')
  }, [])

  const onFile = useCallback(
    (file) => {
      const reason = rejectionReason(file)
      if (reason) {
        setRejection(reason)
        setPhase('idle')
        return
      }
      setRejection(null)
      runAnalysis(adopt(file, false))
    },
    [adopt, runAnalysis],
  )

  const openCamera = useCallback(async () => {
    setRejection(null)
    const outcome = await camera.start()
    if (!outcome.ok) {
      setBlockReason(outcome.reason)
      setPhase('camera-blocked')
      return
    }
    setPhase('camera')
  }, [camera])

  const onCapture = useCallback(
    async (video) => {
      const file = await camera.capture(video)
      camera.stop()
      if (!file) return
      adopt(file, true)
      setPhase('review')
    },
    [adopt, camera],
  )

  const help = { onHowItWorks: () => setHelpOpen(true) }

  return (
    <>
      {phase === 'idle' && (
        <UploadScreen
          onFile={onFile}
          onUseCamera={openCamera}
          rejection={rejection}
          held={held}
          onAbandonHeld={abandonComparison}
          {...help}
        />
      )}

      {phase === 'camera' && (
        <CameraScreen
          stream={camera.stream}
          onCapture={onCapture}
          onCancel={restart}
          {...help}
        />
      )}

      {phase === 'camera-blocked' && (
        <CameraBlockedScreen
          reason={blockReason}
          onChooseFile={restart}
          onRetry={openCamera}
          {...help}
        />
      )}

      {phase === 'review' && photo && (
        <CameraReviewScreen
          previewUrl={photo.url}
          capturedAt={photo.capturedAt}
          onAnalyse={() => runAnalysis(photo)}
          onRetake={openCamera}
          onChooseFile={restart}
          {...help}
        />
      )}

      {phase === 'analyzing' && photo && (
        <AnalyzingScreen
          fileName={photo.file.name}
          elapsed={elapsed}
          onCancel={() => {
            abortRef.current?.abort()
            setPhase('idle')
          }}
          {...help}
        />
      )}

      {phase === 'verdict' && result && (
        <VerdictScreen
          result={result}
          previewUrl={photo?.url}
          onRestart={restart}
          onRetry={() => photo && runAnalysis(photo)}
          onCompare={startComparison}
          {...help}
        />
      )}

      {phase === 'compare' && held && result && photo && (
        <CompareScreen
          comparison={comparisonOf(held, photo, result)}
          onRestart={restart}
          {...help}
        />
      )}

      {phase === 'problem' && problem && (
        <ProblemScreen
          kind={problem.kind}
          detail={problem.detail}
          fileName={photo?.file.name}
          fromCamera={photo?.fromCamera}
          // With an Analysis held, "choose another" must not be `restart` —
          // that revokes photo A's object URL and ends the Comparison.
          onChooseAnother={
            held ? retrySecondPhoto : photo?.fromCamera ? openCamera : restart
          }
          onRetry={() => photo && runAnalysis(photo)}
          held={held}
          onAbandonHeld={abandonComparison}
          {...help}
        />
      )}

      <HowItWorks open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}
