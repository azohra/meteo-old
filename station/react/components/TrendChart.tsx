"use client";
/* A temperature or pressure trace over the same history window the wind
 * chart draws. The time scale is the core geometry's; the y-scale is local
 * because these series are not speeds — the range is padded (±1 °C, ±2 hPa
 * at minimum) so a flat afternoon never zooms sensor noise into drama.
 *
 * Gaps are honest twice over: a null value ends the line segment, and so
 * does a dropout longer than the declared period's tolerance — the trace is
 * never interpolated across either. A history that never carries the series
 * says "not measured here" in words rather than drawing an empty grid.
 *
 * The inspector is the wind chart's, verbatim in behavior: pointer-move
 * previews, click or tap pins by timestamp (not index — a live window slides
 * under an index), pointerleave clears, and touch never previews so a scroll
 * stays a scroll. Width comes from a ResizeObserver on the wrapper, and
 * nothing draws before the first measurement. */
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { CHART_FALLBACK_WIDTH, chartFrame, chartScales, nearestIndex, valueScale } from "../../index.js";
import type { ChartFrame, History, HistoryPoint, Station } from "../../index.js";
import { EM_DASH, defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../lib/strings.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";

export type TrendSeries = "temperature" | "pressure";

/* Same dropout tolerance historyGaps applies: silence beyond 2.5 declared
 * periods is an outage, not a long sample. */
const GAP_TOLERANCE_FACTOR = 2.5;

const valueOf = (point: HistoryPoint, series: TrendSeries): number | null =>
  series === "temperature" ? point.temperatureC : (point.seaLevelPressureHpa ?? null);

/* Units are fixed per series — °C and hPa — which is why this component
 * takes no speed `unit` prop at all. */
const seriesPad = (series: TrendSeries): number => (series === "temperature" ? 1 : 2);

export function TrendChart({
  station: stationProp,
  stationId,
  series,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  series: TrendSeries;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "TrendChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const strings = mergeStringOverrides(context?.strings, stringsProp);
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;
  const words = resolveStrings(strings);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const history = station.status === "ok" ? station.history : null;
  const carrying =
    history == null ? 0 : history.points.filter((point) => valueOf(point, series) != null).length;
  const drawable =
    station.capabilities.history && history != null && history.points.length >= 2 && carrying >= 2;

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

  /* Three distinct absences, three answers: no declared history renders
   * nothing; history missing or thin says so; history present but never
   * carrying this series is "not measured here". */
  if (!station.capabilities.history) return null;
  if (history == null || history.points.length < 2) {
    return (
      <div className="meteo-trend meteo-trend-na" role="note">
        {words.noHistory}
      </div>
    );
  }
  if (!drawable) {
    return (
      <div className="meteo-trend meteo-trend-na" role="note">
        {words.notMeasured}
      </div>
    );
  }

  return (
    <div className="meteo-trend" ref={wrapRef}>
      {width != null && (
        <MeasuredTrend
          formatTime={formatTime}
          history={history}
          series={series}
          stationName={station.name}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredTrend({
  formatTime,
  history,
  series,
  stationName,
  width,
  words,
}: {
  formatTime: FormatTime;
  history: History;
  series: TrendSeries;
  stationName: string;
  width: number;
  words: StationStrings;
}) {
  const points = history.points;
  /* Pinned by observedAt, resolved to an index each render — a live feed
   * slides its window; a moment pinned past the window is gone. */
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /* The core frame, with the vane row cut out: a trend has no direction, so
   * the tick labels ride directly under the plot. */
  const core = chartFrame(width);
  const frame: ChartFrame = {
    ...core,
    vaneRow: core.plotBottom,
    labelRow: core.plotBottom + 22,
    height: core.plotBottom + 30,
  };
  /* Only the time half of the scales is used; y is computed locally below. */
  const scales = chartScales(points, frame);

  /* The shared value scale: padded so a flat afternoon never zooms sensor
   * noise into drama; nulls are the gap-breaking loop's business below. */
  const scale = valueScale(
    points.map((point) => valueOf(point, series)),
    frame,
    { paddingMin: seriesPad(series) },
  );
  const yAt = scale.yAt;

  /* Runs of consecutive carrying samples; a null value or a dropout breaks
   * the run. A one-sample run draws as a dot — a lone measurement between
   * gaps is still a measurement. Each run remembers its first sample's
   * observedAt as its React key: a timestamp names the run under a sliding
   * window, where a pixel coordinate would collide or churn. */
  type Run = { startedAt: string; coords: Array<readonly [number, number]> };
  const gapLimitMs = history.periodMinutes * 60_000 * GAP_TOLERANCE_FACTOR;
  const segments: Run[] = [];
  let run: Run | null = null;
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const value = valueOf(point, series);
    const ms = Date.parse(point.observedAt);
    if ((value == null || ms - previousMs > gapLimitMs) && run != null) {
      segments.push(run);
      run = null;
    }
    if (value != null) {
      run ??= { startedAt: point.observedAt, coords: [] };
      run.coords.push([scales.xAtMs(ms), yAt(value)] as const);
    }
    previousMs = ms;
  }
  if (run != null) segments.push(run);

  const foundPin = pinnedAt == null ? -1 : points.findIndex((point) => point.observedAt === pinnedAt);
  const pinnedIndex = foundPin === -1 ? null : foundPin;
  const activeIndex = previewIndex ?? pinnedIndex;
  const active = activeIndex == null ? undefined : points[activeIndex];
  const activeValue = active == null ? null : valueOf(active, series);

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

  const seriesLabel = series === "temperature" ? words.trendTemperature : words.trendPressure;
  const unitWord = series === "temperature" ? words.degC : words.air.unitHpa;
  const shown = (value: number) => value.toFixed(1);
  /* Simple five-tick time fractions — no vanes to anchor to. */
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => ({
    index,
    timeMs: scales.startMs + fraction * scales.durationMs,
  }));

  return (
    <>
      {/* An implicit live region, exactly the wind chart's: previews are
       * pointer chatter and stay silent; a pin is deliberate and announces. */}
      <output
        aria-label={words.aria.readout(stationName)}
        aria-live={previewIndex == null ? "polite" : "off"}
        className="meteo-trend-readout"
      >
        {active ? (
          <>
            <strong>{formatTime(new Date(active.observedAt))}</strong>
            <span>
              {seriesLabel} {activeValue == null ? EM_DASH : `${shown(activeValue)} ${unitWord}`}
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
        aria-label={words.aria.trend(stationName, seriesLabel)}
        className="meteo-trend-svg"
        height={frame.height}
        role="img"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        width={frame.width}
      >
        {[0, 0.5, 1].map((fraction) => {
          const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
          return (
            <g key={fraction}>
              <line className="wind-grid-line" x1={frame.left} x2={frame.right} y1={gridY} y2={gridY} />
              <text className="wind-grid-label" textAnchor="end" x={frame.left - 6} y={gridY + 5}>
                {Math.round(scale.min + fraction * (scale.max - scale.min))}
              </text>
            </g>
          );
        })}
        {segments.map((segment) =>
          segment.coords.length === 1 ? (
            <circle
              className="meteo-trend-dot"
              cx={segment.coords[0]?.[0]}
              cy={segment.coords[0]?.[1]}
              key={segment.startedAt}
              r={2.5}
            />
          ) : (
            <polyline
              className="meteo-trend-line"
              key={segment.startedAt}
              points={segment.coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
            />
          ),
        )}
        {ticks.map(({ index, timeMs }) => (
          <text
            className="wind-tick"
            key={index}
            textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"}
            x={scales.xAtMs(timeMs)}
            y={frame.labelRow}
          >
            {formatTime(new Date(timeMs))}
          </text>
        ))}
        {active && (
          <>
            <line
              className="wind-cursor"
              x1={scales.xAt(active.observedAt)}
              x2={scales.xAt(active.observedAt)}
              y1={frame.plotTop}
              y2={frame.plotBottom + 4}
            />
            {activeValue != null && (
              <circle
                className="wind-cursor-dot"
                cx={scales.xAt(active.observedAt)}
                cy={yAt(activeValue)}
                r={3}
              />
            )}
          </>
        )}
        {/* On top of everything drawn, so the pointer always lands here. */}
        <rect
          className="wind-hit"
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
