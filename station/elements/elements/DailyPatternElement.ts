/* <meteo-daily-pattern>: the react DailyPattern's twin. Every history point
 * drops into a fixed-width time-of-day slot (dailyPattern, in geometry.ts)
 * and each slot becomes a synthetic point at its own midpoint, so the exact
 * frame/scale/banding machinery WindHistoryChartElement already built
 * applies unchanged — see station/react/components/DailyPattern.tsx for the
 * full rationale (both bindings share it verbatim in prose, not just code).
 *
 * Static, unlike the six-hour chart: a "typical day" has no instant to
 * inspect, so there is no pointer inspector here, only the coverage
 * caption. Width still comes from a ResizeObserver — a bucketed chart is
 * still a chart. */
import {
  CHART_FALLBACK_WIDTH,
  CHART_WIDE_PLOT_HEIGHT,
  CHART_WIDE_PLOT_MIN_WIDTH,
  DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  EM_DASH,
  averagePoints,
  chartFrame,
  chartScales,
  compassDirection,
  dailyPattern,
  isCalm,
  resolveStation,
  roundSpeed,
  speedBand,
  speedToMps,
  stretchFrame,
  thinVanes,
  thresholdsToMps,
  vanePath,
  vaneTicks,
} from "../../index.js";
import type { DailyPatternSlot, HistoryPoint, SpeedUnit } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

let hatchCounter = 0;

const SYNTHETIC_EPOCH_MS = Date.parse("2000-01-01T00:00:00Z");

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

export class DailyPatternElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "plot-height",
    "slot-minutes",
    "station-id",
    "thresholds",
    "unit",
    "utc-offset-minutes",
  ];

  #points: HistoryPoint[] | undefined;
  #width: number | null = null;
  #observer: ResizeObserver | null = null;

  constructor() {
    super();
    this.upgradeProperty("points");
  }

  get points(): HistoryPoint[] | undefined {
    return this.#points;
  }
  set points(value: HistoryPoint[] | undefined) {
    this.#points = value;
    this.requestRender();
  }

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#points == null
        ? (resolveStation(this.ambient()?.feed ?? null, this.getAttribute("station-id") ?? undefined) ??
          undefined)
        : undefined);
    const { thresholds, unit, words } = this.display();
    const source =
      this.#points ??
      (station?.status === "ok" ? (station.history?.points ?? null) : null) ??
      [];
    const periodMinutes =
      this.#points == null && station?.status === "ok" ? (station.history?.periodMinutes ?? null) : null;

    if (source.length === 0) {
      this.#observer?.disconnect();
      this.#observer = null;
      this.replaceChildren(
        h(
          "div",
          { class: "meteo-daily-pattern meteo-daily-pattern-na", role: "note" },
          words.noHistory,
        ),
      );
      return;
    }

    const wrap = h("div", { class: "meteo-daily-pattern" });
    this.replaceChildren(wrap);
    this.#observe(wrap);
    if (this.#width == null) return;

    this.#buildChart(wrap, source, periodMinutes, thresholds, unit, words, this.#width, station?.name);
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
    points: HistoryPoint[],
    periodMinutes: number | null,
    thresholds: import("../../index.js").SpeedThresholds | undefined,
    unit: SpeedUnit,
    words: import("../../index.js").StationStrings,
    width: number,
    stationName: string | undefined,
  ): void {
    const slotMinutes = numberAttribute(this.getAttribute("slot-minutes")) ?? DAILY_PATTERN_DEFAULT_SLOT_MINUTES;
    const utcOffsetMinutes = numberAttribute(this.getAttribute("utc-offset-minutes")) ?? 0;
    const shown = (averageMps: number) => roundSpeed(averageMps, unit);
    const hatchId = `meteo-daily-pattern-hatch-e${++hatchCounter}`;

    const slots = dailyPattern(points, { slotMinutes, utcOffsetMinutes });
    const synthetic = slots.map((slot) => slotPoint(slot, slotMinutes));
    const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleCount, 0);
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
      numberAttribute(this.getAttribute("plot-height")) ??
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
    const voidSpans = slots
      .filter((slot) => slot.sampleCount === 0)
      .map((slot) => [
        scales.xAtMs(SYNTHETIC_EPOCH_MS + slot.startMinuteOfDay * 60_000),
        scales.xAtMs(SYNTHETIC_EPOCH_MS + (slot.startMinuteOfDay + slotMinutes) * 60_000),
      ]);

    const caption = h(
      "output",
      { class: "meteo-daily-pattern-caption" },
      expectedSamples != null
        ? words.dailyPatternCoverage(totalSamples, expectedSamples)
        : words.dailyPatternSamples(totalSamples),
    );

    const svg = hs(
      "svg",
      {
        "aria-label": stationName ? words.aria.dailyPattern(stationName) : words.aria.dailyPatternGeneric,
        class: "meteo-daily-pattern-svg",
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
          { height: "6", id: hatchId, patternTransform: "rotate(45)", patternUnits: "userSpaceOnUse", width: "6" },
          hs("line", { class: "meteo-wind-gap-hatch", x1: "0", x2: "0", y1: "0", y2: "6" }),
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
      vanes.map((vane) =>
        hs("line", {
          class: "meteo-wind-guide",
          x1: scales.xAtMs(vane.midMs),
          x2: scales.xAtMs(vane.midMs),
          y1: frame.plotTop,
          y2: frame.vaneRow - 9,
        }),
      ),
      voidSpans.map(([startX, endX]) =>
        hs("rect", {
          class: "meteo-wind-gap",
          fill: `url(#${hatchId})`,
          height: frame.plotBottom - frame.plotTop,
          width: (endX as number) - (startX as number),
          x: startX,
          y: frame.plotTop,
        }),
      ),
      meanSegments == null
        ? hs("polyline", { class: "meteo-wind-mean", points: averagePoints(synthetic, scales) })
        : meanSegments.map((segment) =>
            hs("line", {
              class: `meteo-wind-mean-segment meteo-band-${segment.band}`,
              x1: segment.x1,
              x2: segment.x2,
              y1: segment.y1,
              y2: segment.y2,
            }),
          ),
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
      /* The persistent Avg row: one number per vane — dashed when every slot
       * the vane's window covers is void (nothing this station ever
       * recorded at that time of day), never a fabricated zero. */
      vanes.map((vane) => {
        const voidWindow = slots
          .slice(vane.startIndex, vane.endIndex)
          .every((slot) => slot.sampleCount === 0);
        return hs(
          "text",
          {
            class: "meteo-wind-vane-value",
            "text-anchor": "middle",
            x: scales.xAtMs(vane.midMs),
            y: frame.valueRow + 4,
          },
          voidWindow ? EM_DASH : String(shown(vane.averageMps)),
        );
      }),
      ticks.map(({ index, timeMs, x }) =>
        hs(
          "text",
          {
            class: "meteo-tick",
            "text-anchor": index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle",
            x,
            y: frame.labelRow,
          },
          formatMinuteOfDay((timeMs - SYNTHETIC_EPOCH_MS) / 60_000),
        ),
      ),
    );

    wrap.replaceChildren(caption, svg);
  }
}
