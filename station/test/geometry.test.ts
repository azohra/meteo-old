/* vectorMeanWind and dailyPattern are new trigonometry with no prior test
 * coverage in the suite to lean on — pinned directly rather than only
 * through a component render. */
import { describe, expect, it } from "vitest";
import {
  METEOROLOGICAL_SEASON_MONTHS,
  dailyPattern,
  filterByMonth,
  filterByTimeOfDay,
  vectorMeanWind,
} from "../index.js";
import type { HistoryPoint } from "../index.js";
import { iso, makePoints } from "./fixtures.js";

const point = (overrides: Partial<HistoryPoint>): HistoryPoint => ({
  observedAt: iso(0),
  averageMps: 5,
  gustMps: null,
  lullMps: null,
  directionDeg: 0,
  temperatureC: null,
  ...overrides,
});

describe("vectorMeanWind", () => {
  it("reports zero speed and no direction for an empty window", () => {
    expect(vectorMeanWind([])).toEqual({ directionDeg: null, speedMps: 0 });
  });

  it("averages a steady wind to itself", () => {
    const points = [point({ averageMps: 10, directionDeg: 270 }), point({ averageMps: 10, directionDeg: 270 })];
    const result = vectorMeanWind(points);
    expect(result.speedMps).toBeCloseTo(10, 5);
    expect(result.directionDeg).toBeCloseTo(270, 5);
  });

  it("cancels two equal, opposite samples toward calm", () => {
    const points = [point({ averageMps: 10, directionDeg: 0 }), point({ averageMps: 10, directionDeg: 180 })];
    const result = vectorMeanWind(points);
    expect(result.speedMps).toBeCloseTo(0, 5);
    expect(result.directionDeg).toBeNull();
  });

  it("pulls the resultant down when a calm sample (no direction) shares the window", () => {
    const points = [point({ averageMps: 10, directionDeg: 90 }), point({ averageMps: 0.1, directionDeg: null })];
    const result = vectorMeanWind(points);
    /* Divided by the full window (2), not just the blowing sample (1) — a
     * calm minute is still a minute. */
    expect(result.speedMps).toBeCloseTo(5, 5);
    expect(result.directionDeg).toBeCloseTo(90, 5);
  });

  it("never walks the long way from 350° to 10°", () => {
    const points = [point({ averageMps: 8, directionDeg: 350 }), point({ averageMps: 8, directionDeg: 10 })];
    const result = vectorMeanWind(points);
    expect(result.directionDeg).toBeCloseTo(0, 3);
  });
});

describe("dailyPattern", () => {
  it("rejects a slot width that does not divide a day evenly", () => {
    expect(() => dailyPattern([], { slotMinutes: 100 })).toThrow(/evenly/);
  });

  it("defaults to eight 3-hour slots covering the whole day", () => {
    const slots = dailyPattern([]);
    expect(slots).toHaveLength(8);
    expect(slots.map((slot) => slot.startMinuteOfDay)).toEqual([0, 180, 360, 540, 720, 900, 1080, 1260]);
    expect(slots.every((slot) => slot.sampleCount === 0)).toBe(true);
  });

  it("buckets by time-of-day alone, merging samples from different days", () => {
    const points = [
      point({ observedAt: iso(Date.parse("2026-01-01T01:00:00Z")), averageMps: 4, directionDeg: 90 }),
      point({ observedAt: iso(Date.parse("2026-06-15T01:30:00Z")), averageMps: 6, directionDeg: 90 }),
      point({ observedAt: iso(Date.parse("2026-01-01T13:00:00Z")), averageMps: 20, directionDeg: 270 }),
    ];
    const slots = dailyPattern(points, { slotMinutes: 60 });
    expect(slots).toHaveLength(24);
    expect(slots[1]?.sampleCount).toBe(2);
    expect(slots[1]?.speedMps).toBeCloseTo(5, 5);
    expect(slots[13]?.sampleCount).toBe(1);
    expect(slots[13]?.speedMps).toBeCloseTo(20, 5);
  });

  it("shifts buckets by a plain UTC offset, not an IANA zone", () => {
    const points = [point({ observedAt: iso(Date.parse("2026-01-01T23:30:00Z")), averageMps: 9, directionDeg: 0 })];
    const utc = dailyPattern(points, { slotMinutes: 60 });
    const shifted = dailyPattern(points, { slotMinutes: 60, utcOffsetMinutes: 120 });
    expect(utc[23]?.sampleCount).toBe(1);
    expect(shifted[1]?.sampleCount).toBe(1);
  });

  it("stays finite over a long, mixed history", () => {
    const slots = dailyPattern(makePoints(500));
    expect(slots.reduce((total, slot) => total + slot.sampleCount, 0)).toBe(500);
  });
});

describe("filterByMonth", () => {
  const points = [
    point({ observedAt: iso(Date.parse("2026-01-15T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-07-04T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-08-20T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-12-25T00:00:00Z")) }),
  ];

  it("keeps only the named months, merging years", () => {
    expect(filterByMonth(points, [1, 12])).toHaveLength(2);
    expect(filterByMonth(points, METEOROLOGICAL_SEASON_MONTHS.summer)).toHaveLength(2);
  });

  it("shifts the month boundary by a plain UTC offset near midnight", () => {
    const nearMidnight = [point({ observedAt: iso(Date.parse("2026-08-01T00:30:00Z")) })];
    expect(filterByMonth(nearMidnight, [8])).toHaveLength(1);
    expect(filterByMonth(nearMidnight, [7], -60)).toHaveLength(1);
  });
});

describe("filterByTimeOfDay", () => {
  const atHour = (hour: number) =>
    point({ observedAt: iso(Date.parse(`2026-08-09T${String(hour).padStart(2, "0")}:00:00Z`)) });
  const points = [atHour(3), atHour(11), atHour(14), atHour(22)];

  it("keeps a plain [from, to) window", () => {
    const midday = filterByTimeOfDay(points, 9 * 60, 15 * 60);
    expect(midday).toHaveLength(2);
  });

  it("wraps a night window across midnight", () => {
    const night = filterByTimeOfDay(points, 21 * 60, 6 * 60);
    expect(night).toHaveLength(2);
  });

  it("shifts by a plain UTC offset", () => {
    /* 22:00 UTC is 03:00 the next day at UTC+5 — inside a 00:00-06:00
     * window only once shifted. */
    expect(filterByTimeOfDay([atHour(22)], 0, 6 * 60)).toHaveLength(0);
    expect(filterByTimeOfDay([atHour(22)], 0, 6 * 60, 5 * 60)).toHaveLength(1);
  });
});
