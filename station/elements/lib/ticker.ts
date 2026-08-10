/* One shared 30-second interval, many subscribers: freshness badges and
 * ticking relative ages re-judge on FRESHNESS_REEVALUATE_MS (the cadence
 * every binding shares), and a page of forty table rows should wake one
 * timer, not forty. The interval exists only while someone listens. */
import { FRESHNESS_REEVALUATE_MS } from "../../client/index.js";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeTicker(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const entry of [...listeners]) entry();
  }, FRESHNESS_REEVALUATE_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
