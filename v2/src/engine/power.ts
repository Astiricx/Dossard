// power.ts — puissance normalisée, facteur d'intensité et TSS (Coggan).
//   NP  = racine quatrième de la moyenne des (moyennes glissantes sur 30 s) élevées à la puissance 4
//   IF  = NP / FTP
//   TSS = (durée en s × NP × IF) / (FTP × 3600) × 100, soit heures × IF² × 100
import type { LoadWarning, Stream } from '../domain/index.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { fail, inRange, ok, type Outcome } from './outcome.ts';
import { cleanSeries } from './series.ts';

const WINDOW_S = 30;
const FTP_BOUNDS = { min: 30, max: 600 } as const;

export interface PowerTss {
  tss: number;
  normalizedPowerW: number;
  intensityFactor: number;
  avgPowerW: number;
  variabilityIndex: number;   // NP / moyenne : 1,00 = effort parfaitement régulier
  timerS: number;
}

/** Série à 1 Hz. Un échantillon manquant (NaN) compte pour 0 W. null si moins de 30 s. */
export function normalizedPower(samples: ArrayLike<number>): number | null {
  const n = samples.length;
  if (n < WINDOW_S) return null;
  const at = (i: number): number => { const v = samples[i]!; return Number.isNaN(v) ? 0 : v; };
  let windowSum = 0;
  let fourthPowers = 0;
  for (let i = 0; i < n; i++) {
    windowSum += at(i);
    if (i >= WINDOW_S) windowSum -= at(i - WINDOW_S);
    if (i >= WINDOW_S - 1) fourthPowers += Math.max(0, windowSum / WINDOW_S) ** 4;
  }
  return (fourthPowers / (n - WINDOW_S + 1)) ** 0.25;
}

function checkFtp(ftpW: number | undefined): 'missing_threshold' | 'invalid_threshold' | null {
  if (ftpW === undefined || ftpW === null) return 'missing_threshold';
  return inRange(ftpW, FTP_BOUNDS.min, FTP_BOUNDS.max) ? null : 'invalid_threshold';
}

/** Par définition, on ne tient pas plus de ~105 % de son seuil pendant une heure. */
export const thresholdLooksOutdated = (intensityFactor: number, durationS: number): boolean =>
  intensityFactor > 1.05 && durationS >= 3600;

export function powerTss(
  input: { powerW: Stream; timeS?: readonly number[]; ftpW: number | undefined },
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<PowerTss> {
  const ftpError = checkFtp(input.ftpW);
  if (ftpError) return fail(ftpError);
  const ftp = input.ftpW as number;

  const series = cleanSeries(input.powerW, input.timeS, { min: cfg.power.minW, max: cfg.power.maxW }, cfg);
  if (series.validS === 0) return fail('missing_data');
  if (series.coverage < cfg.minCoverage) return fail('insufficient_data');

  let sum = 0;
  for (const v of series.samples) if (!Number.isNaN(v)) sum += v;
  const avgPowerW = sum / series.timerS;
  const np = normalizedPower(series.samples) ?? avgPowerW;
  const intensityFactor = np / ftp;
  const tss = (series.timerS * np * intensityFactor) / (ftp * 3600) * 100;

  const warnings: LoadWarning[] = [];
  if (series.timerS < 1200) warnings.push('short_duration');
  if (series.coverage < cfg.goodCoverage) warnings.push('data_gaps');
  if (series.outliers > 0) warnings.push('outliers_removed');
  if (thresholdLooksOutdated(intensityFactor, series.timerS)) warnings.push('threshold_maybe_outdated');

  const quality = series.coverage < cfg.goodCoverage ? 'low' : series.timerS < 1200 ? 'medium' : 'high';
  return ok(
    { tss, normalizedPowerW: np, intensityFactor, avgPowerW, variabilityIndex: avgPowerW > 0 ? np / avgPowerW : 1, timerS: series.timerS },
    quality,
    warnings,
  );
}

/** Sans série : avec la NP fournie par l'appareil si elle existe, sinon la moyenne (qui sous-estime). */
export function powerTssFromSummary(
  input: { normalizedPowerW?: number; avgPowerW?: number; movingS: number; ftpW: number | undefined },
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<Pick<PowerTss, 'tss' | 'normalizedPowerW' | 'intensityFactor'>> {
  const ftpError = checkFtp(input.ftpW);
  if (ftpError) return fail(ftpError);
  const ftp = input.ftpW as number;
  if (!inRange(input.movingS, 1, cfg.maxSessionS)) return fail('invalid_duration');

  const hasNp = input.normalizedPowerW !== undefined;
  const power = hasNp ? input.normalizedPowerW : input.avgPowerW;
  if (power === undefined) return fail('missing_data');
  if (!inRange(power, 1, cfg.power.maxW)) return fail('implausible_value');

  const intensityFactor = power / ftp;
  const warnings: LoadWarning[] = hasNp ? [] : ['summary_only'];
  if (thresholdLooksOutdated(intensityFactor, input.movingS)) warnings.push('threshold_maybe_outdated');
  return ok(
    { tss: (input.movingS / 3600) * intensityFactor ** 2 * 100, normalizedPowerW: power, intensityFactor },
    hasNp ? 'medium' : 'low',
    warnings,
  );
}
