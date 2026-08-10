"use client";
/* One URL convention for every hook: the argument is the MOUNT BASE — where
 * createStationFeedHandler is mounted, e.g. "/api/wind" — and each hook
 * builds its own route from it (`/feed`, `/current?station=`), mirroring the
 * handler's pathname-suffix routing. Nobody passes a full endpoint. */

const trimBase = (base: string) => base.replace(/\/+$/, "");

export function feedEndpoint(base: string): string {
  return `${trimBase(base)}/feed`;
}

export function currentEndpoint(base: string, stationId: string): string {
  return `${trimBase(base)}/current?station=${encodeURIComponent(stationId)}`;
}
