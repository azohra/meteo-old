/* The instrument panel: every component the library ships, over one fixture
 * feed. The "simulate live" toggle regenerates the feed every two seconds —
 * readings tick immediately, history points append on minute boundaries —
 * proving reactive updates never twitch layout. The theme switch pins
 * data-theme on .meteo-root (the library's own mechanism); "auto" removes
 * the pin and the system preference decides.
 *
 * The page showcases the ambient-provider ergonomics: ONE
 * <StationFeedProvider> carries the feed, the clock, the display unit, and
 * the club's thresholds, and every component below picks a station by
 * `stationId` (or the feed's primary) without re-threaded props. A real page
 * against a mounted handler would swap the fixture for
 * `useStation("/api/wind", "launch-ridge")` and hand its `{ feed,
 * receivedAtMs }` to the same provider. The last section renders with fully
 * explicit props and no provider in sight — the provider is a default,
 * never a requirement. */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  METEOROLOGICAL_SEASON_MONTHS,
  filterByMonth,
  filterByTimeOfDay,
  speedUnitLabel,
  windRose,
} from "@azohra/meteo/station";
import type { HistoryPoint, Reading, SpeedThresholds, SpeedUnit } from "@azohra/meteo/station";
import {
  AirMatrix,
  BandChip,
  CurrentConditions,
  DailyPattern,
  Dial,
  Direction,
  Gust,
  Sparkline,
  Speed,
  StationTable,
  StationFeedProvider,
  StationStrip,
  TrendChart,
  UpdatedAt,
  WindHistoryChart,
  WindRose,
  StationCard,
} from "@azohra/meteo/station/react";
import "@azohra/meteo/station/styles.css";
import "./demo.css";
import { isDocKey, type DocKey } from "./docs";

/* The docs view carries every markdown page plus the renderer — split out
 * so the landing never pays for it; the split point also keeps `marked`
 * and the raw docs text out of the first paint. */
const DocsView = lazy(() =>
  import("./DocsView").then((module) => ({ default: module.DocsView })),
);
import { buildCompareShowcaseStation, buildDemoFeed } from "./fixtures";
import { highlightCode } from "./highlight";
import { buildLongHistory } from "../../shared/fakeStation.mjs";
import wordmarkDark from "../../../assets/wordmark-dark.svg";
import wordmarkLight from "../../../assets/wordmark-light.svg";

/* ---- The hero pipeline: the wire made visible ------------------------- */

/* The reading's wind essentials, tinted line by line — real state, not a
 * screenshot: the same object CurrentConditions renders beside it, so the
 * "Simulate live" toggle ticks the JSON and the dial together. Built as
 * React nodes, never innerHTML. */
function WireJson({ reading }: { reading: Reading }) {
  const shown: Record<string, string | number | null> = {
    observedAt: reading.observedAt,
    averageMps: reading.averageMps,
    directionDeg: reading.directionDeg,
    gustMps: reading.gustMps,
    lullMps: reading.lullMps,
    temperatureC: reading.temperatureC,
  };
  return (
    <pre className="demo-wire-json">
      <span className="demo-wire-punct">{"{"}</span>
      {"\n"}
      {Object.entries(shown).map(([key, value], index, all) => (
        <span key={key}>
          {"  "}
          <span className="demo-wire-key">"{key}"</span>
          <span className="demo-wire-punct">: </span>
          {typeof value === "string" ? (
            <span className="demo-wire-string">"{value}"</span>
          ) : value == null ? (
            <span className="demo-wire-null">null</span>
          ) : (
            <span className="demo-wire-number">{value}</span>
          )}
          <span className="demo-wire-punct">{index < all.length - 1 ? "," : ""}</span>
          {"\n"}
        </span>
      ))}
      <span className="demo-wire-punct">{"}"}</span>
    </pre>
  );
}

/* ---- "Two ways in": the same data as an object and as a component ------ */

const WAYS_SNIPPET = `import { windRose, filterByMonth, filterByTimeOfDay,
         METEOROLOGICAL_SEASON_MONTHS } from "@azohra/meteo/station";

const summer = filterByMonth(history, METEOROLOGICAL_SEASON_MONTHS.summer);
const midday = filterByTimeOfDay(summer, 9 * 60, 15 * 60);
const rose   = windRose(midday, 16); // ↓ the object below`;

