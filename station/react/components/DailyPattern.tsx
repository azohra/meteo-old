"use client";
/* The typical day: every history point dropped into a fixed-width slot by
 * time-of-day alone (dailyPattern, in geometry.ts) and drawn with the exact
 * frame/scale/banding machinery WindHistoryChart already built — each slot
 * becomes a synthetic point at its own midpoint, so chartFrame, chartScales,
 * averagePoints, thinVanes, and vaneTicks all apply unchanged. dailyPattern
 * reports one vector-mean speed per slot, never a lull/gust spread, so
 * there is no band to draw here; the vane row is one arrow per slot,
 * vector-averaged like every other vane this library draws.
 *
 * Unlike WindHistoryChart this is static — no pointer inspector. A "typical
 * day" has no instant to inspect, only a slot's coverage, which the caption
 * states in words instead: "n samples over n days" (a true fraction, from
 * the station's own periodMinutes, when a whole station is resolved) rather
 * than a percentage this component would otherwise have to invent.
 *
 * A slot nothing ever fell into is not zero wind — it is missing history —
 * so it wears the same hatch a dropout does, never a false flat reading. */
import { useEffect, useId, useRef, useState } from "react";
import {
  CHART_FALLBACK_WIDTH,
  CHART_WIDE_PLOT_HEIGHT,
  CHART_WIDE_PLOT_MIN_WIDTH,
  DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  averagePoints,
  chartFrame,
  chartScales,
  compassDirection,
  dailyPattern,
  speedFromMps,
  speedToMps,
  isCalm,
  resolveDisplay,
  speedBand,
  stretchFrame,
  thinVanes,
  vanePath,
  vaneTicks,
} from "../../index.js";
import type { DailyPatternSlot, HistoryPoint, SpeedUnit, Station } from "../../index.js";
import { EM_DASH } from "../../index.js";
import type { StationStringOverrides, StationStrings } from "../../index.js";
import { thresholdsToMps } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

/* An arbitrary, fixed epoch: slots carry no real calendar date, only a
 * minute-of-day, so this is scratch space for reusing HistoryPoint-shaped
 * chart geometry — never rendered, never compared against a wall clock. */
const SYNTHETIC_EPOCH_MS = Date.parse("2000-01-01T00:00:00Z");

