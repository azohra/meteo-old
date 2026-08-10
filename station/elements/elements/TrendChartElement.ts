/* <meteo-trend-chart>: a temperature or pressure trace over the same
 * history window the wind chart draws — the react TrendChart's twin. Gaps
 * are honest twice over (null values and dropouts both break the trace,
 * never interpolated), a history that never carries the series says "not
 * measured here" in words, and the inspector is the wind chart's, verbatim
 * in behavior: pointer-move previews, click pins by timestamp, touch never
 * previews. `series` is required — a trend of nothing is a wiring mistake
 * and throws like one. */
import {
  CHART_FALLBACK_WIDTH,
  EM_DASH,
  chartFrame,
  chartScales,
  nearestIndex,
  requireResolved,
  trendRuns,
  trendSeriesPad,
  trendValueOf,
  valueScale,
} from "../../index.js";
import type {
  ChartFrame,
  ChartScales,
  FormatTime,
  History,
  HistoryPoint,
  StationStrings,
  TrendSeries,
} from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

type TrendContext = {
  formatTime: FormatTime;
  frame: ChartFrame;
  points: ReadonlyArray<HistoryPoint>;
  scales: ChartScales;
  series: TrendSeries;
  words: StationStrings;
  yAt: (value: number) => number;
};

export class TrendChartElement extends MeteoStationElement {
  static readonly observedAttributes = ["series", "station-id"];

  #width: number | null = null;
  #observer: ResizeObserver | null = null;
  #pinnedAt: string | null = null;
  #previewIndex: number | null = null;
  #context: TrendContext | null = null;
  #readout: HTMLElement | null = null;
  #svg: SVGElement | null = null;
  #hit: SVGElement | null = null;

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-trend-chart");
    const series = requireResolved(
      "meteo-trend-chart",
      "series",
      this.getAttribute("series") === "temperature" || this.getAttribute("series") === "pressure"
        ? (this.getAttribute("series") as TrendSeries)
        : null,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, words } = this.display();

    const history = station.status === "ok" ? station.history : null;
    const carrying =
      history == null
        ? 0
        : history.points.filter((point) => trendValueOf(point, series) != null).length;
    const drawable =
      station.capabilities.history && history != null && history.points.length >= 2 && carrying >= 2;

    /* Three distinct absences, three answers: no declared history renders
     * nothing; history missing or thin says so; history present but never
     * carrying this series is "not measured here". */
    if (!station.capabilities.history) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren();
      return;
    }
    if (history == null || history.points.length < 2) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(h("div", { class: "meteo-trend meteo-trend-na", role: "note" }, words.noHistory));
      return;
    }
    if (!drawable) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(
        h("div", { class: "meteo-trend meteo-trend-na", role: "note" }, words.notMeasured),
      );
      return;
    }

    const wrap = h("div", { class: "meteo-trend" });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildTrend(wrap, history, series, words, formatTime, this.#width, station.name);
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

  #buildTrend(
    wrap: HTMLElement,
    history: History,
    series: TrendSeries,
    words: StationStrings,
    formatTime: FormatTime,
    width: number,
    stationName: string,
  ): void {
    const points = history.points;

    /* The core frame, with the vane row cut out: a trend has no direction,
     * so the tick labels ride directly under the plot. */
    const core = chartFrame(width);
    const frame: ChartFrame = {
      ...core,
      vaneRow: core.plotBottom,
      labelRow: core.plotBottom + 22,
      height: core.plotBottom + 30,
    };
    /* Only the time half of the scales is used; y is computed locally. */
    const scales = chartScales(points, frame);
    const scale = valueScale(
      points.map((point) => trendValueOf(point, series)),
      frame,
      { paddingMin: trendSeriesPad(series) },
    );
    const yAt = scale.yAt;

    /* The shared trendRuns split; only the mapping to pixels is ours. */
    const segments = trendRuns(points, series, history.periodMinutes).map((run) => ({
      startedAt: run.startedAt,
      coords: run.samples.map(([ms, value]) => [scales.xAtMs(ms), yAt(value)] as const),
    }));

    this.#context = { formatTime, frame, points, scales, series, words, yAt };

    const readout = h("output", {
      "aria-label": words.aria.readout(stationName),
      class: "meteo-trend-readout",
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

    const seriesLabel = series === "temperature" ? words.trendTemperature : words.trendPressure;
    /* Simple five-tick time fractions — no vanes to anchor to. */
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => ({
      index,
      timeMs: scales.startMs + fraction * scales.durationMs,
    }));

    const svg = hs(
      "svg",
      {
        "aria-label": words.aria.trend(stationName, seriesLabel),
        class: "meteo-trend-svg",
        height: frame.height,
        role: "img",
        viewBox: `0 0 ${frame.width} ${frame.height}`,
        width: frame.width,
      },
      [0, 0.5, 1].map((fraction) => {
        const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
        return hs(
          "g",
          null,
          hs("line", { class: "meteo-grid-line", x1: frame.left, x2: frame.right, y1: gridY, y2: gridY }),
          hs(
            "text",
            { class: "meteo-grid-label", "text-anchor": "end", x: frame.left - 6, y: gridY + 5 },
            String(Math.round(scale.min + fraction * (scale.max - scale.min))),
          ),
        );
      }),
      segments.map((segment) =>
        segment.coords.length === 1
          ? hs("circle", {
              class: "meteo-trend-dot",
              cx: segment.coords[0]?.[0],
              cy: segment.coords[0]?.[1],
              r: 2.5,
            })
          : hs("polyline", {
              class: "meteo-trend-line",
              points: segment.coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
            }),
      ),
      ticks.map(({ index, timeMs }) =>
        hs(
          "text",
          {
            class: "meteo-tick",
            "text-anchor": index === 0 ? "start" : index === 4 ? "end" : "middle",
            x: scales.xAtMs(timeMs),
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

  /* ---------- the inspector (the wind chart's, verbatim) ---------- */

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

  #updateCursor(): void {
    const context = this.#context;
    const readout = this.#readout;
    const svg = this.#svg;
    const hit = this.#hit;
    if (context == null || readout == null || svg == null || hit == null) return;
    const { formatTime, frame, points, scales, series, words, yAt } = context;
    const activeIndex = this.#activeIndex();
    const active = activeIndex == null ? undefined : points[activeIndex];
    const activeValue = active == null ? null : trendValueOf(active, series);
    const seriesLabel = series === "temperature" ? words.trendTemperature : words.trendPressure;
    const unitWord = series === "temperature" ? words.degC : words.air.unitHpa;

    readout.setAttribute("aria-live", this.#previewIndex == null ? "polite" : "off");
    if (active != null) {
      readout.replaceChildren(
        h("strong", null, formatTime(new Date(active.observedAt))),
        h(
          "span",
          null,
          `${seriesLabel} ${activeValue == null ? EM_DASH : `${activeValue.toFixed(1)} ${unitWord}`}`,
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
          y2: frame.plotBottom + 4,
        }),
        hit,
      );
      if (activeValue != null) {
        svg.insertBefore(
          hs("circle", {
            class: "meteo-cursor-dot",
            cx: scales.xAt(active.observedAt),
            cy: yAt(activeValue),
            r: 3,
          }),
          hit,
        );
      }
    }
  }
}
