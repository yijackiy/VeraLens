/** A Fake Probability on the 0–100% axis, with the 50% threshold marked. */
export function ProbabilityBar({ probability, fake }) {
  return (
    <div>
      <div className="relative">
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div
            className={`h-2 rounded-full ${fake ? 'bg-terracotta' : 'bg-sage'}`}
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
    </div>
  )
}
