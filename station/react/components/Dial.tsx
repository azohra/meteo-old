"use client";
/* The gauge alone: CurrentConditions' compass dial extracted as a visual
 * atom — face gradient, ring, sixteen ticks, cardinal letters, the filled
 * tapered needle pointing TO with its counterweight, the band-colored speed
 * arc riding the ring, the hub, and the centred speed. No flanks, no
 * direction row, no temperature, no footer: those stay CurrentConditions'
 * business (which composes this component with calmWord={false}).
 *
 * Faithful to the instrument's semantics: calm (WMO: below 0.5 m/s) hides
 * the needle — a vane's idle bearing would fabricate a direction — while the
 * measured speed stays in the hub, with the calm word centred above it
 * because the bare dial has no direction row to say it in. Unavailable greys
 * the dial and wears the reason in words. All drawing math is the shared
 * instrument geometry (station/instruments.ts): the viewBox stays 160 and
 * `size` scales the rendered box, never the math, so every class keeps the
 * proportions styles.css was written against. */
import { useId } from "react";
import {
  DIAL_CARDINALS,
  DIAL_CARDINAL_TICK_INNER,
  DIAL_CENTRE,
  DIAL_COUNTERWEIGHT_RADIUS,
  DIAL_COUNTERWEIGHT_REACH,
  DIAL_HUB_RADIUS,
  DIAL_LETTER_RADIUS,
  DIAL_RING_RADIUS,
  DIAL_SIZE,
  DIAL_TICK_INNER,
  dialNeedlePoints,
  dialPolar,
  dialScaleMaxMps,
  dialSpeedArcPath,
  isCalm,
  resolveDisplay,
  roundSpeed,
  speedBand,
  thresholdsToMps,
} from "../../index.js";
import type { SpeedThresholds, SpeedUnit, Station } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";

export function Dial({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  unit: unitProp,
  size = DIAL_SIZE,
  calmWord = true,
  strings: stringsProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Consumer-unit bounds ({ unit, values }); converted to wire m/s once. The
   * speed arc wears meteo-band-0..n of the current reading when given, the
   * neutral accent otherwise. null opts out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Display unit only: every shown speed converts, banding and geometry stay
   * in wire m/s. */
  unit?: SpeedUnit;
  /* Rendered box in px; the drawing scales uniformly from the fixed 160-unit
   * viewBox, so proportions never change. */
  size?: number;
  /* The calm word centred in the hub when the reading is calm. The BARE dial
   * needs it — it has no direction row to say calm in — so it defaults on; a
   * composition whose own direction row states calm (CurrentConditions)
   * turns it off. The aria label always speaks calm either way. */
  calmWord?: boolean;
  strings?: StationStringOverrides;
  /* Accepted for API symmetry with the other station components; the bare
   * dial prints no timestamps, so it is currently unused. */
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Dial",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });

  /* The shared rounding rule: shown speeds convert, the wire stays m/s. */
  const shown = (averageMps: number) => roundSpeed(averageMps, unit);
  const unitLabel = words.speedUnits[unit];
  /* useId can carry characters url(#…) references choke on. */
  const bezelId = `meteo-bezel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reading = station.status === "ok" ? station.reading : null;
  const calm = reading != null && isCalm(reading.averageMps);
  const blowing = reading != null && !calm && reading.directionDeg != null;

  const dialMax = dialScaleMaxMps(reading?.averageMps ?? null, reading?.gustMps ?? null, unit);
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
    <svg
      aria-label={dialLabel}
      className={station.status === "unavailable" ? "meteo-wind-dial meteo-wind-dial-unavailable" : "meteo-wind-dial"}
      height={size}
      role="img"
      viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
      width={size}
    >
      <defs>
        {/* Stop colours live in CSS so the bezel rethemes with the rest. */}
        <radialGradient cx="50%" cy="42%" id={bezelId} r="68%">
          <stop className="meteo-wind-dial-bezel-in" offset="55%" />
          <stop className="meteo-wind-dial-bezel-out" offset="100%" />
        </radialGradient>
      </defs>
      <circle className="meteo-wind-dial-face" cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={DIAL_RING_RADIUS} />
      <circle className="meteo-wind-dial-bezel" cx={DIAL_CENTRE} cy={DIAL_CENTRE} fill={`url(#${bezelId})`} r={DIAL_RING_RADIUS} />
      <circle className="meteo-wind-dial-ring" cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={DIAL_RING_RADIUS} />
      {reading != null && arcFraction > 0 && (
        <path
          className={arcBand == null ? "meteo-wind-dial-arc" : `meteo-wind-dial-arc meteo-band-${arcBand}`}
          d={dialSpeedArcPath(arcFraction)}
        />
      )}
      {Array.from({ length: 16 }, (_, index) => {
        const bearing = index * 22.5;
        const cardinal = index % 4 === 0;
        const [x1, y1] = dialPolar(bearing, DIAL_RING_RADIUS);
        const [x2, y2] = dialPolar(bearing, cardinal ? DIAL_CARDINAL_TICK_INNER : DIAL_TICK_INNER);
        return (
          <line
            className={cardinal ? "meteo-wind-dial-tick meteo-wind-dial-tick-cardinal" : "meteo-wind-dial-tick"}
            key={bearing}
            x1={x1}
            x2={x2}
            y1={y1}
            y2={y2}
          />
        );
      })}
      {DIAL_CARDINALS.map(({ bearing, letter }) => {
        const [x, y] = dialPolar(bearing, DIAL_LETTER_RADIUS);
        return (
          <text className="meteo-wind-dial-letter" key={letter} textAnchor="middle" x={x} y={y + 3.5}>
            {letter}
          </text>
        );
      })}
      {blowing && reading.directionDeg != null && (
        <g className="meteo-wind-needle">
          <polygon className="meteo-wind-needle-blade" points={dialNeedlePoints(reading.directionDeg)} />
          <circle
            className="meteo-wind-needle-counterweight"
            cx={dialPolar(reading.directionDeg, DIAL_COUNTERWEIGHT_REACH)[0]}
            cy={dialPolar(reading.directionDeg, DIAL_COUNTERWEIGHT_REACH)[1]}
            r={DIAL_COUNTERWEIGHT_RADIUS}
          />
        </g>
      )}
      {/* The hub sits over the needle so the reading owns the centre. */}
      <circle className="meteo-wind-dial-hub" cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={DIAL_HUB_RADIUS} />
      {reading == null ? (
        <text className="meteo-wind-dial-reason" textAnchor="middle" x={DIAL_CENTRE} y={DIAL_CENTRE + 4}>
          {words.notReporting}
        </text>
      ) : (
        <>
          {/* Calm withholds direction, never the measured speed — and with no
           * direction row on the bare dial, the calm word rides the hub,
           * centred above the number in the reason text's quiet voice. */}
          {calm && calmWord && (
            <text className="meteo-wind-dial-reason" textAnchor="middle" x={DIAL_CENTRE} y={DIAL_CENTRE - 22}>
              {words.calm}
            </text>
          )}
          <text className="meteo-wind-dial-speed" textAnchor="middle" x={DIAL_CENTRE} y={DIAL_CENTRE + 8}>
            {shown(reading.averageMps)}
          </text>
          <text className="meteo-wind-dial-unit" textAnchor="middle" x={DIAL_CENTRE} y={DIAL_CENTRE + 26}>
            {unitLabel}
          </text>
        </>
      )}
    </svg>
  );
}
