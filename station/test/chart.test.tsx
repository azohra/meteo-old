// @vitest-environment jsdom
/* jsdom has no ResizeObserver, so the chart draws at CHART_FALLBACK_WIDTH —
 * which is exactly the fallback path under test. Pointer geometry tests mock
 * getBoundingClientRect (jsdom reports zero) so a click lands at a chart x. */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindHistoryChart } from "../react/index.js";
import { defaultStrings } from "../index.js";
import { MINUTE_MS, iso, makePoints, okStation } from "./fixtures.js";

const isoTime = (date: Date) => date.toISOString();

const mockChartBounds = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 180,
    right: 360,
    width: 360,
    height: 180,
    toJSON: () => ({}),
  } as DOMRect);

/* The same 12-point history shifted whole periods forward — the sliding
 * window a live feed produces. */
const slidPoints = (periods: number) =>
  makePoints(12).map((point) => ({
    ...point,
    observedAt: iso(Date.parse(point.observedAt) + periods * 5 * MINUTE_MS),
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindHistoryChart", () => {
  it("draws band, single mean polyline, vanes, and ticks without thresholds", () => {
    const { container } = render(<WindHistoryChart station={okStation()} />);
    expect(container.querySelector("polygon.meteo-wind-band")).not.toBeNull();
    expect(container.querySelector("polyline.meteo-wind-mean")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-mean-segment")).toBeNull();
    expect(container.querySelector(".meteo-wind-zone")).toBeNull();
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".meteo-tick").length).toBe(5);
  });

  it("grades the mean per segment, tints band zones, and labels threshold guides", () => {
    const { container } = render(
      <WindHistoryChart station={okStation()} thresholds={{ unit: "kmh", values: [12, 20] }} />,
    );
    expect(container.querySelector("polyline.meteo-wind-mean")).toBeNull();
    /* 12 points → 11 segments, spanning bands 0..2 for averages 10..21. */
    expect(container.querySelectorAll(".meteo-wind-mean-segment").length).toBe(11);
    expect(container.querySelector(".meteo-wind-mean-segment.meteo-band-0")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-mean-segment.meteo-band-2")).not.toBeNull();
    expect(container.querySelectorAll(".meteo-wind-threshold").length).toBe(2);
    /* Guides wear the band they open and carry a right-edge km/h label. */
    expect(container.querySelector(".meteo-wind-threshold.meteo-band-1")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-threshold-label.meteo-band-2")?.textContent).toBe("20");
    /* Zones: under-first-threshold, 12–20, and 20–scaleMax. */
    expect(container.querySelectorAll(".meteo-wind-zone").length).toBe(3);
    expect(container.querySelector(".meteo-wind-zone.meteo-band-0")).not.toBeNull();
    expect(container.querySelector(".meteo-wind-zone.meteo-band-2")).not.toBeNull();
  });

  it("rounds the axis in the DISPLAY unit and prints declared threshold numbers", () => {
    /* Fixture gust tops at 25 km/h = 13.5 kn: a knots axis must snap its
     * ceiling to the next 5 kn step (15), not to a round km/h number. */
    const { container } = render(
      <WindHistoryChart station={okStation()} thresholds={{ unit: "kmh", values: [12, 20] }} unit="knots" />,
    );
    const gridLabels = Array.from(container.querySelectorAll(".meteo-grid-label")).map(
      (label) => label.textContent,
    );
    expect(gridLabels).toEqual(["0", "8", "15"]);
    /* Declared in km/h, displayed in knots: the guide label converts the
     * DECLARED number (20 km/h → 11 kn). */
    expect(container.querySelector(".meteo-wind-threshold-label.meteo-band-2")?.textContent).toBe("11");

    /* Declared in the display unit: the label is the consumer's number
     * verbatim, no round-trip through the wire. */
    const { container: knotsDeclared } = render(
      <WindHistoryChart
        station={okStation()}
        thresholds={{ unit: "knots", values: [7.5] }}
        unit="knots"
      />,
    );
    expect(knotsDeclared.querySelector(".meteo-wind-threshold-label.meteo-band-1")?.textContent).toBe(
      "7.5",
    );
  });

  it("drops the band when any point lacks the gust-lull pair", () => {
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point, index) =>
          index === 4 ? { ...point, gustMps: null } : point,
        ),
      },
    });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelector("polygon.meteo-wind-band")).toBeNull();
    expect(container.querySelector("polyline.meteo-wind-mean")).not.toBeNull();
  });

  it("says calm in words and dashes the vane row", () => {
    const station = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({
          ...point,
          averageMps: 0,
          gustMps: 0,
          lullMps: 0,
          directionDeg: null,
        })),
      },
    });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelector(".meteo-wind-calm-note")?.textContent).toBe(
      defaultStrings.calmHistory,
    );
    expect(container.querySelectorAll(".meteo-wind-vane").length).toBe(0);
    expect(container.querySelectorAll(".meteo-wind-vane-calm").length).toBeGreaterThan(0);
  });

  it("hatches dropout gaps found against the declared period", () => {
    const points = makePoints(12).filter((_, index) => index < 4 || index > 7);
    const station = okStation({ history: { periodMinutes: 5, points } });
    const { container } = render(<WindHistoryChart station={station} />);
    expect(container.querySelectorAll("rect.meteo-wind-gap").length).toBe(1);
  });

  it("renders nothing when the station declares no history, a note when history is thin", () => {
    const undeclared = okStation({
      capabilities: { gustLull: true, temperature: true, conditions: false, history: false },
      history: null,
    });
    const { container: empty } = render(<WindHistoryChart station={undeclared} />);
    expect(empty.firstChild).toBeNull();

    const thin = okStation({ history: { periodMinutes: 5, points: makePoints(1) } });
    const { container: note } = render(<WindHistoryChart station={thin} />);
    expect(note.querySelector(".meteo-wind-chart-na")?.textContent).toBe(defaultStrings.noHistory);
  });

  it("labels the readout live region and keeps it quiet only while previewing", () => {
    const { container } = render(<WindHistoryChart station={okStation()} />);
    const readout = container.querySelector("output.meteo-wind-chart-readout");
    expect(readout?.getAttribute("aria-label")).toBe(
      defaultStrings.aria.readout(okStation().name),
    );
    expect(readout?.getAttribute("aria-live")).toBe("polite");
  });

  it("pins by timestamp so a sliding window keeps the same moment, then clears when it leaves", () => {
    mockChartBounds();
    const BASE_MS = Date.parse(makePoints(12)[11]!.observedAt);
    const { container, rerender } = render(
      <WindHistoryChart formatTime={isoTime} station={okStation()} />,
    );
    const hit = container.querySelector(".meteo-hit") as SVGRectElement;
    /* Right edge of the plot → the newest sample (averageMps 21). */
    fireEvent.click(hit, { clientX: 354 });
    const readout = () => container.querySelector(".meteo-wind-chart-readout");
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(BASE_MS)));
    expect(readout()?.textContent).toContain(`${defaultStrings.avgLabel} 21`);

    /* Slide the window one period: the pinned moment is now index 10 with a
     * different value — a positional pin would silently show the new tail. */
    const slid = okStation({ history: { periodMinutes: 5, points: slidPoints(1) } });
    rerender(<WindHistoryChart formatTime={isoTime} station={slid} />);
    expect(readout()?.querySelector("strong")?.textContent).toBe(isoTime(new Date(BASE_MS)));
    expect(readout()?.textContent).toContain(`${defaultStrings.avgLabel} 20`);

    /* Slide far enough that the pinned moment leaves the window: the pin
     * clears and the readout names the window again. */
    const gone = okStation({ history: { periodMinutes: 5, points: slidPoints(20) } });
    rerender(<WindHistoryChart formatTime={isoTime} station={gone} />);
    expect(readout()?.textContent).toContain(defaultStrings.inspectHint);
  });

  it("reads calm below the WMO threshold and an em dash for a blowing vaneless sample", () => {
    mockChartBounds();
    /* Sub-calm samples that still carry a bearing: the readout must say calm,
     * not fabricate a direction. */
    const calmish = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({
          ...point,
          averageMps: 1 / 3.6,
          gustMps: 1.4 / 3.6,
          lullMps: 0.5 / 3.6,
          directionDeg: 45,
        })),
      },
    });
    const { container } = render(<WindHistoryChart formatTime={isoTime} station={calmish} />);
    fireEvent.click(container.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    expect(container.querySelector(".meteo-wind-chart-readout")?.textContent).toContain(
      defaultStrings.calm,
    );

    /* Blowing but vaneless: a broken vane earns the dash, never calm words. */
    const vaneless = okStation({
      history: {
        periodMinutes: 5,
        points: makePoints(12, (point) => ({ ...point, directionDeg: null })),
      },
    });
    const { container: dashed } = render(
      <WindHistoryChart formatTime={isoTime} station={vaneless} />,
    );
    fireEvent.click(dashed.querySelector(".meteo-hit") as SVGRectElement, { clientX: 354 });
    const text = dashed.querySelector(".meteo-wind-chart-readout")?.textContent ?? "";
    expect(text).not.toContain(defaultStrings.calm);
    expect(text.trim().endsWith("—")).toBe(true);
  });

  it("honours an explicit plotHeight without forking the frame's row math", () => {
    const { container: standard } = render(<WindHistoryChart station={okStation()} />);
    /* Core narrow frame: plot 76, top 10, footer 64. */
    expect(standard.querySelector(".meteo-wind-chart-svg")?.getAttribute("height")).toBe("150");

    const { container: tall } = render(
      <WindHistoryChart plotHeight={160} station={okStation()} />,
    );
    expect(tall.querySelector(".meteo-wind-chart-svg")?.getAttribute("height")).toBe("234");
  });
});
