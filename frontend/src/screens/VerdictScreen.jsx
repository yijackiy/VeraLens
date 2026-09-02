import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { asset } from '../api/client'
import {
  THRESHOLD,
  W_CLASSIFIER,
  W_REASONING,
  formatElapsed,
  percent,
  reasoningFakeProbability,
  severityBand,
  signalIcon,
} from '../lib/analysis'

/**
 * Screens 5, 6 and 7 — one layout, three states: Fake, Real, and the degraded
 * case where the reasoning layer's reply could not be read.
 *
 * The two columns below the hero carry different kinds of claim and are
 * deliberately not styled alike. Left is what the reasoning layer wrote, under
 * a grey provenance note. Right is what was measured. Tinting that note sage
 * or terracotta would make it read as part of the verdict.
 */
export function VerdictScreen({ result, previewUrl, onRestart, onRetry, onHowItWorks }) {
  const isFake = result.final_verdict === 'fake'
  const degraded = !result.explanation_available
  const reasoning = reasoningFakeProbability(result)
  const decisive = Math.abs(result.fake_probability - THRESHOLD) > 0.35
  const agreed = reasoning === null ? null : reasoning > THRESHOLD === isFake

  return (
    <Page width="wide" textured onHome={onRestart} onHelp={onHowItWorks}>
      <button
        type="button"
        onClick={onRestart}
        className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta"
      >
        <Icon name="arrow_back" size={20} />
        <span className="label-caps">Back to uploads</span>
      </button>

      <Hero
        result={result}
        previewUrl={previewUrl}
        isFake={isFake}
        degraded={degraded}
        decisive={decisive}
        agreed={agreed}
      />

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <h2 className="m-0 border-b border-line pb-2 text-headline-sm font-semibold text-ink-strong">
            What the reasoning layer wrote
          </h2>
          {degraded ? <NoExplanation onRetry={onRetry} /> : <Explanation result={result} />}
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="m-0 border-b border-line pb-2 text-headline-sm font-semibold text-ink-strong">
            How the verdict was reached
          </h2>
          <BlendCard
            result={result}
            reasoning={reasoning}
            degraded={degraded}
            isFake={isFake}
            onRestart={onRestart}
          />
        </div>
      </div>
    </Page>
  )
}

