import { REGISTERS } from '../lib/register'

const LABELS = {
  plain: 'Plain language',
  technical: 'Technical',
}

// No `title` on the options. A tooltip competes with the visible label for the
// accessible name — the tree read back "Show every measurement behind this
// verdict" where it should have read "Technical" — and these two labels do not
// need explaining.

/**
 * A page-level control, not a section one — it governs the tiles, the signal
 * cards and the blend table as well as the prose, so it sits at the top of the
 * page rather than above any one of them.
 *
 * Radios rather than a button: the two states are a choice between named
 * alternatives, both always visible, and a single toggle would have to label
 * itself with either its state or its destination and be misread either way.
 */
export function RegisterToggle({ register, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Explanation detail"
      className="flex gap-1 rounded-lg border border-line bg-container p-1"
    >
      {REGISTERS.map((option) => {
        const active = option === register
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`label-caps cursor-pointer rounded-md border-none px-3.5 py-2.5 transition-colors ${
              active
                ? 'bg-paper text-ink-strong shadow-soft'
                : 'bg-transparent text-ink-muted hover:text-ink-strong'
            }`}
          >
            {LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
