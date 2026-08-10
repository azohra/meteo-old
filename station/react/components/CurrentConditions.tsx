"use client";
/* The instrument: the compass dial (the <Dial> atom — face, ring, ticks,
 * needle, speed arc, centred speed), flanked by lull and gust readouts, with
 * a direction row, a temperature row, and a freshness footer.
 *
 * Fixed geometry throughout: the dial, flanks, and text rows exist whatever
 * the reading says, so a refresh tick can never twitch layout. A value the
 * station cannot report is an em dash in place; a capability the station
 * lacks omits its row entirely. Calm (WMO: below 0.5 m/s) hides the needle
 * and says so in words while the measured speed stays in the hub — a vane's
 * idle bearing would fabricate a direction, but the anemometer did measure.
 * A blowing reading with no bearing is a broken vane and earns the dash.
 * Unavailable greys the dial and wears the reason in words. */
import { compassDirection, isCalm, resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { roundSpeed, temperatureText, temperatureValue } from "../../index.js";
import { EM_DASH } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { Dial } from "./Dial.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

export function CurrentConditions({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Freshness inputs; absent everywhere (no prop, no provider feed) the
   * badge is simply withheld — null never fabricates a status. */
  servedAt?: string | null;
  receivedAtMs?: number | null;
  /* Consumer-unit bounds ({ unit, values }); converted to wire m/s once. The
   * speed arc wears meteo-band-0..n of the current reading when given, the
   * neutral accent otherwise. null opts out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Display unit only: every shown speed converts, banding and geometry stay
   * in wire m/s. */
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "CurrentConditions",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs = receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, strings, thresholds, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const reading = station.status === "ok" ? station.reading : null;
  const status = useFreshness(
    reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  const calm = reading != null && isCalm(reading.averageMps);
  const blowing = reading != null && !calm && reading.directionDeg != null;

  return (
    <div
      aria-label={words.aria.current(station.name)}
      className="meteo-current"
      data-status={station.status}
      role="group"
    >
      <div className="meteo-current-instrument">
        {station.capabilities.gustLull && (
          <div className="meteo-current-flank meteo-current-flank-lull">
            <small className="meteo-microlabel">{words.lullLabel}</small>
            <strong>{reading?.lullMps == null ? EM_DASH : roundSpeed(reading.lullMps, unit)}</strong>
          </div>
        )}
        {/* Everything already resolved above threads through explicitly:
         * the station as a prop, thresholds with undefined collapsed to null
         * so a consumer's opt-out survives (the Dial would otherwise re-read
         * the provider), and calmWord off — the direction row below is this
         * component's place to say calm. */}
        <Dial
          calmWord={false}
          station={station}
          strings={strings}
          thresholds={thresholds ?? null}
          unit={unit}
        />
        {station.capabilities.gustLull && (
          <div className="meteo-current-flank meteo-current-flank-gust">
            <small className="meteo-microlabel">{words.gustLabel}</small>
            <strong>{reading?.gustMps == null ? EM_DASH : roundSpeed(reading.gustMps, unit)}</strong>
          </div>
        )}
      </div>
      <p className="meteo-current-direction">
        {station.status === "unavailable" ? (
          words.reasons[station.reason]
        ) : blowing && reading.directionDeg != null ? (
          <>
            <span className="meteo-current-from-label">{words.fromLabel}</span>{" "}
            <WindArrow deg={reading.directionDeg} />{" "}
            <strong>{compassDirection(reading.directionDeg)}</strong>{" "}
            {Math.round(reading.directionDeg)}°
          </>
        ) : calm ? (
          words.calm
        ) : (
          EM_DASH
        )}
      </p>
      {station.capabilities.temperature && (
        <p className="meteo-current-temp">
          {temperatureText(reading?.temperatureC ?? null, words)}
          {reading?.windChillC != null && (
            <span className="meteo-current-chill">
              {" "}· {words.feelsLikeLabel} {temperatureValue(reading.windChillC)} {words.degC}
            </span>
          )}
        </p>
      )}
      <p className="meteo-current-footer">
        {status != null && <FreshnessBadge status={status} strings={strings} />}
        <span className="meteo-current-observed">
          {reading == null ? EM_DASH : formatTime(new Date(reading.observedAt))}
        </span>
      </p>
    </div>
  );
}
