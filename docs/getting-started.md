# Getting started

Two moves: mount the feed handler on your server, then render components
against it. Everything else — [adapters](adapters.md), [theming](theming.md),
[the React surface](react.md), [the wire itself](wire-contract.md) — layers
on top of this page.

## Install

Until the npm scope lands, install straight from GitHub — the import strings
are identical either way:

```jsonc
// package.json
"dependencies": { "@azohra/meteo": "github:azohra/meteo#v0.1.0" }
```

pnpm ≥ 11 consumers must allow the git dependency's build script (it compiles
its own `dist/` on install); pnpm prints the exact `allowBuilds` entry to add
to `pnpm-workspace.yaml` on first install. That entry pins the tag's commit
SHA, so bumping to a new tag means updating the `allowBuilds` line too —
pnpm will print the new one.

## 1 · Mount the feed

```ts
import { createStationFeedHandler } from "@azohra/meteo/station/server";

// Every station below is fictional — substitute your own identifiers.
const handler = createStationFeedHandler({
  stations: [
    { vendor: "windnerd", id: "bluff", name: "Bluff Launch",
      stationKey: "bluff-launch", locationId: 8675 },
    { vendor: "tempest", id: "meadow", name: "Ridge Meadow",
      stationId: 12345, token: process.env.TEMPEST_TOKEN! },
    { vendor: "campbell", id: "summit", name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.", source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver", latitude: 49.5, longitude: -118.5 },
  ],
  primaryStationId: "summit",
  cors: true,
});

// Mount anywhere that speaks web-standard Request/Response — Node 18.17+,
// workers, Deno, or a framework route. Routing is by pathname suffix.
export default { fetch: handler }; // e.g. a Cloudflare worker
```

```sh
curl 'https://your.host/wind/feed'                   # every station + history
curl 'https://your.host/wind/feed?hours=2'           # narrower window (≤ the ceiling)
curl 'https://your.host/wind/current?station=summit' # one station, reading only
```

`maxHistoryHours` (default 6) is both the default window and the ceiling
`?hours=` clamps to; requested hours snap to quarter-hour steps. Routing
matches by pathname suffix by default; pass `basePath: "/api/wind"` to pin
exact-match routes (`/api/wind/feed`, `/api/wind/current`) when several
handlers are mounted beside each other.

Responses carry `Cache-Control` (honest against upstream cache TTLs) and a
weak `ETag` computed over station content excluding `servedAt`, so unchanged
upstreams revalidate to 304. Override caching for a CDN with:

```ts
cacheControl: (route, maxAge) =>
  `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`,
```

### Dynamic configuration

`stations` may also be a resolver — a database read, a KV fetch — called once
per assembly, with the `Request` when the handler invoked it:

```ts
createStationFeedHandler({ stations: async (request) => readStationsFromDb(request) });
```

A station whose config fails validation (or repeats an id) degrades to
`unavailable`/`not_configured` with the zod issues logged — a bad row never
500s the feed. Static arrays get the same check eagerly at construction,
which warns loudly but does not throw.

### The data-level API

The handler is a thin HTTP wrapper. For cron jobs, static builds, or
framework loaders, call the data layer directly:

```ts
import { loadStationFeed, loadStationCurrent } from "@azohra/meteo/station/server";

const feed = await loadStationFeed({ stations, historyHours: 3 });             // StationFeed
const current = await loadStationCurrent({ stations, stationId: "summit" });   // StationCurrent
```

Both own the degradation belt (an adapter that throws costs one station,
never the document), `servedAt`, and `schemaVersion`.

## 2 · Render the fleet

```tsx
import "@azohra/meteo/station/react/styles.css"; // the default skin (an intentional side effect)
import {
  StationFeedProvider, useStation, WindStation, StationCompare,
} from "@azohra/meteo/station/react";

function LiveWind() {
  // The argument is the MOUNT BASE — where the handler is mounted. The hook
  // polls `${base}/feed` AND `${base}/current?station=bluff`, folds the
  // fast reading into the full feed, and applies the freshness clock rule.
  const { feed, receivedAtMs } = useStation("/api/wind", "bluff", {
    fetchInit: { cache: "no-store" },
  });
  if (!feed) return null;
  return (
    <div className="meteo-root">
      <StationFeedProvider
        feed={feed}
        receivedAtMs={receivedAtMs}
        thresholds={{ unit: "kmh", values: [12, 20, 28] }} // the club's vocabulary
        unit="knots"                                       // what the numbers wear
      >
        <WindStation />     {/* the feed's primary station, provider-fed */}
        <StationCompare />  {/* the whole fleet, no props re-threaded */}
      </StationFeedProvider>
    </div>
  );
}
```

`useStationFeed(url)` polls the feed alone; `useStation` adds the light
`/current` poll for the station you name. Hooks, the provider contract,
composition, and SSR seeding are covered in [react.md](react.md); the tokens
the components wear are in [theming.md](theming.md).

## Where next

| Topic | Page |
|---|---|
| The document shape, semantics, and HTTP protocol | [wire-contract.md](wire-contract.md) |
| Built-in vendors, custom adapters, environment injection | [adapters.md](adapters.md) |
| Hooks, provider, components, SSR | [react.md](react.md) |
| Tokens, dark mode, `@layer` | [theming.md](theming.md) |
