"use client";
/* The rose: where the wind came from over the window, sixteen petals by
 * default, each petal's length the sector's share of non-calm samples
 * (normalised to the busiest sector — the outer ring wears that share as a
 * label so lengths stay readable as numbers). Sequence is the vane row's
 * job; concentration is the rose's. Calm samples are named in a caption
 * beside the dial as a percentage instead of being smeared into a sector.
 * With thresholds given, each petal wears meteo-band-0..n from speedBand of
 * its mean speed. Petal and ring math is the shared instrument geometry
 * (station/instruments.ts). */
import {
  ROSE_CARDINAL_LETTERS,
  ROSE_CENTRE,
  ROSE_FAVORABLE_RING_RADIUS,
  ROSE_HUB_DOT_RADIUS,
  ROSE_HUB_RADIUS,
  ROSE_INTERCARDINAL_BEARINGS,
  ROSE_LETTER_RADIUS,
  ROSE_MAX_RADIUS,
  ROSE_PETAL_FILL,
  ROSE_SIZE,
  ROSE_TICK_REACH,
  normalizeDegrees,
  resolveDisplay,
  rosePetalPath,
  rosePolar,
  roseRingArcPath,
  speedBand,
  thresholdsToMps,
  windRose,
} from "../../index.js";
import type { FavorableDirection, HistoryPoint, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

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
  const { thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
  });
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const source =
    points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
  if (source.length === 0) {
    return (
      <div className="meteo-wind-rose meteo-wind-rose-na" role="note">
        {words.noHistory}
      </div>
    );
  }

  const rose = windRose(source, sectorCount);
  const maxFrequency = Math.max(...rose.sectors.map((sector) => sector.frequency));
  const halfWidthDeg = (360 / sectorCount / 2) * ROSE_PETAL_FILL;
  const calmPercent = Math.round(rose.calmFraction * 100);
  /* The SE quadrant carries the ring label — no cardinal letter lives there. */
  const [ringLabelX, ringLabelY] = rosePolar(135, ROSE_MAX_RADIUS);
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
    <div className="meteo-wind-rose">
      <svg
        aria-label={roseLabel}
        className="meteo-wind-rose-svg"
        height={ROSE_SIZE}
        role="img"
        viewBox={`0 0 ${ROSE_SIZE} ${ROSE_SIZE}`}
        width={ROSE_SIZE}
      >
        {[1, 2 / 3, 1 / 3].map((fraction) => (
          <circle
            className="meteo-wind-rose-grid"
            cx={ROSE_CENTRE}
            cy={ROSE_CENTRE}
            key={fraction}
            r={ROSE_MAX_RADIUS * fraction}
          />
        ))}
        {/* Unfavorable is the whole ring; favorable arcs paint over it, so
         * the remainder needs no complement arithmetic. */}
        {favorable && (
          <>
            <circle
              className="meteo-wind-rose-ring-unfavorable"
              cx={ROSE_CENTRE}
              cy={ROSE_CENTRE}
              r={ROSE_FAVORABLE_RING_RADIUS}
            />
            {favorableDirections.map((sector) => (
              <path
                className="meteo-wind-rose-ring-favorable"
                d={roseRingArcPath(sector)}
                key={`${sector.fromDeg}-${sector.toDeg}`}
              />
            ))}
          </>
        )}
        {ROSE_INTERCARDINAL_BEARINGS.map((bearing) => {
          const [x1, y1] = rosePolar(bearing, ROSE_MAX_RADIUS - ROSE_TICK_REACH);
          const [x2, y2] = rosePolar(bearing, ROSE_MAX_RADIUS + ROSE_TICK_REACH);
          return <line className="meteo-wind-rose-tick" key={bearing} x1={x1} x2={x2} y1={y1} y2={y2} />;
        })}
        {ROSE_CARDINAL_LETTERS.map(({ bearing, letter }) => {
          const [x, y] = rosePolar(bearing, ROSE_LETTER_RADIUS);
          return (
            <text className="meteo-wind-rose-letter" key={letter} textAnchor="middle" x={x} y={y + 4}>
              {letter}
            </text>
          );
        })}
        {rose.sectors.map((sector) => {
          if (sector.count === 0 || maxFrequency === 0) return null;
          const radius =
            ROSE_HUB_RADIUS + (sector.frequency / maxFrequency) * (ROSE_MAX_RADIUS - ROSE_HUB_RADIUS);
          const banded =
            boundsMps != null && sector.meanSpeedMps != null
              ? ` meteo-band-${speedBand(sector.meanSpeedMps, boundsMps)}`
              : "";
          return (
            <path
              className={`meteo-wind-rose-petal${banded}`}
              d={rosePetalPath(sector.bearingDeg, radius, halfWidthDeg)}
              key={sector.bearingDeg}
            />
          );
        })}
        {/* Outer grid ring named for what it means: the busiest sector's
         * share of non-calm samples. */}
        {maxFrequency > 0 && (
          <text
            className="meteo-wind-rose-ring-label"
            textAnchor="start"
            x={ringLabelX + 3}
            y={ringLabelY + 9}
          >
            {words.percentShare(Math.round(maxFrequency * 100))}
          </text>
        )}
        <circle className="meteo-wind-rose-hub" cx={ROSE_CENTRE} cy={ROSE_CENTRE} r={ROSE_HUB_RADIUS} />
        <circle className="meteo-wind-rose-dot" cx={ROSE_CENTRE} cy={ROSE_CENTRE} r={ROSE_HUB_DOT_RADIUS} />
      </svg>
      {rose.calmFraction > 0 && (
        <p className="meteo-wind-rose-calm">{words.percentCalm(calmPercent)}</p>
      )}
    </div>
  );
}
