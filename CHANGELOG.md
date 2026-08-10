# Changelog

## 0.5.0 — 2026-08-10

The namespace wave, taken while the consumer count is one: everything the
suite ships now roots at `meteo-`, and the compatibility shims the 0.3.0
extraction left behind are gone.

- **Breaking: the class and token vocabulary roots at `meteo-`** — one grep
  of a page finds everything this library put there, and future capabilities
  (windgram, soundings) sub-namespace inside it instead of minting new
  top-level prefixes. The map:
  - `wind-band-0..4` → **`meteo-band-0..4`** (classes and tokens): speed
    grading is deliberately suite-wide vocabulary — the windgram renderer
    grades the same speeds against the same tokens when it lands.
  - Generic furniture loses the wind costume it never earned (the trend
    chart and air matrix were already wearing it): `wind-grid-line`,
    `wind-grid-label`, `wind-tick`, `wind-cursor`, `wind-cursor-dot`,
    `wind-hit`, `wind-microlabel` → bare **`meteo-*`**; `--wind-cursor` →
    `--meteo-cursor`.
  - Wind keeps only what actually visualizes wind: `meteo-wind-dial-*`,
    `meteo-wind-rose-*`, `meteo-wind-chart-*`, `meteo-wind-vane`,
    `meteo-wind-band` (the lull–gust envelope), `meteo-wind-mean`,
    `meteo-wind-threshold/zone/guide`, `meteo-wind-arrow`; tokens
    `--wind-mean`, `--wind-vane`, `--wind-favorable`, `--wind-unfavorable`,
    `--wind-band-fill` → `--meteo-wind-*`.
  - Station-level artifacts stop being misattributed to wind — a station is
    a weather station, not a wind station: `wind-station*` →
    **`meteo-station-card-*`**, `wind-table-*` → **`meteo-station-table-*`**,
    `wind-current-*` → **`meteo-current-*`**, `wind-flank-*` →
    `meteo-current-flank-*`, `wind-summary*` → **`meteo-summary-*`**.
- **Breaking: `WindStation` is now `StationCard`** — the same misattribution
  at the API level, fixed the same way: the component renders a weather
  station's card (header, instrument, chart, a summary with a temperature
  range), so it carries the station's name, not one instrument's. React:
  `StationCard` (+ `StationCard.Header/.Instrument/.Chart/.Summary`, flat
  `StationCardHeader` et al.). Elements: `<meteo-station-card>` (+
  `-header/-instrument/-chart/-summary` parts, `StationCardElement` et al.).
- **Breaking: `@azohra/meteo/station/react` exports only the binding** —
  components, hooks, and the provider. The shared vocabulary it used to
  re-export (`mergeCurrent`, `MergeResult`, `airSummary`, `lastStrikeWords`,
  `EM_DASH`, `defaultStrings`, `defaultFormatTime`, `localeFormatTime`,
  `mergeStringOverrides`, `thresholdsToMps`, and the `FormatTime`,
  `StationStrings`, `StationStringOverrides`, `SpeedThresholds`,
  `TrendSeries`, `FavorableDirection`, `PollError` types) imports from its
  home: `@azohra/meteo/station` (or `/station/client` for `PollError`). The
  internal shim modules are deleted, not re-pointed.
- **Breaking: the `./station/react/styles.css` alias is gone** — import
  `@azohra/meteo/station/styles.css`, the one skin both bindings share.
