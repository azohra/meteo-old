"use client";
/* Every user-facing word in one object: consumers pass partial overrides for
 * copy or i18n and no component carries a literal of its own. Reason codes
 * come off the wire; the words for them live here — including the speed unit
 * labels, routed through strings so they are i18n-able like every other word
 * (derive's speedUnitLabel seeds the defaults). */
import { speedUnitLabel } from "../../index.js";
import type { FreshnessStatus, SpeedUnit, UnavailableReason } from "../../index.js";

export const EM_DASH = "—";

export type StationStrings = {
  averageLabel: string;
  avgLabel: string;
  calm: string;
  calmHistory: string;
  degC: string;
  feelsLikeLabel: string;
  fromLabel: string;
  gustLabel: string;
  inspectHint: string;
  km: string;
  lullLabel: string;
  minLabel: string;
  noHistory: string;
  /* A station whose history never carries the asked-for series: an honest
   * "not measured here", never an empty grid. */
  notMeasured: string;
  notReporting: string;
  peakLabel: string;
  tempRangeLabel: string;
  trendPressure: string;
  trendTemperature: string;
  /* The vane rows point downwind — the flow convention — so the row label
   * must say so. */
  toLabel: string;
  windRunLabel: string;
  elevation: (metres: number) => string;
  percentCalm: (percent: number) => string;
  percentShare: (percent: number) => string;
  freshness: Record<FreshnessStatus, string>;
  reasons: Record<UnavailableReason, string>;
  /* Display labels per speed unit — what the dial hub, chart readout, and
   * compare cells print beside a number. */
  speedUnits: Record<SpeedUnit, string>;
  table: {
    station: string;
    wind: string;
    lull: string;
    gust: string;
    from: string;
    temp: string;
    updated: string;
  };
  /* AirMatrix vocabulary: row labels, unit words, the trigger-line summary
   * pieces, and lightning sentences. */
  air: {
    title: string;
    /* Trigger-line pieces; the summary joins the non-null ones with " · ". */
    summaryFallback: string;
    summaryHumidity: (percent: number) => string;
    summaryRaining: (mmPerHour: number) => string;
    summaryRainToday: (mm: number) => string;
    summaryDry: string;
    summaryStrikes: (count: number) => string;
    noStrike: string;
    lastStrike: (distanceKm: number, time: string) => string;
    lastStrikeNoDistance: (time: string) => string;
    trendFalling: string;
    trendRising: string;
    trendSteady: string;
    feelsLike: string;
    humidity: string;
    dewPoint: string;
    pressure: string;
    pressureTrend: string;
    solar: string;
    uv: string;
    rainRate: string;
    rainToday: string;
    rainMinutes: string;
    lightning: string;
    unitPercent: string;
    unitHpa: string;
    unitWm2: string;
    unitIndex: string;
    unitMmPerHour: string;
    unitMm: string;
    unitMinutes: string;
    unitStrikesPastHour: string;
  };
  aria: {
    air: (stationCount: number) => string;
    chart: (stationName: string) => string;
    compare: (stationCount: number) => string;
    current: (stationName: string) => string;
    readout: (stationName: string) => string;
    rose: (stationName: string) => string;
    /* Appended to the rose label when a favorable ring is drawn; `sectors`
     * is the pre-joined "260°–340°, …" list. */
    roseFavorable: (sectors: string) => string;
    roseGeneric: string;
    summary: (endedAtFormatted: string) => string;
    trend: (stationName: string, seriesName: string) => string;
  };
};

