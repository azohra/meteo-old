"use client";
/* The rose: where the wind came from over the window, sixteen petals by
 * default, each petal's length the sector's share of non-calm samples
 * (normalised to the busiest sector — the outer ring wears that share as a
 * label so lengths stay readable as numbers). Sequence is the vane row's
 * job; concentration is the rose's. Calm samples are named in a caption
 * beside the dial as a percentage instead of being smeared into a sector.
 * With thresholds given, each petal wears wind-band-0..n from speedBand of
 * its mean speed. */
import { normalizeDegrees, radians, speedBand, windRose } from "../../index.js";
import type { HistoryPoint, Station } from "../../index.js";
import { mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { StationStringOverrides } from "../lib/strings.js";
import { thresholdsToMps } from "../lib/thresholds.js";
import type { SpeedThresholds } from "../lib/thresholds.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

const ROSE_SIZE = 190;
const CENTRE = ROSE_SIZE / 2;
const MAX_RADIUS = 70;
/* The favorable ring sits just outside the outer grid circle, inside the
 * cardinal letters. */
const FAVORABLE_RING_RADIUS = 75;
const HUB_RADIUS = 16;
const HUB_DOT_RADIUS = 3;
const LETTER_RADIUS = 82;
const TICK_REACH = 4;
/* Petals cover most of their sector but never touch. */
const PETAL_FILL = 0.82;

const polar = (bearingDeg: number, radius: number): readonly [number, number] => {
  const angle = radians(bearingDeg);
  return [CENTRE + Math.sin(angle) * radius, CENTRE - Math.cos(angle) * radius];
};

const at = ([x, y]: readonly [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function petalPath(bearingDeg: number, radius: number, halfWidthDeg: number): string {
  const outerLeft = polar(bearingDeg - halfWidthDeg, radius);
  const outerRight = polar(bearingDeg + halfWidthDeg, radius);
  const innerLeft = polar(bearingDeg - halfWidthDeg, HUB_RADIUS);
  const innerRight = polar(bearingDeg + halfWidthDeg, HUB_RADIUS);
  return [
    `M ${at(innerLeft)}`,
    `L ${at(outerLeft)}`,
    `A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${at(outerRight)}`,
    `L ${at(innerRight)}`,
    `A ${HUB_RADIUS} ${HUB_RADIUS} 0 0 0 ${at(innerLeft)}`,
    "Z",
  ].join(" ");
}

export type FavorableDirection = {
  /* Degrees FROM, like every bearing on the wire. A sector may wrap through
   * north: { fromDeg: 300, toDeg: 40 } covers NW around to NE. */
  fromDeg: number;
  toDeg: number;
};

/* Clockwise arc on the favorable ring from fromDeg to toDeg. The span is the
 * clockwise distance, so wrap-through-north falls out of the modulo; a
 * zero-span sector draws nothing, which is what a zero-width window is. */
function ringArcPath(sector: FavorableDirection): string {
  const from = normalizeDegrees(sector.fromDeg);
  const span = normalizeDegrees(sector.toDeg - sector.fromDeg);
  const start = polar(from, FAVORABLE_RING_RADIUS);
  const end = polar(from + span, FAVORABLE_RING_RADIUS);
  return `M ${at(start)} A ${FAVORABLE_RING_RADIUS} ${FAVORABLE_RING_RADIUS} 0 ${
    span > 180 ? 1 : 0
  } 1 ${at(end)}`;
}

const CARDINAL_LETTERS = [
  { bearing: 0, letter: "N" },
  { bearing: 90, letter: "E" },
  { bearing: 180, letter: "S" },
  { bearing: 270, letter: "W" },
] as const;

const INTERCARDINAL_BEARINGS = [45, 135, 225, 315] as const;

export function WindRose({
  station: stationProp,
  stationId,
  points,
  sectorCount = 16,
  thresholds: thresholdsProp,
  favorableDirections,
  strings: stringsProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> — when no raw `points`
   * are given either — the station resolves via stationId →
   * primaryStationId → stations[0]. The rose shows shares (percentages),
   * never speed numbers, so it takes no display `unit`. */
  station?: Station;
  stationId?: string;
  /* Used when no station is given, or the station carries no history. */
  points?: HistoryPoint[];
  sectorCount?: number;
  /* Consumer-unit bounds ({ unit, values }); converted to wire m/s once for
   * petal banding. null opts out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Launch-window sectors, degrees FROM (may wrap through north). Drawn as a
   * judgment ring outside the grid — the ring judges direction, the petals
   * report distribution, and the two never mix. */
  favorableDirections?: FavorableDirection[];
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  /* Explicit points outrank the provider: a consumer handing raw samples
   * asked for exactly those samples. */
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const thresholds = thresholdsProp === undefined ? context?.thresholds : (thresholdsProp ?? undefined);
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const source =
    points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
  if (source.length === 0) {
    return (
      <div className="wind-rose wind-rose-na" role="note">
        {words.noHistory}
      </div>
    );
  }

  const rose = windRose(source, sectorCount);
  const maxFrequency = Math.max(...rose.sectors.map((sector) => sector.frequency));
  const halfWidthDeg = (360 / sectorCount / 2) * PETAL_FILL;
  const calmPercent = Math.round(rose.calmFraction * 100);
  /* The SE quadrant carries the ring label — no cardinal letter lives there. */
  const [ringLabelX, ringLabelY] = polar(135, MAX_RADIUS);
  /* The judgment ring is spoken, not just drawn: the label names the
   * favorable sectors so a screen reader gets the same verdict. */
  const favorable = favorableDirections != null && favorableDirections.length > 0;
  const baseLabel = station ? words.aria.rose(station.name) : words.aria.roseGeneric;
  const roseLabel = favorable
    ? `${baseLabel} ${words.aria.roseFavorable(
        favorableDirections
          .map(
            (sector) =>
              `${Math.round(normalizeDegrees(sector.fromDeg))}°–${Math.round(
                normalizeDegrees(sector.toDeg),
              )}°`,
          )
          .join(", "),
      )}`
    : baseLabel;

  return (
    <div className="wind-rose">
      <svg
        aria-label={roseLabel}
        className="wind-rose-svg"
        height={ROSE_SIZE}
        role="img"
        viewBox={`0 0 ${ROSE_SIZE} ${ROSE_SIZE}`}
        width={ROSE_SIZE}
      >
        {[1, 2 / 3, 1 / 3].map((fraction) => (
          <circle
            className="wind-rose-grid"
            cx={CENTRE}
            cy={CENTRE}
            key={fraction}
            r={MAX_RADIUS * fraction}
          />
        ))}
        {/* Unfavorable is the whole ring; favorable arcs paint over it, so
         * the remainder needs no complement arithmetic. */}
        {favorable && (
          <>
            <circle
              className="wind-rose-ring-unfavorable"
              cx={CENTRE}
              cy={CENTRE}
              r={FAVORABLE_RING_RADIUS}
            />
            {favorableDirections.map((sector) => (
              <path
                className="wind-rose-ring-favorable"
                d={ringArcPath(sector)}
                key={`${sector.fromDeg}-${sector.toDeg}`}
              />
            ))}
          </>
        )}
        {INTERCARDINAL_BEARINGS.map((bearing) => {
          const [x1, y1] = polar(bearing, MAX_RADIUS - TICK_REACH);
          const [x2, y2] = polar(bearing, MAX_RADIUS + TICK_REACH);
          return <line className="wind-rose-tick" key={bearing} x1={x1} x2={x2} y1={y1} y2={y2} />;
        })}
        {CARDINAL_LETTERS.map(({ bearing, letter }) => {
          const [x, y] = polar(bearing, LETTER_RADIUS);
          return (
            <text className="wind-rose-letter" key={letter} textAnchor="middle" x={x} y={y + 4}>
              {letter}
            </text>
          );
        })}
        {rose.sectors.map((sector) => {
          if (sector.count === 0 || maxFrequency === 0) return null;
          const radius =
            HUB_RADIUS + (sector.frequency / maxFrequency) * (MAX_RADIUS - HUB_RADIUS);
          const banded =
            boundsMps != null && sector.meanSpeedMps != null
              ? ` wind-band-${speedBand(sector.meanSpeedMps, boundsMps)}`
              : "";
          return (
            <path
              className={`wind-rose-petal${banded}`}
              d={petalPath(sector.bearingDeg, radius, halfWidthDeg)}
              key={sector.bearingDeg}
            />
          );
        })}
        {/* Outer grid ring named for what it means: the busiest sector's
         * share of non-calm samples. */}
        {maxFrequency > 0 && (
          <text
            className="wind-rose-ring-label"
            textAnchor="start"
            x={ringLabelX + 3}
            y={ringLabelY + 9}
          >
            {words.percentShare(Math.round(maxFrequency * 100))}
          </text>
        )}
        <circle className="wind-rose-hub" cx={CENTRE} cy={CENTRE} r={HUB_RADIUS} />
        <circle className="wind-rose-dot" cx={CENTRE} cy={CENTRE} r={HUB_DOT_RADIUS} />
      </svg>
      {rose.calmFraction > 0 && (
        <p className="wind-rose-calm">{words.percentCalm(calmPercent)}</p>
      )}
    </div>
  );
}