function Hero({ result, previewUrl, isFake, degraded, decisive, agreed }) {
  const probability = result.fake_probability
  const judged = isFake
    ? 'generated rather than photographed'
    : 'photographed rather than generated'

  let lede
  if (degraded) {
    lede = `VeraLens judged this face to be ${judged}. The reasoning layer dropped out of this analysis, so the verdict rests on the classifier alone — the half of the system that has actually been measured.`
  } else {
    const placement = isFake
      ? `${decisive ? 'well above' : 'just above'} the decision threshold`
      : `${decisive ? 'far below' : 'just below'} the decision threshold`
    const reaction = agreed ? 'agreed' : 'read it the other way'
    lede = `VeraLens judged this face to be ${judged}. The classifier put it ${placement}, and the reasoning layer ${reaction}. What follows is where that number came from, and what the reasoning layer had to say about it.`
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-paper p-8 shadow-ambient md:p-12">
      <div
        className={`pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full opacity-40 blur-[100px] ${
          isFake ? 'bg-error-container' : 'bg-sage-tint'
        }`}
      />

      <div className="relative grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Icon
              name={isFake ? 'warning' : 'verified'}
              fill
              className={isFake ? 'text-terracotta' : 'text-sage'}
              size={32}
            />
            <h1 className="m-0 font-serif text-verdict-lg font-bold text-ink-strong">
              {isFake ? 'Synthetic face detected' : 'No sign of generation'}
            </h1>
          </div>

          <p className="m-0 max-w-2xl text-body-md text-ink-muted">{lede}</p>

          <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Tile
              label="Fake Probability"
              value={percent(probability)}
              valueClass={isFake ? 'text-error' : 'text-sage-ink'}
              borderClass={isFake ? 'border-error-container/60' : 'border-sage-tint'}
            />
            <Tile label="Threshold" value="0.50" />
            <Tile label="Time taken" value={formatElapsed(result.elapsed_seconds)} />
            <Tile label="Face Crop" value="224²" />
          </div>

          <div>
            <div className="relative">
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-2 rounded-full ${isFake ? 'bg-terracotta' : 'bg-sage'}`}
                  style={{ width: `${Math.min(100, Math.max(0, probability * 100))}%` }}
                />
              </div>
              <div className="absolute -top-[5px] left-1/2 h-[18px] w-0.5 rounded-sm bg-slate opacity-60" />
            </div>
            <div className="label-caps mt-2.5 grid grid-cols-3 gap-2 text-outline">
              <span className="text-left">0 · certainly real</span>
              <span className="text-center">0.50 threshold</span>
              <span className="text-right">1 · certainly fake</span>
            </div>
            <p className="m-0 mt-3 text-body-sm text-outline">
              {degraded
                ? "This is the classifier's own number, unblended — the part of VeraLens measured at 97.50% accurate."
                : isFake
                  ? 'Fake Probability always points toward fake, whatever the verdict — a confident Real sits near zero, not near one.'
                  : 'Fake Probability always points toward fake, whatever the verdict — sitting this close to zero is what a confident Real looks like.'}
            </p>
          </div>

          {result.faces_found > 1 && (
            <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
              <Icon name="groups" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-body-sm text-terracotta-deep">
                {result.faces_found} faces were found in this photo. VeraLens analysed the first one
                only — everything on this page describes that face, not the others.
              </p>
            </div>
          )}
        </div>

        <div className="relative">
          <div className="group relative h-80 w-full overflow-hidden rounded-2xl border border-line bg-slate shadow-ambient">
            <img
              src={asset(result.heatmap_url)}
              alt="Grad-CAM saliency map over the analysed face crop"
              className="h-full w-full object-contain"
            />
            {previewUrl && (
              <img
                src={previewUrl}
                alt="The photograph you submitted"
                className="absolute inset-0 h-full w-full bg-slate object-contain opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            )}
            <div className="glass absolute right-4 bottom-4 flex items-center gap-2 rounded-lg px-3 py-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${isFake ? 'bg-terracotta' : 'bg-sage'}`}
              />
              <span className="label-caps tracking-[0.12em] text-ink-strong">Saliency Map</span>
            </div>
          </div>
          <p className="m-0 mt-3 text-body-sm text-ink-muted lg:text-right">
            Grad‑CAM over the Face Crop —{' '}
            {isFake ? 'warmer means it moved the number more' : 'little here pushed toward fake'}.
            {previewUrl && ' Hover to see your original photo.'}
          </p>
        </div>
      </div>
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

function Explanation({ result }) {
  return (
    <>
      <div className="flex items-start gap-4 rounded-xl bg-container-high px-6 py-5">
        <Icon name="info" className="mt-0.5 text-ink-muted" size={22} />
        <p className="m-0 text-body-sm text-slate">
          Qwen3‑VL‑2B wrote all of this <em>after</em> being told the verdict, and it supplies 45%
          of the fused number above. Measured on its own it separates real from fake no better than
          a coin toss — so read this as an account of the decision, not as independent evidence for
          it.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-paper p-6 shadow-ambient">
        <p className="m-0 text-body-md text-ink">{result.explanation}</p>
      </div>

      {result.signals.length > 0 && (
        <>
          <h3 className="label-caps m-0 mt-2 text-outline">Signals it reported</h3>
          {result.signals.map((signal, index) => (
            <SignalCard key={`${signal.name}-${index}`} signal={signal} />
          ))}
          <p className="m-0 text-body-sm text-outline">
            Every explanation this system produces mentions lighting, on real and fake photos alike.
            Treat a lighting remark as the model's habit, not as a finding.
          </p>
        </>
      )}
    </>
  )
}

function SignalCard({ signal }) {
  const band = severityBand(signal.severity)
  const strong = band === 'High'

  return (
    <div className="flex gap-5 rounded-xl border border-line bg-paper p-6 shadow-ambient">
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${
          strong ? 'bg-error-container/40' : 'bg-container-high'
        }`}
      >
        <Icon name={signalIcon(signal.name)} className={strong ? 'text-terracotta' : 'text-slate'} />
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-headline-sm font-semibold text-ink-strong">{signal.name}</h4>
        {signal.note && <p className="m-0 text-body-sm text-ink-muted">{signal.note}</p>}
        <div className="mt-2 flex gap-2">
          <span className="label-caps rounded bg-line px-2 py-1 text-ink-muted">
            Severity: {band}
          </span>
          <span className="label-caps rounded bg-line px-2 py-1 text-ink-muted">
            {signal.severity.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

function NoExplanation({ onRetry }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-line bg-paper px-8 py-12 text-center shadow-ambient">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-container-high">
        <Icon name="speaker_notes_off" className="text-outline" size={34} />
      </div>

      <h3 className="m-0 mt-6 font-serif text-verdict-md font-semibold text-ink-strong">
        Nothing this time
      </h3>
      <p className="m-0 mt-4 max-w-[560px] text-body-md text-ink-muted">
        The reasoning layer replied in a form VeraLens couldn't read, so there is no written account
        and no list of signals for this photo. It happens to roughly 1 photo in 20.
      </p>
      <p className="m-0 mt-3 max-w-[560px] text-body-md text-ink-muted">
        The verdict above is unaffected — VeraLens drops the reasoning layer out of the blend rather
        than guessing at what it meant.
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-8 inline-flex cursor-pointer items-center gap-2 rounded-lg border-none bg-sage px-8 py-3 text-body-md font-semibold text-white shadow-sage hover:bg-sage-deep"
      >
        <Icon name="refresh" size={20} />
        Try this photo again
      </button>
      {/* The design offered "Ask for the explanation again", which would need an
          endpoint that re-runs the reasoning layer over a cached crop. There
          isn't one: this re-runs the whole pipeline, and says so. */}
      <p className="label-caps m-0 mt-5 text-outline">Runs the whole pipeline again · 60–90 sec</p>
    </div>
  )
}

function BlendCard({ result, reasoning, degraded, isFake, onRestart }) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-line bg-paper p-6 shadow-ambient">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="balance" className="text-ink-muted" size={20} />
        <span className="label-caps text-ink-muted">
          {degraded ? 'Classifier only' : 'Weighted blend'}
        </span>
      </div>

      <p className="m-0 border-l-2 border-outline-variant pl-3 text-body-sm text-ink-muted italic">
        {degraded
          ? "When the reasoning layer's reply cannot be read, VeraLens excludes it from the blend entirely rather than treating an unreadable answer as a score. What is left is the classifier at full weight."
          : "The number on this page is not the classifier's alone. It is 0.55 of the classifier plus 0.45 of the reasoning layer — and only the classifier has ever been measured as a detector."}
      </p>

      <div className="mt-4 flex w-full flex-col gap-2">
        <Row
          label="Classifier"
          value={`${degraded ? '1.00' : W_CLASSIFIER.toFixed(2)} · ${percent(result.classifier_score)}`}
        />
        <Row
          label="Reasoning layer"
          value={degraded ? 'Excluded' : `${W_REASONING.toFixed(2)} · ${percent(reasoning)}`}
        />
        <Row
          label={degraded ? 'Final' : 'Fused'}
          value={percent(result.fake_probability)}
          valueClass={isFake ? 'font-bold text-error' : 'font-bold text-sage-ink'}
          labelClass="font-semibold text-ink-strong"
        />
        <Row
          label="Verdict"
          value={`${isFake ? 'Above' : 'Below'} 0.50 → ${isFake ? 'Fake' : 'Real'}`}
          last
        />
      </div>

      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={onRestart}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant/50 bg-container py-3 text-body-md font-semibold text-ink-strong hover:bg-container-high"
        >
          <Icon name="restart_alt" size={20} />
          Analyse another photo
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, valueClass = '', labelClass = 'text-ink-muted', last = false }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 ${last ? '' : 'border-b border-line'}`}
    >
      <span className={`text-body-sm ${labelClass}`}>{label}</span>
      <span className={`font-mono text-data-mono font-medium text-ink-strong ${valueClass}`}>
        {value}
      </span>
    </div>
  )
}
