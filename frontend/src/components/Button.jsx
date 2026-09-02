const VARIANTS = {
  primary:
    'bg-sage text-white shadow-sage hover:bg-sage-deep disabled:opacity-50 disabled:cursor-not-allowed',
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
