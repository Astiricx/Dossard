// foster.ts — charge subjective (Foster) : RPE de séance × durée en minutes, en unités arbitraires.
//   monotonie = moyenne des charges quotidiennes de la semaine / leur écart-type
//   contrainte (strain) = charge de la semaine × monotonie
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { fail, inRange, isFiniteNumber, ok, type Outcome } from './outcome.ts';

export function sessionRpe(
  input: { rpe: number | undefined; durationS: number },
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<number> {
  if (input.rpe === undefined) return fail('missing_data');
  if (!inRange(input.rpe, 0, 10)) return fail('invalid_rpe');               // échelle CR-10, 0 = repos
  if (!inRange(input.durationS, 1, cfg.maxSessionS)) return fail('invalid_duration');
  return ok(input.rpe * (input.durationS / 60), 'high');
}

/** Charge horaire équivalente (échelle TSS) pour un RPE donné, interpolée dans la table de config. */
export function rpeTssPerHour(rpe: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  const table = cfg.rpeTssPerHour;
  const first = table[0] ?? 0;
  if (!isFiniteNumber(rpe) || rpe <= 0) return 0;
  if (rpe <= 1) return first * rpe;
  const position = Math.min(rpe, table.length) - 1;
  const low = Math.floor(position);
  const a = table[low] ?? first;
  const b = table[Math.min(low + 1, table.length - 1)] ?? a;
  return a + (b - a) * (position - low);
}

export interface FosterWeek {
  load: number;
  /** null quand l'écart-type est nul (semaine vide ou jours tous identiques) : l'indice n'est pas défini. */
  monotony: number | null;
  strain: number | null;
}

/**
 * `dailyLoads` : une valeur par jour, jours de repos inclus à 0 (c'est eux qui font baisser la monotonie).
 * Convention retenue : écart-type d'échantillon (n − 1). Une monotonie supérieure à 2 est le seuil
 * d'alerte habituellement cité.
 */
export function fosterWeek(dailyLoads: readonly number[]): FosterWeek {
  const days = dailyLoads.map((v) => (isFiniteNumber(v) && v > 0 ? v : 0));
  const load = days.reduce((a, b) => a + b, 0);
  if (days.length < 2) return { load, monotony: null, strain: null };
  const mean = load / days.length;
  const sd = Math.sqrt(days.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (days.length - 1));
  if (sd < 1e-9) return { load, monotony: null, strain: null };
  const monotony = mean / sd;
  return { load, monotony, strain: load * monotony };
}
