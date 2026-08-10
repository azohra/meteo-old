/* Regenerates every committed image under assets/ from the library's own
 * renderers: the dial is renderToStaticMarkup of the real CurrentConditions,
 * the rose of the real WindRose, and the history chart is drawn from the
 * station capability's chart geometry (WindHistoryChart measures itself with
 * a ResizeObserver, so it renders nothing server-side). Chrome that lives in
 * HTML — station name, freshness pill, flank numbers, the station table —
 * is redrawn here as SVG text, worded from the package's defaultStrings.
 *
 * Output constraints, asserted before writing: self-contained standalone SVG
 * for GitHub — one <style> block with every wind-* class hard-resolved from
 * the styles.css token defaults, system font stack only, no foreignObject,
 * no reference beyond the xmlns declaration, well-formed XML, under 200 KB.
 * Fixture data is seeded and the clock is fixed, so regeneration is
 * byte-stable.
 *
 *   pnpm readme:assets
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* The workspace's own React pair, so components render against the exact
 * versions the package tests against. */
const req = createRequire(join(root, "package.json"));
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const h = React.createElement;

async function importDist(entryRelative) {
  const entry = join(root, "dist/station", entryRelative);
  try {
    return await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new Error(
      `Cannot load dist/station/${entryRelative} — build first (pnpm build). ${error.message}`,
    );
  }
}

const core = await importDist("index.js");
const { CurrentConditions, WindRose } = await importDist("react/index.js");
const words = core.defaultStrings;

/* ---------------- theme tokens, read from the shipped stylesheet --------- */

const stylesCss = await readFile(join(root, "station/styles.css"), "utf8");

/* Tokens are defined ONCE on :where(.meteo-root) via light-dark(a, b) — both
 * --meteo-* (shared skin) and --wind-* (wind-scoped) prefixes. Each theme
 * picks its arm; a token without light-dark() is theme-invariant. Standalone
 * SVG renderers cannot be assumed to speak light-dark(), so both arms are
 * resolved to literals here. */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let piece = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(piece.trim());
      piece = "";
    } else {
      piece += char;
    }
  }
  parts.push(piece.trim());
  return parts;
}