const WAYS_RENDER_SNIPPET = `<WindRose points={midday} />`;

type View = "gallery" | "docs";

/* The whole nav state lives in the URL (?view=docs&page=react) — a page
 * someone reads and shares stays exactly that page on reload, and the
 * browser's own back/forward buttons work without a router dependency. */
function readViewFromLocation(): { view: View; page: DocKey } {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  return {
    view: params.get("view") === "docs" ? "docs" : "gallery",
    page: isDocKey(page) ? page : "readme",
  };
}

/* All/Month/Season — the reference dashboard's own three-way toggle.
 * "Month" and "Season" both narrow through the SAME filterByMonth; a season
 * is just a fixed three-month group, a month is a single one. */
type FilterMode = "all" | "month" | "season";
const FILTER_MODE_CHOICES: { value: FilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "month", label: "Month" },
  { value: "season", label: "Season" },
];

type Season = "winter" | "spring" | "summer" | "fall";
const SEASON_CHOICES: { value: Season; label: string }[] = [
  { value: "winter", label: "Winter" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "fall", label: "Fall" },
];

const MONTH_CHOICES: { value: number; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

type TimeOfDay = "all" | "midday" | "night";
const TIME_OF_DAY_CHOICES: { value: TimeOfDay; label: string }[] = [
  { value: "all", label: "All day" },
  { value: "midday", label: "Midday · 09–15" },
  { value: "night", label: "Night · 21–06" },
];

function filteredHistory(
  points: HistoryPoint[],
  filterMode: FilterMode,
  season: Season,
  month: number,
  timeOfDay: TimeOfDay,
): HistoryPoint[] {
  const byMonth =
    filterMode === "all"
      ? points
      : filterMode === "month"
        ? filterByMonth(points, [month])
        : filterByMonth(points, METEOROLOGICAL_SEASON_MONTHS[season]);
  if (timeOfDay === "all") return byMonth;
  return timeOfDay === "midday"
    ? filterByTimeOfDay(byMonth, 9 * 60, 15 * 60)
    : filterByTimeOfDay(byMonth, 21 * 60, 6 * 60);
}

/* 6h/12h/24h — the reference dashboard's own period toggle, a plain slice of
 * the SAME already-fetched points the six-hour card always had, via
 * WindHistoryChart's windowHours prop. */
const WINDOW_HOURS_CHOICES: { value: number; label: string }[] = [
  { value: 6, label: "6 h" },
  { value: 12, label: "12 h" },
  { value: 24, label: "24 h" },
];

/* Off/-1d/-2d/-3d — the day-over-day comparison overlay. 0 means "no
 * overlay", never a fourth prop value WindHistoryChart itself has to know
 * about. */
const COMPARE_CHOICES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 1, label: "vs. -1 day" },
  { value: 2, label: "vs. -2 days" },
  { value: 3, label: "vs. -3 days" },
];

/* The club thinks in km/h, so the thresholds SAY km/h — the library
 * converts onto the m/s wire once, internally, whatever display unit the
 * switcher picks. */
const THRESHOLDS: SpeedThresholds = { unit: "kmh", values: [12, 20, 28] };

/* The chip row grades finer: five words need four bounds — the extra 5 km/h
 * threshold separates barely-moving air from a light breeze. */
const CHIP_THRESHOLDS: SpeedThresholds = { unit: "kmh", values: [5, 12, 20, 28] };
const CHIP_LABELS = ["calm", "light", "fine", "strong", "nuked"];

/* Sailors, drivers, US visitors — the wire stays m/s either way. */
const UNIT_CHOICES: SpeedUnit[] = ["kmh", "knots", "mph"];

type Theme = "light" | "dark" | "system";
const THEME_CHOICES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

