/* mergeCurrent is framework-free policy on the isomorphic root — these
 * tests run in node, no DOM, pinning the degradation and clock rules every
 * binding folds with. */
import { describe, expect, it } from "vitest";
import { foldCurrent, mergeCurrent } from "../index.js";
import {
  BASE_MS,
  conditionsFixture,
  downStation,
  feedFixture,
  iso,
  okStation,
} from "./fixtures.js";

describe("mergeCurrent", () => {
  it("replaces the matching station's reading, keeps its history, reports merged", () => {
    const feed = feedFixture();
    const newReading = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      averageMps: 33.3,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: newReading, history: null },
    });
    expect(result.merged).toBe(true);
    const station = result.feed.stations[0];
    expect(station?.status).toBe("ok");
    expect(station?.reading?.averageMps).toBe(33.3);
    expect(station?.history?.points.length).toBe(12);
    expect(result.feed.servedAt).toBe(iso(BASE_MS + 61_000));
    /* Other stations untouched. */
    expect(result.feed.stations[1]).toBe(feed.stations[1]);
  });

  it("preserves prior temperature, wind chill, and conditions over structural nulls", () => {
    const prior = okStation({
      reading: {
        ...okStation().reading,
        temperatureC: 14.2,
        windChillC: 10.1,
        conditions: conditionsFixture(),
      },
    });
    const feed = feedFixture([prior, downStation()]);
    /* The light endpoint's shape: fresh wind, nulled extras. */
    const light = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      averageMps: 27.5,
      directionDeg: 200,
      gustMps: 31,
      lullMps: 22,
      temperatureC: null,
      windChillC: null,
      conditions: null,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: light, history: null },
    });
    expect(result.merged).toBe(true);
    const reading = result.feed.stations[0]?.reading;
    /* Wind fields are what the endpoint refreshes: always current's. */
    expect(reading?.averageMps).toBe(27.5);
    expect(reading?.directionDeg).toBe(200);
    expect(reading?.observedAt).toBe(iso(BASE_MS + 60_000));
    /* Structurally omitted fields keep the feed's prior values: the sensor
     * did not go dark, the endpoint just does not carry them. */
    expect(reading?.temperatureC).toBe(14.2);
    expect(reading?.windChillC).toBe(10.1);
    expect(reading?.conditions?.relativeHumidityPercent).toBe(64);
    expect(reading?.conditions?.uvIndex).toBe(6.1);
  });

  it("lets a non-null current value win over the preserved prior", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: {
        ...okStation(),
        reading: { ...okStation().reading, temperatureC: -3.5 },
        history: null,
      },
    });
    expect(result.merged).toBe(true);
    expect(result.feed.stations[0]?.reading?.temperatureC).toBe(-3.5);
  });

  it("reports merged:false and keeps the feed when the current response is unavailable", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...downStation(), id: "test-station" },
    });
    /* merged:false tells the caller to keep the PREVIOUS receivedAtMs — the
     * feed did not advance, so its age must not reset. */
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });

  it("reports merged:false when the current names a station absent from the feed", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), id: "not-in-feed" },
    });
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });

});

describe("foldCurrent", () => {
  it("takes the current's clock only when the merge advanced", () => {
    const feed = feedFixture();
    const current = {
      schemaVersion: 1 as const,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), history: null },
    };
    const folded = foldCurrent(feed, BASE_MS + 1_000, current, BASE_MS + 61_500);
    expect(folded.receivedAtMs).toBe(BASE_MS + 61_500);
    expect(folded.feed?.servedAt).toBe(iso(BASE_MS + 61_000));
  });

  it("keeps the feed's own clock when the current did not merge", () => {
    const feed = feedFixture();
    const current = {
      schemaVersion: 1 as const,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...downStation(), id: "test-station" },
    };
    /* Never credit a dead station with a response it never produced. */
    const folded = foldCurrent(feed, BASE_MS + 1_000, current, BASE_MS + 61_500);
    expect(folded.receivedAtMs).toBe(BASE_MS + 1_000);
    expect(folded.feed).toBe(feed);
  });

  it("passes the feed through untouched when there is no current at all", () => {
    const feed = feedFixture();
    expect(foldCurrent(feed, BASE_MS + 1_000, null, null)).toEqual({
      feed,
      receivedAtMs: BASE_MS + 1_000,
    });
    expect(foldCurrent(null, null, null, null)).toEqual({ feed: null, receivedAtMs: null });
  });
});
