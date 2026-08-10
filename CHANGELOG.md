# Changelog

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
