/** A Material Symbols glyph. `fill` switches to the filled cut of the face. */
export function Icon({ name, className = '', fill = false, size, style }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined select-none${fill ? ' ms-fill' : ''} ${className}`}
      style={size ? { fontSize: `${size}px`, ...style } : style}
    >
      {name}
    </span>
  )
}
