"use client";
/* The instrument: a compass dial with the speed in its centre, a filled
 * tapered needle pointing where the wind goes, and a speed arc riding the
 * ring, flanked by lull and gust readouts.
 *
 * Fixed geometry throughout: the dial, flanks, and text rows exist whatever
 * the reading says, so a refresh tick can never twitch layout. A value the
 * station cannot report is an em dash in place; a capability the station
 * lacks omits its row entirely. Calm (WMO: below 0.5 m/s) hides the needle
 * and says so in words while the measured speed stays in the hub — a vane's
 * idle bearing would fabricate a direction, but the anemometer did measure.
 * A blowing reading with no bearing is a broken vane and earns the dash.
 * Unavailable greys the dial and wears the reason in words. */
import {
  COMPASS_POINTS,
  KMH_PER_MPS,
  compassDirection,
  isCalm,
  radians,
  speedBand,
  speedFromMps,
  speedToMps,
  stationFreshnessThresholds,
} from "../../index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useId } from "react";
import { useFreshness } from "../hooks/useFreshness.js";
import { EM_DASH, defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides } from "../lib/strings.js";
import { thresholdsToMps } from "../lib/thresholds.js";
import type { SpeedThresholds } from "../lib/thresholds.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

const DIAL_SIZE = 160;
const CENTRE = DIAL_SIZE / 2;
const RING_RADIUS = 70;
const TICK_INNER = 64;
const CARDINAL_TICK_INNER = 58;
const LETTER_RADIUS = 46;
const HUB_RADIUS = 36;
const NEEDLE_REACH = 60;
const NEEDLE_HALF_WIDTH = 5;
const COUNTERWEIGHT_RADIUS = 4.5;
const COUNTERWEIGHT_REACH = 46;
/* The arc scales against at least this (the historical 40 km/h floor,
 * expressed in wire m/s), so light air never fills the ring. */
const DIAL_MIN_MAX_MPS = 40 / KMH_PER_MPS;

const polar = (bearingDeg: number, radius: number): readonly [number, number] => {
  const angle = radians(bearingDeg);
  return [CENTRE + Math.sin(angle) * radius, CENTRE - Math.cos(angle) * radius];
};

const at = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;

/* Filled tapered blade from the hub to the downwind rim; the counterweight
 * circle sits opposite, outside the hub. */
function needleBlade(fromDeg: number): string {
  const flowDeg = fromDeg + 180;
  const tip = polar(flowDeg, NEEDLE_REACH);
  const left = [
    CENTRE + Math.sin(radians(flowDeg + 90)) * NEEDLE_HALF_WIDTH,
    CENTRE - Math.cos(radians(flowDeg + 90)) * NEEDLE_HALF_WIDTH,
  ] as const;
  const right = [
    CENTRE + Math.sin(radians(flowDeg - 90)) * NEEDLE_HALF_WIDTH,
    CENTRE - Math.cos(radians(flowDeg - 90)) * NEEDLE_HALF_WIDTH,
  ] as const;
  return `${at(tip)} ${at(left)} ${at(right)}`;
}

