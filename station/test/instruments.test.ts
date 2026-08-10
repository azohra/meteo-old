/* Instrument math is shared truth on the isomorphic root — node tests over
 * fixed inputs pinning the exact path strings and splits both bindings
 * draw. A change here is a visual change in every binding at once. */
import { describe, expect, it } from "vitest";
import {
  DIAL_MIN_MAX_MPS,
  bandStrips,
  dialNeedlePoints,
  dialScaleMaxMps,
  dialSpeedArcPath,
  historyRuns,
  rosePetalPath,
  roseRingArcPath,
  sparklineScale,
  speedToMps,
  trendRuns,
} from "../index.js";
import type { HistoryPoint } from "../index.js";
import { iso, makePoints } from "./fixtures.js";

describe("dial math", () => {
  it("draws the speed arc clockwise from north, large-arc past half", () => {
    expect(dialSpeedArcPath(0.25)).toBe("M 80.0 10.0 A 70 70 0 0 1 150.0 80.0");
    expect(dialSpeedArcPath(0.75)).toBe("M 80.0 10.0 A 70 70 0 1 1 10.0 80.0");
    /* Fraction 1 stops a hair short so the arc renders instead of vanishing. */
    expect(dialSpeedArcPath(1)).toContain("A 70 70 0 1 1");
  });

  it("points the needle blade downwind of the FROM bearing", () => {
    /* From the north (0°) the blade tip lands due south of centre. */
    expect(dialNeedlePoints(0)).toBe("80.0,140.0 75.0,80.0 85.0,80.0");
  });

  it("scales against the fixed floor or the next display-unit step over the gust", () => {
    expect(dialScaleMaxMps(2, 3, "kmh")).toBe(DIAL_MIN_MAX_MPS);
    const stepMps = speedToMps(10, "knots");
    expect(dialScaleMaxMps(10, 3 * stepMps + 0.01, "knots")).toBeCloseTo(4 * stepMps, 10);
    expect(dialScaleMaxMps(null, null, "kmh")).toBe(DIAL_MIN_MAX_MPS);
  });
});

describe("rose math", () => {
  it("draws a petal between the hub and its radius", () => {
    expect(rosePetalPath(0, 60, 10)).toBe(
      "M 92.2 79.2 L 84.6 35.9 A 60.0 60.0 0 0 1 105.4 35.9 L 97.8 79.2 A 16 16 0 0 0 92.2 79.2 Z",
    );
  });

  it("wraps the favorable ring arc through north via the clockwise span", () => {
    /* 300° → 40° spans 100° clockwise: a small arc across the top. */
    expect(roseRingArcPath({ fromDeg: 300, toDeg: 40 })).toBe(
      "M 30.0 57.5 A 75 75 0 0 1 143.2 37.5",
    );
    /* A zero-span sector draws a degenerate arc, not a full circle. */
    expect(roseRingArcPath({ fromDeg: 90, toDeg: 90 })).toBe("M 170.0 95.0 A 75 75 0 0 1 170.0 95.0");
  });
});

describe("sparkline math", () => {
  it("splits runs on dropouts and strips on missing gust–lull pairs", () => {
    const points = makePoints(6);
    /* Push the last three samples an hour out: one dropout, two runs. */
    const shifted: HistoryPoint[] = points.map((point, index) =>
      index < 3 ? point : { ...point, observedAt: iso(Date.parse(point.observedAt) + 3_600_000) },
    );
    const runs = historyRuns(shifted, 10);
    expect(runs.map((run) => run.points.length)).toEqual([3, 3]);
    expect(runs[0]?.startedAt).toBe(shifted[0]?.observedAt);
    expect(runs[1]?.startedAt).toBe(shifted[3]?.observedAt);

    /* Null the middle sample's gust: the band breaks, the runs do not. */
    const holed = shifted.map((point, index) =>
      index === 1 ? { ...point, gustMps: null } : point,
    );
    const strips = bandStrips(historyRuns(holed, 10));
    expect(strips.map((strip) => strip.points.length)).toEqual([1, 1, 3]);
  });

  it("scales zero-to-padded-max and pins a dead-calm window to the floor", () => {
    const points = makePoints(4);
    const gusty = Math.max(...points.map((point) => point.gustMps ?? 0));
    const scale = sparklineScale(points, 120, 32);
    expect(scale.scaleMax).toBeCloseTo(gusty * 1.1, 10);
    expect(scale.yAt(0)).toBe(31);
    expect(scale.xAt(Date.parse(points[0]?.observedAt ?? ""))).toBe(1);

    const calm = points.map((point) => ({
      ...point,
      averageMps: 0,
      gustMps: null,
      lullMps: null,
    }));
    expect(sparklineScale(calm, 120, 32).scaleMax).toBe(1);
  });
});

describe("trend runs", () => {
  it("breaks on null values and on dropouts, keeps lone samples", () => {
    const points = makePoints(5).map((point, index) => ({
      ...point,
      temperatureC: index === 2 ? null : 10 + index,
    }));
    const runs = trendRuns(points, "temperature", 10);
    expect(runs.map((run) => run.samples.length)).toEqual([2, 2]);
    expect(runs[0]?.samples[0]?.[1]).toBe(10);
    expect(runs[1]?.startedAt).toBe(points[3]?.observedAt);
  });
});
