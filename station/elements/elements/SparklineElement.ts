/* <meteo-sparkline>: the word-sized wind history glyph, the react
 * Sparkline's twin — same shared scale and run-splitting
 * (station/instruments.ts), same honesty rules: dropouts break the line,
 * the band only spans real gust–lull pairs, and a station with no drawable
 * history holds the same fixed box with an em dash so a refresh tick can
 * never twitch layout. The SVG builder is exported for composites. */
import {
  EM_DASH,
  bandStrips,
  historyRuns,
  sparklineScale,
  speedBand,
  thresholdsToMps,
} from "../../index.js";
import type { HistoryPoint, SpeedThresholds, Station, StationStrings } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function sparklineNode(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  words: StationStrings;
  width?: number;
  height?: number;
  showBand?: boolean;
}): Element {
  const { station, thresholds, words, width = 120, height = 32, showBand = true } = options;
  const label = words.aria.sparkline(station.name);

  const history = station.status === "ok" ? station.history : null;
  const drawable = station.capabilities.history && history != null && history.points.length >= 2;

  if (!drawable || history == null) {
    const placeholder = h(
      "span",
      { "aria-label": label, class: "meteo-sparkline meteo-sparkline-na", role: "img" },
      EM_DASH,
    );
    placeholder.style.height = `${height}px`;
    placeholder.style.width = `${width}px`;
    return placeholder;
  }

  const points = history.points;
  const { xAt, yAt } = sparklineScale(points, width, height);
  const runs = historyRuns(points, history.periodMinutes);
  const strips = showBand ? bandStrips(runs) : [];

  /* The ONE consumer-unit → wire conversion; everything below is m/s. */
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  return hs(
    "svg",
    {
      "aria-label": label,
      class: "meteo-sparkline",
      height,
      role: "img",
      viewBox: `0 0 ${width} ${height}`,
      width,
    },
    strips
      .filter((strip) => strip.points.length >= 2)
      .map((strip) =>
        hs("polygon", {
          class: "meteo-sparkline-band",
          points: [
            ...strip.points.map((point) =>
              coordinate(xAt(Date.parse(point.observedAt)), yAt(point.gustMps as number)),
            ),
            ...[...strip.points]
              .reverse()
              .map((point) =>
                coordinate(xAt(Date.parse(point.observedAt)), yAt(point.lullMps as number)),
              ),
          ].join(" "),
        }),
      ),
    boundsMps == null
      ? runs.map((segment) =>
          segment.points.length === 1
            ? /* A lone sample between gaps is still a measurement. */
              hs("circle", {
                class: "meteo-sparkline-dot",
                cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                cy: yAt((segment.points[0] as HistoryPoint).averageMps),
                r: 1.5,
              })
            : hs("polyline", {
                class: "meteo-sparkline-line",
                points: segment.points
                  .map((point) =>
                    coordinate(xAt(Date.parse(point.observedAt)), yAt(point.averageMps)),
                  )
                  .join(" "),
              }),
        )
      : runs.flatMap((segment) =>
          segment.points.length === 1
            ? [
                hs("circle", {
                  class: `meteo-sparkline-dot meteo-band-${speedBand(
                    (segment.points[0] as HistoryPoint).averageMps,
                    boundsMps,
                  )}`,
                  cx: xAt(Date.parse((segment.points[0] as HistoryPoint).observedAt)),
                  cy: yAt((segment.points[0] as HistoryPoint).averageMps),
                  r: 1.5,
                }),
              ]
            : segment.points.slice(1).map((point, index) => {
                const previous = segment.points[index] as HistoryPoint;
                /* Each pair wears the band of its mean — the big chart's
                 * per-segment grading, verbatim. */
                const band = speedBand((previous.averageMps + point.averageMps) / 2, boundsMps);
                return hs("line", {
                  class: `meteo-sparkline-segment meteo-band-${band}`,
                  x1: xAt(Date.parse(previous.observedAt)),
                  x2: xAt(Date.parse(point.observedAt)),
                  y1: yAt(previous.averageMps),
                  y2: yAt(point.averageMps),
                });
              }),
        ),
  );
}

export class SparklineElement extends MeteoStationElement {
  static readonly observedAttributes = ["height", "no-band", "station-id", "thresholds", "width"];

  protected override render(): void {
    const station = this.requiredStation("meteo-sparkline");
    const { thresholds, words } = this.display();
    this.replaceChildren(
      sparklineNode({
        station,
        thresholds,
        words,
        width: numberAttribute(this.getAttribute("width")) ?? 120,
        height: numberAttribute(this.getAttribute("height")) ?? 32,
        showBand: !this.hasAttribute("no-band"),
      }),
    );
  }
}