const SECTIONS: { id: string; title: string; nav: string; note: string }[] = [
  {
    id: "ways",
    title: "Two ways in",
    nav: "Two ways",
    note: "The same summer-midday points, once as the object windRose() returns and once as the component that draws it — the headless core and the bindings are peers; take either.",
  },
  {
    id: "cards",
    title: "The station card",
    nav: "Cards",
    note: "StationCard childless composes the full card; with children you pick the pieces — the second card is chart and summary only.",
  },
  {
    id: "instruments",
    title: "Current conditions",
    nav: "Instruments",
    note: "Four instruments, four shapes of truth — including an outage that keeps its card instead of vanishing.",
  },
  {
    id: "charts",
    title: "History, graded and plain",
    nav: "Charts",
    note: "The same six hours with the club's thresholds banding the trace, and with thresholds={null} opting out into the neutral accent. The third panel is a longer-history fixture alone: windowHours re-slices it to 6/12/24 h, and compareOffsetDays overlays a prior day's trace shifted onto today's own x-axis, both a plain client-side re-slice of the same fetched points.",
  },
  {
    id: "roses",
    title: "Wind roses",
    nav: "Roses",
    note: "Launch Ridge wears its 260°–340° launch window as a judgment ring; the petals keep reporting distribution.",
  },
  {
    id: "seasons",
    title: "A season, not a window",
    nav: "Seasons",
    note: "Fourteen months of generated (never fetched) history behind one rose and one typical day — All/Month/Season pick what filterByMonth narrows to (a season is just a fixed three-month group), filterByTimeOfDay narrows further; DailyPattern vector-averages the lot into a day.",
  },
  {
    id: "trends",
    title: "Trends",
    nav: "Trends",
    note: "Temperature and sea-level pressure over the window — the 20-minute dropout breaks both traces, never interpolated over.",
  },
  {
    id: "air",
    title: "Air and precipitation",
    nav: "Air",
    note: "AirMatrix folds the whole atmosphere behind a live trigger line; only the conditions-capable station earns a column.",
  },
  {
    id: "table",
    title: "The fleet, on one table",
    nav: "Table",
    note: "One row per station, unavailable rows keep their geometry — no props at all, the provider supplies everything.",
  },
  {
    id: "strips",
    title: "Strips",
    nav: "Strips",
    note: "StationStrip is the table row as a standalone one-liner — provider-fed here, and the outage keeps its line at full height.",
  },
  {
    id: "primitives",
    title: "Primitives",
    nav: "Primitives",
    note: "The atoms compose inline in your own sentence; BandChip wears the club's vocabulary; Sparkline rides beside StationStrip in the classic board-row pairing; the bare Dial scales without redrawing.",
  },
  {
    id: "explicit",
    title: "No provider, explicit props",
    nav: "Explicit",
    note: "This instrument renders outside the provider: station, clocks, thresholds, and unit all arrive as props.",
  },
];

/* A real <a href> — middle-click / cmd-click / "open in new tab" all still
 * work — that navigates in-page on a plain left click, same as the rest of
 * this SPA's internal nav. */
function DocLink({
  children,
  className,
  onOpen,
  to,
}: {
  children: ReactNode;
  className?: string;
  onOpen: (page: DocKey, hash: string) => void;
  to: DocKey;
}) {
  return (
    <a
      className={className}
      href={`?view=docs&page=${to}`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(to, "");
      }}
    >
      {children}
    </a>
  );
}

function SectionHead({ id }: { id: string }) {
  const section = SECTIONS.find((entry) => entry.id === id);
  if (!section) return null;
  return (
    <div className="demo-section-head">
      <h2>{section.title}</h2>
      <p>{section.note}</p>
    </div>
  );
}

