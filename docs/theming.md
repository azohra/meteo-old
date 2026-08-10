# Theming

Every colour the components paint rides a CSS custom property with a light
fallback baked in. Import the default skin once —

```ts
import "@azohra/meteo/station/react/styles.css";
```

— and wrap your markup in `.meteo-root` for the token set. Override any token
on any ancestor to retheme.

## Scoping and layering

- **`.meteo-root`** carries the tokens and `color-scheme`. Components outside
  a `.meteo-root` still render (the light fallbacks apply); inside one, every
  token is themeable.
- The whole sheet ships inside **`@layer meteo`**, so your unlayered CSS
  always outranks it — no specificity fights, no `!important`.

## Light, dark, and the toggle

Tokens are defined once via `light-dark()` with `color-scheme: light dark` on
the root, so the system preference picks the theme with no duplicate token
blocks. A manual toggle sets `data-theme="dark"` (or `"light"`) on
`.meteo-root` — a one-line `color-scheme` pin that beats the system
preference:

```html
<div class="meteo-root" data-theme="dark">…</div>
```

Remove the attribute (or set any other value) to return to following the
system. Because both arms of every token are always declared, a theme switch
is instant and complete — there is no partially-themed state.

## Token reference

Two prefixes, by scope.

### `--meteo-*` — the shared skin

| Token | Role |
|---|---|
| `--meteo-surface` | Card and panel background |
| `--meteo-surface-raised` | Raised elements (dial face, matrix header) |
| `--meteo-ink` | Primary text and strokes |
| `--meteo-muted` | Secondary text, axis labels |
| `--meteo-border` | Card and table borders |
| `--meteo-grid` | Chart gridlines |
| `--meteo-accent` | The accent (ungraded traces, links, emphasis) |
| `--meteo-gap` | Dropout hatching in charts |
| `--meteo-freshness-live` / `-aging` / `-stale` | The freshness badge states |
| `--meteo-font` | Font stack for all component text (incl. SVG) |
| `--meteo-radius` | Corner radius |
| `--meteo-shadow` | Card shadow |

### `--wind-*` — genuinely wind-scoped

| Token | Role |
|---|---|
| `--wind-band-fill` | The lull–gust envelope fill |
| `--wind-mean` | The mean trace when ungraded |
| `--wind-vane` | Vane glyphs in the direction row |
| `--wind-cursor` | The chart inspector cursor |
| `--wind-favorable` / `--wind-unfavorable` | The rose's judgment ring |
| `--wind-band-0` … `--wind-band-4` | Speed grading, calm → strong |

## Speed bands and your palette

`thresholds` ([react.md](react.md#thresholds)) grades traces, dial arcs, and
rose petals into `wind-band-0..n` **classes** — what a band means and what
colour it wears belong to your CSS. Three thresholds make four bands; add
`--wind-band-*` overrides (and rules for higher indices if you declare more
thresholds) to speak your club's colour language.

## Dark-mode notes

- The demo's theme toggle (`examples/demo`) exercises exactly this mechanism:
  `data-theme` on `.meteo-root`, nothing else.
- If your page also styles `color-scheme` globally, the root's own
  declaration wins inside `.meteo-root` — the components stay coherent even
  when the page around them disagrees.
- README imagery is generated from these very tokens
  (`pnpm readme:assets` reads `styles.css`), so the docs never drift from
  the palette.
