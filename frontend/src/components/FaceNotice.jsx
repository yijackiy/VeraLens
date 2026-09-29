import { Icon } from './Icon'

/**
 * "Face 3 of 4 · everything on this page describes that face."
 *
 * Shown wherever an Analysis of a multi-face photo is reported: the verdict
 * screen, and either card of a Comparison. `scope` names what the sentence is
 * scoping — a Comparison shows two of these at once, so "this page" would be
 * ambiguous exactly where it matters most.
 *
 * Deliberately neutral, not a warning. It used to read "VeraLens analysed the
 * first one only" in the caution palette, which was right when the software
 * picked a face without asking and the notice existed to admit it. Once the
 * picker shipped that sentence was simply false — pick face 3 of 4 and the
 * verdict told you it had analysed face 1 — and the caution colour was wrong
 * for the same reason: nothing went wrong, the photo just had more than one
 * face in it.
 *
 * It names the face without saying who chose it. A Comparison can reach the
 * same screen by two routes (see App.jsx), and a face chosen by hand is
 * indistinguishable from the same face taken by default — so "you chose this"
 * is a claim the stored Analysis cannot actually support. Which face it
 * describes, it can.
 */
export function FaceNotice({ result, scope = 'on this page', className = '' }) {
  if (!result || result.faces_found <= 1) return null

  return (
    <div
      className={`flex items-start gap-3.5 rounded-xl bg-container-high px-5 py-4 ${className}`}
    >
      <Icon name="groups" className="mt-0.5 flex-shrink-0 text-ink-muted" size={22} />
      <p className="m-0 text-body-sm text-ink-muted">
        Face {result.face_index + 1} of {result.faces_found} · everything {scope} describes that
        face.
      </p>
    </div>
  )
}
