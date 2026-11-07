/**
 * What the waiting screen is told about an Analysis, as something it can draw.
 *
 * The backend (backend/app/progress.py) reports a stage and, while the
 * reasoning layer is writing, a count of tokens. It does not report a fraction
 * and this does not make one up: the wait is long-tailed (40 s at the floor,
 * 60 s median, 169 s at p90) and nothing on either side can say how much of it
 * is left. So the screen gets steps — some done, one running — and a counter
 * for the step that is nearly all of the wait. See ADR 0015.
 */

/**
 * The four steps the screen lays out, in order:
 *   0 Face detection · 1 Fake Probability · 2 Saliency Map · 3 Writing the explanation
 */
export const STEP_COUNT = 4

// Which step each backend stage belongs to, and how many steps are behind it.
// Face detection is step 0 and is never reported: it is the separate /detect
// request, finished before this screen exists, so every stage here starts with
// at least one step done.
const STAGES = {
  queued: { active: null, completed: 1 },
  classifying: { active: 1, completed: 1 },
  saliency: { active: 2, completed: 2 },
  loading: { active: 3, completed: 3 },
  writing: { active: 3, completed: 3 },
}

/**
 * @param {object | null | undefined} snapshot  the body of GET /progress/{token}
 * @returns {{ known: false } | {
 *   known: true, completed: number, active: number | null,
 *   waiting: boolean, loading: boolean, retrying: boolean,
 *   attempt?: number, maxAttempts?: number, tokens?: number, serverSeconds?: number,
 * }}
 *
 * `known: false` means indeterminate — nothing reported yet, a backend that
 * has no such endpoint, or a stage newer than this page. It is not an error
 * and it is never drawn as a number.
 */
export function describeProgress(snapshot) {
  const stage = snapshot && STAGES[snapshot.stage]
  if (!stage) return { known: false }

  const attempt = snapshot.attempt
  return {
    known: true,
    completed: stage.completed,
    active: stage.active,
    waiting: snapshot.stage === 'queued',
    loading: snapshot.stage === 'loading',
    // The first attempt is the normal one. Any later attempt means a reply
    // came back that VeraLens could not read, and the model is writing again.
    retrying: typeof attempt === 'number' && attempt > 1,
    attempt,
    maxAttempts: snapshot.max_attempts,
    tokens: snapshot.tokens,
    serverSeconds: snapshot.elapsed_seconds,
  }
}
