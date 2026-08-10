/* Attribute parsing for the elements binding: scalars, and the thresholds
 * grammar that keeps the load-bearing undefined/null distinction expressible
 * in markup (see docs/client-data.md#display-resolution):
 *
 *   attribute absent            → undefined  (inherit the ambient thresholds)
 *   thresholds="none"           → null       (explicitly opt out)
 *   thresholds='{"unit":"kmh","values":[12,20,28]}' → the value
 *
 * Invalid JSON or an invalid shape warns and reads as absent — a malformed
 * attribute must degrade to the ambient default, never crash a page. */
import { SPEED_UNITS } from "../../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../../derive.js";

export function numberAttribute(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function unitAttribute(value: string | null): SpeedUnit | undefined {
  return value != null && (SPEED_UNITS as readonly string[]).includes(value)
    ? (value as SpeedUnit)
    : undefined;
}

export function parseThresholdsAttribute(
  value: string | null,
): SpeedThresholds | null | undefined {
  if (value == null) return undefined;
  if (value.trim() === "none") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      (SPEED_UNITS as readonly string[]).includes((parsed as { unit?: unknown }).unit as string) &&
      Array.isArray((parsed as { values?: unknown }).values) &&
      ((parsed as { values: unknown[] }).values as unknown[]).every(
        (bound) => typeof bound === "number" && Number.isFinite(bound),
      )
    ) {
      return parsed as SpeedThresholds;
    }
  } catch {
    /* fall through to the warning */
  }
  console.warn(
    `meteo: invalid thresholds attribute ${JSON.stringify(value)} — expected ` +
      `'{"unit":"kmh","values":[12,20,28]}' or "none"; treating as absent.`,
  );
  return undefined;
}
