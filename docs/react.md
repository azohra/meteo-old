# React

`@azohra/meteo/station/react`: hooks that poll a mounted feed
([getting-started.md](getting-started.md)) and components that render it,
themed via the tokens in [theming.md](theming.md).

```ts
import "@azohra/meteo/station/react/styles.css"; // the default skin (an intentional side effect)
```

## Hooks

Every hook takes the **mount base** (e.g. `"/api/wind"`) and builds its own
route — nobody passes a full endpoint:

- `useStation(url, stationId, options)` → `{ feed, station, receivedAtMs, error, refresh }`.
  Composes the two hooks below plus `mergeCurrent`, including the clock rule: a merged
  current response advances `receivedAtMs`; a merge that didn't take (station unavailable,
  or absent from the feed) keeps the feed's own clock.
- `useStationFeed(url, options)` → `{ feed, error, receivedAtMs, refresh }`. Polls
  `${url}/feed` at the fastest `recommendedPollSeconds` any station advises;
  visibility-gated; keeps the last good document on errors.
- `useStationCurrent(url, stationId, options)` polls `${url}/current?station=<id>`; fold
  it into the full feed with `mergeCurrent(feed, current)` — or just use `useStation`.
- `error` is structured: `{ kind: "network", status? }` carries the HTTP status when a
  response arrived; `{ kind: "contract", cause? }` carries the zod error (or JSON syntax
  error) behind an unreadable body. Null while the last poll was clean.
