import { FaceNotice } from '../components/FaceNotice'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { RegisterToggle } from '../components/RegisterToggle'
import { asset } from '../api/client'
import { useRegister } from '../hooks/useRegister'
import {
  agreementSummary,
  gapBetween,
  pinPosition,
  sameVerdict,
} from '../lib/comparison'
import {
  W_CLASSIFIER,
  W_REASONING,
  formatElapsed,
  percent,
  reasoningFakeProbability,
} from '../lib/analysis'

/**
 * Screen 10 — two Analyses on one axis.
 *
 * The design decision worth defending: one shared scale rather than two verdict
 * cards side by side. Two independent cards invite a reader to rank the photos,
 * and nothing here supports a ranking — only the classifier has been measured
 * as a detector, and only on dataset images. A single axis with the threshold
 * marked shows the distance between two numbers without implying the distance
 * means anything about either one.
 */
export function CompareScreen({ comparison, onRestart, onHowItWorks }) {
  const { a, b } = comparison
  const { register, setRegister, technical } = useRegister()

  return (
    <Page width="wide" textured onHome={onRestart} onHelp={onHowItWorks}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onRestart}
          className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta-ink"
        >
          <Icon name="arrow_back" size={20} />
          <span className="label-caps">Back to uploads</span>
        </button>

        <RegisterToggle register={register} onChange={setRegister} />
      </div>

      <Scale a={a} b={b} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <AnalysisCard side={a} technical={technical} />
        <AnalysisCard side={b} technical={technical} />
      </div>

      <Difference a={a} b={b} technical={technical} onRestart={onRestart} />
    </Page>
  )
}