- **The vocabulary is documented as a convention** —
  [docs/theming.md](docs/theming.md#the-vocabulary) now states the three
  tiers (bare `meteo-*` skin and furniture, suite-wide `meteo-band-*`,
  family-scoped `meteo-<family>-*`) that new capabilities join.

## 0.4.0 — 2026-08-10

- **The custom-elements binding (`@azohra/meteo/station/elements`)** — the
  full station surface as light-DOM custom elements, a PEER of the react
  binding, not a wrapper: `<meteo-station-feed>` (the ambient provider,
  self-polling via the shared stores, with `meteo-feed`/`meteo-error`
  events), the `<meteo-wind-station>` compound with slot-free composition
  (authored children compose; the `compose` attribute is the empty-card
  edge), `<meteo-wind-history-chart>` and `<meteo-trend-chart>` with the
  full inspector (preview, pin by timestamp, touch-safe), the table, strip,
  rose, dial, sparkline, air matrix, freshness badge, and all eight text
  atoms. No framework, no new dependency; each host erases its box with
  `display: contents`.
- **Neither binding is truth** — a DOM parity suite renders the same
  fixtures through both bindings and holds the normalized output
  byte-identical, component by component, degradation shape by degradation
  shape. The class vocabulary is one contract with two writers.
- **One thresholds grammar in markup** — every element takes
  `thresholds='{"unit":"kmh","values":[…]}'` or `thresholds="none"` as an
  attribute, preserving the shared inherit/value/opt-out trichotomy for
  markup-only pages.
- **`@azohra/meteo/station/elements/register`** — the auto-defining
  one-liner for `<script type="module">` pages; the index stays
  side-effect-free with an idempotent `defineMeteoElements(registry?)`.
- **`examples/demo-elements`** — the react demo's twin, authored as plain
  markup with no framework in the bundle; CI builds both.
- **`docs/elements.md`** — the binding's page; the README now shows the two
  bindings as the peers they are.

## 0.3.0 — 2026-08-10

The extraction wave: everything a binding does not own moves down to
framework-free modules, so a second binding can be a full peer of the react
one — and neither is "the reference". Non-breaking: every `station/react`
export of 0.2.0 still resolves, unchanged.

- **The framework-free client core (`@azohra/meteo/station/client`)** — the
  poll loop (`createJsonPoller`: visibility gating, in-flight suppression,
  first-interval-after-first-response, keep-last-on-error, the 15 s abort
  deadline) and the station stores (`createStationFeedStore`,
  `createStationCurrentStore`, `createStationStore` with the merge clock
  rule) as subscribe/getSnapshot stores. The react hooks are now thin shells
  over them (`useSyncExternalStore`); their observable behavior is pinned
  unchanged by the existing hook and SSR suites.
- **Shared display rules on `@azohra/meteo/station`** — the strings
  vocabulary, formatting (`roundSpeed`, the one-decimal temperature,
  `updatedAtText`, `summaryEntries`, `directionCell`), air sentences and the
  `airRows` table spec, `mergeCurrent`/`foldCurrent`, the mount-base
  endpoints, and `resolveDisplay`/`resolveStation` — the ambient-default
  discipline (including the load-bearing thresholds `undefined`/value/`null`
  trichotomy) implemented exactly once.
- **Instrument geometry (`station/instruments.ts`)** — the dial's needle,
  arc, and scale rule, the rose's petals and judgment ring, and the
  sparkline's scale and run-splitting join geometry.ts's promise:
  coordinates and path strings, never markup, so every binding draws the
  same instruments from the same numbers.
- **`station/styles.css`** — the skin moves to a binding-neutral home; the
  `@azohra/meteo/station/react/styles.css` specifier still resolves to the
  same file. No class renames.
- **`docs/client-data.md`** — the single authority for the client layer;
  react.md slims to the binding's own surface and links over.

## 0.2.0 — 2026-08-10

- **Breaking: `StationCompare` is now `StationTable`.** The component was
  never a comparison — it is a readings table, one row per station under
  named column headers, and the head row is what makes even a single
  station's bare numbers readable. The name follows the structure. Renames:
  the `StationCompare` export → `StationTable`, the `wind-compare-*` class
  hooks → `wind-table-*`, and the `aria.compare` string → `aria.table`.

## 0.1.2 — 2026-08-10

- **`StationCompare` `stationMeta`**: the sub-label under each station's name
  is now a render prop — default stays the source attribution, but a consumer
  can put the station's own facts there ("past 3 s", a distance from launch).

## 0.1.1 — 2026-08-10

The primitives layer: the atoms the organisms were always made of.

- **Text atoms**: `Speed`, `Gust`, `Lull`, `Temperature`, `Pressure`,
  `Direction`, ticking `UpdatedAt`, and `BandChip` (your band labels, your
  thresholds) — inline, provider-resolvable, `<data>`-backed, honest about
  absence.
- **Visual atoms**: `Sparkline` (gap-honest inline history, optional banding)
  and `Dial` (the gauge alone; `CurrentConditions` now composes it).
- **`StationStrip`**: the per-station one-line reading — the board-row
  component the compare table's rows always were.
- One authority per formatting rule: strip, table, atoms, and instruments
  share the same cell helpers, so a dash, a calm word, or a rounded speed
  can never disagree across components.
- New i18n strings groups: relative time (`updated`), spoken compass
  (`compassSpoken`), and direction/sparkline aria sentences.


## 0.1.0 — 2026-08-09

First release of Azohra Meteo (`@azohra/meteo`), shipping the **station**
capability: heterogeneous weather stations behind one wire contract, rendered
natively in your design system.

- **Wire contract** (`@azohra/meteo/station`): `StationFeed` / `StationCurrent`
  documents in m/s with declared capabilities, machine reason codes, per-station
  cadence and IANA time zones, `servedAt`-anchored freshness, and the WMO calm
  threshold — absence is null, never zero; JSON Schema committed under
  `schema/` with a drift test.
- **Vendor adapters** (`@azohra/meteo/station/server`): WindNerd, WeatherFlow
  Tempest, and Campbell Scientific loggers (context-disambiguated DST
  handling), plus a custom-adapter interface and `defineStationAdapter` for
  third-party vendor packages — parse and map; the belt degrades everything else.
- **Handler and data API**: a runtime-agnostic `Request → Response` feed
  handler (`/feed`, `/current`, `?hours=`, ETag/304, honest `Cache-Control`,
  dynamic station config) and data-level `loadStationFeed()` /
  `loadStationCurrent()` for cron jobs and framework loaders. One broken
  station degrades to a reason code; the feed survives.
- **React** (`@azohra/meteo/station/react`): `StationFeedProvider` ambient
  defaults, visibility-gated abortable polling hooks (`useStation`,
  `useStationFeed`, `useStationCurrent`) with SSR seeding, and the component
  set — `WindStation` compound card, `CurrentConditions` dial,
  `WindHistoryChart`, `TrendChart`, `WindRose` with favorable-direction ring,
  `StationCompare`, `AirMatrix`, `FreshnessBadge`.
- **Consumer vocabulary**: unit-explicit `SpeedThresholds` (`{ unit, values }`)
  converted to the wire once; display units km/h, knots, mph, m/s.
- **Theming**: `--meteo-*` / `--wind-*` tokens scoped under `.meteo-root`,
  `light-dark()` with a `data-theme` override, the whole skin in `@layer meteo`.
- **Environment injection**: adapters reach the world only through
  `{ fetch, cache, logger, userAgent, now }` — pluggable `FeedCache`,
  coded log events, honest User-Agent.

Extracted and reshaped from acrophobia.ca's production live-wind system — the
first consumer.
