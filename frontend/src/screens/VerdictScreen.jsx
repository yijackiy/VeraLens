import { DrawsPanel } from '../components/DrawsPanel'
import { FaceNotice } from '../components/FaceNotice'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { RegisterToggle } from '../components/RegisterToggle'
import { SaliencyMap } from '../components/SaliencyMap'
import { useRegister } from '../hooks/useRegister'
import { MODELS } from '../lib/register'
import {
  THRESHOLD,
  W_CLASSIFIER,
  W_REASONING,
  formatClock,
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
export function VerdictScreen({
  result,
  previewUrl,
  onRestart,
  onRetry,
  onCompare,
  onHowItWorks,
  pending,
  draws,
  batch,
}) {
  const isFake = result.final_verdict === 'fake'
  const degraded = !result.explanation_available
  const reasoning = reasoningFakeProbability(result)
  const decisive = Math.abs(result.fake_probability - THRESHOLD) > 0.35
  const agreed = reasoning === null ? null : reasoning > THRESHOLD === isFake
  const { register, setRegister, technical } = useRegister()
  // A row of a Batch: every exit leads back to the table, never to the
  // upload screen, because the queue is still running behind this page and
  // "Analyse another photo" or "Compare" would abandon it.
  const back = batch ? batch.onBack : onRestart

  return (
    <Page width="wide" textured onHome={back} onHelp={onHowItWorks}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={back}
          className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta-ink"
        >
          <Icon name="arrow_back" size={20} />
          <span className="label-caps">{batch ? 'Back to the batch' : 'Back to uploads'}</span>
        </button>

        <RegisterToggle register={register} onChange={setRegister} />
      </div>

      {/* Photo B is still running. This verdict is complete and correct on its
          own terms — it is photo A's — so the page renders normally and this
          strip is the only thing that says more is coming. */}
      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sage-tint px-6 py-4">
          <div className="flex items-start gap-3.5">
            <Icon name="hourglass_top" className="vl-blink mt-0.5 text-sage-ink" size={22} />
            <p className="m-0 text-body-sm text-sage-ink">
              This is photo A. <span className="font-semibold break-all">{pending.name}</span> is being
              analysed now — {formatClock(pending.elapsed)} so far. The comparison opens on its own
              when it lands.
            </p>
          </div>
          <button
            type="button"
            onClick={pending.onStop}
            className="label-caps cursor-pointer rounded-lg border border-sage-deep bg-transparent px-4 py-2.5 text-sage-ink hover:bg-sage-tint"
          >
            Stop and keep A
          </button>
        </div>
      )}

      {batch && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-container-high px-6 py-4">
          <p className="m-0 text-body-sm text-ink-muted">
            <span className="font-semibold text-ink-strong">Multiple-Upload · {batch.progress}</span>
            {batch.running && ' — the queue keeps running while you read this.'}
          </p>
          <button
            type="button"
            onClick={batch.onBack}
            className="label-caps cursor-pointer rounded-lg border border-outline bg-transparent px-4 py-2 text-ink hover:bg-container"
          >
            Back to the batch
          </button>
        </div>
      )}

      <Hero
        result={result}
        previewUrl={previewUrl}
        isFake={isFake}
        degraded={degraded}
        decisive={decisive}
        agreed={agreed}
        technical={technical}
      />

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <h2 className="m-0 border-b border-line pb-2 text-headline-sm font-semibold text-ink-strong">
            What the reasoning layer wrote
          </h2>
          {degraded ? (
            <NoExplanation onRetry={batch ? batch.onRetry : onRetry} />
          ) : (
            <Explanation result={result} technical={technical} />
          )}
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
            technical={technical}
            onRestart={back}
            restartLabel={batch ? 'Back to the batch' : 'Analyse another photo'}
            onCompare={pending || batch ? null : onCompare}
          />
        </div>
      </div>

      {/* Absent while photo B of a Comparison is running: the graphics card is
          busy with B, and a Draw would queue behind it for minutes. */}
      {draws && (
        <DrawsPanel
          analysis={result}
          entries={draws.entries}
          inFlight={draws.inFlight}
          elapsed={draws.elapsed}
          technical={technical}
          onDrawAgain={draws.onDrawAgain}
          onCancel={draws.onCancel}
          unavailable={draws.unavailable}
        />
      )}
    </Page>
  )
}

