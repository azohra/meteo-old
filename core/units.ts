/* Adapter-facing unit helpers (see core/environment.ts for the core/ sharing
 * convention). The wire is SI — wind speeds travel as m/s — so conversion
 * happens exactly once, at the vendor boundary, and plausibility for the wire
 * unit is defined exactly once, here. */

/* The one definition of the km/h↔m/s ratio; station/derive re-exports it for
 * display math. */
export const KMH_PER_MPS = 3.6;

/* Vendor km/h → wire m/s, at Reading/HistoryPoint construction — after the
 * adapter has bounds-checked the value in the vendor's own unit. */
export function kmhToMps(value: number): number {
  return value / KMH_PER_MPS;
}

/* Wire-unit plausibility, defined once: a wind speed outside 0–140 m/s is a
 * broken instrument, and degrading one station beats nulling the whole
 * document. For upstreams that already speak m/s this is the whole check;
 * km/h upstreams bounds-check in km/h before converting instead. */
export function plausibleWindMps(value: number, subject: string): number {
  if (value < 0 || value > 140) {
    throw new Error(`${subject} returned an invalid wind speed`);
  }
  return value;
}
