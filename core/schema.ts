/* Shared zod building blocks for capability configuration (see
 * core/environment.ts for the core/ sharing convention). These validate what
 * an integrator writes down — claims about hardware and its installation —
 * never wire documents. */
import { z } from "zod";

export const ianaTimeZone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "not an IANA time zone" },
);

export const httpUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "not an http(s) URL" },
);

/* Position claim fields shared by capability configs. Nullish on purpose:
 * integrator config usually comes from database rows, where "we don't know"
 * is null — forcing callers to launder null into undefined would fail the
 * station contract's own rule that absence is null. */
export const positionFields = {
  elevationM: z.number().finite().nullish(),
  latitude: z.number().finite().min(-90).max(90).nullish(),
  longitude: z.number().finite().min(-180).lt(180).nullish(),
};
