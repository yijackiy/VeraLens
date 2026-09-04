import { Icon } from './Icon'
import { useTheme } from '../hooks/useTheme'

/**
 * One press gives you the other theme. It reports the theme you are in, not
 * the one you would get — a control labelled with its own destination reads
 * as a statement about the current state to about half of everyone who sees
 * it, and this one sits next to a verdict where being misread is expensive.
 * aria-pressed carries the actual state for anyone who cannot see the icon.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? 'Dark theme, switch to light' : 'Light theme, switch to dark'}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink-muted hover:bg-container-high hover:text-terracotta-ink"
    >
      <Icon name={dark ? 'dark_mode' : 'light_mode'} size={22} />
    </button>
  )
}