function Hero({ result, previewUrl, isFake, degraded, decisive, agreed, technical }) {
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
            <h1 className="m-0 font-serif text-verdict-md font-bold text-ink-strong sm:text-verdict-lg">
              {isFake ? 'Synthetic face detected' : 'No sign of generation'}
            </h1>
          </div>

          <p className="m-0 max-w-2xl text-body-md text-ink-muted">{lede}</p>

          {/* Threshold and crop size are apparatus: true, and meaningless to
              anyone who has not been told what the pipeline does. They stay in
              technical and leave in plain, where the remaining two tiles are
              the only numbers that answer a question someone actually asked. */}
          <div
            className={`mt-2 grid grid-cols-2 gap-4 ${technical ? 'md:grid-cols-4' : 'md:grid-cols-2'}`}
          >
            <Tile
              label="Fake Probability"
              value={percent(probability)}
              valueClass={isFake ? 'text-error' : 'text-sage-ink'}
              borderClass={isFake ? 'border-error-container/60' : 'border-sage-tint'}
            />
            {technical && <Tile label="Threshold" value={percent(THRESHOLD, 0)} />}
            <Tile label="Time taken" value={formatElapsed(result.elapsed_seconds)} />
            {technical && <Tile label="Face Crop" value="224²" />}
          </div>

          <div>
            <div className="relative">
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-2 rounded-full ${isFake ? 'bg-terracotta' : 'bg-sage'}`}
                  style={{ width: `${Math.min(100, Math.max(0, probability * 100))}%` }}
                />
              </div>
              <div className="absolute -top-[5px] left-1/2 h-[18px] w-0.5 rounded-sm bg-ink opacity-60" />
            </div>
            <div className="label-caps mt-2.5 grid grid-cols-3 gap-2 text-outline">
              <span className="text-left">0% · certainly real</span>
              <span className="text-center">50% threshold</span>
              <span className="text-right">100% · certainly fake</span>
            </div>
            <p className="m-0 mt-3 text-body-sm text-outline">
              {degraded
                ? "This is the classifier's own number, unblended — the part of VeraLens measured at 97.5% accurate."
                : isFake
                  ? 'Fake Probability always points toward fake, whatever the verdict — a confident Real sits near 0%, not near 100%.'
                  : 'Fake Probability always points toward fake, whatever the verdict — sitting this close to zero is what a confident Real looks like.'}
            </p>
          </div>

          <FaceNotice result={result} />
        </div>

        <div className="relative">
          <SaliencyMap
            heatmapUrl={result.heatmap_url}
            photoUrl={previewUrl}
            heatmapAlt="Grad-CAM saliency map over the analysed face crop"
            photoAlt="The photograph you submitted"
            fake={isFake}
            className="h-64 rounded-2xl shadow-ambient sm:h-80"
          />
          <p className="m-0 mt-3 text-body-sm text-ink-muted lg:text-right">
            Grad‑CAM over the Face Crop —{' '}
            {isFake ? 'warmer means it moved the number more' : 'little here pushed toward fake'}.
            {previewUrl && ' Tap or hover over it to see your original photo.'}
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

function Explanation({ result, technical }) {
  return (
    <>
      {/* Reworded between registers, never removed from either. Plain language
          is a reason to disclose more readably, not to disclose less: both
          versions still say a model wrote this, that it was told the verdict
          first, and that it is not independent evidence. */}
      <div className="flex items-start gap-4 rounded-xl bg-container-high px-6 py-5">
        <Icon name="info" className="mt-0.5 text-ink-muted" size={22} />
        <p className="m-0 text-body-sm text-ink-muted">
          {technical ? (
            <>
              Qwen3‑VL‑2B wrote all of this <em>after</em> being told the verdict, and it supplies
              45% of the fused number above. Measured on its own it separates real from fake no
              better than a coin toss — so read this as an account of the decision, not as
              independent evidence for it.
            </>
          ) : (
            <>
              A small language model wrote this <em>after</em> it had already been told the answer.
              It explains the decision in words; it is not a second opinion confirming it.
            </>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-paper p-6 shadow-ambient">
        <p className="m-0 text-body-md text-ink">{result.explanation}</p>
      </div>

      {result.signals.length > 0 && (
        <>
          <h3 className="label-caps m-0 mt-2 text-ink-muted">
            {technical ? 'Signals it reported' : 'What it noticed'}
          </h3>
          {result.signals.map((signal, index) => (
            <SignalCard key={`${signal.name}-${index}`} signal={signal} technical={technical} />
          ))}
          <p className="m-0 text-body-sm text-ink-muted">
            {technical
              ? "Every explanation this system produces mentions lighting, on real and fake photos alike. Treat a lighting remark as the model's habit, not as a finding."
              : 'This system mentions lighting in almost every explanation, whatever the photo. Take that particular remark lightly.'}
          </p>
        </>
      )}
    </>
  )
}

function SignalCard({ signal, technical }) {
  const band = severityBand(signal.severity)
  const strong = band === 'High'

  return (
    <div className="flex gap-5 rounded-xl border border-line bg-paper p-6 shadow-ambient">
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${
          strong ? 'bg-error-container/40' : 'bg-container-high'
        }`}
      >
        <Icon name={signalIcon(signal.name)} className={strong ? 'text-terracotta' : 'text-ink-muted'} />
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-headline-sm font-semibold text-ink-strong">{signal.name}</h4>
        {signal.note && <p className="m-0 text-body-sm text-ink-muted">{signal.note}</p>}
        {/* A bare 0.78 is a number the reasoning layer produced for itself,
            against no scale anyone outside this project could calibrate. It
            belongs with the other measurements, not next to the prose. */}
        {technical && (
          <div className="mt-2 flex gap-2">
            <span className="label-caps rounded bg-line px-2 py-1 text-ink-muted">
              Severity: {band}
            </span>
            <span className="label-caps rounded bg-line px-2 py-1 text-ink-muted">
              {percent(signal.severity, 0)}
            </span>
          </div>
        )}
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

      {onRetry ? (
        <>
          <button
            type="button"
            onClick={onRetry}
            className="mt-8 inline-flex cursor-pointer items-center gap-2 rounded-lg border-none bg-sage-deep px-8 py-3 text-body-md font-semibold text-on-sage shadow-sage hover:bg-sage-ink"
          >
            <Icon name="refresh" size={20} />
            Try this photo again
          </button>
          {/* The design offered "Ask for the explanation again", which would need an
              endpoint that re-runs the reasoning layer over a cached crop. There
              isn't one: this re-runs the whole pipeline, and says so. */}
          <p className="label-caps m-0 mt-5 text-outline">
            Runs the whole pipeline again · about a minute, sometimes three
          </p>
        </>
      ) : (
        // A row of a running Batch: trying again needs the graphics card the
        // queue is using, so it waits until the queue is done or stopped.
        <p className="label-caps m-0 mt-8 text-outline">
          Trying again is available once the batch has finished or been stopped
        </p>
      )}
    </div>
  )
}

