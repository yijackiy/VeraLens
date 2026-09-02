import { useEffect } from 'react'
import { Icon } from './Icon'

/**
 * The one place the interface explains itself. Every figure here is measured —
 * results/RESULTS.md — including the ones that are unflattering. An
 * explainability tool that overstated its own evidence would be arguing
 * against itself.
 */
export function HowItWorks({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate/40 p-5 py-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How VeraLens works"
        className="w-full max-w-[720px] rounded-3xl border border-line bg-paper p-8 shadow-ambient md:p-12"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6">
          <h2 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
            How this works
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer border-none bg-transparent text-ink-muted hover:text-terracotta"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-5 text-body-md text-ink-muted">
          <p className="m-0">
            VeraLens runs four models in sequence on one photograph. InsightFace finds a face and
            cuts a 224×224 crop. EfficientNet‑B4 scores that crop from 0 to 1, always toward fake.
            Grad‑CAM traces which regions moved the score. Qwen3‑VL‑2B then reads the crop, is told
            what the classifier concluded, and writes the account you see.
          </p>
          <p className="m-0">
            The number on the verdict page is a weighted blend: 0.55 of the classifier plus 0.45 of
            the reasoning layer, called fake above 0.50. The classifier is not retrained by this
            project — the contribution is the pipeline around it.
          </p>

          <div className="rounded-xl bg-tint p-5">
            <h3 className="label-caps m-0 text-ink-muted">What has been measured</h3>
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-body-sm">
              <li>
                Classifier alone: 97.50% accuracy, 0.9973 AUC across 2,799 validation images with
                duplicates removed.
              </li>
              <li>
                Reasoning layer alone: 66.25% accuracy — and on fake faces 48.5%, which is chance.
                It answers &ldquo;real&rdquo; too readily.
              </li>
              <li>
                Blending the two changed accuracy by +0.5 points across 400 images, on four
                disagreements. At p = 0.625 that is noise, not an improvement.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border-l-2 border-outline-variant bg-container-high p-5">
            <h3 className="label-caps m-0 text-ink-muted">What that means for the explanation</h3>
            <p className="m-0 mt-2 text-body-sm">
              The written account is an explanation of a decision the classifier had already made,
              not a second opinion that confirms it. Read it for why the system says what it says.
              Roughly one photo in twenty comes back with no explanation at all, and VeraLens says
              so rather than inventing one.
            </p>
          </div>

          <p className="m-0 text-body-sm text-outline">
            Photographs only, one face at a time. Those figures come from a validation split that
            was observed during training, not from an untouched test set, and none of it was
            measured on photos taken with a webcam.
          </p>
        </div>
      </div>
    </div>
  )
}
