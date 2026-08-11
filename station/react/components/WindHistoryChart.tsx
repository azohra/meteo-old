"use client";
/* The six-hour chart: lull-to-gust band, average trace, a vane row pointing
 * downwind, dropout gaps drawn as hatched spans, and an inspector.
 *
 * Interaction model (inherited from the predecessor and kept exactly):
 * pointer-move previews, click or tap pins, pointerleave clears the preview,
 * and touch never previews so scrolling over the chart stays a scroll. The
 * readout row above the chart always says something — unpinned it names the
 * window — so inspection never changes the layout's height. A pin holds the
 * sample's timestamp, not its position: a live window slides under an index,
 * and the pin clears itself when its moment leaves the window.
 *
 * Colour grading is the axis of control an iframe never offered: given
 * consumer-unit thresholds ({ unit, values } — converted to wire m/s once,
 * in thresholdsToMps), the average trace is drawn per-segment and each
 * segment wears meteo-band-0..n from speedBand of its mean, each band's zone
 * is tinted behind the plot, and a guide line at each threshold wears the
 * band it opens. What a band means and what colour it wears belong to the
 * consumer's CSS.
 *
 * Width comes from a ResizeObserver on the wrapper — no window listeners —
 * and nothing draws until the first measurement so a chart never flashes at
 * the wrong scale. Drawn at one SVG unit per CSS pixel: a scaled viewBox
 * would shrink its own labels. */
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  CHART_FALLBACK_WIDTH,
  CHART_WIDE_PLOT_HEIGHT,
  CHART_WIDE_PLOT_MIN_WIDTH,
  averagePoints,
  bandPoints,
  chartFrame,
  chartScales,
  compareTracePoints,
  compareWindow,
  compassDirection,
  speedFromMps,
  speedToMps,
  historyGaps,
  isCalm,
  isCalmHistory,
  nearestIndex,
  resolveDisplay,
  speedBand,
  stretchFrame,
  thinVanes,
  vanePath,
  vaneTicks,
  windowPoints,
} from "../../index.js";
import type { History, HistoryPoint, SpeedUnit, Station } from "../../index.js";
import { EM_DASH } from "../../index.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { thresholdsToMps } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

