/* A fake, long-range station history — generated, never fetched, and never
 * a real station's data. Built for exactly the two things a six-hour demo
 * can't show: a WindRose filtered by month/season and time-of-day, and a
 * DailyPattern "typical day". Both examples/demo and
 * scripts/generate-readme-assets.mjs import this one generator, so the
 * story a season's rose tells and the story a typical day tells are the
 * same station, not two hand-tuned coincidences.
 *
 * Shape of the year: calm before sunrise, a thermic SW build through the
 * afternoon, calming by dusk — strongest and most SW-consistent in summer,
 * weaker and more scattered the rest of the year, with an occasional
 * dropout so the honesty machinery (hatched gaps, "no history") has
 * something real to draw. Plain ESM, no framework or build-step
 * dependency, so a raw `node` script and a Vite app can both import it
 * unchanged. */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Deterministic PRNG (mulberry32) — same algorithm the README asset
 * generator already uses, reseeded here so this module has no import of
 * its own. */
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

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const mps = (kmh) => round2(kmh / 3.6);
const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/** A day-of-year in [0, 1), 0 at the winter solstice — so "summer" is the
 * plateau centred on 0.5 regardless of which calendar year a sample falls
 * in, the same "merge every year" convention filterByMonth/dailyPattern
 * already use. */
function seasonPhase(dateUtc) {
  const solsticeMs = Date.UTC(dateUtc.getUTCFullYear(), 11, 21);
  const anchored = dateUtc.getTime() >= solsticeMs ? solsticeMs : Date.UTC(dateUtc.getUTCFullYear() - 1, 11, 21);
  return ((dateUtc.getTime() - anchored) / (365.25 * DAY_MS)) % 1;
}

/**
 * @param {object} options
 * @param {number} options.nowMs - the series ends here.
 * @param {number} [options.days] - how many days of history to build.
 * @param {number} [options.periodMinutes] - sample cadence.
 * @param {number} [options.seed]
 * @param {boolean} [options.withGaps] - punch a few honest dropouts in.
 * @returns {Array<{observedAt: string, averageMps: number, gustMps: number, lullMps: number, directionDeg: number|null, temperatureC: number}>}
 */
export function buildLongHistory({
  nowMs,
  days = 420,
  periodMinutes = 15,
  seed = 0x5eed_1e5,
  withGaps = true,
}) {
  const rand = mulberry32(seed);
  const wobble = (s) => (Math.sin(s * 12.9898) + Math.sin(s * 4.1414 + 1.3)) / 2;
  const totalSamples = Math.round((days * DAY_MS) / (periodMinutes * MINUTE_MS));
  const anchorMs = Math.floor(nowMs / (periodMinutes * MINUTE_MS)) * periodMinutes * MINUTE_MS;
  /* A handful of multi-hour dropouts, placed by the same seeded stream so a
   * regeneration is byte-stable. */
  const gapStartIndexes = withGaps
    ? Array.from({ length: 6 }, () => Math.floor(rand() * (totalSamples - 40)) + 20)
    : [];
  const gapLengthSamples = Math.max(2, Math.round((3 * 60) / periodMinutes));

  const points = [];
  for (let index = 0; index < totalSamples; index += 1) {
    const sampleMs = anchorMs - (totalSamples - 1 - index) * periodMinutes * MINUTE_MS;
    if (gapStartIndexes.some((start) => index >= start && index < start + gapLengthSamples)) continue;

    const date = new Date(sampleMs);
    const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
    const dayFraction = minuteOfDay / 1440;
    /* Thermic build peaking mid-afternoon, calm overnight — the same
     * envelope shape launchRidgeHistory (examples/demo's six-hour fixture)
     * uses, stretched across a whole day instead of a six-hour window. */
    const diurnal = smooth((dayFraction - 0.32) / 0.24) * (1 - smooth((dayFraction - 0.72) / 0.22));

    /* Summer is strong and SW-consistent; the shoulder seasons and winter
     * are weaker and more scattered — the "Season" picker has something
     * real to show. */
    const season = seasonPhase(date);
    const summerWeight = smooth(1 - Math.abs(season - 0.5) * 2.4);
    const strength = 0.35 + 0.9 * summerWeight;
    const scatter = 60 - 34 * summerWeight;

    const noise = wobble(index * 0.7) * 0.5 + wobble(index * 3.1 + 11) * 0.5;
    const average = Math.max(0, round1(diurnal * strength * (16 + noise * 6)));
    const calm = average < 0.5;
    const gust = calm ? 0 : mps(average * 1.3 + 2 + Math.abs(noise) * 4);
    const lull = calm ? 0 : mps(Math.max(0, average * 0.6 - 1));
    const bearing = calm ? null : round1(normalizeDeg(225 + noise * scatter));

    /* A gentle seasonal temperature curve, purely for TrendChart-adjacent
     * demos; not the point of this generator but free to carry along. */
    const temperature = round1(8 + 14 * summerWeight + 6 * smooth((dayFraction - 0.3) / 0.4) + wobble(index * 5) * 1.5);

    points.push({
      observedAt: new Date(sampleMs).toISOString(),
      averageMps: mps(average),
      gustMps: gust,
      lullMps: lull,
      directionDeg: bearing,
      temperatureC: temperature,
    });
  }
  return points;
}
