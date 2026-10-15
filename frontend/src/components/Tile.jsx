/** One labelled number — Fake Probability, Time taken, and the like. */
export function Tile({ label, value, valueClass = 'text-ink-strong', borderClass = 'border-line' }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border bg-tint p-4 ${borderClass}`}>
      <span className="label-caps text-ink-muted">{label}</span>
      <span className={`font-mono text-data-lg font-bold ${valueClass}`}>{value}</span>
    </div>
  )
}
