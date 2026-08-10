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
import { useEffect, useMemo, useState } from "react";
import { speedUnitLabel } from "@azohra/meteo/station";
import type { SpeedThresholds, SpeedUnit } from "@azohra/meteo/station";
import {
  AirMatrix,
  BandChip,
  CurrentConditions,
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
import { buildDemoFeed } from "./fixtures";

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
    note: "The same six hours with the club's thresholds banding the trace, and with thresholds={null} opting out into the neutral accent.",
  },
  {
    id: "roses",
    title: "Wind roses",
    nav: "Roses",
    note: "Launch Ridge wears its 260°–340° launch window as a judgment ring; the petals keep reporting distribution.",
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

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 2_000);
    return () => window.clearInterval(timer);
  }, [live]);

  const feed = useMemo(() => buildDemoFeed(nowMs), [nowMs]);
  /* The fixture is "served" the instant it is built. */
  const receivedAtMs = nowMs;
  const summitLogger = feed.stations[1];
  if (!summitLogger) return null;

  return (
    <div
      className="meteo-root demo-page"
      data-theme={theme === "system" ? undefined : theme}
    >
      <header className="demo-header">
        <div className="demo-header-bar">
          <span className="demo-wordmark">
            azohra meteo <span className="demo-wordmark-sub">· station demo</span>
          </span>
          <div className="demo-controls">
            <div aria-label="Display unit" className="demo-segmented" role="group">
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
            <div aria-label="Theme" className="demo-segmented" role="group">
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
          </div>
        </div>
        <nav aria-label="Sections" className="demo-nav">
          {SECTIONS.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.nav}
            </a>
          ))}
        </nav>
      </header>

      <main className="demo-main">
        <StationFeedProvider
          feed={feed}
          receivedAtMs={receivedAtMs}
          thresholds={THRESHOLDS}
          unit={unit}
        >
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
              <div className="demo-panel">
                <h3>Atoms in a sentence — the feed's primary station</h3>
                <p className="demo-sentence">
                  <Speed /> <Direction />, gusting <Gust />, <UpdatedAt />
                </p>
              </div>
              <div className="demo-panel">
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
              <div className="demo-panel">
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
