// hr.ts — charge cardiaque.
//   TRIMP de Banister : Σ minutes × FCr × a × e^(b × FCr), avec FCr = (FC − FC repos) / (FC max − FC repos)
//                       a = 0,64 et b = 1,92 (hommes) ; a = 0,86 et b = 1,67 (femmes)
//   TRIMP d'Edwards   : Σ minutes × numéro de zone (5 zones de 10 % entre 50 et 100 % de la FC max)
//   hrTSS             : TRIMP rapporté à celui d'une heure à la FC seuil, × 100 (même échelle que le TSS)
import type { LoadWarning, Stream } from '../domain/index.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { clamp, fail, inRange, ok, type FailureReason, type Outcome } from './outcome.ts';
import { cleanSeries } from './series.ts';

const BANISTER = { male: { a: 0.64, b: 1.92 }, female: { a: 0.86, b: 1.67 } } as const;

export interface HrProfile { hrMaxBpm?: number; hrRestBpm?: number; sex?: 'male' | 'female' }
interface Resolved { hrMax: number; hrRest: number; a: number; b: number; warnings: LoadWarning[] }

function resolveProfile(profile: HrProfile, cfg: EngineConfig): Resolved | FailureReason {
  if (profile.hrMaxBpm === undefined) return 'missing_threshold';
  if (!inRange(profile.hrMaxBpm, 100, cfg.hr.maxBpm)) return 'invalid_threshold';
  const warnings: LoadWarning[] = [];
  let hrRest = profile.hrRestBpm;
  if (hrRest === undefined) { hrRest = cfg.defaultHrRestBpm; warnings.push('hr_rest_assumed'); }
  if (!inRange(hrRest, 25, 110) || profile.hrMaxBpm - hrRest < 40) return 'invalid_threshold';
  if (profile.sex === undefined) warnings.push('sex_assumed');
  return { hrMax: profile.hrMaxBpm, hrRest, ...BANISTER[profile.sex ?? 'male'], warnings };
}
const reserve = (hr: number, r: Resolved): number => clamp((hr - r.hrRest) / (r.hrMax - r.hrRest), 0, 1);
const weight = (hrr: number, r: Resolved): number => hrr * r.a * Math.exp(r.b * hrr);

export interface Trimp { trimp: number; timerS: number; avgHrBpm: number; peakHrBpm: number }

export function banisterTrimp(
  input: { hrBpm: Stream; timeS?: readonly number[] },
  profile: HrProfile,
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<Trimp> {
  const r = resolveProfile(profile, cfg);
  if (typeof r === 'string') return fail(r);
  // Au-delà de 110 % de la FC max déclarée, c'est un artefact (capteur optique calé sur la cadence).
  const series = cleanSeries(input.hrBpm, input.timeS, { min: cfg.hr.minBpm, max: Math.min(cfg.hr.maxBpm, r.hrMax * 1.1) }, cfg);
  if (series.validS === 0) return fail('missing_data');
  if (series.coverage < cfg.minCoverage) return fail('insufficient_data');

  let trimp = 0, hrSum = 0, peak = 0, secondsAboveMax = 0;
  for (const hr of series.samples) {
    if (Number.isNaN(hr)) continue;
    trimp += weight(reserve(hr, r), r) / 60;
    hrSum += hr;
    if (hr > peak) peak = hr;
    if (hr > r.hrMax) secondsAboveMax++;
  }
  // Les secondes sans mesure sont supposées ressembler aux autres, plutôt que comptées pour zéro.
  trimp *= series.timerS / series.validS;

  const warnings = [...r.warnings];
  if (series.coverage < cfg.goodCoverage) warnings.push('data_gaps');
  if (series.outliers > 0) warnings.push('outliers_removed');
  if (secondsAboveMax > 60) warnings.push('hr_above_max');
  return ok(
    { trimp, timerS: series.timerS, avgHrBpm: hrSum / series.validS, peakHrBpm: peak },
    series.coverage < cfg.goodCoverage ? 'medium' : 'high',
    warnings,
  );
}

/**
 * Sans série. La pondération étant convexe, appliquer la formule à la FC moyenne sous-estime
 * toujours une séance d'intensité variable (inégalité de Jensen) : d'où la qualité « medium ».
 */
export function banisterTrimpFromAverage(
  input: { avgHrBpm: number | undefined; durationS: number },
  profile: HrProfile,
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<Pick<Trimp, 'trimp'>> {
  const r = resolveProfile(profile, cfg);
  if (typeof r === 'string') return fail(r);
  if (input.avgHrBpm === undefined) return fail('missing_data');
  if (!inRange(input.durationS, 1, cfg.maxSessionS)) return fail('invalid_duration');
  if (!inRange(input.avgHrBpm, cfg.hr.minBpm, r.hrMax * 1.05)) return fail('implausible_value');
  return ok({ trimp: (input.durationS / 60) * weight(reserve(input.avgHrBpm, r), r) }, 'medium', [...r.warnings, 'summary_only']);
}

export function edwardsTrimp(
  input: { hrBpm: Stream; timeS?: readonly number[] },
  hrMaxBpm: number | undefined,
  cfg: EngineConfig = DEFAULT_CONFIG,
): Outcome<{ trimp: number; secondsInZone: readonly [number, number, number, number, number] }> {
  if (hrMaxBpm === undefined) return fail('missing_threshold');
  if (!inRange(hrMaxBpm, 100, cfg.hr.maxBpm)) return fail('invalid_threshold');
  const series = cleanSeries(input.hrBpm, input.timeS, { min: cfg.hr.minBpm, max: Math.min(cfg.hr.maxBpm, hrMaxBpm * 1.1) }, cfg);
  if (series.validS === 0) return fail('missing_data');
  if (series.coverage < cfg.minCoverage) return fail('insufficient_data');

  const secondsInZone: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const hr of series.samples) {
    if (Number.isNaN(hr)) continue;
    const zone = Math.min(5, Math.floor((hr / hrMaxBpm) * 10) - 4);   // 50–60 % → 1 … 90 % et plus → 5
    if (zone >= 1) secondsInZone[zone - 1]! += 1;
  }
  const trimp = secondsInZone.reduce((total, s, i) => total + (s / 60) * (i + 1), 0) * (series.timerS / series.validS);
  return ok({ trimp, secondsInZone }, series.coverage < cfg.goodCoverage ? 'medium' : 'high',
    series.coverage < cfg.goodCoverage ? ['data_gaps'] : []);
}

/** Ramène un TRIMP de Banister à l'échelle TSS : une heure à la FC seuil vaut 100. */
export function hrTss(trimp: number, lthrBpm: number | undefined, profile: HrProfile, cfg: EngineConfig = DEFAULT_CONFIG): Outcome<number> {
  const r = resolveProfile(profile, cfg);
  if (typeof r === 'string') return fail(r);
  if (lthrBpm === undefined) return fail('missing_threshold');
  if (!inRange(lthrBpm, r.hrRest + 20, r.hrMax)) return fail('invalid_threshold');
  if (!inRange(trimp, 0, 5000)) return fail('implausible_value');
  return ok((trimp / (60 * weight(reserve(lthrBpm, r), r))) * 100, 'high', r.warnings);
}