export function WindHistoryChart({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  unit: unitProp,
  plotHeight,
  windowHours,
  compareOffsetDays,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Consumer-unit bounds ({ unit, values }) for meteo-band-0..n grading;
   * converted to wire m/s once. Guide labels print the numbers the consumer
   * declared, converted only when the display unit differs. null opts out of
   * the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Display unit only: readout numbers, axis labels, and guide labels
   * convert; scales, banding, and geometry stay in wire m/s. */
  unit?: SpeedUnit;
  /* Plot-area height in px; defaults to the core frame, raised to 160 on
   * wide layouts. */
  plotHeight?: number;
  /* Slices the station's OWN already-fetched history to its trailing N
   * hours before anything else touches it — no new fetch. Omitted draws
   * every point the station carries, today's behaviour. */
  windowHours?: number;
  /* Overlays a prior period's trace, shifted forward onto today's own x-axis
   * for direct comparison — client-side re-slice of the SAME history, never
   * a new fetch. Absent (the default) draws no overlay; also absent from the
   * overlay itself, silently, when the station's history does not reach
   * back far enough to cover the requested offset. */
  compareOffsetDays?: 1 | 2 | 3;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "WindHistoryChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { formatTime, thresholds, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const history = station.status === "ok" ? station.history : null;
  const drawable = station.capabilities.history && history != null && history.points.length >= 2;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      /* A hidden panel reports zero; err phone-sized rather than never drawing. */
      setWidth(measured > 0 ? Math.round(measured) : CHART_FALLBACK_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawable]);

  /* A station that declares no history has nothing missing — render nothing.
   * A station that should have history but does not says so in words. */
  if (!station.capabilities.history) return null;
  if (!drawable || history == null) {
    return (
      <div className="meteo-wind-chart meteo-wind-chart-na" role="note">
        {words.noHistory}
      </div>
    );
  }

  return (
    <div className="meteo-wind-chart" ref={wrapRef}>
      {width != null && (
        <MeasuredChart
          compareOffsetDays={compareOffsetDays}
          formatTime={formatTime}
          history={history}
          plotHeight={plotHeight}
          stationName={station.name}
          thresholds={thresholds}
          unit={unit}
          width={width}
          windowHours={windowHours}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredChart({
  compareOffsetDays,
  formatTime,
  history,
  plotHeight,
  stationName,
  thresholds,
  unit,
  width,
  windowHours,
  words,
}: {
  compareOffsetDays: 1 | 2 | 3 | undefined;
  formatTime: FormatTime;
  history: History;
  plotHeight: number | undefined;
  stationName: string;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  windowHours: number | undefined;
  words: StationStrings;
}) {
  /* windowHours narrows to the trailing N hours of the SAME points array;
   * omitted, every point the station carries draws, unchanged. */
  const points = windowPoints(history.points, windowHours);
  const shown = (averageMps: number) => Math.round(speedFromMps(averageMps, unit));
  /* useId can carry characters url(#…) references choke on. */
  const hatchId = `meteo-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  /* Pinned by observedAt, resolved to an index each render (A live feed
   * slides its window; a moment pinned past the window is gone). */
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const coreFrame = chartFrame(width);
  const corePlotHeight = coreFrame.plotBottom - coreFrame.plotTop;
  const frame = stretchFrame(
    coreFrame,
    plotHeight ??
      (width < CHART_WIDE_PLOT_MIN_WIDTH
        ? corePlotHeight
        : Math.max(corePlotHeight, CHART_WIDE_PLOT_HEIGHT)),
  );
  /* Axis rounding follows the DISPLAY unit: the ceiling snaps to a 5-step
   * and floors at 10 in whatever unit the labels will print, so a knots
   * axis tops out at a round knots number, not a rounded km/h one. */
  const scales = chartScales(points, frame, {
    niceStepMps: speedToMps(5, unit),
    floorMps: speedToMps(10, unit),
  });
  const band = bandPoints(points, scales);
  const vanes = thinVanes(points);
  const ticks = vaneTicks(vanes, scales);
  /* Gaps are the DISPLAYED window's own — a dropout outside windowHours has
   * nothing to hatch here. */
  const gaps = historyGaps({ ...history, points: points as HistoryPoint[] });
  const calm = isCalmHistory(points);

  /* Client-side re-slice of the SAME history array — never a new fetch.
   * Null (no overlay drawn) when the station's own history does not reach
   * back far enough to cover the requested offset. */
  const comparePoints =
    compareOffsetDays == null ? null : compareWindow(history.points, compareOffsetDays, windowHours);
  const compareTrace =
    comparePoints == null ? null : compareTracePoints(comparePoints, scales, compareOffsetDays as number);

  const foundPin = pinnedAt == null ? -1 : points.findIndex((point) => point.observedAt === pinnedAt);
  const pinnedIndex = foundPin === -1 ? null : foundPin;
  const activeIndex = previewIndex ?? pinnedIndex;
  const active = activeIndex == null ? undefined : points[activeIndex];

  const indexAtPoint = (clientX: number, hit: SVGRectElement): number | null => {
    const svg = hit.ownerSVGElement;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return null;
    const chartX = ((clientX - bounds.left) / bounds.width) * frame.width;
    return nearestIndex(points, chartX, frame, scales);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "touch") return;
    setPreviewIndex(indexAtPoint(event.clientX, event.currentTarget));
  };

  const handleClick = (event: ReactMouseEvent<SVGRectElement>) => {
    const index = indexAtPoint(event.clientX, event.currentTarget);
    if (index == null) return;
    const observedAt = points[index]?.observedAt;
    if (observedAt == null) return;
    setPinnedAt((current) => (current === observedAt ? null : observedAt));
    setPreviewIndex(null);
  };

  /* The ONE consumer-unit → wire conversion; everything below is m/s. */
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const meanSegments =
    boundsMps == null
      ? null
      : points.slice(1).map((point, index) => {
          const previous = points[index] as HistoryPoint;
          return {
            band: speedBand((previous.averageMps + point.averageMps) / 2, boundsMps),
            key: point.observedAt,
            x1: scales.xAt(previous.observedAt),
            x2: scales.xAt(point.observedAt),
            y1: scales.yAt(previous.averageMps),
            y2: scales.yAt(point.averageMps),
          };
        });
  /* Guides pair the wire position with the number the consumer declared:
   * the label prints the declared value verbatim when the display unit is
   * the thresholds' own unit, and converts it otherwise. */
  const thresholdGuides =
    thresholds == null || boundsMps == null
      ? []
      : boundsMps
          .map((boundMps, index) => ({
            boundMps,
            label:
              unit === thresholds.unit
                ? String(thresholds.values[index])
                : String(shown(boundMps)),
          }))
          .filter(({ boundMps }) => boundMps > 0 && boundMps <= scales.scaleMax);
  /* Ascending cut points 0..scaleMax; each pair encloses one band's zone. */
  const zoneCuts =
    boundsMps == null
      ? null
      : [0, ...boundsMps.filter((bound) => bound > 0 && bound < scales.scaleMax), scales.scaleMax];

  return (
    <>
      {/* An implicit live region: previews are pointer chatter and stay
       * silent; a pinned reading is a deliberate act and announces. */}
      <output
        aria-label={words.aria.readout(stationName)}
        aria-live={previewIndex == null ? "polite" : "off"}
        className="meteo-wind-chart-readout"
      >
        {active ? (
          <>
            <strong>{formatTime(new Date(active.observedAt))}</strong>
            <span>
              {words.avgLabel} {shown(active.averageMps)} · {words.lullLabel}{" "}
              {active.lullMps == null ? EM_DASH : shown(active.lullMps)} · {words.gustLabel}{" "}
              {active.gustMps == null ? EM_DASH : shown(active.gustMps)} {words.speedUnits[unit]} ·{" "}
              {/* Calm withholds direction by definition; a blowing sample with
               * no bearing is a broken vane and earns the dash. */}
              {isCalm(active.averageMps) ? (
                words.calm
              ) : active.directionDeg == null ? (
                EM_DASH
              ) : (
                <>
                  {words.fromLabel} <WindArrow deg={active.directionDeg} />{" "}
                  {compassDirection(active.directionDeg)} {Math.round(active.directionDeg)}°
                </>
              )}
            </span>
          </>
        ) : (
          <>
            <strong>
              {formatTime(new Date(scales.startMs))}–{formatTime(new Date(scales.endMs))}
            </strong>
            <span>{words.inspectHint}</span>
          </>
        )}
      </output>
      <svg
        aria-label={words.aria.chart(stationName)}
        className="meteo-wind-chart-svg"
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
          {/* The compare trace rides TODAY's scale; a windier prior day
           * exits the plot's top edge here rather than drawing over the
           * threshold labels above it. */}
          <clipPath id={`${hatchId}-plot`}>
            <rect
              height={frame.plotBottom - frame.plotTop}
              width={frame.right - frame.left}
              x={frame.left}
              y={frame.plotTop}
            />
          </clipPath>
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
              {/* The guide sits at the wire-unit bound; its label prints the
               * consumer's declared number in the display unit. */}
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
        {/* One guide per vane, so a vane ties to the moment above it. */}
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
        {gaps.map(([startMs, endMs]) => (
          <rect
            className="meteo-wind-gap"
            fill={`url(#${hatchId})`}
            height={frame.plotBottom - frame.plotTop}
            key={startMs}
            width={scales.xAtMs(endMs) - scales.xAtMs(startMs)}
            x={scales.xAtMs(startMs)}
            y={frame.plotTop}
          />
        ))}
        {band != null && <polygon className="meteo-wind-band" points={band} />}
        {/* Shifted forward by compareOffsetDays onto TODAY's own x-axis, so
         * the two traces overlay for a direct read — drawn behind the main
         * trace, which stays the stronger line. */}
        {compareTrace != null && (
          <polyline
            className="meteo-wind-compare"
            clipPath={`url(#${hatchId}-plot)`}
            points={compareTrace}
          />
        )}
        {meanSegments == null ? (
          <polyline className="meteo-wind-mean" points={averagePoints(points, scales)} />
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
        {/* Said in words: an all-zero trace on an empty grid reads as a dead
         * feed, not a windless day. */}
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
        {/* A window that was calm throughout has no direction to point. */}
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
        {/* The persistent Avg row: one number per vane, the same scalar mean
         * the mean trace already plots — never every raw point, too dense
         * to read. */}
        {vanes.map((vane) => (
          <text
            className="meteo-wind-vane-value"
            key={`value-${vane.midMs}`}
            textAnchor="middle"
            x={scales.xAtMs(vane.midMs)}
            y={frame.valueRow + 4}
          >
            {shown(vane.averageMps)}
          </text>
        ))}
        {ticks.map(({ index, timeMs, x }) => (
          <text
            className="meteo-tick"
            key={index}
            textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"}
            x={x}
            y={frame.labelRow}
          >
            {formatTime(new Date(timeMs))}
          </text>
        ))}
        {active && (
          <>
            <line
              className="meteo-cursor"
              x1={scales.xAt(active.observedAt)}
              x2={scales.xAt(active.observedAt)}
              y1={frame.plotTop}
              y2={frame.vaneRow + 9}
            />
            <circle
              className="meteo-cursor-dot"
              cx={scales.xAt(active.observedAt)}
              cy={scales.yAt(active.averageMps)}
              r={3}
            />
          </>
        )}
        {/* On top of everything drawn, so the pointer always lands here. */}
        <rect
          className="meteo-hit"
          fill="transparent"
          height={frame.height}
          onClick={handleClick}
          onPointerLeave={() => setPreviewIndex(null)}
          onPointerMove={handlePointerMove}
          width={frame.width}
          x={0}
          y={0}
        />
      </svg>
    </>
  );
}
