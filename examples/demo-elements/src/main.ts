/* The whole wiring of the elements demo: register the tags, hand the
 * provider a synthetic feed, and let the markup in index.html render
 * itself. The toggles show the two levers a page pulls at runtime — a
 * display unit change is one attribute, a live feed is one property set. */
import "@azohra/meteo/station/elements/register";
import "@azohra/meteo/station/styles.css";
import "./demo.css";
import type { StationFeedElement, StationTableElement } from "@azohra/meteo/station/elements";
import type { Station } from "@azohra/meteo/station";
import { buildDemoFeed } from "./fixtures.js";

const feed = document.querySelector("#feed") as StationFeedElement;
const table = document.querySelector("#table") as StationTableElement;
const chip = document.querySelector("#chip") as HTMLElement & { labels?: readonly string[] };
const simulate = document.querySelector("#simulate") as HTMLInputElement;
const knots = document.querySelector("#knots") as HTMLInputElement;

/* Rich values ride properties; scalars ride attributes. */
const publish = () => {
  feed.feed = buildDemoFeed(Date.now());
  feed.receivedAtMs = Date.now();
};
publish();

/* The table's sub-label render prop: the station's own sampling window. */
table.stationMeta = (station: Station) =>
  station.status === "ok" ? `past ${station.samplingWindowSeconds} s` : station.sourceLabel;

/* Band words are the consumer's vocabulary. */
chip.labels = ["light", "soarable", "strong", "nuking"];

let timer: ReturnType<typeof setInterval> | undefined;
simulate.addEventListener("change", () => {
  if (simulate.checked) {
    timer = setInterval(publish, 2_000);
  } else {
    clearInterval(timer);
  }
});

knots.addEventListener("change", () => {
  if (knots.checked) feed.setAttribute("unit", "knots");
  else feed.removeAttribute("unit");
});