export function DailyPattern({
  station: stationProp,
  stationId,
  points,
  slotMinutes = DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  utcOffsetMinutes = 0,
  thresholds: thresholdsProp,
  unit: unitProp,
  plotHeight,
  strings: stringsProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> — when no raw `points`
   * are given either — the station resolves via stationId →
   * primaryStationId → stations[0]. */
  station?: Station;
  stationId?: string;
  /* Used when no station is given, or the station carries no history. */
  points?: HistoryPoint[];
  /* Bucket width in minutes; must divide 1440 evenly (dailyPattern enforces
   * it). Default matches WindNerd's own "vector-averaged 3h slots". */
  slotMinutes?: number;
  /* A plain UTC offset, not an IANA zone — see dailyPattern's own note. */
  utcOffsetMinutes?: number;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const source =
    points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
  /* A whole station's own sampling cadence turns "n samples" into a true
   * coverage fraction; raw points carry no cadence to divide by. */
  const periodMinutes =
    points == null && station?.status === "ok" ? (station.history?.periodMinutes ?? null) : null;
  const drawable = source.length > 0;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      setWidth(measured > 0 ? Math.round(measured) : CHART_FALLBACK_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawable]);

  if (!drawable) {
    return (
      <div className="meteo-daily-pattern meteo-daily-pattern-na" role="note">
        {words.noHistory}
      </div>
    );
  }

  return (
    <div className="meteo-daily-pattern" ref={wrapRef}>
      {width != null && (
        <MeasuredDailyPattern
          periodMinutes={periodMinutes}
          plotHeight={plotHeight}
          points={source}
          slotMinutes={slotMinutes}
          stationName={station?.name}
          thresholds={thresholds}
          unit={unit}
          utcOffsetMinutes={utcOffsetMinutes}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

/* A slot's own synthetic point, plus the [start, end) minute span it was
 * built from — the span is what a coverage-honest caption and the void
 * hatching key off, never the point's fabricated observedAt. */
function slotPoint(slot: DailyPatternSlot, slotMinutes: number): HistoryPoint {
  return {
    observedAt: new Date(
      SYNTHETIC_EPOCH_MS + (slot.startMinuteOfDay + slotMinutes / 2) * 60_000,
    ).toISOString(),
    averageMps: slot.speedMps,
    gustMps: null,
    lullMps: null,
    directionDeg: slot.directionDeg,
    temperatureC: null,
  };
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const clamped = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const hours = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minutes = String(clamped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function MeasuredDailyPattern({
  periodMinutes,
  plotHeight,
  points,
  slotMinutes,
  stationName,
  thresholds,
  unit,
  utcOffsetMinutes,
  width,
  words,
}: {
  periodMinutes: number | null;
  plotHeight: number | undefined;
  points: HistoryPoint[];
  slotMinutes: number;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  utcOffsetMinutes: number;
  width: number;
  words: StationStrings;
}) {
  const shown = (averageMps: number) => Math.round(speedFromMps(averageMps, unit));
  const hatchId = `meteo-daily-pattern-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const slots = dailyPattern(points, { slotMinutes, utcOffsetMinutes });
  const synthetic = slots.map((slot) => slotPoint(slot, slotMinutes));
  const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleCount, 0);
  /* Every day in the input's own span contributes periodMinutes/slotMinutes
   * samples to each slot; a coverage caption divides by exactly that, never
   * an assumed cadence. */
  const daysSpanned =
    points.length < 2
      ? null
      : (Date.parse((points[points.length - 1] as HistoryPoint).observedAt) -
          Date.parse((points[0] as HistoryPoint).observedAt)) /
        86_400_000;
  const expectedSamples =
    periodMinutes != null && daysSpanned != null && daysSpanned > 0
      ? Math.round((slotMinutes / periodMinutes) * daysSpanned * slots.length)
      : null;

  const coreFrame = chartFrame(width);
  const corePlotHeight = coreFrame.plotBottom - coreFrame.plotTop;
  const frame = stretchFrame(
    coreFrame,
    plotHeight ??
      (width < CHART_WIDE_PLOT_MIN_WIDTH
        ? corePlotHeight
        : Math.max(corePlotHeight, CHART_WIDE_PLOT_HEIGHT)),
  );
  const scales = chartScales(synthetic, frame, {
    niceStepMps: speedToMps(5, unit),
    floorMps: speedToMps(10, unit),
  });
  const vanes = thinVanes(synthetic);
  const ticks = vaneTicks(vanes, scales);
  const calm = synthetic.every((point) => isCalm(point.averageMps));

  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const meanSegments =
    boundsMps == null
      ? null
      : synthetic.slice(1).map((point, index) => {
          const previous = synthetic[index] as HistoryPoint;
          return {
            band: speedBand((previous.averageMps + point.averageMps) / 2, boundsMps),
            key: point.observedAt,
            x1: scales.xAt(previous.observedAt),
            x2: scales.xAt(point.observedAt),
            y1: scales.yAt(previous.averageMps),
            y2: scales.yAt(point.averageMps),
          };
        });
  const thresholdGuides =
    thresholds == null || boundsMps == null
      ? []
      : boundsMps
          .map((boundMps, index) => ({
            boundMps,
            label: unit === thresholds.unit ? String(thresholds.values[index]) : String(shown(boundMps)),
          }))
          .filter(({ boundMps }) => boundMps > 0 && boundMps <= scales.scaleMax);
  const zoneCuts =
    boundsMps == null
      ? null
      : [0, ...boundsMps.filter((bound) => bound > 0 && bound < scales.scaleMax), scales.scaleMax];

  /* A slot no sample ever landed in reads as missing history, hatched the
   * same way a live chart's dropout is — never smoothed away by its
   * neighbours. */
  const voidSpans: Array<[number, number]> = slots
    .filter((slot) => slot.sampleCount === 0)
    .map((slot) => [
      scales.xAtMs(SYNTHETIC_EPOCH_MS + slot.startMinuteOfDay * 60_000),
      scales.xAtMs(SYNTHETIC_EPOCH_MS + (slot.startMinuteOfDay + slotMinutes) * 60_000),
    ]);

  return (
    <>
      <output className="meteo-daily-pattern-caption">
        {expectedSamples != null
          ? words.dailyPatternCoverage(totalSamples, expectedSamples)
          : words.dailyPatternSamples(totalSamples)}
      </output>
      <svg
        aria-label={
          stationName ? words.aria.dailyPattern(stationName) : words.aria.dailyPatternGeneric
        }
        className="meteo-daily-pattern-svg"
        height={frame.height}
        role="img"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        width={frame.width}
      >
        <defs>
          <pattern
            height="6"
            id={hatchId}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
            width="6"
          >
            <line className="meteo-wind-gap-hatch" x1="0" x2="0" y1="0" y2="6" />
          </pattern>
        </defs>
        {zoneCuts != null &&
          boundsMps != null &&
          zoneCuts.slice(0, -1).map((lower, index) => {
            const upper = zoneCuts[index + 1] as number;
            return (
              <rect
                className={`meteo-wind-zone meteo-band-${speedBand((lower + upper) / 2, boundsMps)}`}
                height={scales.yAt(lower) - scales.yAt(upper)}
                key={lower}
                width={frame.right - frame.left}
                x={frame.left}
                y={scales.yAt(upper)}
              />
            );
          })}
        {[0, 0.5, 1].map((fraction) => {
          const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
          return (
            <g key={fraction}>
              <line className="meteo-grid-line" x1={frame.left} x2={frame.right} y1={gridY} y2={gridY} />
              <text className="meteo-grid-label" textAnchor="end" x={frame.left - 6} y={gridY + 5}>
                {shown(scales.scaleMax * fraction)}
              </text>
            </g>
          );
        })}
        {boundsMps != null &&
          thresholdGuides.map(({ boundMps, label }) => (
            <g key={boundMps}>
              <line
                className={`meteo-wind-threshold meteo-band-${speedBand(boundMps, boundsMps)}`}
                x1={frame.left}
                x2={frame.right}
                y1={scales.yAt(boundMps)}
                y2={scales.yAt(boundMps)}
              />
              <text
                className={`meteo-wind-threshold-label meteo-band-${speedBand(boundMps, boundsMps)}`}
                textAnchor="end"
                x={frame.right - 3}
                y={scales.yAt(boundMps) - 3}
              >
                {label}
              </text>
            </g>
          ))}
        {vanes.map((vane) => (
          <line
            className="meteo-wind-guide"
            key={`guide-${vane.midMs}`}
            x1={scales.xAtMs(vane.midMs)}
            x2={scales.xAtMs(vane.midMs)}
            y1={frame.plotTop}
            y2={frame.vaneRow - 9}
          />
        ))}
        {voidSpans.map(([startX, endX]) => (
          <rect
            className="meteo-wind-gap"
            fill={`url(#${hatchId})`}
            height={frame.plotBottom - frame.plotTop}
            key={startX}
            width={endX - startX}
            x={startX}
            y={frame.plotTop}
          />
        ))}
        {meanSegments == null ? (
          <polyline className="meteo-wind-mean" points={averagePoints(synthetic, scales)} />
        ) : (
          meanSegments.map((segment) => (
            <line
              className={`meteo-wind-mean-segment meteo-band-${segment.band}`}
              key={segment.key}
              x1={segment.x1}
              x2={segment.x2}
              y1={segment.y1}
              y2={segment.y2}
            />
          ))
        )}
        {calm && (
          <text
            className="meteo-wind-calm-note"
            textAnchor="middle"
            x={(frame.left + frame.right) / 2}
            y={(frame.plotTop + frame.plotBottom) / 2 + 4}
          >
            {words.calmHistory}
          </text>
        )}
        <text className="meteo-wind-row-label" textAnchor="end" x={frame.left - 8} y={frame.vaneRow + 4}>
          {words.toLabel}
        </text>
        {vanes.map((vane) =>
          vane.directionDeg == null ? (
            <text
              className="meteo-wind-vane-calm"
              key={vane.midMs}
              textAnchor="middle"
              x={scales.xAtMs(vane.midMs)}
              y={frame.vaneRow + 4}
            >
              {EM_DASH}
            </text>
          ) : (
            <path
              className="meteo-wind-vane"
              d={vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.directionDeg)}
              key={vane.midMs}
            />
          ),
        )}
        {/* The persistent compass-letter row: the direction every vane
         * points, spelled out, so a reader never has to hover to name it. */}
        {vanes.map((vane) => (
          <text
            className="meteo-wind-vane-label"
            key={`label-${vane.midMs}`}
            textAnchor="middle"
            x={scales.xAtMs(vane.midMs)}
            y={frame.vaneLabelRow + 4}
          >
            {vane.directionDeg == null ? EM_DASH : compassDirection(vane.directionDeg)}
          </text>
        ))}
        <text className="meteo-wind-row-label" textAnchor="end" x={frame.left - 8} y={frame.valueRow + 4}>
          {words.avgLabel}
        </text>
        {/* The persistent Avg row: one number per vane — dashed when every
         * slot the vane's window covers is void (nothing this station ever
         * recorded at that time of day), never a fabricated zero. */}
        {vanes.map((vane) => {
          const voidWindow = slots
            .slice(vane.startIndex, vane.endIndex)
            .every((slot) => slot.sampleCount === 0);
          return (
            <text
              className="meteo-wind-vane-value"
              key={`value-${vane.midMs}`}
              textAnchor="middle"
              x={scales.xAtMs(vane.midMs)}
              y={frame.valueRow + 4}
            >
              {voidWindow ? EM_DASH : shown(vane.averageMps)}
            </text>
          );
        })}
        {ticks.map(({ index, timeMs, x }) => (
          <text
            className="meteo-tick"
            key={index}
            textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
            x={x}
            y={frame.labelRow}
          >
            {formatMinuteOfDay((timeMs - SYNTHETIC_EPOCH_MS) / 60_000)}
          </text>
        ))}
      </svg>
    </>
  );
}

/* Re-exported so a consumer building a custom legend can name the same
 * compass points and arrow the vane row itself draws. */
export { compassDirection, WindArrow };