export const defaultStrings: StationStrings = {
  averageLabel: "Average",
  avgLabel: "avg",
  calm: "Calm",
  calmHistory: "Calm for the entire period",
  degC: "°C",
  feelsLikeLabel: "feels like",
  fromLabel: "from",
  gustLabel: "gust",
  inspectHint: "hover or tap to inspect",
  km: "km",
  lullLabel: "lull",
  minLabel: "Min",
  noHistory: "No history available",
  notMeasured: "Not measured here",
  notReporting: "Not reporting",
  peakLabel: "Peak",
  tempRangeLabel: "Temp",
  trendPressure: "Pressure",
  trendTemperature: "Temperature",
  toLabel: "TO",
  windRunLabel: "Wind run",
  elevation: (metres) => `${metres} m`,
  percentCalm: (percent) => `${percent}% calm`,
  percentShare: (percent) => `${percent}%`,
  freshness: {
    live: "Live",
    aging: "Aging",
    stale: "Stale",
  },
  reasons: {
    upstream_error: "Station not responding",
    contract_break: "Station sent unreadable data",
    timeout: "Station timed out",
    not_configured: "Station not configured",
    rate_limited: "Update limit reached",
  },
  speedUnits: {
    kmh: speedUnitLabel("kmh"),
    knots: speedUnitLabel("knots"),
    mph: speedUnitLabel("mph"),
    mps: speedUnitLabel("mps"),
  },
  table: {
    station: "Station",
    wind: "Wind",
    lull: "Lull",
    gust: "Gust",
    from: "From",
    temp: "Temp",
    updated: "Updated",
  },
  air: {
    title: "Air and precipitation",
    summaryFallback: "Humidity, pressure, rain and lightning",
    summaryHumidity: (percent) => `humidity ${percent}%`,
    summaryRaining: (mmPerHour) => `raining ${mmPerHour} mm/h`,
    summaryRainToday: (mm) => `rain ${mm} mm today`,
    summaryDry: "dry today",
    summaryStrikes: (count) => `${count} ${count === 1 ? "strike" : "strikes"} past hour`,
    noStrike: "No lightning strike on record.",
    lastStrike: (distanceKm, time) => `Last recorded strike ${distanceKm} km away, ${time}.`,
    lastStrikeNoDistance: (time) => `Last recorded strike ${time}, distance unknown.`,
    trendFalling: "falling",
    trendRising: "rising",
    trendSteady: "steady",
    feelsLike: "Feels like",
    humidity: "Humidity",
    dewPoint: "Dew point",
    pressure: "Pressure",
    pressureTrend: "Trend",
    solar: "Solar",
    uv: "UV index",
    rainRate: "Rain rate",
    rainToday: "Rain today",
    rainMinutes: "Raining today",
    lightning: "Lightning",
    unitPercent: "%",
    unitHpa: "hPa",
    unitWm2: "W/m²",
    unitIndex: "index",
    unitMmPerHour: "mm/h",
    unitMm: "mm",
    unitMinutes: "minutes",
    unitStrikesPastHour: "strikes past hour",
  },
  aria: {
    air: (stationCount) => `Air and precipitation readings from ${stationCount} stations`,
    chart: (stationName) =>
      `Wind history at ${stationName}: the band spans lull to gust, the line is the average, and the vanes below point where the wind blew to.`,
    compare: (stationCount) => `Live readings from ${stationCount} stations`,
    current: (stationName) => `Current conditions at ${stationName}`,
    readout: (stationName) => `Inspected reading at ${stationName}`,
    rose: (stationName) => `Wind direction distribution at ${stationName}`,
    roseFavorable: (sectors) => `The outer ring marks favorable directions: from ${sectors}.`,
    roseGeneric: "Wind direction distribution",
    summary: (endedAtFormatted) => `Summary of the period ending ${endedAtFormatted}`,
    trend: (stationName, seriesName) => `${seriesName} history at ${stationName}`,
  },
};

/* Nested groups merge shallowly, so overriding one reason keeps the rest. */
export type StationStringOverrides = Partial<
  Omit<StationStrings, "freshness" | "reasons" | "speedUnits" | "table" | "air" | "aria"> & {
    freshness: Partial<StationStrings["freshness"]>;
    reasons: Partial<StationStrings["reasons"]>;
    speedUnits: Partial<StationStrings["speedUnits"]>;
    table: Partial<StationStrings["table"]>;
    air: Partial<StationStrings["air"]>;
    aria: Partial<StationStrings["aria"]>;
  }
>;

export function resolveStrings(overrides?: StationStringOverrides): StationStrings {
  if (!overrides) return defaultStrings;
  return {
    ...defaultStrings,
    ...overrides,
    freshness: { ...defaultStrings.freshness, ...overrides.freshness },
    reasons: { ...defaultStrings.reasons, ...overrides.reasons },
    speedUnits: { ...defaultStrings.speedUnits, ...overrides.speedUnits },
    table: { ...defaultStrings.table, ...overrides.table },
    air: { ...defaultStrings.air, ...overrides.air },
    aria: { ...defaultStrings.aria, ...overrides.aria },
  };
}

/* Strings layer by MERGING, never replacing: a provider's overrides, a
 * WindStation root's, and a subcomponent's stack up, inner keys winning per
 * key with the same shallow nested-group rule resolveStrings applies. An
 * inner layer overriding one aria sentence keeps the outer layer's reasons. */
export function mergeStringOverrides(
  outer: StationStringOverrides | undefined,
  inner: StationStringOverrides | undefined,
): StationStringOverrides | undefined {
  if (!outer) return inner;
  if (!inner) return outer;
  return {
    ...outer,
    ...inner,
    freshness: { ...outer.freshness, ...inner.freshness },
    reasons: { ...outer.reasons, ...inner.reasons },
    speedUnits: { ...outer.speedUnits, ...inner.speedUnits },
    table: { ...outer.table, ...inner.table },
    air: { ...outer.air, ...inner.air },
    aria: { ...outer.aria, ...inner.aria },
  };
}

export type FormatTime = (date: Date) => string;

/* Intl.DateTimeFormat construction is deferred to first use and memoized:
 * building it at module scope taxes every importer and, under SSR, would bake
 * the SERVER's default locale into a shared instance. The hazard does not
 * fully vanish — `undefined` locale means "this runtime's default", which can
 * differ between the server pass and the client's hydration pass and change
 * rendered times. When markup must match across passes, pass an explicit
 * `locale` on StationFeedProvider (or your own formatTime). */
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function timeFormat(locale: string | undefined): Intl.DateTimeFormat {
  const key = locale ?? "";
  let format = timeFormats.get(key);
  if (format == null) {
    format = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    timeFormats.set(key, format);
  }
  return format;
}

export function defaultFormatTime(date: Date): string {
  return timeFormat(undefined).format(date);
}

/* The default hour:minute format pinned to one locale — what
 * StationFeedProvider builds from its `locale` prop. Memoized per locale so
 * the returned FormatTime is referentially stable across renders. */
const localeFormatTimes = new Map<string, FormatTime>();

export function localeFormatTime(locale: string): FormatTime {
  let format = localeFormatTimes.get(locale);
  if (format == null) {
    format = (date) => timeFormat(locale).format(date);
    localeFormatTimes.set(locale, format);
  }
  return format;
}
