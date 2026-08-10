"use client";
/* Inline wind history: the big chart's average trace and lull–gust band shrunk
 * to a word-sized glyph. One <svg>, no axes, no labels, no interaction — a
 * sparkline earns its keep inside a sentence or a table cell.
 *
 * Honesty rules are the chart's, kept at miniature scale and computed by the
 * shared instrument geometry (station/instruments.ts): the line breaks
 * across dropouts longer than the declared period's tolerance (historyRuns),
 * the band only spans samples that actually carry the gust–lull pair and
 * breaks where the pair goes null (bandStrips), and nothing is ever
 * interpolated across a silence. Given consumer thresholds the trace is
 * drawn per-segment wearing meteo-band-0..n from speedBand of each segment's
 * mean, exactly the big chart's grading. The y scale runs from zero to a
 * padded window maximum; a flat calm history sits on the floor instead of
 * zooming noise into drama.
 *
 * A station with no drawable history renders an em-dash placeholder span of
 * the same fixed box, so a refresh tick can never twitch layout. */
import {
  EM_DASH,
  bandStrips,
  historyRuns,
  resolveDisplay,
  sparklineScale,
  speedBand,
  thresholdsToMps,
} from "../../index.js";
import type { HistoryPoint, SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function Sparkline({
  station: stationProp,
  stationId,
  width = 120,
  height = 32,
  showBand = true,
  thresholds: thresholdsProp,
  strings: stringsProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Fixed box in px — placeholder and drawn glyph share the same geometry. */
  width?: number;
  height?: number;
  /* The lull–gust band behind the trace; drawn only where the pair exists. */
  showBand?: boolean;
  /* Consumer-unit bounds ({ unit, values }); converted to wire m/s once. The
   * trace is graded per-segment into meteo-band-0..n when given, drawn as one
   * --meteo-wind-mean polyline otherwise. null opts out of the provider's. */
  thresholds?: SpeedThresholds | null;
  /* Accepted for API symmetry with the other station components; a sparkline
   * prints no numbers, so the display unit is currently unused. */
  unit?: SpeedUnit;
  /* Word overrides / i18n; the aria sentence is strings' aria.sparkline. */
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Sparkline",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
  });
  const label = words.aria.sparkline(station.name);

  const history = station.status === "ok" ? station.history : null;
  const drawable = station.capabilities.history && history != null && history.points.length >= 2;

  /* History-less or thin: an em dash in the same box, so the geometry a row
   * reserved for the glyph never changes when a station goes quiet. */
  if (!drawable || history == null) {
    return (
      <span
        aria-label={label}
        className="meteo-sparkline meteo-sparkline-na"
        role="img"
        style={{ height, width }}
      >
        {EM_DASH}
      </span>
    );
  }

  const points = history.points;
  const { xAt, yAt } = sparklineScale(points, width, height);
  const runs = historyRuns(points, history.periodMinutes);
  const strips = showBand ? bandStrips(runs) : [];

  /* The ONE consumer-unit → wire conversion; everything below is m/s. */
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  return (
    <svg
      aria-label={label}
      className="meteo-sparkline"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      {strips
        .filter((strip) => strip.points.length >= 2)
        .map((strip) => (
          <polygon
            className="meteo-sparkline-band"
            key={strip.startedAt}
            points={[
              ...strip.points.map((point) =>
                coordinate(xAt(Date.parse(point.observedAt)), yAt(point.gustMps as number)),
              ),
              ...[...strip.points]
                .reverse()
                .map((point) =>
                  coordinate(xAt(Date.parse(point.observedAt)), yAt(point.lullMps as number)),
                ),
            ].join(" ")}
          />
        ))}
      {boundsMps == null
        ? runs.map((segment) =>
            segment.points.length === 1 ? (
              /* A lone sample between gaps is still a measurement. */
              <circle
                className="meteo-sparkline-dot"
                cx={xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt))}
                cy={yAt((segment.points[0] as HistoryPoint).averageMps)}
                key={segment.startedAt}
                r={1.5}
              />
            ) : (
              <polyline
                className="meteo-sparkline-line"
                key={segment.startedAt}
                points={segment.points
                  .map((point) =>
                    coordinate(xAt(Date.parse(point.observedAt)), yAt(point.averageMps)),
                  )
                  .join(" ")}
              />
            ),
          )
        : runs.flatMap((segment) =>
            segment.points.length === 1
              ? [
                  <circle
                    className={`meteo-sparkline-dot meteo-band-${speedBand(
                      (segment.points[0] as HistoryPoint).averageMps,
                      boundsMps,
                    )}`}
                    cx={xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt))}
                    cy={yAt((segment.points[0] as HistoryPoint).averageMps)}
                    key={segment.startedAt}
                    r={1.5}
                  />,
                ]
              : segment.points.slice(1).map((point, index) => {
                  const previous = segment.points[index] as HistoryPoint;
                  /* Each pair wears the band of its mean — the big chart's
                   * per-segment grading, verbatim. */
                  const band = speedBand((previous.averageMps + point.averageMps) / 2, boundsMps);
                  return (
                    <line
                      className={`meteo-sparkline-segment meteo-band-${band}`}
                      key={point.observedAt}
                      x1={xAt(Date.parse(previous.observedAt))}
                      x2={xAt(Date.parse(point.observedAt))}
                      y1={yAt(previous.averageMps)}
                      y2={yAt(point.averageMps)}
                    />
                  );
                }),
          )}
    </svg>
  );
}
