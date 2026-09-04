import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'

/** Shared chrome. `width` follows the artboards: the verdict pages run wider
 *  than the upload pages, and the waiting page is narrower than both. */
const WIDTHS = {
  narrow: 'max-w-[1024px]',
  normal: 'max-w-[1280px]',
  wide: 'max-w-[1440px]',
}

export function Page({ children, width = 'normal', textured = false, onHome, onHelp }) {
  return (
    <div className={`flex min-h-screen flex-col bg-surface${textured ? ' bg-texture' : ''}`}>
      <Header width={width} onHome={onHome} onHelp={onHelp} />
      <main
        className={`mx-auto flex w-full flex-grow flex-col gap-8 px-5 py-12 md:px-16 ${WIDTHS[width]}`}
      >
        {children}
      </main>
      <Footer width={width} />
    </div>
  )
}

function Header({ width, onHome, onHelp }) {
  return (
    <header className="w-full bg-surface shadow-ambient">
      <div
        className={`mx-auto flex h-20 w-full items-center justify-between gap-4 px-5 md:px-16 ${WIDTHS[width]}`}
      >
        <button
          type="button"
          onClick={onHome}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 font-serif text-verdict-md font-bold text-ink-strong"
        >
          <Icon name="lens_blur" fill className="text-terracotta" size={30} />
          VeraLens
        </button>
        <nav className="flex items-center gap-8">
          <button
            type="button"
            onClick={onHome}
            className="cursor-pointer border-none border-b-2 border-terracotta bg-transparent pb-1 text-body-md font-semibold text-ink-strong"
          >
            Upload
          </button>
        </nav>
        {/* Both controls carry a 44px box. The help button was a bare glyph
            with no padding until the theme toggle landed beside it — two
            adjacent controls of visibly different target size read as a bug
            before they read as an accessibility problem. */}
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={onHelp}
            aria-label="How this works"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink-muted hover:bg-container-high hover:text-terracotta-ink"
          >
            <Icon name="help_outline" size={22} />
          </button>
        </div>
      </div>
    </header>
  )
}

function Footer({ width }) {
  return (
    <footer className="mt-auto w-full bg-container">
      <div
        className={`mx-auto flex w-full flex-col justify-between gap-8 px-5 py-10 md:flex-row md:items-center md:px-16 ${WIDTHS[width]}`}
      >
        <div className="flex flex-col gap-1.5">
          <span className="font-serif text-headline-sm font-bold text-ink-strong">VeraLens</span>
          <span className="label-caps text-ink-muted">Bachelor thesis project · 2026</span>
        </div>
        <p className="m-0 max-w-[620px] text-body-sm text-ink-muted md:text-right">
          Classifier: 97.50% accuracy, 0.9973 AUC on a leakage‑free validation split of 2,799
          images. Not measured on camera photos; the reasoning layer is not claimed to improve
          detection.
        </p>
      </div>
    </footer>
  )
}
