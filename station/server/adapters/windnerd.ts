/* WindNerd records adapter. WindNerd publishes no read API; this is the
 * endpoint its own station page calls, so it can change without notice —
 * every series is validated and a contract break degrades the station to
 * "unavailable". The hardware archives one record a minute, and both the
 * current reading and the history come out of the same records call.
 *
 * Units: the vendor speaks km/h. Validation happens in vendor units at the
 * vendor boundary (parseWindnerdRecords); conversion to the wire's m/s
 * happens at Reading/HistoryPoint construction. */
import { emptyConditions, type AirConditions, type HistoryPoint } from "../../contract.js";
import { isCalm, normalizeDegrees, pressureTendency, seaLevelPressureHpa } from "../../derive.js";
import { kmhToMps } from "../../../core/units.js";
import { windnerdStationUrl, type WindnerdStationConfig } from "../config.js";
import { defineStationAdapter, type StationAdapterOptions } from "../adapter.js";
import { fetchUpstreamText } from "../environment.js";

const WINDNERD_RECORDS_URL = "https://windnerd.net/api/records";
const RECORD_PERIOD_MINUTES = 1;
const CACHE_TTL_SECONDS = 60;

/* How far behind the reading's own record a sensor value may lag and still
 * serve as "current". WindNerd's hide-daytime-temperatures feature lets an
 * operator null out the series during the day, so an unbounded "latest
 * non-null" would resurrect last night's value and stamp it against the
 * current observedAt. Applies to temperature and pressure alike. */
const SENSOR_VALUE_LOOKBACK_MS = 15 * 60_000;

/* Station-pressure plausibility: 300 hPa clears any terrestrial summit,
 * 1100 hPa clears any recorded sea-level high. Outside is a lying sensor. */
const STATION_PRESSURE_MIN_HPA = 300;
const STATION_PRESSURE_MAX_HPA = 1100;

export type WindnerdAdapterOptions = StationAdapterOptions & {
  /* The records endpoint, overridable for tests only. */
  recordsUrl?: string;
};

/* Parallel series indexed against date_utc, as the API returns them —
 * vendor-true, so speeds here are km/h. */
export type WindnerdRecords = {
  averageSpeedKmh: number[];
  directionDeg: number[];
  gustSpeedKmh: number[];
  lullSpeedKmh: number[];
  observedAt: string[];
  /* A one-minute record carries a single temperature, not a spread: WindNerd
   * only splits temperature into min/max on the aggregated periods. */
  temperatureC: Array<number | null>;
  /* Raw STATION pressure as the barometer reports it (verified live: ~947 hPa
   * at a ~450 m sensor). Reduction to sea level happens in this adapter; the
   * wire never carries the raw value. All-null when the config declares no
   * pressure board. */
  stationPressureHpa: Array<number | null>;
};

export const loadWindnerdStation = defineStationAdapter<
  WindnerdStationConfig,
  WindnerdAdapterOptions
>({
  meta: (config) => ({
    id: config.id,
    name: config.name,
    sourceLabel: "WindNerd",
    pageUrl: config.pageUrl ?? windnerdStationUrl(config.stationKey),
    /* The records API reports no position or zone; the config's claim is all
     * there is. */
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    elevationM: config.elevationM ?? null,
    capabilities: {
      gustLull: true,
      temperature: config.hasTemperature,
      /* The optional pressure board is the only conditions-class sensor a
       * WindNerd station carries; with it declared, the block is legitimate. */
      conditions: config.hasPressure,
      history: true,
    },
    /* The window the three wind numbers are averaged over, which for a
     * one-minute record is the minute itself. */
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 60,
  }),
  /* Current mode costs the same upstream hit — the records call is the only
   * data source — so only the returned document slims (in the belt). */
  load: async (config, { environment, historyHours, options }) => {
    const now = environment.now();
    const url = new URL(options.recordsUrl ?? WINDNERD_RECORDS_URL);
    url.searchParams.set("location_id", String(config.locationId));
    url.searchParams.set("from", new Date(now.getTime() - historyHours * 3_600_000).toISOString());
    url.searchParams.set("to", now.toISOString());
    url.searchParams.set("period", String(RECORD_PERIOD_MINUTES));

    const records = parseWindnerdRecords(
      await fetchUpstreamText(environment, {
        url,
        cacheKey: `windnerd/${config.locationId}/${historyHours}`,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        subject: `WindNerd location ${config.locationId}`,
      }),
      config.locationId,
      config.hasPressure,
    );
    const points = windnerdHistoryPoints(records, config);
    const last = points[points.length - 1];
    if (!last) throw new Error(`WindNerd location ${config.locationId} returned no wind`);
    const lastMs = Date.parse(last.observedAt);

    return {
      reading: {
        observedAt: last.observedAt,
        averageMps: last.averageMps,
        directionDeg: last.directionDeg,
        gustMps: last.gustMps,
        lullMps: last.lullMps,
        /* The most recent minute that carried a temperature — bounded by the
         * honesty lookback, so a sensor hidden or dropped for longer reads
         * null rather than an old value against the current observedAt. */
        temperatureC: config.hasTemperature
          ? (latestSensorValue(records.temperatureC, records.observedAt, lastMs)?.value ?? null)
          : null,
        windChillC: null,
        conditions: config.hasPressure ? windnerdConditions(records, points, config, lastMs) : null,
      },
      history: { periodMinutes: RECORD_PERIOD_MINUTES, points },
    };
  },
});

/* One point per archived minute, converted km/h → m/s here — the wire
 * boundary. WindNerd expresses a dropout as an absent record rather than a
 * zero, so the series maps straight across. Calm minutes (below the WMO
 * threshold) carry no direction — the vane's idle bearing would fabricate
 * one. */
