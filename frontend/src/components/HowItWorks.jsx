import { useEffect } from 'react'
import { useRegister } from '../hooks/useRegister'
import { Icon } from './Icon'
import { RegisterToggle } from './RegisterToggle'

/**
 * The one place the interface explains itself. Every figure here is measured —
 * results/RESULTS.md — including the ones that are unflattering. An
 * explainability tool that overstated its own evidence would be arguing
 * against itself.
 */
export function HowItWorks({ open, onClose }) {
  const { register, setRegister, technical } = useRegister()

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

        <div className="mt-5 flex">
          <RegisterToggle register={register} onChange={setRegister} />
        </div>

        <div className="mt-6 flex flex-col gap-5 text-body-md text-ink-muted">
          {technical ? <TechnicalAccount /> : <PlainAccount />}
        </div>
      </div>
    </div>
  )
}

// Plain is a translation of technical, not a softer version of it: the same
// claims, including the unflattering ones, with the jargon taken out.
function PlainAccount() {
  return (
    <>
      <p className="m-0">
        When you upload a photo, VeraLens does four things in order. It finds the face and cuts it
        out. A detector trained on thousands of real and fake faces scores how likely the face is
        to be fake. A heatmap shows which parts of the face the detector paid most attention to.
        Last, a second AI that can look at images and write text is told what the detector decided,
        and it writes the explanation you read.
      </p>
      <p className="m-0">
        The final score mixes the two, a little more than half from the detector and the rest from
        the second AI. Above 50%, the photo is called fake.
      </p>

      <div className="rounded-xl bg-tint p-5">
        <h3 className="label-caps m-0 text-ink-muted">How well it works</h3>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-body-sm">
          <li>
            The detector gets about 39 out of 40 photos right (97.5%), tested on 2,799 photos it
            was not trained on.
          </li>
          <li>
            The second AI on its own is much weaker. On fake faces it does no better than a coin
            toss, because it tends to say &ldquo;real&rdquo;.
          </li>
          <li>
            Mixing the two did not make VeraLens better at spotting fakes. The difference was too
            small to count.
          </li>
        </ul>
      </div>

      <div className="rounded-xl border-l-2 border-outline-variant bg-container-high p-5">
        <h3 className="label-caps m-0 text-ink-muted">What this means for you</h3>
        <p className="m-0 mt-2 text-body-sm">
          The explanation tells you why the detector gave its answer. It is not a second check that
          proves the answer right. For about one photo in twenty no explanation can be written, and
          VeraLens tells you so instead of making one up.
        </p>
      </div>

      <p className="m-0 text-body-sm text-outline">
        Photos only, one face at a time. The accuracy figures come from photos much like the ones
        the detector learned from, not a completely fresh set, and it has not been tested on
        webcam photos.
      </p>
    </>
  )
}

function TechnicalAccount() {
  return (
    <>
      <p className="m-0">
        VeraLens runs four models in sequence on one photograph. InsightFace finds a face and cuts
        a 224×224 crop. EfficientNet‑B4 scores that crop from 0% to 100%, where 100% is fake. Grad‑CAM
        traces which regions moved the score. Qwen3‑VL‑2B (4-bit) then reads the crop, is told in
        words what the classifier concluded, and writes the account you see.
      </p>
      <p className="m-0">
        The number on the verdict page is a weighted blend: 55% the classifier and 45% the
        reasoning layer, called fake above 50%. The classifier is an ImageNet-pretrained backbone
        fine-tuned once on this dataset and left unchanged since. The contribution is the pipeline
        around it, not a new detector.
      </p>

      <div className="rounded-xl bg-tint p-5">
        <h3 className="label-caps m-0 text-ink-muted">What has been measured</h3>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-body-sm">
          <li>
            Classifier alone: 97.5% accuracy, 99.7% AUC across 2,799 validation images with
            duplicates removed.
          </li>
          <li>
            Reasoning layer alone: 66% accuracy, and 49% on fake faces, which is chance. It
            answers &ldquo;real&rdquo; too readily.
          </li>
          <li>
            Blending the two changed accuracy by +0.5 points across 400 images, on four
            disagreements. McNemar’s test puts the chance of that being luck at 62.5%, so it is
            noise, not an improvement.
          </li>
        </ul>
      </div>

      <div className="rounded-xl border-l-2 border-outline-variant bg-container-high p-5">
        <h3 className="label-caps m-0 text-ink-muted">What that means for the explanation</h3>
        <p className="m-0 mt-2 text-body-sm">
          The written account is an explanation of a decision the classifier had already made, not
          a second opinion that confirms it. Read it for why the system says what it says. Roughly
          one photo in twenty comes back with no explanation at all, and VeraLens says so rather
          than inventing one.
        </p>
      </div>

      <p className="m-0 text-body-sm text-outline">
        Photographs only, one face at a time. Those figures come from a validation split that was
        observed during training, not from an untouched test set, and none of it was measured on
        photos taken with a webcam.
      </p>
    </>
  )
}