/* Gauge arc clockwise from the scale start at N; fraction 1 closes the ring. */
function speedArcPath(fraction: number): string {
  const sweepDeg = Math.min(359.9, Math.max(0, fraction) * 360);
  const start = polar(0, RING_RADIUS);
  const end = polar(sweepDeg, RING_RADIUS);
  return `M ${start[0].toFixed(1)} ${start[1].toFixed(1)} A ${RING_RADIUS} ${RING_RADIUS} 0 ${
    sweepDeg > 180 ? 1 : 0
  } 1 ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
}

/* Dial letters come from the same vocabulary compassDirection speaks. */
const CARDINALS = [
  { bearing: 0, letter: COMPASS_POINTS[0] },
  { bearing: 90, letter: COMPASS_POINTS[4] },
  { bearing: 180, letter: COMPASS_POINTS[8] },
  { bearing: 270, letter: COMPASS_POINTS[12] },
] as const;

export function CurrentConditions({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Freshness inputs; absent everywhere (no prop, no provider feed) the
   * badge is simply withheld — null never fabricates a status. */
  servedAt?: string | null;
  receivedAtMs?: number | null;
  /* Consumer-unit bounds ({ unit, values }); converted to wire m/s once. The
   * speed arc wears wind-band-0..n of the current reading when given, the
   * neutral accent otherwise. null opts out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Display unit only: every shown speed converts, banding and geometry stay
   * in wire m/s. */
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "CurrentConditions",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs = receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const thresholds = thresholdsProp === undefined ? context?.thresholds : (thresholdsProp ?? undefined);
  const unit = unitProp ?? context?.unit ?? "kmh";
  const strings = mergeStringOverrides(context?.strings, stringsProp);
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;

  const words = resolveStrings(strings);
  const shown = (averageMps: number) => Math.round(speedFromMps(averageMps, unit));
  const unitLabel = words.speedUnits[unit];
  const bezelId = `wind-bezel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reading = station.status === "ok" ? station.reading : null;
  const status = useFreshness(
    reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  const calm = reading != null && isCalm(reading.averageMps);
  const blowing = reading != null && !calm && reading.directionDeg != null;

  /* Arc scale: a sane fixed floor, or the gust rounded up to the next nice
   * DISPLAY-unit step (ten in the display unit, so a knots dial tops out at
   * a round knots number) — the needle's ring never saturates on an
   * ordinary day. */
  const dialStepMps = speedToMps(10, unit);
  const dialMax = Math.max(
    DIAL_MIN_MAX_MPS,
    Math.ceil(Math.max(reading?.gustMps ?? 0, reading?.averageMps ?? 0) / dialStepMps) *
      dialStepMps,
  );
  const arcFraction = reading == null ? 0 : Math.min(1, Math.max(0, reading.averageMps) / dialMax);
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const arcBand = reading != null && boundsMps != null ? speedBand(reading.averageMps, boundsMps) : null;

  const dialLabel =
    station.status === "unavailable"
      ? `${station.name}: ${words.reasons[station.reason]}`
      : calm
        ? `${station.name}: ${words.calm}, ${shown(station.reading.averageMps)} ${unitLabel}`
        : `${station.name}: ${shown(station.reading.averageMps)} ${unitLabel}`;

  return (
    <div
      aria-label={words.aria.current(station.name)}
      className="wind-current"
      data-status={station.status}
      role="group"
    >
      <div className="wind-current-instrument">
        {station.capabilities.gustLull && (
          <div className="wind-flank wind-flank-lull">
            <small className="wind-microlabel">{words.lullLabel}</small>
            <strong>{reading?.lullMps == null ? EM_DASH : shown(reading.lullMps)}</strong>
          </div>
        )}
        <svg
          aria-label={dialLabel}
          className={station.status === "unavailable" ? "wind-dial wind-dial-unavailable" : "wind-dial"}
          height={DIAL_SIZE}
          role="img"
          viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
          width={DIAL_SIZE}
        >
          <defs>
            {/* Stop colours live in CSS so the bezel rethemes with the rest. */}
            <radialGradient cx="50%" cy="42%" id={bezelId} r="68%">
              <stop className="wind-dial-bezel-in" offset="55%" />
              <stop className="wind-dial-bezel-out" offset="100%" />
            </radialGradient>
          </defs>
          <circle className="wind-dial-face" cx={CENTRE} cy={CENTRE} r={RING_RADIUS} />
          <circle className="wind-dial-bezel" cx={CENTRE} cy={CENTRE} fill={`url(#${bezelId})`} r={RING_RADIUS} />
          <circle className="wind-dial-ring" cx={CENTRE} cy={CENTRE} r={RING_RADIUS} />
          {reading != null && arcFraction > 0 && (
            <path
              className={arcBand == null ? "wind-dial-arc" : `wind-dial-arc wind-band-${arcBand}`}
              d={speedArcPath(arcFraction)}
            />
          )}
          {Array.from({ length: 16 }, (_, index) => {
            const bearing = index * 22.5;
            const cardinal = index % 4 === 0;
            const [x1, y1] = polar(bearing, RING_RADIUS);
            const [x2, y2] = polar(bearing, cardinal ? CARDINAL_TICK_INNER : TICK_INNER);
            return (
              <line
                className={cardinal ? "wind-dial-tick wind-dial-tick-cardinal" : "wind-dial-tick"}
                key={bearing}
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
              />
            );
          })}
          {CARDINALS.map(({ bearing, letter }) => {
            const [x, y] = polar(bearing, LETTER_RADIUS);
            return (
              <text className="wind-dial-letter" key={letter} textAnchor="middle" x={x} y={y + 3.5}>
                {letter}
              </text>
            );
          })}
          {blowing && reading.directionDeg != null && (
            <g className="wind-needle">
              <polygon className="wind-needle-blade" points={needleBlade(reading.directionDeg)} />
              <circle
                className="wind-needle-counterweight"
                cx={polar(reading.directionDeg, COUNTERWEIGHT_REACH)[0]}
                cy={polar(reading.directionDeg, COUNTERWEIGHT_REACH)[1]}
                r={COUNTERWEIGHT_RADIUS}
              />
            </g>
          )}
          {/* The hub sits over the needle so the reading owns the centre. */}
          <circle className="wind-dial-hub" cx={CENTRE} cy={CENTRE} r={HUB_RADIUS} />
          {reading == null ? (
            <text className="wind-dial-reason" textAnchor="middle" x={CENTRE} y={CENTRE + 4}>
              {words.notReporting}
            </text>
          ) : (
            <>
              {/* Calm withholds direction, never the measured speed. */}
              <text className="wind-dial-speed" textAnchor="middle" x={CENTRE} y={CENTRE + 8}>
                {shown(reading.averageMps)}
              </text>
              <text className="wind-dial-unit" textAnchor="middle" x={CENTRE} y={CENTRE + 26}>
                {unitLabel}
              </text>
            </>
          )}
        </svg>
        {station.capabilities.gustLull && (
          <div className="wind-flank wind-flank-gust">
            <small className="wind-microlabel">{words.gustLabel}</small>
            <strong>{reading?.gustMps == null ? EM_DASH : shown(reading.gustMps)}</strong>
          </div>
        )}
      </div>
      <p className="wind-current-direction">
        {station.status === "unavailable" ? (
          words.reasons[station.reason]
        ) : blowing && reading.directionDeg != null ? (
          <>
            <span className="wind-current-from-label">{words.fromLabel}</span>{" "}
            <WindArrow deg={reading.directionDeg} />{" "}
            <strong>{compassDirection(reading.directionDeg)}</strong>{" "}
            {Math.round(reading.directionDeg)}°
          </>
        ) : calm ? (
          words.calm
        ) : (
          EM_DASH
        )}
      </p>
      {station.capabilities.temperature && (
        <p className="wind-current-temp">
          {reading?.temperatureC == null ? EM_DASH : `${reading.temperatureC.toFixed(1)} ${words.degC}`}
          {reading?.windChillC != null && (
            <span className="wind-current-chill">
              {" "}· {words.feelsLikeLabel} {reading.windChillC.toFixed(1)} {words.degC}
            </span>
          )}
        </p>
      )}
      <p className="wind-current-footer">
        {status != null && <FreshnessBadge status={status} strings={strings} />}
        <span className="wind-current-observed">
          {reading == null ? EM_DASH : formatTime(new Date(reading.observedAt))}
        </span>
      </p>
    </div>
  );
}
