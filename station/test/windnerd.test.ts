import { describe, expect, it } from "vitest";
import { historyGaps } from "../index.js";
import {
  loadWindnerdStation,
  parseWindnerdRecords,
  windnerdStationConfigSchema,
} from "../server/index.js";
import { stubEnvironment, timeoutError, windnerdPayload } from "./support.js";

const config = windnerdStationConfigSchema.parse({
  vendor: "windnerd",
  id: "bluff",
  name: "Bluff Launch",
  stationKey: "bluff-launch",
  locationId: 8675,
  elevationM: 1370,
});

/* A station carrying the optional pressure add-on: the fixture's ~947 hPa
 * wire values are station pressure at a ~450 m barometer. */
const pressureConfig = windnerdStationConfigSchema.parse({
  vendor: "windnerd",
  id: "vernon",
  name: "Vernon Lookout",
  stationKey: "vernon-lookout",
  locationId: 311,
  elevationM: 450,
  hasPressure: true,
});

describe("parseWindnerdRecords", () => {
  it("reads each series against the record times", () => {
    const records = parseWindnerdRecords(windnerdPayload(), 8675);

    expect(records.observedAt).toEqual([
      "2026-08-05T22:10:45.000Z",
      "2026-08-05T22:11:45.000Z",
      "2026-08-05T22:12:45.000Z",
    ]);
    expect(records.averageSpeedKmh).toEqual([6, 12, 9]);
    expect(records.gustSpeedKmh).toEqual([8, 21, 14]);
    expect(records.lullSpeedKmh).toEqual([4, 7, 6]);
    expect(records.directionDeg).toEqual([300, 310, 290]);
  });

  it("keeps a missing temperature as null rather than zero", () => {
    expect(parseWindnerdRecords(windnerdPayload(), 8675).temperatureC).toEqual([20.2, null, 22.6]);
  });

  /* A one-minute record only ever carries temperature_avg; the min and max
   * series appear on the aggregated periods, and requiring them stalls every
   * station. */
  it("does not require the aggregated temperature spread", () => {
    expect(parseWindnerdRecords(windnerdPayload(), 8675).temperatureC).toHaveLength(3);
  });

  it("rejects a series that no longer lines up with the record times", () => {
    expect(() => parseWindnerdRecords(windnerdPayload({ wind_max: [8, 21] }), 8675)).toThrow(
      "WindNerd location 8675 returned an invalid wind_max",
    );
  });

  it("rejects a direction outside the compass and a speed outside 0-500", () => {
    expect(() => parseWindnerdRecords(windnerdPayload({ wind_dir: [300, 400, 290] }), 8675)).toThrow(
      "WindNerd location 8675 returned an invalid wind_dir",
    );
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ wind_avg_1D: [6, -1, 9] }), 8675),
    ).toThrow("WindNerd location 8675 returned an invalid wind_avg_1D");
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ wind_max: [8, 600, 14] }), 8675),
    ).toThrow("WindNerd location 8675 returned an invalid wind_max");
  });

  it("rejects a wind series that went missing entirely", () => {
    expect(() => parseWindnerdRecords(windnerdPayload({ wind_min: undefined }), 8675)).toThrow(
      "WindNerd location 8675 returned an invalid wind_min",
    );
  });

  it("ignores the pressure series unless the config declares the board", () => {
    expect(parseWindnerdRecords(windnerdPayload(), 8675).stationPressureHpa).toEqual([
      null,
      null,
      null,
    ]);
    expect(parseWindnerdRecords(windnerdPayload(), 8675, true).stationPressureHpa).toEqual([
      947.7, 947.4, 947.2,
    ]);
    /* Without the board, a broken or absent pressure series costs nothing. */
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ pressure_hpa_avg: undefined }), 8675),
    ).not.toThrow();
  });

  it("keeps a dark pressure minute null and rejects an implausible one", () => {
    expect(
      parseWindnerdRecords(windnerdPayload({ pressure_hpa_avg: [947.7, null, 947.2] }), 8675, true)
        .stationPressureHpa,
    ).toEqual([947.7, null, 947.2]);
    /* Station pressure outside 300–1100 hPa is a lying barometer. */
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ pressure_hpa_avg: [947.7, 1200, 947.2] }), 8675, true),
    ).toThrow("WindNerd location 8675 returned an invalid pressure_hpa_avg");
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ pressure_hpa_avg: [947.7, 250, 947.2] }), 8675, true),
    ).toThrow("WindNerd location 8675 returned an invalid pressure_hpa_avg");
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ pressure_hpa_avg: undefined }), 8675, true),
    ).toThrow("WindNerd location 8675 returned an invalid pressure_hpa_avg");
  });

  it("rejects a response that is not a record set", () => {
    expect(() => parseWindnerdRecords(JSON.stringify({ error: "nope" }), 8675)).toThrow(
      "WindNerd location 8675 returned no records",
    );
  });

  it("rejects an unparseable record time", () => {
    expect(() => parseWindnerdRecords(windnerdPayload({ date_utc: ["yesterday"] }), 8675)).toThrow(
      "WindNerd location 8675 returned an invalid",
    );
  });

  it("reads utcOffsetMinutes only where the vendor sends it — the 180-minute aggregate", () => {
    /* The 1-minute payload (this fixture's default) carries no time_offset
     * at all: confirmed live, not assumed. */
    expect(parseWindnerdRecords(windnerdPayload(), 8675).utcOffsetMinutes).toBeNull();
    expect(
      parseWindnerdRecords(windnerdPayload({ time_offset: [-480, -480, -480] }), 8675)
        .utcOffsetMinutes,
    ).toBe(-480);
  });

  it("takes the first given time_offset rather than requiring every record to agree", () => {
    expect(
      parseWindnerdRecords(windnerdPayload({ time_offset: [null, -480, -480] }), 8675)
        .utcOffsetMinutes,
    ).toBe(-480);
  });

  it("rejects a time_offset outside a real UTC offset", () => {
    expect(() =>
      parseWindnerdRecords(windnerdPayload({ time_offset: [-1000, -1000, -1000] }), 8675),
    ).toThrow("WindNerd location 8675 returned an invalid time_offset");
  });
});

