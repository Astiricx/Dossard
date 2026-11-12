// outcome.ts — le moteur ne lève jamais d'exception : chaque calcul renvoie un résultat explicite.
import type { LoadQuality, LoadWarning } from '../domain/index.ts';

export type FailureReason =
  | 'missing_threshold'     // FTP, FC max ou vitesse seuil non renseignée
  | 'invalid_threshold'     // seuil hors des bornes physiologiques
  | 'missing_data'          // aucune donnée exploitable
  | 'insufficient_data'     // trop de trous pour un résultat fiable
  | 'invalid_duration'
  | 'invalid_rpe'
  | 'implausible_value'     // valeur physiquement impossible (GPS resté allumé en voiture…)
  | 'unsupported_sport';

export type Outcome<T> =
  | { ok: true; value: T; quality: LoadQuality; warnings: LoadWarning[] }
  | { ok: false; reason: FailureReason };

export const ok = <T>(value: T, quality: LoadQuality, warnings: LoadWarning[] = []): Outcome<T> =>
  ({ ok: true, value, quality, warnings: [...new Set(warnings)] });
export const fail = (reason: FailureReason): Outcome<never> => ({ ok: false, reason });

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const inRange = (v: unknown, min: number, max: number): v is number => isFiniteNumber(v) && v >= min && v <= max;
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const round1 = (v: number): number => Math.round(v * 10) / 10;
