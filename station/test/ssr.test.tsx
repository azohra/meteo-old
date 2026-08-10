// @vitest-environment node
/* SSR smoke: the components must renderToString in a plain node environment
 * — no window, document, or ResizeObserver — because App Router pages render
 * them on the server before hydrating ("use client" moves the boundary, not
 * the first paint). The chart renders its wrapper and defers drawing to the
 * client's first measurement; everything else renders in full.
 *
 * Hydration sanity: useFreshness seeds its clock from receivedAtMs, a prop
 * both passes share, never Date.now() — so the badge below is asserted as a
 * deterministic value, which is exactly the property hydration needs. */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AirMatrix,
  StationTable,
  StationFeedProvider,
  StationStrip,
  TrendChart,
  WindStation,
  defaultStrings,
} from "../react/index.js";
import { BASE_MS, conditionsStation, downStation, feedFixture, okStation } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

describe("server rendering", () => {
  it("renderToString produces non-empty markup for the composite components", () => {
    const feed = feedFixture([okStation(), conditionsStation(), downStation()]);
    const html = renderToString(
      <div className="meteo-root">
        <WindStation
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          servedAt={feed.servedAt}
          station={okStation()}
          thresholds={{ unit: "kmh", values: [12, 20, 28] }}
          unit="knots"
        />
        <AirMatrix formatTime={isoTime} stations={feed.stations} />
        <StationTable
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          servedAt={feed.servedAt}
          stations={feed.stations}
        />
        <TrendChart formatTime={isoTime} series="temperature" station={okStation()} />
      </div>,
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Test Station");
    expect(html).toContain("meteo-air-trigger");
    expect(html).toContain("wind-table");
    /* Like the wind chart, the trend renders its wrapper on the server and
     * defers drawing to the client's first measurement. */
    expect(html).toContain("meteo-trend");
  });

  it("renderToString handles a provider-fed page with propless components", () => {
    const feed = feedFixture([okStation(), conditionsStation(), downStation()]);
    const html = renderToString(
      <div className="meteo-root">
        <StationFeedProvider
          feed={feed}
          formatTime={isoTime}
          receivedAtMs={BASE_MS + 30_000}
          thresholds={{ unit: "kmh", values: [12, 20, 28] }}
          unit="knots"
        >
          <WindStation />
          <StationTable />
          <StationStrip />
          <AirMatrix />
        </StationFeedProvider>
      </div>,
    );
    /* The provider resolved the primary station and threaded the defaults. */
    expect(html).toContain("Test Station");
    expect(html).toContain("wind-dial-arc wind-band-1");
    expect(html).toContain("meteo-strip");
    expect(html).toContain("meteo-air-trigger");
    expect(html).toContain(defaultStrings.freshness.live);
  });

  it("renderToString handles a composed WindStation subset", () => {
    const feed = feedFixture([okStation()]);
    const html = renderToString(
      <WindStation
        formatTime={isoTime}
        receivedAtMs={BASE_MS + 30_000}
        servedAt={feed.servedAt}
        station={okStation()}
      >
        <WindStation.Chart />
        <WindStation.Summary />
      </WindStation>,
    );
    expect(html).toContain("wind-summary");
    expect(html).not.toContain("wind-dial");
  });

  it("computes initial freshness from receivedAtMs, not the server's Date.now", () => {
    /* The fixture's reading is 30 s old at serve time and receivedAtMs is the
     * serve moment: freshness must say Live no matter when this test runs. A
     * Date.now() seed would make the status a function of the wall clock —
     * the exact nondeterminism that mismatches server and client markup. */
    const feed = feedFixture([okStation()]);
    const html = renderToString(
      <StationTable
        formatTime={isoTime}
        receivedAtMs={BASE_MS + 30_000}
        servedAt={feed.servedAt}
        stations={feed.stations}
      />,
    );
    expect(html).toContain(defaultStrings.freshness.live);
    expect(html).not.toContain(defaultStrings.freshness.stale);
  });
});