export function windnerdHistoryPoints(
  records: WindnerdRecords,
  config: Pick<WindnerdStationConfig, "hasTemperature" | "hasPressure" | "elevationM">,
): HistoryPoint[] {
  /* Config validation guarantees the elevation when hasPressure is set; the
   * null check narrows the type and shields a hand-built config. */
  const barometerElevationM = config.hasPressure ? (config.elevationM ?? null) : null;
  return records.observedAt.map((observedAt, index) => {
    const averageMps = kmhToMps(records.averageSpeedKmh[index] as number);
    const stationPressure = records.stationPressureHpa[index] ?? null;
    return {
      observedAt,
      averageMps,
      gustMps: kmhToMps(records.gustSpeedKmh[index] as number),
      lullMps: kmhToMps(records.lullSpeedKmh[index] as number),
      directionDeg:
        isCalm(averageMps) ? null : normalizeDegrees(records.directionDeg[index] as number),
      temperatureC: config.hasTemperature ? (records.temperatureC[index] ?? null) : null,
      /* Reduced with the same record's temperature; a dark-thermometer minute
       * falls back to derive's ISA default inside the reduction. */
      seaLevelPressureHpa:
        barometerElevationM != null && stationPressure != null
          ? seaLevelPressureHpa(stationPressure, barometerElevationM, records.temperatureC[index] ?? null)
          : null,
    };
  });
}

/* The conditions block a pressure-carrying station serves: sea-level pressure
 * from the freshest pressure record inside the honesty lookback, tendency
 * over the whole history window, and every other field null — no other
 * conditions-class sensor rides this board. */
function windnerdConditions(
  records: WindnerdRecords,
  points: ReadonlyArray<HistoryPoint>,
  config: Pick<WindnerdStationConfig, "elevationM">,
  readingObservedAtMs: number,
): AirConditions {
  const fresh = latestSensorValue(records.stationPressureHpa, records.observedAt, readingObservedAtMs);
  const reduced =
    fresh != null && config.elevationM != null
      ? seaLevelPressureHpa(fresh.value, config.elevationM, records.temperatureC[fresh.index] ?? null)
      : null;
  return emptyConditions({
    pressureTrend: pressureTendency(points),
    seaLevelPressureHpa: reduced,
  });
}

export function parseWindnerdRecords(
  value: string,
  locationId: number,
  /* Only a config that declares the pressure board requires (and validates)
   * the pressure series; without it the series is ignored, so an older or
   * boardless payload cannot degrade the station. */
  hasPressure = false,
): WindnerdRecords {
  const data: unknown = JSON.parse(value);
  if (!isRecord(data) || !isRecord(data.records)) {
    throw new Error(`WindNerd location ${locationId} returned no records`);
  }
  const { records } = data;
  const dates = records.date_utc;
  if (!Array.isArray(dates) || dates.some((date) => typeof date !== "string")) {
    throw new Error(`WindNerd location ${locationId} returned invalid record times`);
  }

  const fail = (name: string): never => {
    throw new Error(`WindNerd location ${locationId} returned an invalid ${name}`);
  };
  /* Vendor-unit plausibility: 0–500 km/h, checked before any conversion. */
  const speeds = (name: string) => numberSeries(records[name], dates.length, 0, 500, name, fail);
  return {
    averageSpeedKmh: speeds("wind_avg_1D"),
    directionDeg: numberSeries(records.wind_dir, dates.length, 0, 360, "wind_dir", fail),
    gustSpeedKmh: speeds("wind_max"),
    lullSpeedKmh: speeds("wind_min"),
    observedAt: (dates as string[]).map((date) => recordTimeToIso(date, locationId)),
    temperatureC: nullableSeries(records.temperature_avg, dates.length, "temperature_avg", fail),
    stationPressureHpa: hasPressure
      ? nullableSeries(
          records.pressure_hpa_avg,
          dates.length,
          "pressure_hpa_avg",
          fail,
          STATION_PRESSURE_MIN_HPA,
          STATION_PRESSURE_MAX_HPA,
        )
      : dates.map(() => null),
  };
}

/* The newest non-null sample, provided its record is within the honesty
 * lookback of the reading's own record; anything older is history, not a
 * current value, and reads null. */
function latestSensorValue(
  series: ReadonlyArray<number | null>,
  observedAt: ReadonlyArray<string>,
  readingObservedAtMs: number,
): { value: number; index: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index];
    if (value == null) continue;
    const recordMs = Date.parse(observedAt[index] as string);
    return readingObservedAtMs - recordMs <= SENSOR_VALUE_LOOKBACK_MS ? { value, index } : null;
  }
  return null;
}

function numberSeries(
  value: unknown,
  length: number,
  minimum: number,
  maximum: number,
  name: string,
  fail: (name: string) => never,
): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some(
      (entry) =>
        typeof entry !== "number" || !Number.isFinite(entry) || entry < minimum || entry > maximum,
    )
  ) {
    fail(name);
  }
  return value as number[];
}

function nullableSeries(
  value: unknown,
  length: number,
  name: string,
  fail: (name: string) => never,
  minimum = -Infinity,
  maximum = Infinity,
): Array<number | null> {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some(
      (entry) =>
        entry != null &&
        (typeof entry !== "number" ||
          !Number.isFinite(entry) ||
          entry < minimum ||
          entry > maximum),
    )
  ) {
    fail(name);
  }
  return value as Array<number | null>;
}

function recordTimeToIso(value: string, locationId: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`WindNerd location ${locationId} returned an invalid record time`);
  }
  return new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
