// Fusion constants. These mirror backend/app/fusion/fusion.py — if the weights
// or the threshold change there, the blend table here goes quietly wrong.
export const W_CLASSIFIER = 0.55
export const W_REASONING = 0.45
export const THRESHOLD = 0.5

// Client-side guard rails. The backend accepts anything and lets cv2 fail,
// which surfaces as "no face detected" — a misleading thing to tell someone
// who handed over a HEIC.
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_BYTES = 10 * 1024 * 1024

export function rejectionReason(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'VeraLens reads JPG, PNG and WebP photographs. Other formats — HEIC from an iPhone, for instance — have to be converted first.'
  }
  if (file.size > MAX_BYTES) {
    return `That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB — a re-export at a smaller size will go through.`
  }
  return null
}

export function percent(probability, digits = 1) {
  return `${(probability * 100).toFixed(digits)}%`
}

/**
 * The reasoning layer's own Fake Probability, recovered from the two numbers
 * /analyze does return:  fused = 0.55·classifier + 0.45·reasoning.
 *
 * fuse() computes this internally and discards it. Deriving it here is exact,
 * but it hard-codes the weights on both sides of the wire — returning
 * llm_fake_probability from the backend would be the better fix.
 * Returns null when the reasoning layer was excluded from the blend.
 */
export function reasoningFakeProbability(result) {
  if (!result.explanation_available) return null
  const raw = (result.fake_probability - W_CLASSIFIER * result.classifier_score) / W_REASONING
  return Math.min(1, Math.max(0, raw))
}

/** High / Medium / Low from the 0-1 severity the reasoning layer reports. */
export function severityBand(severity) {
  if (severity >= 0.7) return 'High'
  if (severity >= 0.45) return 'Medium'
  return 'Low'
}

// The reasoning layer names its own signals, so this matches on what it tends
// to write rather than on a fixed vocabulary. Anything unrecognised still gets
// a card, just with a neutral icon.
const SIGNAL_ICONS = [
  [/light|shadow|illuminat|highlight/i, 'light_mode'],
  [/skin|texture|pore|smooth|grain/i, 'texture'],
  [/eye|iris|pupil|reflect|specular|gaze/i, 'visibility'],
  [/hair|edge|blend|boundar|blur|outline/i, 'blur_on'],
  [/symmetr|proportion|align|geometry/i, 'face'],
  [/teeth|mouth|lip|smile/i, 'sentiment_satisfied'],
  [/background|scene|context/i, 'wallpaper'],
  [/artifact|noise|compress|frequency/i, 'grain'],
  [/ear|nose|jaw|cheek|forehead/i, 'face_retouching_natural'],
]

export function signalIcon(name) {
  const match = SIGNAL_ICONS.find(([pattern]) => pattern.test(name))
  return match ? match[1] : 'troubleshoot'
}

export function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function formatElapsed(seconds) {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${Math.round(seconds)} s`
}