function BlendCard({
  result,
  reasoning,
  degraded,
  isFake,
  technical,
  onRestart,
  restartLabel,
  onCompare,
}) {
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
          : technical
            ? "The number on this page is not the classifier's alone. It is 55% the classifier and 45% the reasoning layer — and only the classifier has ever been measured as a detector."
            : "Two things looked at this photo: a detector, and a language model that explains. The number above is mostly the detector's — and only the detector has ever been tested at telling real from fake."}
      </p>

      {/* The weights, the recovered reasoning score and the threshold
          arithmetic are the apparatus of the decision. Plain replaces the whole
          table with the one fact it establishes; nothing here is hidden that
          technical does not show in full. */}
      {technical ? (
        <div className="mt-4 flex w-full flex-col gap-2">
          <Row
            label="Classifier"
            value={`${percent(result.classifier_score)} · counts ${percent(degraded ? 1 : W_CLASSIFIER, 0)}`}
          />
          <Row
            label="Reasoning layer"
            value={degraded ? 'Excluded' : `${percent(reasoning)} · counts ${percent(W_REASONING, 0)}`}
          />
          <Row
            label={degraded ? 'Final' : 'Fused'}
            value={percent(result.fake_probability)}
            valueClass={isFake ? 'font-bold text-error' : 'font-bold text-sage-ink'}
            labelClass="font-semibold text-ink-strong"
          />
          <Row
            label="Verdict"
            value={`${isFake ? 'Above' : 'Below'} ${percent(THRESHOLD, 0)} → ${isFake ? 'Fake' : 'Real'}`}
            last
          />

          {/* Headed, because "Classifier" means a weight in the rows above and
              a model name in the rows below, and an unbroken table of the two
              reads as though EfficientNet-B4 scored 0.55. */}
          <h3 className="label-caps m-0 mt-4 mb-1 text-ink-muted">On the inference path</h3>
          {MODELS.map((model, index) => (
            <Row
              key={model.role}
              label={model.role}
              value={model.name}
              last={index === MODELS.length - 1}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 mt-2 text-body-md text-ink">
          {degraded
            ? `The detector alone put this at ${percent(result.fake_probability, 0)} likely to be generated, which is ${isFake ? 'enough' : 'not enough'} to call it ${isFake ? 'fake' : 'real'}.`
            : `Together they put this at ${percent(result.fake_probability, 0)} likely to be generated, which is ${isFake ? 'enough' : 'not enough'} to call it ${isFake ? 'fake' : 'real'}.`}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-6">
        {onCompare && (
          <button
            type="button"
            onClick={onCompare}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none bg-sage-deep py-3 text-body-md font-semibold text-on-sage shadow-sage hover:bg-sage-ink"
          >
            <Icon name="compare" size={20} />
            Compare with another photo
          </button>
        )}
        <button
          type="button"
          onClick={onRestart}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant/50 bg-container py-3 text-body-md font-semibold text-ink-strong hover:bg-container-high"
        >
          <Icon name="restart_alt" size={20} />
          {restartLabel}
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