function Scale({ a, b }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-paper p-8 shadow-ambient md:p-12">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Icon name="compare" fill className="text-sage" size={32} />
          <h1 className="m-0 font-serif text-verdict-lg font-bold text-ink-strong">
            Two photos, one scale
          </h1>
        </div>

        <p className="m-0 max-w-3xl text-body-md text-ink-muted">
          Both faces went through the same pipeline, at the same threshold, and sit on the same axis
          below. A comparison is not a ranking: the distance between two Fake Probabilities is not
          evidence about either photo on its own.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <div className="relative h-12">
            <Pin side={a} />
            <Pin side={b} />
          </div>

          <div className="relative">
            <div className="h-2.5 rounded-full border border-line bg-container" />
            <div className="absolute -top-[5px] left-1/2 h-5 w-0.5 rounded-sm bg-ink opacity-60" />
          </div>

          <div className="label-caps mt-1 grid grid-cols-3 gap-2 text-ink-muted">
            <span className="text-left">0% · certainly real</span>
            <span className="text-center">50% threshold</span>
            <span className="text-right">100% · certainly fake</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Pin({ side }) {
  const fake = side.result.final_verdict === 'fake'
  return (
    <div
      className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1"
      style={{ left: `${pinPosition(side.result.fake_probability)}%` }}
    >
      <span
        className={`font-mono text-data-mono font-bold whitespace-nowrap ${
          fake ? 'text-error' : 'text-sage-ink'
        }`}
      >
        {side.label} · {percent(side.result.fake_probability, 0)}
      </span>
      <span
        className={`h-0 w-0 border-x-7 border-t-10 border-x-transparent ${
          fake ? 'border-t-terracotta-ink' : 'border-t-sage-deep'
        }`}
      />
    </div>
  )
}

function AnalysisCard({ side, technical }) {
  const { label, photo, result } = side
  const fake = result.final_verdict === 'fake'
  const reasoning = reasoningFakeProbability(result)

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 shadow-ambient">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`label-caps flex h-6.5 w-6.5 flex-shrink-0 items-center justify-center rounded-full ${
              fake ? 'bg-terracotta-tint text-terracotta-ink' : 'bg-sage-tint text-sage-ink'
            }`}
          >
            {label}
          </span>
          <span className="truncate font-mono text-data-mono font-medium text-ink">
            {photo.file.name}
          </span>
        </div>
        <span
          className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 ${
            fake ? 'bg-terracotta-tint' : 'bg-sage-tint'
          }`}
        >
          <Icon
            name={fake ? 'warning' : 'verified'}
            fill
            size={16}
            className={fake ? 'text-terracotta-ink' : 'text-sage-ink'}
          />
          <span className={`label-caps ${fake ? 'text-terracotta-ink' : 'text-sage-ink'}`}>
            {fake ? 'Fake' : 'Real'}
          </span>
        </span>
      </div>

      <div className="group relative h-56 w-full overflow-hidden rounded-xl border border-line bg-slate">
        <img
          src={asset(result.heatmap_url)}
          alt={`Grad-CAM saliency map for photo ${label}`}
          className="h-full w-full object-contain"
        />
        <img
          src={photo.url}
          alt={`The photograph submitted as ${label}`}
          className="absolute inset-0 h-full w-full bg-slate object-contain opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        <div className="glass absolute right-3 bottom-3 flex items-center gap-2 rounded-lg px-3 py-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${fake ? 'bg-terracotta' : 'bg-sage'}`}
          />
          <span className="label-caps tracking-[0.12em] text-ink-strong">Saliency Map</span>
        </div>
      </div>

      <FaceNotice result={result} scope="in this card" />

      <div className="grid grid-cols-2 gap-4">
        <Tile
          label="Fake Probability"
          value={percent(result.fake_probability)}
          valueClass={fake ? 'text-error' : 'text-sage-ink'}
          borderClass={fake ? 'border-error-container/60' : 'border-sage-tint'}
        />
        <Tile label="Time taken" value={formatElapsed(result.elapsed_seconds)} />
      </div>

      {technical && (
        <div className="flex flex-col">
          <Row
            label="Classifier"
            value={`${percent(result.classifier_score)} · counts ${percent(W_CLASSIFIER, 0)}`}
          />
          <Row
            label="Reasoning layer"
            value={
              reasoning === null ? 'Excluded' : `${percent(reasoning)} · counts ${percent(W_REASONING, 0)}`
            }
          />
          <Row label="Fused" value={percent(result.fake_probability)} last />
        </div>
      )}

      {result.explanation_available ? (
        <p className="m-0 border-l-2 border-outline-variant pl-3 text-body-sm text-ink-muted">
          {result.explanation}
        </p>
      ) : (
        <p className="m-0 border-l-2 border-outline-variant pl-3 text-body-sm text-ink-muted italic">
          The reasoning layer's reply could not be read for this photo, so it was left out of the
          blend. The number above is the classifier's alone.
        </p>
      )}
    </div>
  )
}

function Difference({ a, b, technical, onRestart }) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-container-high px-8 py-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Stat label="Gap on the scale" value={`${Math.round(gapBetween(a, b) * 100)} points`} />
        <Stat label="Same verdict" value={sameVerdict(a, b) ? 'Yes' : 'No'} />
        {technical && <Stat label="Layers agreed on" value={agreementSummary(a, b)} />}
      </div>

      <p className="m-0 max-w-4xl text-body-sm text-ink-muted">
        {technical
          ? 'Only the classifier has been measured as a detector, and only on dataset images. Two photos placed side by side each carry that limit — putting them on one axis makes them easier to read against each other, not more certain.'
          : 'Seeing two photos together makes them easier to compare with each other. It does not make either answer more certain than it was on its own.'}
      </p>

      <button
        type="button"
        onClick={onRestart}
        className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-outline-variant/50 bg-container px-6 py-3 text-body-md font-semibold text-ink-strong hover:bg-container-high"
      >
        <Icon name="restart_alt" size={20} />
        Start over with a new photo
      </button>
    </section>
  )
}

function Tile({ label, value, valueClass = 'text-ink-strong', borderClass = 'border-line' }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border bg-tint p-4 ${borderClass}`}>
      <span className="label-caps text-ink-muted">{label}</span>
      <span className={`font-mono text-data-lg font-bold ${valueClass}`}>{value}</span>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps text-ink-muted">{label}</span>
      <span className="font-mono text-data-lg font-bold text-ink-strong">{value}</span>
    </div>
  )
}

function Row({ label, value, last = false }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 ${last ? '' : 'border-b border-line'}`}
    >
      <span className="text-body-sm text-ink-muted">{label}</span>
      <span className="font-mono text-data-mono font-medium text-ink-strong">{value}</span>
    </div>
  )
}