function resolveLightDark(value, arm) {
  /* Replace every light-dark(a, b) occurrence (the shadow token carries two)
   * with the asked-for arm. */
  let resolved = value;
  for (;;) {
    const start = resolved.indexOf("light-dark(");
    if (start === -1) return resolved;
    let depth = 0;
    let end = start + "light-dark".length;
    for (; end < resolved.length; end += 1) {
      if (resolved[end] === "(") depth += 1;
      if (resolved[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const inner = resolved.slice(start + "light-dark(".length, end);
    const [light, dark] = splitTopLevel(inner);
    resolved = resolved.slice(0, start) + (arm === "dark" ? dark : light) + resolved.slice(end + 1);
  }
}

function parseTokens(arm) {
  const marker = ":where(.meteo-root) {";
  const start = stylesCss.indexOf(marker);
  if (start === -1) throw new Error(`styles.css: token block not found: ${marker}`);
  const block = stylesCss.slice(start, stylesCss.indexOf("\n}", start));
  const tokens = {};
  for (const match of block.matchAll(/--(?:meteo|wind)-([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = resolveLightDark(match[2].replace(/\s+/g, " ").trim(), arm);
  }
  return tokens;
}

const THEMES = {
  light: parseTokens("light"),
  dark: parseTokens("dark"),
};

/* styles.css says color-mix(... 72%, black); resolved to a literal because
 * standalone SVG renderers cannot be assumed to speak color-mix. */
function darken(hex, keep = 0.72) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) =>
    Math.round(((value >> shift) & 0xff) * keep)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/* Every wind-* class any asset can carry, resolved to concrete colours.
 * Values mirror station/styles.css; the colours themselves are never
 * duplicated here — they come from the parsed token blocks above. */
function styleBlock(t) {
  const bands = [0, 1, 2, 3, 4].map((band) => t[`band-${band}`]);
  const perBand = (selector, property) =>
    bands.map((color, band) => `${selector}.meteo-band-${band}{${property}:${color}}`).join("\n");
  return `<style>
text{font-family:${t.font};font-size:10.5px;fill:${t.muted}}
.meteo-wind-dial-face{fill:${t["surface-raised"]}}
.meteo-wind-dial-bezel-in{stop-color:${t["surface-raised"]};stop-opacity:0}
.meteo-wind-dial-bezel-out{stop-color:${t.ink};stop-opacity:0.1}
.meteo-wind-dial-ring{fill:none;stroke:${t.border};stroke-width:1.5}
.meteo-wind-dial-arc{fill:none;stroke:${t.accent};stroke-width:5.5;stroke-linecap:round}
${perBand(".meteo-wind-dial-arc", "stroke")}
.meteo-wind-dial-tick{stroke:${t.muted};stroke-width:1;opacity:0.55}
.meteo-wind-dial-tick-cardinal{stroke:${t.ink};stroke-width:2;opacity:0.9}
.meteo-wind-dial-letter{font-size:11px;font-weight:600;fill:${t.muted}}
.meteo-wind-needle-blade{fill:${t.accent}}
.meteo-wind-needle-counterweight{fill:${t.accent}}
.meteo-wind-dial-hub{fill:${t["surface-raised"]};stroke:${t.border};stroke-width:1.5}
.meteo-wind-dial-speed{font-size:37px;font-weight:750;fill:${t.ink}}
.meteo-wind-dial-unit{font-size:10px;fill:${t.muted}}
.meteo-grid-line{stroke:${t.grid};stroke-width:1}
.meteo-wind-zone{stroke:none;fill-opacity:0.05}
${perBand(".meteo-wind-zone", "fill")}
.meteo-wind-threshold{stroke-width:1;stroke-dasharray:2 5;opacity:0.7}
${perBand(".meteo-wind-threshold", "stroke")}
.meteo-wind-threshold-label{font-size:9px;font-weight:650}
${perBand(".meteo-wind-threshold-label", "fill")}
.meteo-wind-guide{stroke:${t.grid};stroke-width:1;stroke-dasharray:1 4}
.meteo-wind-band{fill:${t["band-fill"]};stroke:none}
.meteo-wind-mean-segment{fill:none;stroke-width:3.5;stroke-linecap:round}
${perBand(".meteo-wind-mean-segment", "stroke")}
.meteo-wind-row-label{font-size:9px;letter-spacing:0.08em}
.meteo-wind-vane{fill:none;stroke:${t.vane};stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.meteo-wind-gap-hatch{stroke:${t.gap};stroke-width:1.25}
.meteo-wind-rose-grid{fill:none;stroke:${t.grid};stroke-width:1}
.meteo-wind-rose-tick{stroke:${t.muted};stroke-width:1;opacity:0.35}
.meteo-wind-rose-letter{font-size:12.5px;font-weight:650;fill:${t.ink}}
.meteo-wind-rose-ring-label{font-size:8.5px;fill:${t.muted}}
.meteo-wind-rose-petal{fill:${t.accent};fill-opacity:0.85;stroke:${darken(t.accent)};stroke-width:1;stroke-linejoin:round}
${bands
  .map(
    (color, band) =>
      `.meteo-wind-rose-petal.meteo-band-${band}{fill:${color};stroke:${darken(color)}}`,
  )
  .join("\n")}
.meteo-wind-rose-hub{fill:${t.surface};stroke:${t.border};stroke-width:1}
.meteo-wind-rose-dot{fill:${t.muted}}
.hw-card{fill:${t.surface};stroke:${t.border};stroke-width:1}
.hw-raised{fill:${t["surface-raised"]}}
.hw-border{stroke:${t.border};stroke-width:1}
.hw-name{font-size:20px;font-weight:700;fill:${t.ink};letter-spacing:-0.2px}
.hw-meta{font-size:12px;fill:${t.muted}}
.hw-micro{font-size:10px;font-weight:600;letter-spacing:0.08em;fill:${t.muted}}
.hw-big{font-size:22px;font-weight:700;fill:${t.ink}}
.hw-strong{font-size:14px;font-weight:650;fill:${t.ink}}
.hw-dim{font-size:13px;fill:${t.muted}}
.hw-accent-strong{font-size:12px;font-weight:700;fill:${t.accent}}
.hw-italic{font-size:12px;font-style:italic;fill:${t.muted}}
.hw-pill{fill:${t["freshness-live"]};fill-opacity:0.13}
.hw-pill-dot{fill:${t["freshness-live"]}}
.hw-pill-text{font-size:12px;font-weight:600;fill:${t["freshness-live"]}}
.hw-vane-accent{fill:none;stroke:${t.accent};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hw-table-strong{font-size:13px;font-weight:650;fill:${t.ink}}
.hw-table-num{font-size:14px;font-weight:700;fill:${t.ink}}
.hw-wordmark{font-size:44px;font-weight:600;letter-spacing:-1.2px;fill:${t.ink}}
.hw-wordmark-sub{font-size:12px;font-weight:650;letter-spacing:0.34em;fill:${t.muted}}
</style>`;
}

/* ---------------- fixtures: seeded, fixed clock --------------------------- */

const NOW_MS = Date.parse("2025-06-21T20:00:00Z");
/* Rendered station-local time; a fixed offset, not Intl, so output never
 * depends on the generating machine's locale or zoneinfo. */
const TZ_OFFSET_MS = -7 * 3_600_000;
const PERIOD_MINUTES = 5;
/* Authored in km/h. Components take the declared { unit, values } pair and
 * convert internally; the hand-drawn chart below speaks wire m/s itself. */
const THRESHOLDS_DECLARED = { unit: "kmh", values: [12, 20, 28] };
const THRESHOLDS = THRESHOLDS_DECLARED.values.map((kmh) => kmh / 3.6);

const iso = (ms) => new Date(ms).toISOString();
/* Wire speeds are m/s; the fixture shapes are authored in km/h. */
const mps = (kmh) => Math.round((kmh / 3.6) * 100) / 100;
const shownKmh = (valueMps) => Math.round(core.speedFromMps(valueMps, "kmh"));
const fmtTime = (ms) => {
  const local = new Date(ms + TZ_OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};
const round1 = (value) => Math.round(value * 10) / 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (value) => {
  const u = Math.min(1, Math.max(0, value));
  return u * u * (3 - 2 * u);
};

/* Six hours at five-minute cadence: a calm dawn drainage out of the ESE
 * building into a thermic NW afternoon, gustiness growing with the build.
 * Calm samples carry no direction — the contract's rule, kept by the
 * fixture so the chart's dawn vanes honestly dash. */
function buildHistory() {
  const rand = mulberry32(0x57a71c);
  const points = [];
  for (let index = 0; index <= 72; index += 1) {
    const t = index / 72;
    const build = smooth((t - 0.15) / 0.7);
    const gustiness = 1 + 4 * build;
    const average = Math.max(0.2, 1.2 + 17.6 * build + (rand() - 0.5) * (1 + 3 * build));
    const gust = average + gustiness * (0.9 + 0.7 * rand()) + 1;
    const lull = Math.max(0, average - gustiness * (0.7 + 0.5 * rand()) - 0.5);
    const bearing = 110 + 205 * smooth((t - 0.08) / 0.8) + (rand() - 0.5) * 24;
    points.push({
      observedAt: iso(NOW_MS - (72 - index) * PERIOD_MINUTES * 60_000),
      averageMps: mps(average),
      gustMps: mps(gust),
      lullMps: mps(lull),
      directionDeg: core.isCalm(mps(average)) ? null : round1(core.normalizeDegrees(bearing)),
      temperatureC: null,
    });
  }
  return { periodMinutes: PERIOD_MINUTES, points };
}

const HISTORY = buildHistory();

const READING = {
  observedAt: iso(NOW_MS - 30_000),
  averageMps: mps(17.3),
  directionDeg: 313,
  gustMps: mps(24.1),
  lullMps: mps(11.2),
  temperatureC: null,
  windChillC: null,
  conditions: null,
};

const STATION = {
  id: "launch-ridge",
  name: "Launch Ridge",
  sourceLabel: "WindNerd",
  pageUrl: null,
  latitude: null,
  longitude: null,
  timeZone: "America/Vancouver",
  elevationM: 1180,
  capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
  samplingWindowSeconds: 3,
  recommendedPollSeconds: 60,
  status: "ok",
  reading: READING,
  history: HISTORY,
};

/* The fixture must be a legal wire document; drift from the contract fails
 * the regeneration, not the reader. */
core.stationSchema.parse(STATION);

/* NW-dominant with an SE drainage lobe and a calm share, for a rose that
 * shows banded petals and the calm caption. */
function buildRosePoints() {
  const rand = mulberry32(0x9e2d);
  const gauss = () => (rand() + rand() + rand()) / 3 - 0.5;
  const points = [];
  for (let index = 0; index < 144; index += 1) {
    const roll = rand();
    let bearing = null;
    let speed = 0.8;
    if (roll >= 0.12 && roll < 0.6) {
      bearing = 315 + gauss() * 70;
      speed = 13 + rand() * 11;
    } else if (roll >= 0.6 && roll < 0.85) {
      bearing = 135 + gauss() * 54;
      speed = 5 + rand() * 7;
    } else if (roll >= 0.85) {
      bearing = 240 + gauss() * 80;
      speed = 3 + rand() * 5;
    }
    points.push({
      observedAt: iso(NOW_MS - (144 - index) * PERIOD_MINUTES * 60_000),
      averageMps: mps(speed),
      gustMps: null,
      lullMps: null,
      directionDeg: bearing == null ? null : round1(core.normalizeDegrees(bearing)),
      temperatureC: null,
    });
  }
  return points;
}

const ROSE_POINTS = buildRosePoints();

/* ---------------- SVG assembly ------------------------------------------- */

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (value) => String(Math.round(value * 10) / 10);
const text = (x, y, cls, content, anchor) =>
  `<text class="${cls}" x="${n(x)}" y="${n(y)}"${anchor ? ` text-anchor="${anchor}"` : ""}>${esc(content)}</text>`;

const svgDocument = (width, height, theme, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${styleBlock(THEMES[theme])}${body}</svg>`;

/* Lift a component's <svg> out of its renderToStaticMarkup HTML and nest it
 * at (x, y); nested <svg> viewports are valid SVG and inherit the outer
 * document's <style>. */
function extractSvg(markup, className, x, y) {
  const marker = markup.indexOf(`class="${className}"`);
  if (marker === -1) throw new Error(`render carries no <svg class="${className}">`);
  const open = markup.lastIndexOf("<svg", marker);
  const close = markup.indexOf("</svg>", marker) + "</svg>".length;
  return `<svg x="${n(x)}" y="${n(y)}"${markup.slice(open + 4, close)}`;
}

/* A card with a raised, top-rounded header band — the .meteo-station-card chrome,
 * in SVG. */
function cardChrome(width, height, headerBottom, radius = 14) {
  const inner = radius - 1;
  return (
    `<rect class="hw-card" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}"/>` +
    `<path class="hw-raised" d="M1,${headerBottom} v-${headerBottom - 1 - inner} a${inner},${inner} 0 0 1 ${inner},-${inner} h${width - 2 - 2 * inner} a${inner},${inner} 0 0 1 ${inner},${inner} v${headerBottom - 1 - inner} z"/>` +
    `<line class="hw-border" x1="1" y1="${headerBottom}" x2="${width - 1}" y2="${headerBottom}"/>`
  );
}

/* "from ↗ NW 313°" — the CurrentConditions direction row, the dart drawn by
 * the same vanePath the chart's vane row uses. */
function directionRow(cx, y, bearingDeg) {
  const compass = core.compassDirection(bearingDeg);
  return (
    text(cx - 23, y, "hw-dim", words.fromLabel, "end") +
    `<path class="hw-vane-accent" d="${core.vanePath(cx - 9, y - 5, bearingDeg, { reach: 6.5, spread: 3 })}"/>` +
    `<text x="${n(cx + 5)}" y="${n(y)}"><tspan class="hw-strong">${esc(compass)}</tspan><tspan class="hw-dim"> ${Math.round(bearingDeg)}°</tspan></text>`
  );
}

function flank(cx, cy, label, valueKmh) {
  return (
    text(cx, cy, "hw-micro", label.toUpperCase(), "middle") +
    text(cx, cy + 26, "hw-big", Math.round(valueKmh), "middle")
  );
}

/* The MeasuredChart drawing, from core geometry alone: zone tints, grid,
 * threshold guides, lull–gust band, banded mean segments, vane row, ticks. */
function chartSvg({ points, periodMinutes, thresholds, width, x, y, idPrefix }) {
  const frame = core.chartFrame(width);
  const scales = core.chartScales(points, frame);
  const vanes = core.thinVanes(points);
  const parts = [];

  const cuts = [0, ...thresholds.filter((b) => b > 0 && b < scales.scaleMax), scales.scaleMax];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const [lower, upper] = [cuts[index], cuts[index + 1]];
    const band = core.speedBand((lower + upper) / 2, thresholds);
    parts.push(
      `<rect class="meteo-wind-zone meteo-band-${band}" x="${n(frame.left)}" y="${n(scales.yAt(upper))}" width="${n(frame.right - frame.left)}" height="${n(scales.yAt(lower) - scales.yAt(upper))}"/>`,
    );
  }
  for (const fraction of [0, 0.5, 1]) {
    const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
    parts.push(
      `<line class="meteo-grid-line" x1="${n(frame.left)}" y1="${n(gridY)}" x2="${n(frame.right)}" y2="${n(gridY)}"/>`,
      text(frame.left - 6, gridY + 5, "meteo-grid-label", shownKmh(scales.scaleMax * fraction), "end"),
    );
  }
  for (const bound of thresholds.filter((b) => b > 0 && b <= scales.scaleMax)) {
    const band = core.speedBand(bound, thresholds);
    parts.push(
      `<line class="meteo-wind-threshold meteo-band-${band}" x1="${n(frame.left)}" y1="${n(scales.yAt(bound))}" x2="${n(frame.right)}" y2="${n(scales.yAt(bound))}"/>`,
      text(frame.right - 3, scales.yAt(bound) - 3, `meteo-wind-threshold-label meteo-band-${band}`, shownKmh(bound), "end"),
    );
  }
  for (const vane of vanes) {
    parts.push(
      `<line class="meteo-wind-guide" x1="${n(scales.xAtMs(vane.midMs))}" y1="${n(frame.plotTop)}" x2="${n(scales.xAtMs(vane.midMs))}" y2="${n(frame.vaneRow - 9)}"/>`,
    );
  }
  const gaps = core.historyGaps({ periodMinutes, points });
  if (gaps.length > 0) {
    parts.push(
      `<defs><pattern id="${idPrefix}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="meteo-wind-gap-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`,
      ...gaps.map(
        ([startMs, endMs]) =>
          `<rect fill="url(#${idPrefix}-hatch)" x="${n(scales.xAtMs(startMs))}" y="${n(frame.plotTop)}" width="${n(scales.xAtMs(endMs) - scales.xAtMs(startMs))}" height="${n(frame.plotBottom - frame.plotTop)}"/>`,
      ),
    );
  }
  const band = core.bandPoints(points, scales);
  if (band != null) parts.push(`<polygon class="meteo-wind-band" points="${band}"/>`);
  for (let index = 1; index < points.length; index += 1) {
    const [previous, point] = [points[index - 1], points[index]];
    const segmentBand = core.speedBand((previous.averageMps + point.averageMps) / 2, thresholds);
    parts.push(
      `<line class="meteo-wind-mean-segment meteo-band-${segmentBand}" x1="${n(scales.xAt(previous.observedAt))}" y1="${n(scales.yAt(previous.averageMps))}" x2="${n(scales.xAt(point.observedAt))}" y2="${n(scales.yAt(point.averageMps))}"/>`,
    );
  }
  parts.push(text(frame.left - 8, frame.vaneRow + 4, "meteo-wind-row-label", words.toLabel, "end"));
  for (const vane of vanes) {
    parts.push(
      vane.directionDeg == null
        ? text(scales.xAtMs(vane.midMs), frame.vaneRow + 4, "meteo-wind-vane-calm", "—", "middle")
        : `<path class="meteo-wind-vane" d="${core.vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.directionDeg)}"/>`,
    );
  }
  for (const tick of core.vaneTicks(vanes, scales)) {
    const anchor = tick.index === 0 ? "start" : tick.index === 4 ? "end" : "middle";
    parts.push(text(tick.x, frame.labelRow, "meteo-tick", fmtTime(tick.timeMs), anchor));
  }
  return `<svg x="${n(x)}" y="${n(y)}" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">${parts.join("")}</svg>`;
}

/* ---------------- the assets --------------------------------------------- */

function renderDial() {
  return renderToStaticMarkup(
    h(CurrentConditions, {
      station: STATION,
      servedAt: iso(NOW_MS),
      receivedAtMs: NOW_MS,
      thresholds: THRESHOLDS_DECLARED,
    }),
  );
}

function heroSvg(theme) {
  const status = core.freshness({
    observedAt: READING.observedAt,
    servedAt: iso(NOW_MS),
    receivedAtMs: NOW_MS,
    nowMs: NOW_MS,
  });
  const startMs = Date.parse(HISTORY.points[0].observedAt);
  const body =
    `<g transform="translate(10,10)">` +
    cardChrome(880, 340, 56) +
    text(24, 30, "hw-name", STATION.name) +
    text(24, 47, "hw-meta", `${STATION.sourceLabel} · ${words.elevation(STATION.elevationM)} · updated ${fmtTime(NOW_MS)}`) +
    `<rect class="hw-pill" x="790" y="15" width="66" height="26" rx="13"/>` +
    `<circle class="hw-pill-dot" cx="806" cy="28" r="4"/>` +
    text(818, 32, "hw-pill-text", words.freshness[status]) +
    `<line class="meteo-grid-line" x1="326" y1="82" x2="326" y2="322"/>` +
    flank(43, 174, words.lullLabel, shownKmh(READING.lullMps)) +
    extractSvg(renderDial(), "meteo-wind-dial", 71, 102) +
    flank(259, 174, words.gustLabel, shownKmh(READING.gustMps)) +
    directionRow(151, 294, READING.directionDeg) +
    `<text x="386" y="104"><tspan class="hw-accent-strong">${fmtTime(startMs)} – ${fmtTime(NOW_MS)}</tspan><tspan class="hw-meta"> · lull–gust band · vanes point downwind</tspan></text>` +
    chartSvg({
      points: HISTORY.points,
      periodMinutes: HISTORY.periodMinutes,
      thresholds: THRESHOLDS,
      width: 524,
      x: 340,
      y: 116,
      idPrefix: "hero",
    }) +
    `</g>`;
  return svgDocument(900, 360, theme, `Live wind at ${STATION.name}: instrument dial and six-hour graded history`, body);
}

function wordmarkSvg(theme) {
  /* One dart from core's vanePath, bearing FROM the southwest so it points
   * northeast; the head chevron (the path's second subpath) wears the amber
   * band as a tip accent. */
  const dart = core.vanePath(36, 40, 225, { reach: 23, spread: 10.5 });
  const split = dart.indexOf("M", 1);
  const amber = THEMES[theme]["band-2"];
  const body =
    `<path d="${dart.slice(0, split).trim()}" fill="none" stroke="${THEMES[theme].accent}" stroke-width="6.5" stroke-linecap="round"/>` +
    `<path d="${dart.slice(split)}" fill="none" stroke="${amber}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    /* The umbrella mark: no capability descriptor — station, forecast, and
     * their siblings all shelter under the same dart. */
    text(74, 58, "hw-wordmark", "azohra meteo");
  return svgDocument(430, 92, theme, "azohra meteo", body);
}

function galleryDialSvg() {
  const body =
    `<rect class="hw-card" x="6.5" y="6.5" width="267" height="219" rx="12"/>` +
    flank(32, 88, words.lullLabel, shownKmh(READING.lullMps)) +
    extractSvg(renderDial(), "meteo-wind-dial", 60, 18) +
    flank(248, 88, words.gustLabel, shownKmh(READING.gustMps)) +
    directionRow(140, 206, READING.directionDeg);
  return svgDocument(280, 232, "light", `CurrentConditions at ${STATION.name}`, body);
}

function galleryChartSvg() {
  const body =
    `<rect class="hw-card" x="6.5" y="6.5" width="267" height="171" rx="12"/>` +
    chartSvg({
      points: HISTORY.points,
      periodMinutes: HISTORY.periodMinutes,
      thresholds: THRESHOLDS,
      width: 256,
      x: 12,
      y: 18,
      idPrefix: "gallery",
    });
  return svgDocument(280, 184, "light", `WindHistoryChart at ${STATION.name}`, body);
}

function galleryRoseSvg() {
  const markup = renderToStaticMarkup(h(WindRose, { points: ROSE_POINTS, thresholds: THRESHOLDS_DECLARED }));
  const calmPercent = Math.round(core.windRose(ROSE_POINTS).calmFraction * 100);
  const body =
    `<rect class="hw-card" x="6.5" y="6.5" width="267" height="223" rx="12"/>` +
    extractSvg(markup, "meteo-wind-rose-svg", 45, 12) +
    text(140, 218, "hw-dim", words.percentCalm(calmPercent), "middle");
  return svgDocument(280, 236, "light", "WindRose direction distribution", body);
}

function galleryTableSvg() {
  /* StationTable is an HTML grid; a three-row miniature is redrawn as SVG
   * text, including the degrade-don't-lie row a broken upstream earns. */
  const columns = { station: 18, wind: 170, gust: 208, from: 222 };
  const row = (y, name, windKmh, gustKmh, bearingDeg) =>
    text(columns.station, y, "hw-table-strong", name) +
    `<text class="hw-table-num" x="${columns.wind}" y="${y}" text-anchor="end">${Math.round(windKmh)}<tspan class="hw-micro"> ${esc(words.speedUnits.kmh)}</tspan></text>` +
    text(columns.gust, y, "hw-table-num", Math.round(gustKmh), "end") +
    `<path class="hw-vane-accent" d="${core.vanePath(columns.from + 6, y - 4, bearingDeg, { reach: 5.5, spread: 2.5 })}"/>` +
    text(columns.from + 16, y, "hw-strong", core.compassDirection(bearingDeg));
  const body =
    `<rect class="hw-card" x="6.5" y="6.5" width="267" height="141" rx="12"/>` +
    `<path class="hw-raised" d="M7,33.5 v-15.5 a11,11 0 0 1 11,-11 h244 a11,11 0 0 1 11,11 v15.5 z"/>` +
    `<line class="hw-border" x1="7" y1="33.5" x2="273" y2="33.5"/>` +
    text(columns.station, 25, "hw-micro", words.table.station.toUpperCase()) +
    text(columns.wind, 25, "hw-micro", words.table.wind.toUpperCase(), "end") +
    text(columns.gust, 25, "hw-micro", words.table.gust.toUpperCase(), "end") +
    text(columns.from, 25, "hw-micro", words.table.from.toUpperCase()) +
    row(57, "Launch Ridge", shownKmh(READING.averageMps), shownKmh(READING.gustMps), READING.directionDeg) +
    `<line class="meteo-grid-line" x1="7" y1="70.5" x2="273" y2="70.5"/>` +
    row(95, "Valley Floor", 9, 13, 135) +
    `<line class="meteo-grid-line" x1="7" y1="108.5" x2="273" y2="108.5"/>` +
    text(columns.station, 133, "hw-table-strong", "Ridge East") +
    text(110, 133, "hw-italic", words.reasons.timeout);
  return svgDocument(280, 154, "light", "StationTable across three stations", body);
}

/* ---------------- validation and writing --------------------------------- */

function assertWellFormed(name, xml) {
  const stack = [];
  const scanner = /<!--[\s\S]*?-->|<(\/?)([A-Za-z_][A-Za-z0-9_.:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*?)(\/?)>|[<>]/g;
  let match;
  while ((match = scanner.exec(xml)) !== null) {
    if (match[0] === "<" || match[0] === ">") {
      throw new Error(`${name}: stray ${JSON.stringify(match[0])} at offset ${match.index}`);
    }
    if (match[0].startsWith("<!--")) continue;
    const [, closing, tag, , selfClosing] = match;
    if (closing) {
      const expected = stack.pop();
      if (expected !== tag) throw new Error(`${name}: </${tag}> closes <${expected}>`);
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  if (stack.length > 0) throw new Error(`${name}: unclosed <${stack.join("<")}>`);
  const badEntity = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.exec(xml);
  if (badEntity) throw new Error(`${name}: unescaped & at offset ${badEntity.index}`);
}

function assertSelfContained(name, svg) {
  if (/<foreignObject/i.test(svg)) throw new Error(`${name}: foreignObject`);
  if (/url\((?!#)/.test(svg)) throw new Error(`${name}: non-fragment url() reference`);
  if (/https?:\/\//.test(svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', ""))) {
    throw new Error(`${name}: external http reference`);
  }
  if (/@import|<image|<script/i.test(svg)) throw new Error(`${name}: external content`);
  const bytes = Buffer.byteLength(svg);
  if (bytes > 200 * 1024) throw new Error(`${name}: ${bytes} bytes exceeds 200 KB`);
  assertWellFormed(name, svg);
  return bytes;
}

const ASSETS = {
  "hero-light.svg": heroSvg("light"),
  "hero-dark.svg": heroSvg("dark"),
  "wordmark-light.svg": wordmarkSvg("light"),
  "wordmark-dark.svg": wordmarkSvg("dark"),
  "gallery-dial.svg": galleryDialSvg(),
  "gallery-chart.svg": galleryChartSvg(),
  "gallery-rose.svg": galleryRoseSvg(),
  "gallery-table.svg": galleryTableSvg(),
};

await mkdir(join(root, "assets"), { recursive: true });
for (const [name, svg] of Object.entries(ASSETS)) {
  const bytes = assertSelfContained(name, `${svg}\n`);
  await writeFile(join(root, "assets", name), `${svg}\n`);
  console.log(`assets/${name}  ${(bytes / 1024).toFixed(1)} KB`);
}
