import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeFace, detectFaces } from './api/client'
import { HowItWorks } from './components/HowItWorks'
import { useBatch } from './hooks/useBatch'
import { useCamera } from './hooks/useCamera'
import { useElapsed } from './hooks/useElapsed'
import { rejectionReason } from './lib/analysis'
import { counts } from './lib/batch'
import { comparisonOf, heldFrom } from './lib/comparison'
import { canDrawAgain, drawsOf, isDrawOf } from './lib/draws'
import { recommendedFaceIndex } from './lib/faces'
import { rotateAndCrop } from './lib/imageTransform'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { BatchScreen } from './screens/BatchScreen'
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
 * then /analyze (the slow half: a minute at the median). Both show the same screen — the gap
 * is too short to be worth a state of its own — except when /detect finds
 * more than one face, which is what `face-pick` is for. The queued second
 * photo (compare-two-up-front) never reaches `face-pick`: there is no screen
 * free to interrupt into while photo A's verdict is on screen, so it takes
 * the recommended face, the same way the single-face path always did.
 *
 * Which means a Comparison's two sides can reach the same screen by different
 * routes: via ComparePickScreen, B is auto-picked while A was chosen; via
 * hold-then-analyse, both were chosen. Neither screen claims which happened.
 * Both name the face they describe instead, which is the fact that matters
 * and the only one a stored Analysis can actually vouch for.
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

  // Draws of the Analysis on the verdict screen (CONTEXT.md, "Draw"). Draw 1
  // is `result` itself; these are the later attempts, each one of
  // { status: 'drawn' | 'mismatch' | 'failed', result?, detail? } — only
  // 'drawn' ones count, see lib/draws.js. They belong to the one Analysis on
  // screen and go when it does: a new Analysis, restarting, or holding it
  // for a Comparison (which carries the Analysis as first shown) all clear
  // them.
  // A Batch (CONTEXT.md). Its queue runs in useBatch, here rather than on the
  // table screen, because it keeps running while one of its rows is open.
  const batch = useBatch()
  const [openRowId, setOpenRowId] = useState(null)
  const openRow =
    phase === 'batch-row' ? batch.rows.find((row) => row.id === openRowId && row.status === 'done') : null
  // The queue holds the graphics card while it runs; Draws and re-runs of a
  // row wait for it to finish, pause or stop.
  const batchBusy = batch.stage === 'running' || batch.stage === 'stopping'

  const [drawEntries, setDrawEntries] = useState([])
  const [drawStartedAt, setDrawStartedAt] = useState(null)
  const drawAbortRef = useRef(null)
  const drawIdRef = useRef(0)
  const drawElapsed = useElapsed(drawStartedAt)

  const clearDraws = useCallback(() => {
    drawAbortRef.current?.abort()
    drawAbortRef.current = null
    setDrawStartedAt(null)
    setDrawEntries([])
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
        clearDraws()
      }
      setDetected(null)
      // The clock starts here, not when /detect was sent — a demo timing a
      // 90-second wait should not have a fraction of a second's detection
      // request counted against it.
      setStartedAt(performance.now())

      const controller = new AbortController()
      abortRef.current = controller

      try {
        // The backend echoes face_index (ADR 0012); a backend started before
        // that change does not, and the browser knows the answer anyway —
        // it just sent it. The response wins wherever it has one.
        const analysis = {
          face_index: faceIndex,
          ...(await analyzeFace(token, faceIndex, { signal: controller.signal })),
        }
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
    [adopt, hold, clearDraws],
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
        await analyzeChosenFaceRef.current?.(subject, token, recommendedFaceIndex(faces), {
          background,
        })
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
    clearDraws()
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
  }, [camera, clearDraws, hold])

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
    // A Comparison compares Verdicts, and Draws never change a Verdict — so
    // the held Analysis travels as first shown and its Draws stay here.
    clearDraws()
    hold(heldFrom(photo, result))
    setPhoto(null)
    setResult(null)
    setRejection(null)
    setPhase('idle')
  }, [clearDraws, hold, photo, result])

  /**
   * Ask the reasoning layer again about the Analysis on screen.
   *
   * Re-submits the photo rather than calling a draw-only endpoint: the upload
   * is gone after /analyze (ADR 0012's token is single-use), and a second
   * held-state store on the server buys nothing the check below does not.
   * The classifier and detector re-run too — both deterministic — so the
   * result is only a Draw of this Analysis if its classifier score matches.
   * If it does not, the page says so instead of presenting a different face,
   * or a different measurement, as variance.
   *
   * The picker is skipped: the face was chosen when the Analysis was made,
   * and a Draw asks again about that face, not about the photo.
   */
  const drawSubject = useMemo(
    () =>
      openRow
        ? { analysis: openRow.result, file: openRow.file }
        : result && photo
          ? { analysis: result, file: photo.file }
          : null,
    [openRow, result, photo],
  )

  const drawAgain = useCallback(async () => {
    if (!drawSubject) return
    const { analysis, file } = drawSubject
    if (!canDrawAgain(drawsOf(analysis, drawEntries), drawAbortRef.current !== null)) return

    const id = ++drawIdRef.current
    const controller = new AbortController()
    drawAbortRef.current = controller
    setDrawStartedAt(performance.now())

    try {
      const { token } = await detectFaces(file, { signal: controller.signal })
      const candidate = await analyzeFace(token, analysis.face_index ?? 0, {
        signal: controller.signal,
      })
      // Aborted after the response had already landed — restart, hold, or a
      // new Analysis. The Analysis this was a Draw of is gone, and its entry
      // must not appear under whichever one replaced it.
      if (controller.signal.aborted) return
      setDrawEntries((previous) => [
        ...previous,
        { id, status: isDrawOf(analysis, candidate) ? 'drawn' : 'mismatch', result: candidate },
      ])
    } catch (error) {
      // A request that failed produced no Draw, so it is shown but not
      // counted — unlike a Draw that ran and produced no explanation.
      if (error.kind !== 'aborted') {
        setDrawEntries((previous) => [...previous, { id, status: 'failed', detail: error.message }])
      }
    } finally {
      if (drawAbortRef.current === controller) {
        drawAbortRef.current = null
        setDrawStartedAt(null)
      }
    }
  }, [drawSubject, drawEntries])

  const startBatch = useCallback(
    (files) => {
      batch.choose(files)
      setPhase('batch')
    },
    [batch],
  )

  const openBatchRow = useCallback(
    (id) => {
      clearDraws()
      setOpenRowId(id)
      setPhase('batch-row')
    },
    [clearDraws],
  )

  const backToBatch = useCallback(() => {
    clearDraws()
    setOpenRowId(null)
    setPhase('batch')
  }, [clearDraws])

  /**
   * Leaving the table discards the Batch: its results live only on this page.
   * Asks first whenever that loses something — results already in, or photos
   * still to run — and says that the one on the graphics card finishes
   * regardless.
   */
  const leaveBatch = useCallback(() => {
    const c = counts(batch.rows)
    const unfinished = ['running', 'stopping', 'paused'].includes(batch.stage) && c.queued > 0
    if (unfinished || c.done > 0) {
      const message = unfinished
        ? 'Stop this upload and leave? Its results live only on this page, so leaving discards them. The photo being analysed now still finishes on the graphics card.'
        : 'Leave this upload? Its results live only on this page, so leaving discards them — export the CSV first to keep them.'
      if (!window.confirm(message)) return
    }
    clearDraws()
    batch.discard()
    setOpenRowId(null)
    setPhase('idle')
  }, [batch, clearDraws])

  /** Stops waiting for a Draw. The GPU finishes it regardless — the same
   *  honest limit the wait screen states — so this only closes the page on it. */
  const cancelDraw = useCallback(() => {
    drawAbortRef.current?.abort()
    drawAbortRef.current = null
    setDrawStartedAt(null)
  }, [])

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
          onBatch={startBatch}
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

      {phase === 'batch' && (
        <BatchScreen
          rows={batch.rows}
          notAdded={batch.notAdded}
          stage={batch.stage}
          onStart={batch.start}
          onStop={batch.stop}
          onResume={batch.resume}
          onRetryFailed={batch.retryFailed}
          onOpen={openBatchRow}
          onLeave={leaveBatch}
          {...help}
        />
      )}

      {phase === 'batch-row' && openRow && (
        <VerdictScreen
          result={openRow.result}
          previewUrl={openRow.url}
          draws={{
            entries: drawEntries,
            inFlight: drawStartedAt !== null,
            elapsed: drawElapsed,
            onDrawAgain: drawAgain,
            onCancel: cancelDraw,
            unavailable: batchBusy
              ? 'Available once this upload has finished, paused or been stopped — the queue is using the graphics card.'
              : null,
          }}
          batch={{
            progress: batchProgress(batch.rows),
            running: batchBusy,
            onBack: backToBatch,
            // A re-run replaces this row's Analysis, so watch it from the
            // table rather than from a verdict that is about to change.
            onRetry:
              batch.stage === 'ended'
                ? () => {
                    batch.rerun(openRow.id)
                    backToBatch()
                  }
                : null,
          }}
          onRestart={backToBatch}
          {...help}
        />
      )}

      {phase === 'verdict' && result && (
        <VerdictScreen
          result={result}
          previewUrl={photo?.url}
          draws={{
            entries: drawEntries,
            inFlight: drawStartedAt !== null,
            elapsed: drawElapsed,
            onDrawAgain: drawAgain,
            onCancel: cancelDraw,
          }}
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

/** "4 of 8 done" — photos that have reached an outcome, of those that were sent. */
function batchProgress(rows) {
  const c = counts(rows)
  return `${c.done + c.noFace + c.failed} of ${rows.length - c.rejected} done`
}
