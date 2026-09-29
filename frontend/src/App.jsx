import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeFace, detectFaces } from './api/client'
import { HowItWorks } from './components/HowItWorks'
import { useCamera } from './hooks/useCamera'
import { useElapsed } from './hooks/useElapsed'
import { rejectionReason } from './lib/analysis'
import { comparisonOf, heldFrom } from './lib/comparison'
import { rotateAndCrop } from './lib/imageTransform'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { ComparePickScreen } from './screens/ComparePickScreen'
import { CompareScreen } from './screens/CompareScreen'
import { CameraBlockedScreen } from './screens/CameraBlockedScreen'
import { CameraReviewScreen } from './screens/CameraReviewScreen'
import { CameraScreen } from './screens/CameraScreen'
import { CropScreen } from './screens/CropScreen'
import { FacePickerScreen } from './screens/FacePickerScreen'
import { ProblemScreen } from './screens/ProblemScreen'
import { UploadScreen } from './screens/UploadScreen'
import { VerdictScreen } from './screens/VerdictScreen'

/**
 * There is one flow through VeraLens, so this is a state machine rather than a
 * router: thirteen screens, one of which is on screen at a time. No URL is
 * worth deep-linking to — a verdict only exists for as long as the photo
 * that produced it is still in the browser.
 *
 *   idle ─┬─ (file chosen) ─────────────────────→ analyzing ─┬────────────→ verdict ─┬→ (compare with
 *         ├─ (straighten first) → crop → (use) ─→ analyzing  ├→ face-pick ─┘         │   another) ──┐
 *         ├─ camera → review ───────────────────→ analyzing  ├→ problem             │               │
 *         ├─ camera-blocked                                  └→ idle                │               │
 *         │                    ▲                                        ▲           │               │
 *         │                    └────────────────────────────────────────┴───────────┘               │
 *         └─ compare-pick (both at once) → analyzing A → comparing ──────────────────────────────────┤
 *                                                            │                                        │
 *                                            (B lands) → compare ←────────────────────────────────────┘
 *
 * Two ways into a Comparison, one mechanism. `held` is an Analysis parked
 * aside — exactly one, never a list — and it is what makes the next response
 * route to `compare` instead of `verdict`. Choosing both photos up front only
 * changes when the slot is filled: `queued` holds the second file, and the
 * first response fills `held` and starts the second run in the background so
 * photo A's verdict is readable while photo B is still going. There is no
 * history screen and nothing is persisted — a Comparison dies with the tab.
 *
 * `analyzing` covers two backend requests, not one: /detect (sub-second) and
 * then /analyze (the 60-90 second half). Both show the same screen — the gap
 * is too short to be worth a state of its own — except when /detect finds
 * more than one face, which is what `face-pick` is for. The queued second
 * photo (compare-two-up-front) never reaches `face-pick`: there is no screen
 * free to interrupt into while photo A's verdict is on screen, so it silently
 * keeps the leftmost face, the same way the single-face path always did.
 *
 * `crop` is the only phase that runs before /detect rather than after a file
 * is chosen — it is reached only from the "Straighten first" card, and not
 * opening it sends the photo exactly as it always has.
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
  // 'comparing' shows photo A's verdict while photo B is still running, so the
  // clock has to keep going past the analyzing screen.
  const elapsed = useElapsed(phase === 'analyzing' || phase === 'comparing' ? startedAt : null)

  // A ref beside the state because runAnalysis reads it at the moment the
  // response lands, and a closure captured before "compare with another" was
  // pressed would still think this is a first Analysis.
  const heldRef = useRef(null)
  const hold = useCallback((next) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  // The second photo, chosen at the same time as the first and waiting its
  // turn. A ref for the same reason as `held`: runAnalysis reads it when the
  // first response lands, not when the callback was made.
  const [queued, setQueued] = useState(null)
  const queuedRef = useRef(null)

  // Set only while phase is 'face-pick': the subject /detect ran on, its
  // token, and the faces it found. Read once, by whichever face is chosen.
  const [detected, setDetected] = useState(null)

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
      // Never free the held photo. During a Comparison the outgoing `photo`
      // and the parked one are briefly the same object, and revoking here
      // would blank photo A's preview on the comparison screen.
      if (previous && previous !== heldRef.current?.photo) URL.revokeObjectURL(previous.url)
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
  const runAnalysisRef = useRef(null)
  const analyzeChosenFaceRef = useRef(null)

  /**
   * The slow half: /analyze on one already-chosen face. Split out of
   * runAnalysis() so the fast /detect step and this one can sit either side
   * of `face-pick` without duplicating the comparison bookkeeping (holding,
   * queuing the second photo) that only belongs here.
   */
  const analyzeChosenFace = useCallback(
    // `background`: photo B runs while photo A's verdict is on screen, so it
    // must not claim the analyzing screen or clear the result being read.
    // Failure still takes over — a problem screen is the point of a problem.
    async (subject, token, faceIndex, { background = false } = {}) => {
      if (!background) {
        setResult(null)
        setProblem(null)
        setPhase('analyzing')
      }
      setDetected(null)
      // The clock starts here, not when /detect was sent — a demo timing a
      // 90-second wait should not have a fraction of a second's detection
      // request counted against it.
      setStartedAt(performance.now())

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const analysis = await analyzeFace(token, faceIndex, { signal: controller.signal })
        const second = queuedRef.current

        if (second) {
          // Both photos were chosen up front and this was the first. Park it,
          // put its verdict on screen, and start the second behind it: the
          // backend serialises anyway, so the only thing overlapping is the
          // reading.
          queuedRef.current = null
          setQueued(null)
          hold(heldFrom(subject, analysis))
          setResult(analysis)
          setPhase('comparing')
          runAnalysisRef.current?.(adopt(second, false), { background: true })
          return
        }

        setResult(analysis)
        // Holding an Analysis is what makes this the second half of a
        // Comparison. Nothing else distinguishes the two runs.
        setPhase(heldRef.current ? 'compare' : 'verdict')
      } catch (error) {
        if (error.kind === 'aborted') return
        setProblem({ kind: error.kind, detail: error.message })
        setPhase('problem')
      } finally {
        abortRef.current = null
      }
    },
    [adopt, hold],
  )
  useEffect(() => {
    analyzeChosenFaceRef.current = analyzeChosenFace
  }, [analyzeChosenFace])

  /**
   * The fast half: /detect, then either straight on to analyzeChosenFace()
   * (zero or one face — zero surfaces as the same 'no_face' problem it always
   * has) or, foreground only, a stop at `face-pick` for more than one.
   */
  const runAnalysis = useCallback(
    async (subject, { background = false } = {}) => {
      if (!background) {
        setResult(null)
        setProblem(null)
        setPhase('analyzing')
      }

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const { token, faces } = await detectFaces(subject.file, { signal: controller.signal })
        abortRef.current = null

        if (faces.length > 1 && !background) {
          setDetected({ subject, token, faces })
          setPhase('face-pick')
          return
        }
        await analyzeChosenFaceRef.current?.(subject, token, faces[0].index, { background })
      } catch (error) {
        if (error.kind === 'aborted') return
        setProblem({ kind: error.kind, detail: error.message })
        setPhase('problem')
      } finally {
        abortRef.current = null
      }
    },
    [],
  )
  // Assigned in an effect rather than during render. Every caller is a click
  // handler or a settled promise, so the ref is always populated by then.
  useEffect(() => {
    runAnalysisRef.current = runAnalysis
  }, [runAnalysis])

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
    queuedRef.current = null
    setQueued(null)
    setDetected(null)
    setResult(null)
    setProblem(null)
    setRejection(null)
    setPhase('idle')
  }, [camera, hold])

  /**
   * Both photos at once. The queue is what makes the first response route to
   * 'comparing' rather than 'verdict'; nothing else about the two runs differs
   * from a single analysis.
   */
  const analyseBoth = useCallback(
    (fileA, fileB) => {
      queuedRef.current = fileB
      setQueued(fileB)
      runAnalysisRef.current?.(adopt(fileA, false))
    },
    [adopt],
  )

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
    // Reachable while photo B is still in flight, so the request has to go too.
    abortRef.current?.abort()
    queuedRef.current = null
    setQueued(null)
    setDetected(null)
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
    setDetected(null)
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

  /** The "Straighten first" card: chooses a photo but holds it at `crop`
   *  instead of running analysis on it straight away. */
  const onFileForCrop = useCallback(
    (file) => {
      const reason = rejectionReason(file)
      if (reason) {
        setRejection(reason)
        setPhase('idle')
        return
      }
      setRejection(null)
      adopt(file, false)
      setPhase('crop')
    },
    [adopt],
  )

  /** CropScreen's "Use this crop": rotates and crops the held photo, adopts
   *  the result as the new photo, and only then runs the real analysis. */
  const useThisCrop = useCallback(
    async ({ rotationDegrees, frameWidthFraction, frameHeightFraction }) => {
      if (!photo) return
      const transformed = await rotateAndCrop(photo.file, {
        rotationDegrees,
        frameWidthFraction,
        frameHeightFraction,
      })
      runAnalysis(adopt(transformed, false))
    },
    [adopt, photo, runAnalysis],
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
          onFileForCrop={onFileForCrop}
          onUseCamera={openCamera}
          onCompareTwo={() => setPhase('compare-pick')}
          rejection={rejection}
          held={held}
          onAbandonHeld={abandonComparison}
          {...help}
        />
      )}

      {phase === 'crop' && photo && (
        <CropScreen previewUrl={photo.url} onUse={useThisCrop} onCancel={restart} {...help} />
      )}

      {phase === 'compare-pick' && (
        <ComparePickScreen
          onAnalyseBoth={analyseBoth}
          onSinglePhoto={() => setPhase('idle')}
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
          queuedName={queued?.name}
          onCancel={() => {
            abortRef.current?.abort()
            setPhase('idle')
          }}
          {...help}
        />
      )}

      {phase === 'face-pick' && detected && (
        <FacePickerScreen
          previewUrl={detected.subject.url}
          faces={detected.faces}
          onChoose={(faceIndex) =>
            analyzeChosenFaceRef.current?.(detected.subject, detected.token, faceIndex)
          }
          onCancel={restart}
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

      {phase === 'comparing' && held && result && (
        <VerdictScreen
          result={result}
          previewUrl={held.photo.url}
          pending={{ name: photo?.file.name, elapsed, onStop: abandonComparison }}
          onRestart={restart}
          onRetry={() => photo && runAnalysis(photo)}
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