export default function App() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [live, setLive] = useState(false);
  const [unit, setUnit] = useState<SpeedUnit>("kmh");
  const [theme, setTheme] = useState<Theme>("system");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [season, setSeason] = useState<Season>("winter");
  const [month, setMonth] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("all");
  const [windowHours, setWindowHours] = useState(6);
  const [compareOffsetDays, setCompareOffsetDays] = useState<0 | 1 | 2 | 3>(0);
  const [{ view, page: docPage }, setNav] = useState(readViewFromLocation);

  useEffect(() => {
    const onPopState = () => setNav(readViewFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openDocs = (page: DocKey, hash: string) => {
    setNav({ view: "docs", page });
    const url = `${window.location.pathname}?view=docs&page=${page}`;
    window.history.pushState({}, "", hash ? `${url}#${hash}` : url);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  };
  const closeDocs = () => {
    setNav({ view: "gallery", page: docPage });
    window.history.pushState({}, "", window.location.pathname);
  };

  /* Generated once, at mount — settled history, not something the "simulate
   * live" ticker has any business regenerating every two seconds. */
  const [longHistory] = useState<HistoryPoint[]>(() =>
    buildLongHistory({ nowMs: Date.now(), days: 420, periodMinutes: 15 }),
  );
  const seasonHistory = useMemo(
    () => filteredHistory(longHistory, filterMode, season, month, timeOfDay),
    [longHistory, filterMode, season, month, timeOfDay],
  );
  /* A standalone fixture, never part of the live feed: four days of 5-minute
   * history exist ONLY so windowHours and compareOffsetDays below have
   * something real to slice, without ballooning what every other section's
   * summit-logger panels draw. Built once, like longHistory. */
  const [compareStation] = useState(() => buildCompareShowcaseStation(Date.now()));

  /* "Two ways in": one fixed slice of the long history feeds both panels —
   * the object windRose() returns and the component that draws it — so the
   * section's claim ("same data") is literally true, not staged. */
  const ways = useMemo(() => {
    const midday = filterByTimeOfDay(
      filterByMonth(longHistory, METEOROLOGICAL_SEASON_MONTHS.summer),
      9 * 60,
      15 * 60,
    );
    const rose = windRose(midday, 16);
    const busiest = rose.sectors.reduce((top, sector) =>
      sector.frequency > top.frequency ? sector : top,
    );
    const output =
      `{\n  sampleCount: ${rose.sampleCount},\n  calmFraction: ${rose.calmFraction.toFixed(2)},\n` +
      `  sectors: [ /* 16 */ ],\n  // busiest:\n` +
      `  { bearingDeg: ${busiest.bearingDeg}, frequency: ${busiest.frequency.toFixed(2)},\n` +
      `    meanSpeedMps: ${busiest.meanSpeedMps?.toFixed(1) ?? "null"}, count: ${busiest.count} }\n}`;
    return { midday, output };
  }, [longHistory]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 2_000);
    return () => window.clearInterval(timer);
  }, [live]);

  const feed = useMemo(() => buildDemoFeed(nowMs), [nowMs]);
  /* The fixture is "served" the instant it is built. */
  const receivedAtMs = nowMs;
  const summitLogger = feed.stations[1];
  const primary =
    feed.stations.find((station) => station.id === feed.primaryStationId) ?? feed.stations[0];
  if (!summitLogger) return null;

  return (
    <div
      className="meteo-root demo-page"
      data-theme={theme === "system" ? undefined : theme}
    >
      {/* Brand + site destinations only — the demo's own controls live with
       * the demo, in the sticky toolbar below the hero. */}
      <header className="demo-header">
        <div className="demo-header-bar">
          <a
            className="demo-wordmark"
            href="?"
            onClick={(event) => {
              event.preventDefault();
              if (view === "docs") closeDocs();
              else window.scrollTo({ top: 0 });
            }}
          >
            <img alt="azohra meteo" className="demo-wordmark-img demo-wordmark-light" src={wordmarkLight} />
            <img alt="" className="demo-wordmark-img demo-wordmark-dark" src={wordmarkDark} />
          </a>
          <nav aria-label="Site" className="demo-header-links">
            {view === "docs" ? (
              <button className="demo-header-link" onClick={closeDocs} type="button">
                Demo
              </button>
            ) : (
              <button
                className="demo-header-link"
                onClick={() => openDocs("readme", "")}
                type="button"
              >
                Docs
              </button>
            )}
            <a className="demo-header-link" href="https://github.com/azohra/meteo">
              GitHub ↗
            </a>
            <div aria-label="Theme" className="demo-segmented demo-segmented-compact" role="group">
              {THEME_CHOICES.map((choice) => (
                <button
                  aria-pressed={theme === choice.value}
                  key={choice.value}
                  onClick={() => setTheme(choice.value)}
                  type="button"
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      {view === "gallery" && (
      <>
      <section className="demo-about">
        <div className="demo-about-inner">
          <div className="demo-hero">
            <div className="demo-hero-grid">
              <div className="demo-hero-copy">
                <h1 className="demo-hero-headline">Every station. One wire. Your pixels.</h1>
                <p className="demo-hero-sub">
                  Vendor adapters normalize whatever hardware you run into
                  one wire contract. Build your own UI on the data, or
                  render it with components that live natively in your
                  design system.
                </p>
                <div className="demo-hero-cta">
                  <button
                    className="demo-cta-primary"
                    onClick={() => openDocs("getting-started", "")}
                    type="button"
                  >
                    Get started
                  </button>
                  <a className="demo-cta-ghost" href="https://github.com/azohra/meteo">
                    GitHub ↗
                  </a>
                </div>
                <div className="demo-hero-band" />
              </div>
              {primary?.status === "ok" && primary.reading && (
                <div aria-label="A live reading and the dial rendered from it" className="demo-hero-pipeline">
                  <div className="demo-terminal demo-wire-card">
                    <div className="demo-terminal-title">
                      GET /api/wind/feed · stations[0].reading
                    </div>
                    <WireJson reading={primary.reading} />
                  </div>
                  <div aria-hidden="true" className="demo-hero-flow">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="demo-hero-render">
                    <CurrentConditions
                      receivedAtMs={receivedAtMs}
                      servedAt={feed.servedAt}
                      station={primary}
                      thresholds={THRESHOLDS}
                      unit={unit}
                    />
                    <p className="demo-hero-render-caption">
                      the same object, drawn — flip “Simulate live” and both tick
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="demo-hero-features">
              <div>
                <h3>Any vendor</h3>
                <p>WindNerd, Tempest, Campbell Scientific, or a loader you write yourself.</p>
              </div>
              <div>
                <h3>Headless core</h3>
                <p>The contract, derivations, chart geometry, and polling stores are framework-free — components optional.</p>
              </div>
              <div>
                <h3>Rendered natively</h3>
                <p>Dial, graded history, wind rose, daily pattern — the full station-page vocabulary, no iframe.</p>
              </div>
              <div>
                <h3>Two peer bindings</h3>
                <p>React or framework-free custom elements. Byte-identical DOM; neither is the reference.</p>
              </div>
            </div>
          </div>
          <div className="demo-vendors">
            <h3 className="demo-strip-label">Vendors supported</h3>
            <div className="demo-vendor-cards">
              <div className="demo-vendor-card">
                <strong>WindNerd</strong>
                <p>3D-printed anemometer kits; live and long-range history off their own records endpoint.</p>
              </div>
              <div className="demo-vendor-card">
                <strong>WeatherFlow Tempest</strong>
                <p>Wind, temperature, pressure, humidity, solar, lightning.</p>
              </div>
              <div className="demo-vendor-card">
                <strong>Campbell Scientific</strong>
                <p>Dataloggers — DataQuery / CRBasic tables.</p>
              </div>
              <div className="demo-vendor-card">
                <strong>Custom</strong>
                <p>Bring your own loader; the same wire contract, the same components.</p>
              </div>
            </div>
          </div>
          <div className="demo-doclinks">
            <h3 className="demo-strip-label">Documentation</h3>
            <div className="demo-doclink-row">
              <DocLink className="demo-doclink" onOpen={openDocs} to="getting-started">Getting started</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="wire-contract">Wire contract</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="adapters">Adapters</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="client-data">Client data</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="react">React</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="elements">Elements</DocLink>
              <DocLink className="demo-doclink" onOpen={openDocs} to="theming">Theming</DocLink>
              <a className="demo-doclink" href="https://github.com/azohra/meteo">Repository ↗</a>
            </div>
          </div>
        </div>
      </section>

      {/* The demo's own affordances, riding with the demo: section anchors
       * left, the unit and live controls that affect every section right. */}
      <div className="demo-toolbar">
        <div className="demo-toolbar-inner">
          <nav aria-label="Sections" className="demo-toolbar-nav">
            {SECTIONS.map((section) => (
              <a href={`#${section.id}`} key={section.id}>
                {section.nav}
              </a>
            ))}
          </nav>
          <div className="demo-toolbar-controls">
            <div aria-label="Display unit" className="demo-segmented demo-segmented-compact" role="group">
              {UNIT_CHOICES.map((choice) => (
                <button
                  aria-pressed={unit === choice}
                  key={choice}
                  onClick={() => setUnit(choice)}
                  type="button"
                >
                  {speedUnitLabel(choice)}
                </button>
              ))}
            </div>
            <button
              aria-pressed={live}
              className="demo-live-toggle"
              data-live={live}
              onClick={() => setLive((value) => !value)}
              type="button"
            >
              <span className="demo-live-dot" />
              {live ? "Live · 2 s" : "Simulate live"}
            </button>
          </div>
        </div>
      </div>

      <main className="demo-main">
        <StationFeedProvider
          feed={feed}
          receivedAtMs={receivedAtMs}
          thresholds={THRESHOLDS}
          unit={unit}
        >
          <section className="demo-section" id="ways">
            <SectionHead id="ways" />
            <div className="demo-ways">
              <div className="demo-way">
                <h3 className="demo-way-title">Headless — the object</h3>
                <div className="demo-terminal">
                  <pre
                    className="demo-terminal-code"
                    dangerouslySetInnerHTML={{ __html: highlightCode(WAYS_SNIPPET, "ts") }}
                  />
                  <pre className="demo-terminal-output">{ways.output}</pre>
                </div>
              </div>
              <div className="demo-way">
                <h3 className="demo-way-title">Headed — the same data, drawn</h3>
                <div className="demo-panel demo-way-panel">
                  <pre
                    className="demo-way-render-code"
                    dangerouslySetInnerHTML={{ __html: highlightCode(WAYS_RENDER_SNIPPET, "ts") }}
                  />
                  <WindRose points={ways.midday} />
                </div>
              </div>
            </div>
          </section>

          <section className="demo-section" id="cards">
            <SectionHead id="cards" />
            <div className="demo-grid demo-grid-cards">
              <StationCard stationId="launch-ridge" />
              <StationCard stationId="summit-logger">
                <StationCard.Header />
                <StationCard.Chart />
                <StationCard.Summary />
              </StationCard>
            </div>
          </section>

          <section className="demo-section" id="instruments">
            <SectionHead id="instruments" />
            <div className="demo-grid demo-grid-instruments">
              {feed.stations.map((station) => (
                <CurrentConditions key={station.id} stationId={station.id} />
              ))}
            </div>
          </section>

          <section className="demo-section" id="charts">
            <SectionHead id="charts" />
            <div className="demo-grid demo-grid-charts">
              <div className="demo-panel">
                <h3>With thresholds — 12 · 20 · 28 km/h</h3>
                <WindHistoryChart stationId="summit-logger" />
              </div>
              <div className="demo-panel">
                <h3>Without thresholds</h3>
                <WindHistoryChart stationId="summit-logger" thresholds={null} />
              </div>
            </div>
            <div className="demo-filter-row">
              <div aria-label="Window" className="demo-segmented" role="group">
                {WINDOW_HOURS_CHOICES.map((choice) => (
                  <button
                    aria-pressed={windowHours === choice.value}
                    key={choice.value}
                    onClick={() => setWindowHours(choice.value)}
                    type="button"
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <div aria-label="Compare to a prior day" className="demo-segmented" role="group">
                {COMPARE_CHOICES.map((choice) => (
                  <button
                    aria-pressed={compareOffsetDays === choice.value}
                    key={choice.value}
                    onClick={() => setCompareOffsetDays(choice.value)}
                    type="button"
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-grid demo-grid-charts">
              <div className="demo-panel">
                <h3>History Lab — four days fetched, windowHours + compareOffsetDays</h3>
                <WindHistoryChart
                  compareOffsetDays={compareOffsetDays === 0 ? undefined : compareOffsetDays}
                  station={compareStation}
                  windowHours={windowHours}
                />
              </div>
            </div>
          </section>

          <section className="demo-section" id="roses">
            <SectionHead id="roses" />
            <div className="demo-grid demo-grid-roses">
              <div className="demo-panel">
                <h3>Launch Ridge — graded, launch window ring</h3>
                <WindRose
                  favorableDirections={[{ fromDeg: 260, toDeg: 340 }]}
                  stationId="launch-ridge"
                />
              </div>
              <div className="demo-panel">
                <h3>Summit Logger — plain</h3>
                <WindRose stationId="summit-logger" thresholds={null} />
              </div>
            </div>
          </section>

          <section className="demo-section" id="seasons">
            <SectionHead id="seasons" />
            <div className="demo-filter-row">
              <div aria-label="Filter" className="demo-segmented" role="group">
                {FILTER_MODE_CHOICES.map((choice) => (
                  <button
                    aria-pressed={filterMode === choice.value}
                    key={choice.value}
                    onClick={() => setFilterMode(choice.value)}
                    type="button"
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              {filterMode === "month" && (
                <select
                  aria-label="Month"
                  className="demo-select"
                  onChange={(event) => setMonth(Number(event.target.value))}
                  value={month}
                >
                  {MONTH_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
              {filterMode === "season" && (
                <div aria-label="Season" className="demo-segmented" role="group">
                  {SEASON_CHOICES.map((choice) => (
                    <button
                      aria-pressed={season === choice.value}
                      key={choice.value}
                      onClick={() => setSeason(choice.value)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
              <div aria-label="Time of day" className="demo-segmented" role="group">
                {TIME_OF_DAY_CHOICES.map((choice) => (
                  <button
                    aria-pressed={timeOfDay === choice.value}
                    key={choice.value}
                    onClick={() => setTimeOfDay(choice.value)}
                    type="button"
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-grid demo-grid-roses">
              <div className="demo-panel">
                <h3>WindRose — {seasonHistory.length.toLocaleString()} of the year's samples</h3>
                <WindRose points={seasonHistory} />
              </div>
              <div className="demo-panel">
                <h3>DailyPattern — the whole 14 months, vector-averaged</h3>
                <DailyPattern points={longHistory} />
              </div>
            </div>
          </section>

          <section className="demo-section" id="trends">
            <SectionHead id="trends" />
            <div className="demo-grid demo-grid-charts">
              <div className="demo-panel">
                <h3>Temperature — Launch Ridge</h3>
                <TrendChart series="temperature" stationId="launch-ridge" />
              </div>
              <div className="demo-panel">
                <h3>Pressure — Launch Ridge</h3>
                <TrendChart series="pressure" stationId="launch-ridge" />
              </div>
            </div>
          </section>

          <section className="demo-section" id="air">
            <SectionHead id="air" />
            <AirMatrix />
          </section>

          <section className="demo-section" id="table">
            <SectionHead id="table" />
            <StationTable />
          </section>

          <section className="demo-section" id="strips">
            <SectionHead id="strips" />
            <div className="demo-strips">
              <StationStrip stationId="launch-ridge" />
              <StationStrip stationId="summit-logger" />
              <StationStrip stationId="north-bluff" />
            </div>
          </section>

          <section className="demo-section" id="primitives">
            <SectionHead id="primitives" />
            <div className="demo-primitives">
              <div className="demo-panel demo-panel-compact">
                <h3>Atoms in a sentence — the feed's primary station</h3>
                <p className="demo-sentence">
                  <Speed /> <Direction />, gusting <Gust />, <UpdatedAt />
                </p>
              </div>
              <div className="demo-panel demo-panel-compact">
                <h3>Band chips — five words over 5 · 12 · 20 · 28 km/h</h3>
                <div className="demo-chip-row">
                  {feed.stations.map((station) => (
                    <BandChip
                      key={station.id}
                      labels={CHIP_LABELS}
                      stationId={station.id}
                      thresholds={CHIP_THRESHOLDS}
                    />
                  ))}
                </div>
              </div>
              <div className="demo-panel">
                <h3>Strips with sparklines — the board-row pairing</h3>
                <div className="demo-board">
                  {feed.stations.map((station) => (
                    <div className="demo-board-row" key={station.id}>
                      <StationStrip stationId={station.id} />
                      <Sparkline stationId={station.id} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="demo-panel demo-panel-compact">
                <h3>The bare dial, two sizes — same 160-unit drawing</h3>
                <div className="demo-dials">
                  <Dial size={120} stationId="launch-ridge" />
                  <Dial size={200} stationId="launch-ridge" />
                </div>
              </div>
            </div>
          </section>
        </StationFeedProvider>

        {/* Outside the provider on purpose: everything arrives as explicit
         * props, proving the provider is an ambient default, not a
         * requirement. */}
        <section className="demo-section" id="explicit">
          <SectionHead id="explicit" />
          <div className="demo-grid demo-grid-instruments">
            <CurrentConditions
              receivedAtMs={receivedAtMs}
              servedAt={feed.servedAt}
              station={summitLogger}
              thresholds={THRESHOLDS}
              unit={unit}
            />
          </div>
        </section>
      </main>
      </>
      )}

      {view === "docs" && (
        <Suspense fallback={<div className="demo-docs-loading" />}>
          <DocsView onNavigate={openDocs} page={docPage} />
        </Suspense>
      )}

      <footer className="demo-footer">
        <p>
          Every pixel above is drawn by the library — the fixtures are the only
          thing this page fakes.
        </p>
        <a href="https://github.com/azohra/meteo">github.com/azohra/meteo</a>
      </footer>
    </div>
  );
}
