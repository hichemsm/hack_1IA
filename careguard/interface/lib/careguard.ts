import { createCareGuard } from "@careguard/bridge";

// Une seule instance par serveur : les clés des agents ne quittent jamais le serveur.
let instance: ReturnType<typeof createCareGuard> | undefined;

export function careguard() {
  instance ??= createCareGuard();
  return instance;
}

/** JSON.stringify qui sait sérialiser les bigint (montants tUSD8, identifiants) */
export const toJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
