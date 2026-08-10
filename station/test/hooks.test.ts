// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCurrent, useStation, useStationFeed } from "../react/index.js";
import {
  BASE_MS,
  conditionsFixture,
  downStation,
  feedFixture,
  iso,
  okStation,
} from "./fixtures.js";

const jsonResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  text: async () => body,
});

/* A request that never resolves on its own but honours its abort signal —
 * the stalled-upstream shape the poll loop must survive. */
const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );

const signalOfCall = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
  (fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.signal;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useStationFeed", () => {
  it("builds /feed off the mount base, loads immediately, keeps the last feed on errors", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);

    /* A day-long cadence so the poll timer never interferes with the test. */
    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", { pollSeconds: 86_400 }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.receivedAtMs).not.toBeNull();
    expect(result.current.feed?.stations.length).toBe(2);
    /* The hook owns the route: the mount base grew the /feed suffix. */
    expect(fetchMock).toHaveBeenCalledWith(
      "/wind/feed",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    /* A thrown fetch is a network error with no status to report. */
    fetchMock.mockRejectedValue(new Error("down"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toEqual({ kind: "network" }));
    expect(result.current.feed?.stations.length).toBe(2);

    /* Valid JSON, wrong shape: contract, with the zod issues threaded in. */
    fetchMock.mockResolvedValue(jsonResponse('{"not":"a feed"}'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.kind).toBe("contract"));
    expect(result.current.error?.kind === "contract" && result.current.error.cause).toHaveProperty(
      "issues",
    );
    expect(result.current.feed?.stations.length).toBe(2);
    unmount();
  });

  it("carries the HTTP status on a non-ok response and the syntax error on unparseable JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("upstream broke", false));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", { pollSeconds: 86_400 }),
    );
    await waitFor(() => expect(result.current.error).toEqual({ kind: "network", status: 500 }));

    fetchMock.mockResolvedValue(jsonResponse("not json at all"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.kind).toBe("contract"));
    expect(
      result.current.error?.kind === "contract" && result.current.error.cause,
    ).toBeInstanceOf(SyntaxError);
    unmount();
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useStationFeed("/wind", { enabled: false }));
    expect(result.current.feed).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("aborts the in-flight request on unmount", () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useStationFeed("/wind", { pollSeconds: 86_400 }));
    const signal = signalOfCall(fetchMock, 0);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("on url change: aborts the stalled request and fetches the new url unsuppressed", async () => {
    const feedBody = JSON.stringify(feedFixture([okStation()]));
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/a/feed") {
        return new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(jsonResponse(feedBody));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ url }) => useStationFeed(url, { pollSeconds: 86_400 }),
      { initialProps: { url: "/a" } },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ url: "/b" });
    expect(signalOfCall(fetchMock, 0)?.aborted).toBe(true);
    /* The aborted predecessor must not suppress the new url's first fetch. */
    await waitFor(() => expect(result.current.feed?.stations.length).toBe(1));
    expect(fetchMock).toHaveBeenLastCalledWith("/b/feed", expect.anything());
    unmount();
  });

  it("on url change: drops the old url's data instead of serving it under the new address", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/a/feed") return Promise.resolve(jsonResponse(feedBody));
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ url }) => useStationFeed(url, { pollSeconds: 86_400 }),
      { initialProps: { url: "/a" } },
    );
    await waitFor(() => expect(result.current.feed?.stations.length).toBe(2));
    rerender({ url: "/b" });
    expect(result.current.feed).toBeNull();
    expect(result.current.receivedAtMs).toBeNull();
    unmount();
  });

  it("schedules the first interval from the first response's advised cadence", async () => {
    vi.useFakeTimers();
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useStationFeed("/wind"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* The fixture stations advise 30 s and 60 s — the first interval must be
     * min(advised) = 30 s, never the 60 s pre-data default. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("paints seeded initialData before any fetch resolves, and still fires the first poll", async () => {
    const seeded = feedFixture();
    /* A fetch that never resolves: whatever renders came from the seed. */
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", {
        pollSeconds: 86_400,
        initialData: { feed: seeded, receivedAtMs: BASE_MS + 30_000 },
      }),
    );
    expect(result.current.feed?.stations.length).toBe(2);
    expect(result.current.receivedAtMs).toBe(BASE_MS + 30_000);
    /* A seed is a starting point, never a substitute for refreshing. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("merges fetchInit into the poll fetch, but its own abort signal wins", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);
    const consumerController = new AbortController();

    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", {
        pollSeconds: 86_400,
        fetchInit: {
          cache: "no-store",
          headers: { authorization: "Bearer demo" },
          signal: consumerController.signal,
        },
      }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/wind/feed",
      expect.objectContaining({
        cache: "no-store",
        headers: { authorization: "Bearer demo" },
      }),
    );
    /* The consumer's (never-aborted) signal was overridden by the loop's:
     * unmounting aborts the request the fetch actually carried. */
    const carried = signalOfCall(fetchMock, 0);
    expect(carried).not.toBe(consumerController.signal);
    unmount();
  });

  it("abandons a stalled request at the deadline and keeps polling", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useStationFeed("/wind"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(signalOfCall(fetchMock, 0)?.aborted).toBe(true);
    expect(result.current.error).toEqual({ kind: "network" });
    /* The in-flight flag released: the next tick (60 s pre-data default)
     * fetches again instead of the loop staying parked forever. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe("useStation", () => {
  const currentBody = (station: unknown, servedAtMs: number) =>
    JSON.stringify({ schemaVersion: 1, servedAt: iso(servedAtMs), station });

  it("polls both routes off one mount base, merges current into the feed, applies the clock rule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
    const feedBody = JSON.stringify(feedFixture());
    /* First current says unavailable (nothing merges); after 30 s the
     * station comes back with a fresh reading. */
    let current = currentBody({ ...downStation(), id: "test-station" }, BASE_MS + 1_000);
    const fetchMock = vi.fn((url: string) => {
      if (url === "/wind/feed") return Promise.resolve(jsonResponse(feedBody));
      if (url === "/wind/current?station=test-station") {
        return Promise.resolve(jsonResponse(current));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      useStation("/wind", "test-station", { pollSeconds: 86_400, currentPollSeconds: 30 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    /* Both routes grew off the same base. */
    expect(fetchMock).toHaveBeenCalledWith("/wind/feed", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(
      "/wind/current?station=test-station",
      expect.anything(),
    );
    /* merged:false — the unavailable current must not erase the feed's
     * reading, and the clock stays the FEED's receivedAtMs. */
    expect(result.current.station?.status).toBe("ok");
    expect(result.current.station?.reading?.averageMps).toBeCloseTo(18.4 / 3.6);
    expect(result.current.receivedAtMs).toBe(BASE_MS);
    expect(result.current.error).toBeNull();

    /* The current endpoint recovers on its next tick: the reading advances,
     * the history stays the feed's, and the clock is the CURRENT response's. */
    current = currentBody(
      {
        ...okStation(),
        reading: { ...okStation().reading, observedAt: iso(BASE_MS + 30_000), averageMps: 9.9 },
        history: null,
      },
      BASE_MS + 30_000,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_100);
    });
    expect(result.current.station?.reading?.averageMps).toBe(9.9);
    expect(result.current.feed?.stations[0]?.history?.points.length).toBe(12);
    /* The current response's clock, not the feed's BASE_MS. */
    expect(result.current.receivedAtMs).toBeGreaterThanOrEqual(BASE_MS + 30_000);
    unmount();
  });

  it("refresh refreshes both endpoints", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const okCurrent = currentBody({ ...okStation(), history: null }, BASE_MS + 1_000);
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(jsonResponse(url === "/wind/feed" ? feedBody : okCurrent)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() =>
      useStation("/wind", "test-station", { pollSeconds: 86_400, currentPollSeconds: 86_400 }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    const callsBefore = fetchMock.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsBefore + 2));
    unmount();
  });
});

describe("mergeCurrent", () => {
  it("replaces the matching station's reading, keeps its history, reports merged", () => {
    const feed = feedFixture();
    const newReading = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      averageMps: 33.3,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: newReading, history: null },
    });
    expect(result.merged).toBe(true);
    const station = result.feed.stations[0];
    expect(station?.status).toBe("ok");
    expect(station?.reading?.averageMps).toBe(33.3);
    expect(station?.history?.points.length).toBe(12);
    expect(result.feed.servedAt).toBe(iso(BASE_MS + 61_000));
    /* Other stations untouched. */
    expect(result.feed.stations[1]).toBe(feed.stations[1]);
  });

  it("preserves prior temperature, wind chill, and conditions over structural nulls", () => {
    const prior = okStation({
      reading: {
        ...okStation().reading,
        temperatureC: 14.2,
        windChillC: 10.1,
        conditions: conditionsFixture(),
      },
    });
    const feed = feedFixture([prior, downStation()]);
    /* The light endpoint's shape: fresh wind, nulled extras. */
    const light = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      averageMps: 27.5,
      directionDeg: 200,
      gustMps: 31,
      lullMps: 22,
      temperatureC: null,
      windChillC: null,
      conditions: null,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: light, history: null },
    });
    expect(result.merged).toBe(true);
    const reading = result.feed.stations[0]?.reading;
    /* Wind fields are what the endpoint refreshes: always current's. */
    expect(reading?.averageMps).toBe(27.5);
    expect(reading?.directionDeg).toBe(200);
    expect(reading?.observedAt).toBe(iso(BASE_MS + 60_000));
    /* Structurally omitted fields keep the feed's prior values: the sensor
     * did not go dark, the endpoint just does not carry them. */
    expect(reading?.temperatureC).toBe(14.2);
    expect(reading?.windChillC).toBe(10.1);
    expect(reading?.conditions?.relativeHumidityPercent).toBe(64);
    expect(reading?.conditions?.uvIndex).toBe(6.1);
  });

  it("lets a non-null current value win over the preserved prior", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: {
        ...okStation(),
        reading: { ...okStation().reading, temperatureC: -3.5 },
        history: null,
      },
    });
    expect(result.merged).toBe(true);
    expect(result.feed.stations[0]?.reading?.temperatureC).toBe(-3.5);
  });

  it("reports merged:false and keeps the feed when the current response is unavailable", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...downStation(), id: "test-station" },
    });
    /* merged:false tells the caller to keep the PREVIOUS receivedAtMs — the
     * feed did not advance, so its age must not reset. */
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });

  it("reports merged:false when the current names a station absent from the feed", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 1,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), id: "not-in-feed" },
    });
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });
});
