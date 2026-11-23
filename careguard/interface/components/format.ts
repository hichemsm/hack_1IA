"use client";

import { useEffect, useState } from "react";

export const eur = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export const tusd = (units: string | null) =>
  units === null
    ? "—"
    : `${(Number(units) / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} tUSD8`;

/** Fait défiler un nombre jusqu'à sa valeur (désactivé si l'utilisateur limite les animations) */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer-test.qday.info";
