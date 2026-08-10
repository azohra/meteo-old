# `@azohra/meteo/station`

The **station** capability of Azohra Meteo: one wire contract, vendor
adapters that normalize into it (WindNerd, WeatherFlow Tempest, Campbell
Scientific loggers, or your own), a mountable `Request → Response` handler
that serves the whole inventory as a single feed, and hooks and components
that render it — natively, in your design system, with no vendor iframe.

## Surface

| Entry point | What it is |
|---|---|
| `@azohra/meteo/station` | The isomorphic root: the wire contract (zod), pure derivations (period stats, compass, freshness, unit and threshold conversion), and framework-free chart geometry. |
| `@azohra/meteo/station/server` | Vendor adapters plus the custom-adapter interface and `defineStationAdapter`, data-level `loadStationFeed()` / `loadStationCurrent()`, and the mountable feed handler. Server-only, so it can never leak into a client bundle. |
| `@azohra/meteo/station/react` | `StationFeedProvider`, polling hooks (`useStation`, `useStationFeed`, `useStationCurrent`), the component set — `WindStation`, `CurrentConditions`, `WindHistoryChart`, `TrendChart`, `WindRose`, `StationCompare`, `StationStrip`, `AirMatrix`, `FreshnessBadge` — and an atoms layer of inline primitives (`Speed`, `Gust`, `Lull`, `Temperature`, `Pressure`, `Direction`, `UpdatedAt`, `BandChip`, `Dial`, `Sparkline`) for composing your own layouts. |
| `@azohra/meteo/station/react/styles.css` | The default skin (an intentional side effect). |

## Taste

```tsx
import { StationFeedProvider, useStation, WindStation } from "@azohra/meteo/station/react";
import "@azohra/meteo/station/react/styles.css";

function LiveWind() {
  const { feed, receivedAtMs } = useStation("/api/wind", "launch");
  if (!feed) return null;
  return (
    <div className="meteo-root">
      <StationFeedProvider feed={feed} receivedAtMs={receivedAtMs}
        thresholds={{ unit: "kmh", values: [12, 20, 28] }}>
        <WindStation />
      </StationFeedProvider>
    </div>
  );
}
```

## Documentation

Each page is the single authority for its topic:

| Page | Covers |
|---|---|
| [docs/getting-started.md](../docs/getting-started.md) | Install, mount the handler, render components, the data-level API |
| [docs/wire-contract.md](../docs/wire-contract.md) | The document shape, semantics, evolution rules, HTTP protocol, freshness model |
| [docs/adapters.md](../docs/adapters.md) | Custom adapters, `defineStationAdapter`, the rulebook, environment injection, caching, polling etiquette |
| [docs/react.md](../docs/react.md) | Provider, hooks, thresholds, composition, SSR seeding |
| [docs/theming.md](../docs/theming.md) | `.meteo-root` scoping, token tables, dark mode, `@layer` |

JSON Schema for the wire documents lives in [`../schema/`](../schema/).

## Stability

Pre-1.0: the wire contract and environment helpers are stable; handler
internals are not. Pin a minor version if you reach past the documented
surface.

MIT © Justin Watts
