// `bg-sage` with white on it measured 3.78:1 — under AA for a 16px semibold
// label, and the 3:1 large-text allowance does not reach it. sage-deep is
// 6.44:1 and was already the hover colour, so the pair just steps down one.
// `text-on-sage` rather than `text-white`: in dark mode the primary surface
// is the light sage tone and needs near-black on it.
const VARIANTS = {
  primary:
    'bg-sage-deep text-on-sage shadow-sage hover:bg-sage-ink disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'border border-outline text-ink hover:bg-container-high disabled:opacity-50 disabled:cursor-not-allowed',
  quiet:
    'bg-container text-ink-strong border border-outline-variant/50 hover:bg-container-high',
}

export function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-8 py-3 font-sans text-body-md font-semibold transition-colors cursor-pointer ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