- Options: `pollSeconds`, `currentPollSeconds` (useStation), `enabled`, `fetchInit`
  (headers, credentials, cache mode — the hook's own abort signal always wins), and
  `initialData`.

`useFreshness(observedAt, servedAt, receivedAtMs, thresholds?)` grades an
observation for display — the semantics are the wire contract's
[freshness model](wire-contract.md#freshness-the-servedat-anchor).

## The provider

`StationFeedProvider` is the package-wide ambient default: it carries
`{ feed, receivedAtMs }` (servedAt is read off the feed) plus the display
defaults `strings`, `unit`, `formatTime`, `thresholds`, and an optional
`locale` that pins the default time format so SSR and hydration passes agree.
Every component's data and display props become optional overrides over it —
an explicit prop always wins, and components still work fully via explicit
props with no provider anywhere.

Per-station components inside a provider resolve their station in this order:
an explicit `station` prop → a `stationId` prop looked up in the feed → the
feed's `primaryStationId` → `stations[0]`. A component that resolves nothing
throws a wiring error rather than rendering a mystery blank.

## Thresholds

**Thresholds are unit-explicit**: `thresholds: { unit, values }` speaks the
consumer's vocabulary (`{ unit: "kmh", values: [12, 20, 28] }`) and is
converted to the m/s wire once, internally (`thresholdsToMps`, exported from
`@azohra/meteo/station` next to the other unit conversions) — chart guide
labels print the numbers you declared, never round-tripped wire values.
Inside a provider, `thresholds={null}` opts one component out of the ambient
grading. Bands map to `wind-band-0..n` classes; the colours are
[yours](theming.md#speed-bands-and-your-palette).

## Components

Wind-speed components are display-unit aware (`unit?: "kmh" | "knots" | "mph" | "mps"`,
default `"kmh"`) and all take `strings` (word overrides / i18n) and `formatTime`.
Per-station components take `station` (or `stationId`); fleet components take `stations`.

| Component | Props that matter |
|---|---|
| `WindStation` | The station card, a compound (below). `station`/`stationId`, `servedAt`, `receivedAtMs`, `thresholds`, `unit` |
| `CurrentConditions` | The instrument dial. Same props; calm hides the needle, outages grey the dial |
| `WindHistoryChart` | Lull–gust band + graded mean. `thresholds` (guide labels show your declared numbers), `plotHeight` |
| `TrendChart` | Temperature (°C) or sea-level pressure (hPa) over history. `series: "temperature" \| "pressure"`; null gaps break the trace, never interpolated. No `unit` — the units are the series' own |
| `WindRose` | Direction shares. `station`/`stationId` or raw `points`, `sectorCount`, `thresholds`, `favorableDirections`. No `unit` — the rose shows percentages |
| `StationCompare` | One row per `stations` entry; unavailable rows keep their geometry. `servedAt`, `receivedAtMs` |
| `AirMatrix` | Humidity → lightning behind a live disclosure; columns only for conditions-capable `stations` |
| `FreshnessBadge` | A dot and a word, from `useFreshness` |

`receivedAtMs` is `number | null` everywhere — null (feed still loading) simply withholds
the freshness badge.

### Composing the station card

`WindStation` is a context provider: with **no children authored** it renders
the full card (header, instrument, chart, summary); with children you say
which pieces appear, in what order, without re-threading props. The trigger
is `children === undefined` — authored children that evaluate to `false` or
`null` (a `{cond && <X/>}` expression) still mean composition mode, so a
condition going false never surprise-renders the whole default card. Each
piece also accepts explicit props that override the card's context — one
chart can wear its own thresholds. Pieces ride the root as properties and as
flat named exports (`WindStationChart` et al., for toolchains that dislike
dot-access across an RSC client boundary); rendering one outside
`<WindStation>` throws.

```tsx
<WindStation stationId="launch" unit="knots">
  <WindStation.Header />
  <WindStation.Chart thresholds={{ unit: "knots", values: [6, 11, 15] }} />
  <WindStation.Summary />
</WindStation> {/* no instrument: the compare table above already states the reading */}
```

### The rose's judgment ring

`favorableDirections={[{ fromDeg: 260, toDeg: 340 }]}` (degrees FROM; sectors
may wrap through north) draws a thin ring outside the rose's grid: favorable
arcs in `--wind-favorable`, the remainder in `--wind-unfavorable`. The ring
judges direction, the petals report distribution — the two never mix.

## SSR and App Router

`"use client"` is baked into every react module — import straight into an App Router
tree, no wrapper files. Components render fully under `renderToString` (the chart draws
after its first client-side measurement), and freshness is computed from `receivedAtMs`,
not the wall clock, so server and client markup agree. The default time format resolves
the runtime's locale lazily — pass `locale` on `StationFeedProvider` (or your own
`formatTime`) when server and client locales may differ. To skip the client's blank first
paint, fetch the feed in a server component and seed the hook:

```tsx
const body = await fetch(FEED_URL).then((r) => r.text());
const feed = parseStationFeedJson(body); // from @azohra/meteo/station
// pass { feed, receivedAtMs: Date.now() } to useStation's / useStationFeed's initialData
```

## Board cells recipe

A compact per-station row — primary station reading plus freshness — derived straight off
the feed, for overview boards that link into full pages:

```tsx
import { speedFromMps, speedUnitLabel, stationFreshnessThresholds } from "@azohra/meteo/station";
import { FreshnessBadge, useFreshness, useStationFeed } from "@azohra/meteo/station/react";

function BoardCell({ url }: { url: string }) {
  // url is the mount base; the hook polls `${url}/feed`.
  const { feed, receivedAtMs } = useStationFeed(url, { fetchInit: { cache: "no-store" } });
  const station = feed?.stations.find((s) => s.id === feed.primaryStationId) ?? feed?.stations[0];
  const status = useFreshness(
    station?.reading?.observedAt, feed?.servedAt, receivedAtMs,
    station ? stationFreshnessThresholds(station) : undefined,
  );
  if (!station) return null;
  return (
    <div className="meteo-root">
      <strong>{station.name}</strong>{" "}
      {station.reading
        ? `${Math.round(speedFromMps(station.reading.averageMps, "knots"))} ${speedUnitLabel("knots")}`
        : "—"}
      {status && <FreshnessBadge status={status} />}
    </div>
  );
}
```

## Stability

Pre-1.0: the wire contract and environment helpers are stable; handler
internals are not. Pin a minor version if you reach past the documented
surface.
