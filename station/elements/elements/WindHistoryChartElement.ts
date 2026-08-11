/* <meteo-wind-history-chart>: the six-hour chart, the react
 * WindHistoryChart's twin over the shared chart geometry — lull-to-gust
 * band, graded average, downwind vane row, hatched dropout spans, and the
 * inspector.
 *
 * Interaction model, ported verbatim: pointer-move previews, click or tap
 * pins, pointerleave clears the preview, and touch never previews so
 * scrolling over the chart stays a scroll. The readout row above the chart
 * always says something, so inspection never changes the layout's height. A
 * pin holds the sample's TIMESTAMP, not its position: a live window slides
 * under an index, and the pin clears itself when its moment leaves the
 * window.
 *
 * Rendering splits exactly as react's does: data, width, or attribute
 * changes rebuild the readout and the SVG; pointer chatter goes through
 * #updateCursor, which touches only the readout's children and the cursor
 * marks — the .meteo-hit rect is never re-created mid-gesture, so a 60 Hz
 * pointer stream never destroys its own event target.
 *
 * Width comes from a ResizeObserver on the wrapper — no window listeners —
 * and nothing draws until the first measurement so a chart never flashes at
 * the wrong scale (no ResizeObserver falls back to the phone-sized width,
 * the same path jsdom tests exercise in both bindings). */
import {
  CHART_FALLBACK_WIDTH,
  CHART_WIDE_PLOT_HEIGHT,
  CHART_WIDE_PLOT_MIN_WIDTH,
  EM_DASH,
  averagePoints,
  bandPoints,
  chartFrame,
  chartScales,
  compareTracePoints,
  compareWindow,
  compassDirection,
  historyGaps,
  isCalm,
  isCalmHistory,
  nearestIndex,
  roundSpeed,
  speedBand,
  speedToMps,
  stretchFrame,
  thinVanes,
  thresholdsToMps,
  vanePath,
  vaneTicks,
  windowPoints,
} from "../../index.js";
import type {
  ChartFrame,
  ChartScales,
  FormatTime,
  History,
  HistoryPoint,
  SpeedThresholds,
  SpeedUnit,
  StationStrings,
} from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { windArrowSvg } from "../lib/fragments.js";
import { h, hs } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";

/* useId's job without react: unique url(#…)-safe hatch ids per chart. */
let hatchCounter = 0;

type ChartContext = {
  formatTime: FormatTime;
  frame: ChartFrame;
  points: ReadonlyArray<HistoryPoint>;
  scales: ChartScales;
  unit: SpeedUnit;
  words: StationStrings;
};

