# Adapters

How station hardware becomes wire documents. Three vendors are built in —
WindNerd, WeatherFlow Tempest, Campbell Scientific — and anything else plugs
in as a custom adapter. Campbell Scientific loggers carry per-station IANA
zones with context-disambiguated DST handling. The documents they produce
are specified in [wire-contract.md](wire-contract.md).

## The custom arm

Any station without a built-in vendor plugs in as `vendor: "custom"`:

```ts
const stations = [{
  vendor: "custom", id: "ridge", name: "Ridge Sensor",
  latitude: 49.5, longitude: -117.5, timeZone: "America/Vancouver",
  async load({ environment, historyHours, mode, station }) {
    // `station` is the parsed identity from this very config entry (id, name,
    // position, zone, pageUrl — nullish claims normalized to null), so meta
    // never re-declares the fields written three lines up.
    const body = await environment.fetch("https://acme.example/latest");
    return toStation(station, await body.json()); // must be a valid Station
  },
}];
```

The returned document is validated against the wire schema; an invalid return
degrades that station to `unavailable`/`contract_break` and the rest of the
feed survives. A loader that **throws** degrades through the same reason
mapping the built-in adapters use: a thrown `UpstreamError("…", "timeout")`
surfaces as `timeout`, a network `TypeError` as `upstream_error` —
`contract_break` is reserved for invalid returned documents and unclassified
throws.

## The plugin-factory pattern

A third-party vendor package ships the same thing as a **plugin factory** — a
function closing over vendor options and returning a config entry:

```ts
// @acme/meteo-acmewind
import { emptyConditions, unavailableStation } from "@azohra/meteo/station";
import { fetchUpstreamText, type StationConfigInput } from "@azohra/meteo/station/server";

export function acmeStation(options: {
  id: string; name: string; deviceUrl: string; apiKey: string;
}): StationConfigInput {
  return {
    vendor: "custom", id: options.id, name: options.name,
    async load({ environment, historyHours, mode, station }) {
      const text = await fetchUpstreamText(environment, {
        url: `${options.deviceUrl}/latest`,
        headers: { Authorization: `Bearer ${options.apiKey}` },
        cacheKey: `acmewind/${options.deviceUrl}`, // names the upstream, not the key
        cacheTtlSeconds: 30,
        subject: `AcmeWind ${options.deviceUrl}`,
      });
      return toStation(station, JSON.parse(text));
    },
  };
}

// host app:
// stations: [acmeStation({ id: "ridge", name: "Ridge Sensor", deviceUrl: "…", apiKey: "…" })]
```

## defineStationAdapter

Vendor packages that want the full built-in treatment build their loader with
`defineStationAdapter({ meta, load })` from `@azohra/meteo/station/server`.
It owns environment resolution, meta assembly, the try/catch degradation
belt, failure logging, reason mapping, and `mode: "current"` slimming — the
adapter body is then parse + map, nothing else. Inside its `load`, throw
freely; the belt degrades.

## The rulebook

The rules below bind what an adapter *returns*, however it is built:

- Never resolve a healthy-looking document for an upstream failure: the
  station degrades to `unavailable` with a reason (the belt does this for
  anything thrown).
- Capabilities are declared from what the hardware carries, never inferred
  from the data that happened to arrive.
- Calm (below the WMO threshold) carries no direction; the speed still
  travels.
- Plausibility bounds live in the adapter, in the VENDOR's units (0–500 km/h
  for km/h upstreams, 0–140 m/s for m/s ones), where a lying instrument costs
  one station — the contract only validates shape.
- Cache keys name the upstream identity (vendor + endpoint/station), never a
  host-chosen label.
- `mode: "current"` means history `null` with meta intact — same decoder,
  lighter document.

`emptyConditions()` from `@azohra/meteo/station` is the honest starting point
for a station carrying one or two conditions-class sensors: spread the
measured fields over it and every absent quantity stays null, never zero.

## Environment injection

Adapters touch the world only through an injected environment:
`{ fetch, cache, logger, userAgent, now }`.

- **`cache`** — provide a `FeedCache` backed by KV/Redis when your platform
  runs multiple isolates, so they share one upstream poll instead of each
  keeping a private memory cache.
- **`logger`** — the default writes degradations to the console
  (`warn`/`error`); inject your own to route them, or a no-op to silence
  them. Every `LogEvent` carries a stable `code` (`"upstream_failure"`,
  `"config_invalid"`, `"clock_skew"`, …) — match alerting on codes, never on
  the prose `message`.
- **`userAgent`** — overrides the default
  `azohra-meteo/0.1 (+https://meteo.azohra.com)`.
- **`now`** — injectable clock, for tests and replay.

## The cache trust model

**The shared default cache is a trust boundary.** When no cache is injected,
every handler and bare adapter call in the process shares one bounded
in-memory cache, and concurrent misses on a key coalesce into a single
upstream hit. Cache keys name the *upstream* (vendor + endpoint/station
identity), never credentials or host-chosen labels — Tempest keys
deliberately exclude the token, so a config carrying a wrong token can be
served a payload another config's valid token warmed. That is by design
(payloads are per-station, not per-credential), but it means the default
cache trusts every tenant in the process: multi-tenant hosts whose tenants
must not share payloads — or must re-prove credentials per request — should
inject a cache per tenant.

## Polling etiquette

Every response advertises `recommendedPollSeconds` per station, derived from
upstream cache TTLs — polling faster only reheats a cache. WindNerd's records
endpoint is unofficial (it is what the vendor's own station page calls), so
treat it as a guest: this library validates every series, degrades to
`unavailable` on any contract break rather than guessing, and identifies
itself with an honest User-Agent
(`azohra-meteo/0.1 (+https://meteo.azohra.com)`, overridable via
`environment.userAgent`).
