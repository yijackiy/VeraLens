import { Icon } from './Icon'

const PIPELINE = [
  { label: 'Face detector', value: 'InsightFace', chip: 'STEP 1' },
  { label: 'Classifier', value: 'EfficientNet‑B4', chip: 'STEP 2' },
  { label: 'Explanation', value: 'Qwen3‑VL‑2B', chip: 'STEP 3' },
]

export const FILE_GUIDANCE =
  'Use the original photo where you can, with a front‑facing face filling most of the frame. Screenshots and re‑saved images lose the fine detail the classifier reads.'

export const CAMERA_GUIDANCE =
  'Sit facing your main light rather than with a window behind you. A backlit face is the most common reason the detector finds nothing.'

/** The left rail of every "getting a photo in" screen: what will run, and how
 *  to give it something it can work with. Below `lg` the rail stacks, and it
 *  stacks *after* the screen's own content — first, a phone would open on two
 *  cards of context and scroll to find the thing it came to do. */
export function Sidebar({ guidance = FILE_GUIDANCE, onHowItWorks }) {
  return (
    <aside className="order-last flex w-full flex-col gap-6 lg:order-first lg:w-96 lg:flex-shrink-0">
      <div className="flex flex-col gap-6 rounded-xl bg-paper p-6 shadow-ambient">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <Icon name="tune" fill className="text-sage" />
          <h2 className="m-0 text-headline-sm font-semibold text-ink-strong">
            What runs on your photo
          </h2>
        </div>

        <div className="flex flex-col gap-4">
          {PIPELINE.map((row, index) => (
            <div key={row.label} className="flex flex-col gap-1">
              {index > 0 && <hr className="m-0 mb-4 border-none border-t border-line" />}
              <span className="label-caps text-outline">{row.label}</span>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-data-mono font-medium text-ink">{row.value}</span>
                <span className="label-caps rounded-full bg-sage-tint px-2.5 py-0.5 text-sage-deep">
                  {row.chip}
                </span>
              </div>
            </div>
          ))}

          <hr className="m-0 border-none border-t border-line" />

          <div className="flex flex-col gap-1">
            <span className="label-caps text-outline">Decision threshold</span>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-data-mono font-medium text-ink">50%</span>
              <span className="label-caps text-ink-muted">Fixed</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onHowItWorks}
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline bg-transparent py-2.5 text-body-sm text-ink hover:bg-container-high"
        >
          <Icon name="menu_book" size={18} />
          How this works
        </button>
      </div>

      <div className="rounded-xl border border-line/50 bg-cream p-5">
        <div className="flex items-start gap-3">
          <Icon name="lightbulb" className="mt-0.5 text-terracotta" />
          <div>
            <h3 className="m-0 mb-1 text-body-md font-semibold text-ink-strong">Guidance</h3>
            <p className="m-0 text-body-sm text-ink-muted">{guidance}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
