import { useCallback, useEffect, useRef, useState } from 'react'

import { analyzeFace, detectFaces } from '../api/client'
import { admit, isUnfinished } from '../lib/batch'
import { recommendedFaceIndex } from '../lib/faces'

/**
 * Runs a Batch (CONTEXT.md, "Batch"); lib/batch.js holds its rules.
 *
 * Lives in App rather than on the table screen because the queue keeps
 * running while someone reads one of its rows, and the table is not mounted
 * then. State is in memory only: the photos are object URLs that die with the
 * tab, so a table restored without them would offer verdicts nobody could
 * open — numbers without their explanations.
 *
 * Stages:
 *   idle     — no batch
 *   ready    — photos chosen, nothing sent
 *   running  — the loop is working (also used while one row is re-run)
 *   stopping — Stop was pressed; the photo in flight is allowed to land
 *   paused   — the server became unreachable; finished rows are kept
 *   ended    — nothing left to run: finished, or stopped
 */
export function useBatch() {
  const [rows, setRows] = useState([])
  const [notAdded, setNotAdded] = useState([])
  const [stage, setStageState] = useState('idle')

  // Refs beside the state because the loop is one long async function: it
  // reads rows and stage as they are now, not as they were when it began.
  const rowsRef = useRef([])
  const stageRef = useRef('idle')
  // Bumped to orphan a loop (leaving the batch, or a newer run starting): a
  // loop that wakes from an await and finds its generation stale does nothing.
  const generationRef = useRef(0)
  const abortRef = useRef(null)

  const commit = useCallback((next) => {
    rowsRef.current = next
    setRows(next)
  }, [])
  const patch = useCallback(
    (id, changes) => commit(rowsRef.current.map((r) => (r.id === id ? { ...r, ...changes } : r))),
    [commit],
  )
  const setStage = useCallback((next) => {
    stageRef.current = next
    setStageState(next)
  }, [])

  const choose = useCallback(
    (files) => {
      const admitted = admit(files)
      // An object URL per photo that will be sent, for its verdict screen.
      commit(
        admitted.rows.map((row) =>
          row.status === 'rejected' ? row : { ...row, url: URL.createObjectURL(row.file) },
        ),
      )
      setNotAdded(admitted.notAdded)
      setStage('ready')
    },
    [commit, setStage],
  )

  const discard = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    for (const row of rowsRef.current) if (row.url) URL.revokeObjectURL(row.url)
    commit([])
    setNotAdded([])
    setStage('idle')
  }, [commit, setStage])

  /** /detect one row. Returns false when the server could not be reached. */
  const detect = useCallback(
    async (row, alive, signal) => {
      try {
        const { token, faces } = await detectFaces(row.file, { signal })
        if (!alive()) return true
        patch(row.id, {
          status: 'queued',
          token,
          facesFound: faces.length,
          faceIndex: recommendedFaceIndex(faces),
        })
      } catch (error) {
        if (!alive() || error.kind === 'aborted') return true
        if (error.kind === 'unreachable') return false
        patch(row.id, error.kind === 'no_face' ? { status: 'no_face' } : { status: 'failed', reason: error.message })
      }
      return true
    },
    [patch],
  )

  const pause = useCallback(() => {
    // A server that went away has forgotten every token it issued, so every
    // row waiting on one goes back to be detected again on resume.
    commit(
      rowsRef.current.map((r) =>
        r.status === 'queued' || r.status === 'running'
          ? { ...r, status: 'waiting', token: null, startedAt: null }
          : r,
      ),
    )
    setStage('paused')
  }, [commit, setStage])

  const run = useCallback(async () => {
    const generation = ++generationRef.current
    const alive = () => generationRef.current === generation
    const controller = new AbortController()
    abortRef.current = controller
    setStage('running')

    // Detection first, for every photo: ~0.2 s each on CPU, outside the GPU
    // lock. A photo with no face is known in seconds instead of when the
    // queue reaches it, and the ETA counts only photos that will run. The
    // cost is that the server holds every upload until its turn (ADR 0012).
    for (const row of rowsRef.current.filter((r) => r.status === 'waiting')) {
      if (!alive()) return
      if (stageRef.current === 'stopping') break
      if (!(await detect(row, alive, controller.signal))) return pause()
    }

    while (alive()) {
      const next = rowsRef.current.find((r) => r.status === 'queued')
      if (!next) break
      patch(next.id, { status: 'running', startedAt: performance.now() })
      try {
        const result = await analyzeFace(next.token, next.faceIndex, { signal: controller.signal })
        if (!alive()) return
        patch(next.id, {
          status: 'done',
          token: null,
          // The browser chose the face and knows its index; a backend from
          // before face_index was echoed (ADR 0012) does not say.
          result: { face_index: next.faceIndex, ...result },
        })
      } catch (error) {
        if (!alive() || error.kind === 'aborted') return
        if (error.kind === 'unreachable') return pause()
        // The server restarted between /detect and /analyze and forgot the
        // token: detect again, once, rather than call the photo a failure.
        if (/token/i.test(error.message) && !next.redetected) {
          patch(next.id, { status: 'waiting', token: null, redetected: true })
          if (!(await detect(rowsRef.current.find((r) => r.id === next.id), alive, controller.signal))) {
            return pause()
          }
          continue
        }
        patch(next.id, { status: 'failed', reason: error.message })
      }
    }

    if (!alive()) return
    abortRef.current = null
    setStage('ended')
  }, [detect, patch, pause, setStage])

  const start = useCallback(() => {
    if (stageRef.current === 'ready') run()
  }, [run])

  const resume = useCallback(() => {
    if (stageRef.current === 'paused') run()
  }, [run])

  /** Stops after the photo in flight. Its result is not thrown away — the
   *  graphics card finishes it either way — but nothing else starts. */
  const stop = useCallback(() => {
    if (stageRef.current !== 'running' && stageRef.current !== 'paused') return
    commit(
      rowsRef.current.map((r) =>
        r.status === 'waiting' || r.status === 'queued' ? { ...r, status: 'stopped', token: null } : r,
      ),
    )
    const running = rowsRef.current.some((r) => r.status === 'running')
    if (running) setStage('stopping')
    else {
      generationRef.current += 1
      setStage('ended')
    }
  }, [commit, setStage])

  /**
   * "Try this photo again" from a row's verdict screen: a new Analysis of
   * the same face, replacing the row's and marked as a re-run. Only when the
   * queue is not running — it needs the same graphics card. If it fails, the
   * row keeps the Analysis it had.
   */
  const rerun = useCallback(
    async (id) => {
      const before = stageRef.current
      if (before !== 'ended') return
      const row = rowsRef.current.find((r) => r.id === id)
      if (!row || row.status !== 'done') return

      const generation = ++generationRef.current
      const alive = () => generationRef.current === generation
      const controller = new AbortController()
      abortRef.current = controller
      setStage('running')
      patch(id, { status: 'running', startedAt: performance.now(), rerunError: null })

      try {
        const { token } = await detectFaces(row.file, { signal: controller.signal })
        const faceIndex = row.result.face_index ?? 0
        const result = await analyzeFace(token, faceIndex, { signal: controller.signal })
        if (!alive()) return
        patch(id, { status: 'done', rerun: true, result: { face_index: faceIndex, ...result } })
      } catch (error) {
        if (!alive() || error.kind === 'aborted') return
        patch(id, { status: 'done', rerunError: error.message })
      }
      abortRef.current = null
      setStage('ended')
    },
    [patch, setStage],
  )

  // A batch lives only on this page. Closing the tab mid-queue loses it, and
  // the photo on the graphics card finishes for nobody — so ask first.
  const unfinished = isUnfinished(rows) && ['running', 'stopping', 'paused'].includes(stage)
  useEffect(() => {
    if (!unfinished) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unfinished])

  // When the stopping loop lands its last photo it sets 'ended' itself; a
  // stop with nothing in flight ends at once (above).
  return { rows, notAdded, stage, choose, start, stop, resume, rerun, discard }
}
