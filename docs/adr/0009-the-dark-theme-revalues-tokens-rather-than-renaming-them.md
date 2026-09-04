# The dark theme revalues tokens rather than renaming them

`--color-paper` is `#ffffff` in light and `#211f1e` in dark. A reader meeting
that for the first time will assume it is a mistake, so: the alternative was to
rename the palette to pure roles (`surface-raised`, `surface-sunken`, …) so that
no name asserts a colour. That rename touches roughly 400 call sites across 26
files; revaluing touches about 30 lines of `index.css` and nothing else, because
no component in `frontend/src` names a colour — every one of them goes through a
token. Days after the software deadline, a 400-site rename buys a tidier
vocabulary and a diff nobody can review. We kept the names.

Two of the names survive the move better than they look. `sage` and `terracotta`
are this design system's words for *real* and *fake*; they are semantic already,
and only their lightness has to change. `paper` and `cream` are the ones that
read oddly, and they are the price.

One token is deliberately not revalued. `slate` was doing two unrelated jobs: the
dark well behind a photo, a video frame or a saliency map, and body text on light
containers. Flipping it would have put a light box around every image. The three
places it carried text moved to `ink-muted`, and `slate` is now a material that
means the same thing in both themes.

The operating-system preference is resolved to an explicit `data-theme` by a
boot script in `index.html` rather than by a `prefers-color-scheme` query in CSS.
That is what lets the stylesheet carry one dark block instead of the same thirty
declarations twice.

## Consequences

- Any new colour must be added as a token in both blocks. A component that
  writes a hex value directly will look correct in whichever theme the author
  was in and wrong in the other, with nothing to catch it.
- `src/lib/tokens.contrast.test.js` parses `index.css` and asserts every text
  pair clears 4.5:1 and every meaningful non-text pair clears 3:1, in both
  themes. It is deliberately written against the stylesheet rather than a copy
  of the palette, so it fails when a token is edited — that is the whole point.
  Three pairs in the original light palette were already below AA and nobody had
  noticed: white on `sage` at 3.78:1 on every primary button, `outline` on paper
  at 4.48:1 under the honesty caveats, and `terracotta` at 2.66:1 under the 3:1
  floor for meaningful marks. All three were fixed in the same branch, since the
  values were being edited anyway.
- `--color-on-sage` exists because the primary button inverts: light uses the
  deep sage tone with white on it, dark uses the light tone with near-black.
  Buttons say `text-on-sage`, never `text-white`, so the pair travels together.
- The palette now diverges from `Frontend Design/warmth_wisdom/DESIGN.md`, which
  still records `muted-terracotta: #D68E5E` and `outline: #737879`. `index.css`
  was already declared the single source of truth; the design file is now a
  historical record of the original artboards, not a specification.
- Without JavaScript there is no theme, because there is no app either. This
  would be the wrong trade for a content site.