export class WindHistoryChartElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "compare-offset-days",
    "plot-height",
    "station-id",
    "thresholds",
    "unit",
    "window-hours",
  ];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  /* Pinned by observedAt, resolved to an index each render — a live feed
   * slides its window; a moment pinned past the window is gone. */
  #pinnedAt: string | null = null;
  #previewIndex: number | null = null;
  #context: ChartContext | null = null;
  #readout: HTMLElement | null = null;
  #svg: SVGElement | null = null;
  #hit: SVGElement | null = null;

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-wind-history-chart");
    const { formatTime, thresholds, unit, words } = this.display();

    const history = station.status === "ok" ? station.history : null;
    const drawable = station.capabilities.history && history != null && history.points.length >= 2;

    /* A station that declares no history has nothing missing — render
     * nothing. A station that should have history but does not says so. */
    if (!station.capabilities.history) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren();
      return;
    }
    if (!drawable || history == null) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(h("div", { class: "meteo-wind-chart meteo-wind-chart-na", role: "note" }, words.noHistory));
      return;
    }

    const wrap = h("div", { class: "meteo-wind-chart" });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildChart(wrap, history, thresholds, unit, words, formatTime, this.#width);
  }

  #observe(wrap: HTMLElement): void {
    this.#observer?.disconnect();
    if (typeof ResizeObserver === "undefined") {
      this.#width = CHART_FALLBACK_WIDTH;
      this.#observer = null;
      return;
    }
    this.#observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      /* A hidden panel reports zero; err phone-sized rather than never drawing. */
      const width = measured > 0 ? Math.round(measured) : CHART_FALLBACK_WIDTH;
      if (width !== this.#width) {
        this.#width = width;
        this.requestRender();
      }
    });
    this.#observer.observe(wrap);
  }

  #buildChart(
    wrap: HTMLElement,
    history: History,
    thresholds: SpeedThresholds | undefined,
    unit: SpeedUnit,
    words: StationStrings,
    formatTime: FormatTime,
    width: number,
  ): void {
    const windowHours = numberAttribute(this.getAttribute("window-hours"));
    const compareOffsetDays = numberAttribute(this.getAttribute("compare-offset-days"));
    /* windowHours narrows to the trailing N hours of the SAME points array;
     * omitted, every point the station carries draws, unchanged. */
    const points = windowPoints(history.points, windowHours);
    const shown = (averageMps: number) => roundSpeed(averageMps, unit);
    const hatchId = `meteo-hatch-e${++hatchCounter}`;
    const stationName = this.requiredStation("meteo-wind-history-chart").name;

    const coreFrame = chartFrame(width);
    const corePlotHeight = coreFrame.plotBottom - coreFrame.plotTop;
    const frame = stretchFrame(
      coreFrame,
      numberAttribute(this.getAttribute("plot-height")) ??
        (width < CHART_WIDE_PLOT_MIN_WIDTH
          ? corePlotHeight
          : Math.max(corePlotHeight, CHART_WIDE_PLOT_HEIGHT)),
    );
    /* Axis rounding follows the DISPLAY unit, so a knots axis tops out at a
     * round knots number, not a rounded km/h one. */
    const scales = chartScales(points, frame, {
      niceStepMps: speedToMps(5, unit),
      floorMps: speedToMps(10, unit),
    });
    const band = bandPoints(points, scales);
    const vanes = thinVanes(points);
    const ticks = vaneTicks(vanes, scales);
    /* Gaps are the DISPLAYED window's own — a dropout outside windowHours
     * has nothing to hatch here. */
    const gaps = historyGaps({ ...history, points: points as HistoryPoint[] });
    const calm = isCalmHistory(points);

    /* Client-side re-slice of the SAME history array — never a new fetch.
     * Null (no overlay drawn) when the station's own history does not reach
     * back far enough to cover the requested offset. */
    const comparePoints =
      compareOffsetDays == null ? null : compareWindow(history.points, compareOffsetDays, windowHours);
    const compareTrace =
      comparePoints == null ? null : compareTracePoints(comparePoints, scales, compareOffsetDays as number);

    this.#context = { formatTime, frame, points, scales, unit, words };

    /* The ONE consumer-unit → wire conversion; everything below is m/s. */
    const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
    const meanSegments =
      boundsMps == null
        ? null
        : points.slice(1).map((point, index) => {
            const previous = points[index] as HistoryPoint;
            return {
              band: speedBand((previous.averageMps + point.averageMps) / 2, boundsMps),
              x1: scales.xAt(previous.observedAt),
              x2: scales.xAt(point.observedAt),
              y1: scales.yAt(previous.averageMps),
              y2: scales.yAt(point.averageMps),
            };
          });
    /* Guides pair the wire position with the number the consumer declared. */
    const thresholdGuides =
      thresholds == null || boundsMps == null
        ? []
        : boundsMps
            .map((boundMps, index) => ({
              boundMps,
              label:
                unit === thresholds.unit ? String(thresholds.values[index]) : String(shown(boundMps)),
            }))
            .filter(({ boundMps }) => boundMps > 0 && boundMps <= scales.scaleMax);
    /* Ascending cut points 0..scaleMax; each pair encloses one band's zone. */
    const zoneCuts =
      boundsMps == null
        ? null
        : [0, ...boundsMps.filter((bound) => bound > 0 && bound < scales.scaleMax), scales.scaleMax];

    const readout = h("output", {
      "aria-label": words.aria.readout(stationName),
      class: "meteo-wind-chart-readout",
    });
    this.#readout = readout;

    const hit = hs("rect", {
      class: "meteo-hit",
      fill: "transparent",
      height: frame.height,
      onclick: (event: Event) => this.#handleClick(event as MouseEvent),
      onpointerleave: () => {
        this.#previewIndex = null;
        this.#updateCursor();
      },
      onpointermove: (event: Event) => this.#handlePointerMove(event as PointerEvent),
      width: frame.width,
      x: 0,
      y: 0,
    });
    this.#hit = hit;

    const svg = hs(
      "svg",
      {
        "aria-label": words.aria.chart(stationName),
        class: "meteo-wind-chart-svg",
        height: frame.height,
        role: "img",
        viewBox: `0 0 ${frame.width} ${frame.height}`,
        width: frame.width,
      },
      hs(
        "defs",
        null,
        hs(
          "pattern",
          {
            height: "6",
            id: hatchId,
            patternTransform: "rotate(45)",
            patternUnits: "userSpaceOnUse",
            width: "6",
          },
          hs("line", { class: "meteo-wind-gap-hatch", x1: "0", x2: "0", y1: "0", y2: "6" }),
        ),
        /* The compare trace rides TODAY's scale; a windier prior day exits
         * the plot's top edge here rather than drawing over the threshold
         * labels above it. */
        hs(
          "clipPath",
          { id: `${hatchId}-plot` },
          hs("rect", {
            height: frame.plotBottom - frame.plotTop,
            width: frame.right - frame.left,
            x: frame.left,
            y: frame.plotTop,
          }),
        ),
      ),
      zoneCuts != null && boundsMps != null
        ? zoneCuts.slice(0, -1).map((lower, index) => {
            const upper = zoneCuts[index + 1] as number;
            return hs("rect", {
              class: `meteo-wind-zone meteo-band-${speedBand((lower + upper) / 2, boundsMps)}`,
              height: scales.yAt(lower) - scales.yAt(upper),
              width: frame.right - frame.left,
              x: frame.left,
              y: scales.yAt(upper),
            });
          })
        : null,
      [0, 0.5, 1].map((fraction) => {
        const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
        return hs(
          "g",
          null,
          hs("line", { class: "meteo-grid-line", x1: frame.left, x2: frame.right, y1: gridY, y2: gridY }),
          hs(
            "text",
            { class: "meteo-grid-label", "text-anchor": "end", x: frame.left - 6, y: gridY + 5 },
            String(shown(scales.scaleMax * fraction)),
          ),
        );
      }),
      boundsMps != null
        ? thresholdGuides.map(({ boundMps, label }) =>
            hs(
              "g",
              null,
              hs("line", {
                class: `meteo-wind-threshold meteo-band-${speedBand(boundMps, boundsMps)}`,
                x1: frame.left,
                x2: frame.right,
                y1: scales.yAt(boundMps),
                y2: scales.yAt(boundMps),
              }),
              /* The guide sits at the wire-unit bound; its label prints the
               * consumer's declared number in the display unit. */
              hs(
                "text",
                {
                  class: `meteo-wind-threshold-label meteo-band-${speedBand(boundMps, boundsMps)}`,
                  "text-anchor": "end",
                  x: frame.right - 3,
                  y: scales.yAt(boundMps) - 3,
                },
                label,
              ),
            ),
          )
        : null,
      /* One guide per vane, so a vane ties to the moment above it. */
      vanes.map((vane) =>
        hs("line", {
          class: "meteo-wind-guide",
          x1: scales.xAtMs(vane.midMs),
          x2: scales.xAtMs(vane.midMs),
          y1: frame.plotTop,
          y2: frame.vaneRow - 9,
        }),
      ),
      gaps.map(([startMs, endMs]) =>
        hs("rect", {
          class: "meteo-wind-gap",
          fill: `url(#${hatchId})`,
          height: frame.plotBottom - frame.plotTop,
          width: scales.xAtMs(endMs) - scales.xAtMs(startMs),
          x: scales.xAtMs(startMs),
          y: frame.plotTop,
        }),
      ),
      band != null && hs("polygon", { class: "meteo-wind-band", points: band }),
      /* Shifted forward by compareOffsetDays onto TODAY's own x-axis, so the
       * two traces overlay for a direct read — drawn behind the main trace,
       * which stays the stronger line. */
      compareTrace != null &&
        hs("polyline", {
          class: "meteo-wind-compare",
          "clip-path": `url(#${hatchId}-plot)`,
          points: compareTrace,
        }),
      meanSegments == null
        ? hs("polyline", { class: "meteo-wind-mean", points: averagePoints(points, scales) })
        : meanSegments.map((segment) =>
            hs("line", {
              class: `meteo-wind-mean-segment meteo-band-${segment.band}`,
              x1: segment.x1,
              x2: segment.x2,
              y1: segment.y1,
              y2: segment.y2,
            }),
          ),
      /* Said in words: an all-zero trace on an empty grid reads as a dead
       * feed, not a windless day. */
      calm &&
        hs(
          "text",
          {
            class: "meteo-wind-calm-note",
            "text-anchor": "middle",
            x: (frame.left + frame.right) / 2,
            y: (frame.plotTop + frame.plotBottom) / 2 + 4,
          },
          words.calmHistory,
        ),
      hs(
        "text",
        { class: "meteo-wind-row-label", "text-anchor": "end", x: frame.left - 8, y: frame.vaneRow + 4 },
        words.toLabel,
      ),
      /* A window that was calm throughout has no direction to point. */
      vanes.map((vane) =>
        vane.directionDeg == null
          ? hs(
              "text",
              { class: "meteo-wind-vane-calm", "text-anchor": "middle", x: scales.xAtMs(vane.midMs), y: frame.vaneRow + 4 },
              EM_DASH,
            )
          : hs("path", {
              class: "meteo-wind-vane",
              d: vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.directionDeg),
            }),
      ),
      /* The persistent compass-letter row: the direction every vane points,
       * spelled out, so a reader never has to hover to name it. */
      vanes.map((vane) =>
        hs(
          "text",
          {
            class: "meteo-wind-vane-label",
            "text-anchor": "middle",
            x: scales.xAtMs(vane.midMs),
            y: frame.vaneLabelRow + 4,
          },
          vane.directionDeg == null ? EM_DASH : compassDirection(vane.directionDeg),
        ),
      ),
      hs(
        "text",
        { class: "meteo-wind-row-label", "text-anchor": "end", x: frame.left - 8, y: frame.valueRow + 4 },
        words.avgLabel,
      ),
      /* The persistent Avg row: one number per vane, the same scalar mean
       * the mean trace already plots — never every raw point, too dense to
       * read. */
      vanes.map((vane) =>
        hs(
          "text",
          {
            class: "meteo-wind-vane-value",
            "text-anchor": "middle",
            x: scales.xAtMs(vane.midMs),
            y: frame.valueRow + 4,
          },
          String(shown(vane.averageMps)),
        ),
      ),
      ticks.map(({ index, timeMs, x }) =>
        hs(
          "text",
          {
            class: "meteo-tick",
            "text-anchor": index === 0 ? "start" : index === 4 ? "end" : "middle",
            x,
            y: frame.labelRow,
          },
          formatTime(new Date(timeMs)),
        ),
      ),
      /* On top of everything drawn, so the pointer always lands here. */
      hit,
    );
    this.#svg = svg;

    wrap.replaceChildren(readout, svg);
    this.#updateCursor();
  }

  /* ---------- the inspector ---------- */

  #activeIndex(): number | null {
    const context = this.#context;
    if (context == null) return null;
    const foundPin =
      this.#pinnedAt == null
        ? -1
        : context.points.findIndex((point) => point.observedAt === this.#pinnedAt);
    const pinnedIndex = foundPin === -1 ? null : foundPin;
    return this.#previewIndex ?? pinnedIndex;
  }

  #indexAtPoint(clientX: number): number | null {
    const context = this.#context;
    const svg = this.#svg;
    if (context == null || svg == null) return null;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return null;
    const chartX = ((clientX - bounds.left) / bounds.width) * context.frame.width;
    return nearestIndex(context.points, chartX, context.frame, context.scales);
  }

  #handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    this.#previewIndex = this.#indexAtPoint(event.clientX);
    this.#updateCursor();
  }

  #handleClick(event: MouseEvent): void {
    const index = this.#indexAtPoint(event.clientX);
    if (index == null) return;
    const observedAt = this.#context?.points[index]?.observedAt;
    if (observedAt == null) return;
    this.#pinnedAt = this.#pinnedAt === observedAt ? null : observedAt;
    this.#previewIndex = null;
    this.#updateCursor();
  }

  /* Pointer chatter touches only the readout's children and the cursor
   * marks; the hit rect and everything under it stay put. */
  #updateCursor(): void {
    const context = this.#context;
    const readout = this.#readout;
    const svg = this.#svg;
    const hit = this.#hit;
    if (context == null || readout == null || svg == null || hit == null) return;
    const { formatTime, frame, points, scales, unit, words } = context;
    const activeIndex = this.#activeIndex();
    const active = activeIndex == null ? undefined : points[activeIndex];
    const shown = (averageMps: number) => roundSpeed(averageMps, unit);

    /* An implicit live region: previews are pointer chatter and stay
     * silent; a pinned reading is a deliberate act and announces. */
    readout.setAttribute("aria-live", this.#previewIndex == null ? "polite" : "off");
    if (active != null) {
      const tail: ElementChild[] = isCalm(active.averageMps)
        ? [words.calm]
        : active.directionDeg == null
          ? [EM_DASH]
          : [
              `${words.fromLabel} `,
              windArrowSvg(active.directionDeg),
              ` ${compassDirection(active.directionDeg)} ${Math.round(active.directionDeg)}°`,
            ];
      readout.replaceChildren(
        h("strong", null, formatTime(new Date(active.observedAt))),
        h(
          "span",
          null,
          `${words.avgLabel} ${shown(active.averageMps)} · ${words.lullLabel} ${
            active.lullMps == null ? EM_DASH : shown(active.lullMps)
          } · ${words.gustLabel} ${
            active.gustMps == null ? EM_DASH : shown(active.gustMps)
          } ${words.speedUnits[unit]} · `,
          ...tail,
        ),
      );
    } else {
      readout.replaceChildren(
        h("strong", null, `${formatTime(new Date(scales.startMs))}–${formatTime(new Date(scales.endMs))}`),
        h("span", null, words.inspectHint),
      );
    }

    for (const mark of [...svg.querySelectorAll(".meteo-cursor, .meteo-cursor-dot")]) mark.remove();
    if (active != null) {
      svg.insertBefore(
        hs("line", {
          class: "meteo-cursor",
          x1: scales.xAt(active.observedAt),
          x2: scales.xAt(active.observedAt),
          y1: frame.plotTop,
          y2: frame.vaneRow + 9,
        }),
        hit,
      );
      svg.insertBefore(
        hs("circle", {
          class: "meteo-cursor-dot",
          cx: scales.xAt(active.observedAt),
          cy: scales.yAt(active.averageMps),
          r: 3,
        }),
        hit,
      );
    }
  }
}
