"use client";
/* Tiny inline dart pointing where the wind goes — the flow (TO) convention —
 * flipped from the FROM bearing every feed reports. Decorative: callers print
 * the FROM bearing in text beside it. No icon library; the dart rests
 * pointing north so the rotation is exactly deg + 180. */
export function WindArrow({ deg, size = 12 }: { deg: number; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="meteo-wind-arrow"
      height={size}
      style={{ transform: `rotate(${deg + 180}deg)` }}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 1 L13 14 L8 10.6 L3 14 Z" fill="currentColor" />
    </svg>
  );
}