describe("loadWindnerdStation", () => {
  it("serves the last record as the reading and every record as history", async () => {
    const { environment, requests } = stubEnvironment(() => windnerdPayload());
    const station = await loadWindnerdStation(config, { environment, historyHours: 6 });

    expect(station.status).toBe("ok");
    if (station.status !== "ok") return;
    /* The upstream's km/h divided onto the m/s wire — same expression the
     * adapter computes, so toEqual compares identical doubles. */
    expect(station.reading).toEqual({
      observedAt: "2026-08-05T22:12:45.000Z",
      averageMps: 9 / 3.6,
      directionDeg: 290,
      gustMps: 14 / 3.6,
      lullMps: 6 / 3.6,
      temperatureC: 22.6,
      windChillC: null,
      conditions: null,
    });
    expect(station.history).not.toBeNull();
    expect(station.history?.periodMinutes).toBe(1);
    expect(station.history?.points).toHaveLength(3);
    expect(station.capabilities).toEqual({
      gustLull: true,
      temperature: true,
      conditions: false,
      history: true,
    });
    expect(station.pageUrl).toBe("https://windnerd.net/en/bluff-launch");
    expect(station.elevationM).toBe(1370);
    /* The records API reports no position or zone; unconfigured means null,
     * never a guess. */
    expect(station.latitude).toBeNull();
    expect(station.longitude).toBeNull();
    expect(station.timeZone).toBeNull();
    expect(station.samplingWindowSeconds).toBe(60);
    expect(station.recommendedPollSeconds).toBe(60);

    const url = requests[0];
    expect(url?.origin).toBe("https://windnerd.net");
    expect(url?.pathname).toBe("/api/records");
    expect(url?.searchParams.get("location_id")).toBe("8675");
    expect(url?.searchParams.get("period")).toBe("1");
    expect(url?.searchParams.get("to")).toBe("2026-08-05T22:13:00.000Z");
    expect(url?.searchParams.get("from")).toBe("2026-08-05T16:13:00.000Z");
  });

  it("carries the configured position and zone in meta", async () => {
    const { environment } = stubEnvironment(() => windnerdPayload());
    const positioned = windnerdStationConfigSchema.parse({
      vendor: "windnerd",
      id: "bluff",
      name: "Bluff Launch",
      stationKey: "bluff-launch",
      locationId: 8675,
      latitude: 50.24,
      longitude: -117.8,
      timeZone: "America/Vancouver",
    });
    const station = await loadWindnerdStation(positioned, { environment });
    expect(station.latitude).toBe(50.24);
    expect(station.longitude).toBe(-117.8);
    expect(station.timeZone).toBe("America/Vancouver");
  });

  it("gives calm no direction, in the reading and in history", async () => {
    /* 1.5 km/h is below the WMO threshold, not only exact zero. */
    const { environment } = stubEnvironment(() =>
      windnerdPayload({ wind_avg_1D: [6, 1.5, 0], wind_min: [4, 0, 0], wind_max: [8, 2, 1] }),
    );
    const station = await loadWindnerdStation(config, { environment });

    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.directionDeg).toBeNull();
    expect(station.reading.averageMps).toBe(0);
    expect(station.history?.points.map((point) => point.directionDeg)).toEqual([300, null, null]);
    expect(station.history?.points[1]?.averageMps).toBe(1.5 / 3.6);
  });

  it("normalizes a vendor 360 onto the wire's [0,360)", async () => {
    const { environment } = stubEnvironment(() => windnerdPayload({ wind_dir: [300, 310, 360] }));
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.directionDeg).toBe(0);
  });

  it("keeps a dropout absent instead of zero-filling it", async () => {
    const { environment } = stubEnvironment(() =>
      windnerdPayload({
        /* The 22:11 minute never archived. */
        date_utc: ["2026-08-05T22:10:45Z", "2026-08-05T22:12:45Z"],
        temperature_avg: [20.2, 22.6],
        pressure_hpa_avg: [947.7, 947.2],
        wind_avg_1D: [6, 9],
        wind_avg_2D: [5.5, 8],
        wind_dir: [300, 290],
        wind_max: [8, 14],
        wind_min: [4, 6],
      }),
    );
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok" || !station.history) throw new Error("expected ok history");

    expect(station.history.points).toHaveLength(2);
    expect(station.history.points.every((point) => point.averageMps > 0)).toBe(true);
    expect(historyGaps(station.history, 1.5)).toEqual([
      [Date.parse("2026-08-05T22:10:45Z"), Date.parse("2026-08-05T22:12:45Z")],
    ]);
  });

  it("distinguishes a dark thermometer from an absent one", async () => {
    /* Dark sensor: the capability stays declared, the value is null. */
    const dark = stubEnvironment(() => windnerdPayload({ temperature_avg: [null, null, null] }));
    const darkStation = await loadWindnerdStation(config, { environment: dark.environment });
    if (darkStation.status !== "ok") throw new Error("expected ok");
    expect(darkStation.capabilities.temperature).toBe(true);
    expect(darkStation.reading.temperatureC).toBeNull();

    /* Absent board: the capability says so, whatever the API reports. */
    const absent = stubEnvironment(() => windnerdPayload());
    const absentStation = await loadWindnerdStation(
      { ...config, hasTemperature: false },
      { environment: absent.environment },
    );
    if (absentStation.status !== "ok") throw new Error("expected ok");
    expect(absentStation.capabilities.temperature).toBe(false);
    expect(absentStation.reading.temperatureC).toBeNull();
    expect(absentStation.history?.points.every((point) => point.temperatureC === null)).toBe(true);
  });

  it("reads the last minute that carried a temperature", async () => {
    const { environment } = stubEnvironment(() =>
      windnerdPayload({ temperature_avg: [20.2, 21.1, null] }),
    );
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.temperatureC).toBe(21.1);
  });

  it("nulls a temperature older than the honesty lookback", async () => {
    /* The vendor's hide-daytime-temperatures option nulls the daytime series;
     * without the bound, last night's 20.2° would serve as "current" against
     * the 22:12:45 observedAt. Twenty minutes stale → null. */
    const { environment } = stubEnvironment(() =>
      windnerdPayload({
        date_utc: ["2026-08-05T21:52:45Z", "2026-08-05T22:12:45Z"],
        temperature_avg: [20.2, null],
        pressure_hpa_avg: [947.7, null],
        wind_avg_1D: [6, 9],
        wind_avg_2D: [5.5, 8],
        wind_dir: [300, 290],
        wind_max: [8, 14],
        wind_min: [4, 6],
      }),
    );
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.temperatureC).toBeNull();
    /* History keeps the old record where it belongs — at its own timestamp. */
    expect(station.history?.points[0]?.temperatureC).toBe(20.2);
  });

  it("carries a temperature ten minutes inside the lookback", async () => {
    const { environment } = stubEnvironment(() =>
      windnerdPayload({
        date_utc: ["2026-08-05T22:02:45Z", "2026-08-05T22:12:45Z"],
        temperature_avg: [21.1, null],
        pressure_hpa_avg: [947.7, null],
        wind_avg_1D: [6, 9],
        wind_avg_2D: [5.5, 8],
        wind_dir: [300, 290],
        wind_max: [8, 14],
        wind_min: [4, 6],
      }),
    );
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.temperatureC).toBe(21.1);
  });

  it("reduces station pressure to sea level in history and conditions", async () => {
    const { environment } = stubEnvironment(() => windnerdPayload());
    const station = await loadWindnerdStation(pressureConfig, { environment });
    if (station.status !== "ok" || !station.history) throw new Error("expected ok history");

    /* The board legitimizes the conditions block. */
    expect(station.capabilities.conditions).toBe(true);

    /* 947.x hPa at 450 m reduces to just under 1000 hPa — each point with the
     * temperature of its own record, the dark-thermometer minute via the ISA
     * default. */
    const reduced = station.history.points.map((point) => point.seaLevelPressureHpa);
    expect(reduced[0]).toBeCloseTo(998.44, 2);
    expect(reduced[1]).toBeCloseTo(999.06, 2);
    expect(reduced[2]).toBeCloseTo(997.495, 2);
    for (const value of reduced) {
      expect(value).toBeGreaterThan(990);
      expect(value).toBeLessThan(1010);
    }

    const conditions = station.reading.conditions;
    expect(conditions).not.toBeNull();
    expect(conditions?.seaLevelPressureHpa).toBeCloseTo(997.495, 2);
    /* Three minutes of records cannot support the three-hour tendency. */
    expect(conditions?.pressureTrend).toBeNull();
    /* No other conditions-class sensor rides this board. */
    expect(conditions?.dewPointC).toBeNull();
    expect(conditions?.relativeHumidityPercent).toBeNull();
    expect(conditions?.uvIndex).toBeNull();
    expect(conditions?.precipitationTodayMm).toBeNull();
  });

  it("computes the pressure trend over a moving series", async () => {
    /* Four hours of ten-minute records, so the three-hour synoptic window is
     * reachable; step is per record, ±0.2 hPa ≈ ±3.6 hPa over the window. */
    const movingPayload = (stepHpa: number): string => {
      const endMs = Date.parse("2026-08-05T22:12:45Z");
      const dates = Array.from({ length: 25 }, (_, index) =>
        new Date(endMs - (24 - index) * 10 * 60_000).toISOString(),
      );
      return windnerdPayload({
        date_utc: dates,
        pressure_hpa_avg: dates.map((_, index) => 947 + index * stepHpa),
        temperature_avg: dates.map(() => null),
        wind_avg_1D: dates.map(() => 10),
        wind_avg_2D: dates.map(() => 9),
        wind_dir: dates.map(() => 300),
        wind_max: dates.map(() => 12),
        wind_min: dates.map(() => 8),
      });
    };

    for (const [step, trend] of [
      [0.2, "rising"],
      [-0.2, "falling"],
      [0.01, "steady"],
    ] as const) {
      const { environment } = stubEnvironment(() => movingPayload(step));
      const station = await loadWindnerdStation(pressureConfig, { environment });
      if (station.status !== "ok") throw new Error("expected ok");
      expect(station.reading.conditions?.pressureTrend).toBe(trend);
    }
  });

  it("nulls a conditions pressure older than the honesty lookback", async () => {
    const stale = stubEnvironment(() =>
      windnerdPayload({
        date_utc: ["2026-08-05T21:52:45Z", "2026-08-05T22:12:45Z"],
        temperature_avg: [null, null],
        pressure_hpa_avg: [947.7, null],
        wind_avg_1D: [6, 9],
        wind_avg_2D: [5.5, 8],
        wind_dir: [300, 290],
        wind_max: [8, 14],
        wind_min: [4, 6],
      }),
    );
    const staleStation = await loadWindnerdStation(pressureConfig, {
      environment: stale.environment,
    });
    if (staleStation.status !== "ok") throw new Error("expected ok");
    expect(staleStation.reading.conditions?.seaLevelPressureHpa).toBeNull();
    /* The stale record still carries its value in history. */
    expect(staleStation.history?.points[0]?.seaLevelPressureHpa).toBeCloseTo(999.38, 2);

    const fresh = stubEnvironment(() =>
      windnerdPayload({
        date_utc: ["2026-08-05T22:02:45Z", "2026-08-05T22:12:45Z"],
        temperature_avg: [null, null],
        pressure_hpa_avg: [947.7, null],
        wind_avg_1D: [6, 9],
        wind_avg_2D: [5.5, 8],
        wind_dir: [300, 290],
        wind_max: [8, 14],
        wind_min: [4, 6],
      }),
    );
    const freshStation = await loadWindnerdStation(pressureConfig, {
      environment: fresh.environment,
    });
    if (freshStation.status !== "ok") throw new Error("expected ok");
    expect(freshStation.reading.conditions?.seaLevelPressureHpa).toBeCloseTo(999.38, 2);
  });

  it("keeps conditions null and history pressure-free without the board", async () => {
    const { environment } = stubEnvironment(() => windnerdPayload());
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "ok" || !station.history) throw new Error("expected ok history");
    expect(station.capabilities.conditions).toBe(false);
    expect(station.reading.conditions).toBeNull();
    expect(
      station.history.points.every((point) => point.seaLevelPressureHpa == null),
    ).toBe(true);
  });

  it("degrades to contract_break when a declared pressure board lies", async () => {
    const { environment } = stubEnvironment(() =>
      windnerdPayload({ pressure_hpa_avg: [947.7, 1200, 947.2] }),
    );
    const station = await loadWindnerdStation(pressureConfig, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("contract_break");
  });

  it("degrades to upstream_error on an HTTP failure", async () => {
    const { environment, logs } = stubEnvironment(() => new Response("gone", { status: 502 }));
    const station = await loadWindnerdStation(config, { environment });
    expect(station.status).toBe("unavailable");
    if (station.status !== "unavailable") return;
    expect(station.reason).toBe("upstream_error");
    expect(station.reading).toBeNull();
    expect(logs).toHaveLength(1);
  });

  it("degrades to timeout on an abort", async () => {
    const { environment } = stubEnvironment(() => timeoutError());
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("timeout");
  });

  it("degrades to rate_limited on HTTP 429", async () => {
    const { environment } = stubEnvironment(() => new Response("slow down", { status: 429 }));
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("rate_limited");
  });

  it("degrades to contract_break when the shape lies", async () => {
    const { environment } = stubEnvironment(() => windnerdPayload({ wind_max: [1, 2] }));
    const station = await loadWindnerdStation(config, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("contract_break");
  });

  it("serves a second load from the cache", async () => {
    const { environment, requests } = stubEnvironment(() => windnerdPayload());
    await loadWindnerdStation(config, { environment });
    await loadWindnerdStation(config, { environment });
    expect(requests).toHaveLength(1);
  });

  it("requests the vendor's own aggregate period and carries it onto the wire", async () => {
    const { environment, requests } = stubEnvironment(() => windnerdPayload());
    const station = await loadWindnerdStation(config, {
      environment,
      recordPeriodMinutes: 180,
    });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(requests[0]?.searchParams.get("period")).toBe("180");
    /* historyGaps and wind-run both read this, so a resolved period that
     * silently stayed 1 would misjudge dropouts on every non-default call. */
    expect(station.history?.periodMinutes).toBe(180);
  });

  it("rejects a period outside the vendor's whitelist before any request", async () => {
    const { environment, requests } = stubEnvironment(() => windnerdPayload());
    const station = await loadWindnerdStation(config, {
      environment,
      // @ts-expect-error deliberately outside WindnerdRecordPeriodMinutes
      recordPeriodMinutes: 30,
    });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("contract_break");
    expect(requests).toHaveLength(0);
  });

  it("keys the cache by period, so a live pull and a season pull never collide", async () => {
    const { environment, requests } = stubEnvironment(() => windnerdPayload());
    await loadWindnerdStation(config, { environment, recordPeriodMinutes: 1 });
    await loadWindnerdStation(config, { environment, recordPeriodMinutes: 180 });
    await loadWindnerdStation(config, { environment, recordPeriodMinutes: 180 });
    expect(requests).toHaveLength(2);
  });
});
