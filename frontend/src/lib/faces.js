/**
 * Which Face Candidate VeraLens analyses when nobody chooses.
 *
 * The same rule as the backend's recommended_face_index(), deliberately
 * written twice rather than shipped over the wire: /detect reports what it
 * found, and what to do about it is each side's own business. The two are
 * kept honest by naming the rule the same on both sides, not by a field.
 *
 * Within this side it is written once. App.jsx needs it to pick a face when
 * the picker is skipped, and FacePickerScreen needs it to highlight one when
 * the picker is shown; those are the same question, and answering it twice is
 * how the picker came to recommend a different face than it would have used.
 */

/**
 * The `index` of the largest Face Candidate, ties broken by det_score.
 *
 * Largest rather than leftmost because a photo with a subject and bystanders
 * usually frames the subject biggest. It is a guess about framing, not about
 * who the photo is of — a bystander closer to the camera still wins. See
 * ADR 0012.
 *
 * Returns an `index` from the list, not a position in it. Those are the same
 * number today (the backend numbers the faces in the order it sends them) and
 * `index` is the one /analyze wants, so it is the one to carry around.
 */
export function recommendedFaceIndex(faces) {
  if (!faces || faces.length === 0) return null

  // A fold, not `area === Math.max(...)`. The predicate form is what let two
  // faces of equal area both count as "the largest", so the picker outlined
  // two recommendations at once and the fallback's answer depended on which
  // one a caller happened to look at first.
  return faces.reduce((best, face) =>
    area(face) > area(best) || (area(face) === area(best) && face.det_score > best.det_score)
      ? face
      : best,
  ).index
}

function area(face) {
  return face.width * face.height
}
