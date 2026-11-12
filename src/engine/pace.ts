// pace.ts — TSS à l'allure, pour la course (rTSS) et la natation (sTSS).
//   IF = vitesse moyenne / vitesse au seuil
//   course   : heures × IF² × 100
//   natation : heures × IF³ × 100 (la résistance de l'eau croît plus vite que celle de l'air)
import type { LoadWarning, Sport } from '../domain/index.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { fail, inRange, ok, type Outcome } from './outcome.ts';
import { thresholdLooksOutdated } from './power.ts';

const SPEED = {
  run: { exponent: 2, maxMps: 8, thresholdMin: 1.5, thresholdMax: 7 },
  swim: { exponent: 3, maxMps: 2.6, thresholdMin: 0.4, thresholdMax: 2.2 },
} as const;
export const paceExponent = (sport: Sport | 'rest'): 2 | 3 => (sport === 'swim' ? 3 : 2);

export interface PaceTss { tss: number; intensityFactor: number; speedMps: number }

export function paceTss(
  input: { sport: Sport; distanceM: number | undefined; movingS: number; thresholdSpeedMps: number | undefined; elevationGainM?: number },
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<PaceTss> {
  if (input.sport !== 'run' && input.sport !== 'swim') return fail('unsupported_sport');
  const limits = SPEED[input.sport];
  if (input.thresholdSpeedMps === undefined) return fail('missing_threshold');
  if (!inRange(input.thresholdSpeedMps, limits.thresholdMin, limits.thresholdMax)) return fail('invalid_threshold');
  if (!inRange(input.movingS, 1, cfg.maxSessionS)) return fail('invalid_duration');
  if (input.distanceM === undefined) return fail('missing_data');
  if (!inRange(input.distanceM, 1, 1_000_000)) return fail('implausible_value');

  const speedMps = input.distanceM / input.movingS;
  if (speedMps > limits.maxMps) return fail('implausible_value');

  const intensityFactor = speedMps / input.thresholdSpeedMps;
  const tss = (input.movingS / 3600) * intensityFactor ** limits.exponent * 100;

  // Calcul sur la moyenne : correct pour une sortie régulière, sous-estime le fractionné.
  const warnings: LoadWarning[] = ['summary_only'];
  const hilly = input.sport === 'run' && (input.elevationGainM ?? 0) / input.distanceM > 0.03;
  if (hilly) warnings.push('elevation_ignored');
  if (thresholdLooksOutdated(intensityFactor, input.movingS)) warnings.push('threshold_maybe_outdated');
  return ok({ tss, intensityFactor, speedMps }, hilly ? 'low' : 'medium', warnings);
}

/**
 * Vitesse au seuil (tenable une heure) estimée depuis un chrono de course, par la loi de Riegel
 * (temps ∝ distance^1,06). Valable pour un effort de 10 min à 2 h 30 ; null en dehors.
 */
export function thresholdSpeedFromRace(distanceM: number, timeS: number): number | null {
  if (!inRange(distanceM, 1000, 50_000) || !inRange(timeS, 600, 9000)) return null;
  const distanceInOneHour = distanceM * (3600 / timeS) ** (1 / 1.06);
  return distanceInOneHour / 3600;
}
