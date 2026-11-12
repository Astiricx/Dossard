// load.ts — choisit LA charge d'une activité parmi tout ce qui est calculable.
// TSS, TRIMP et Foster ne vivent pas sur la même échelle : on ne peut pas les additionner. Chaque
// méthode est donc ramenée à l'échelle TSS (100 = une heure au seuil), puis on retient la première
// méthode fiable dans l'ordre de préférence du sport. Les autres mesures restent dans `metrics` :
// l'écart entre charge objective et charge ressentie est lui-même un indicateur de fatigue.
import type { ActivityLoad, ActivityStreams, CompletedActivity, LoadMethod, LoadMetrics, LoadQuality, LoadWarning, ResolvedThresholds } from '../domain/index.ts';
import { DEFAULT_CONFIG, ENGINE_VERSION, type EngineConfig } from './config.ts';
import { rpeTssPerHour, sessionRpe } from './foster.ts';
import { banisterTrimp, banisterTrimpFromAverage, hrTss, type HrProfile } from './hr.ts';
import { inRange, round1 } from './outcome.ts';
import { paceTss } from './pace.ts';
import { powerTss, powerTssFromSummary } from './power.ts';

export interface LoadContext {
  thresholds: ResolvedThresholds;
  sex?: 'male' | 'female';
  streams?: Pick<ActivityStreams, 'timeS' | 'powerW' | 'hrBpm'>;
  config?: EngineConfig;
}
interface Candidate { value: number; quality: LoadQuality; warnings: LoadWarning[] }

export function resolveActivityLoad(
  activity: Pick<CompletedActivity, 'sport' | 'summary' | 'subjective'>,
  ctx: LoadContext,
): ActivityLoad | null {
  const cfg = ctx.config ?? DEFAULT_CONFIG;
  const { sport, summary, subjective } = activity;
  const th = ctx.thresholds;
  const sportTh = th.bySport[sport] ?? {};
  const durationS = summary.movingS > 0 ? summary.movingS : summary.elapsedS;
  const candidates: Partial<Record<LoadMethod, Candidate>> = {};
  const metrics: LoadMetrics = {};

  // --- Puissance ---
  const power = ctx.streams?.powerW
    ? powerTss({ powerW: ctx.streams.powerW, timeS: ctx.streams.timeS, ftpW: sportTh.ftpW }, cfg)
    : powerTssFromSummary({ normalizedPowerW: summary.normalizedPowerW, avgPowerW: summary.avgPowerW, movingS: durationS, ftpW: sportTh.ftpW }, cfg);
  if (power.ok) {
    candidates.power = { value: power.value.tss, quality: power.quality, warnings: power.warnings };
    metrics.tss = round1(power.value.tss);
    metrics.intensityFactor = power.value.intensityFactor;
    metrics.normalizedPowerW = Math.round(power.value.normalizedPowerW);
  }

  // --- Allure ---
  const pace = paceTss({ sport, distanceM: summary.distanceM, movingS: durationS, thresholdSpeedMps: sportTh.thresholdSpeedMps, elevationGainM: summary.elevationGainM }, cfg);
  if (pace.ok) {
    candidates.pace = { value: pace.value.tss, quality: pace.quality, warnings: pace.warnings };
    if (!power.ok) { metrics.tss = round1(pace.value.tss); metrics.intensityFactor = pace.value.intensityFactor; }
  }

  // --- Fréquence cardiaque ---
  const profile: HrProfile = { hrMaxBpm: th.hrMaxBpm, hrRestBpm: th.hrRestBpm, sex: ctx.sex };
  const trimp = ctx.streams?.hrBpm
    ? banisterTrimp({ hrBpm: ctx.streams.hrBpm, timeS: ctx.streams.timeS }, profile, cfg)
    : banisterTrimpFromAverage({ avgHrBpm: summary.avgHrBpm, durationS }, profile, cfg);
  if (trimp.ok) {
    metrics.trimp = round1(trimp.value.trimp);
    const knownLthr = sportTh.lthrBpm ?? Object.values(th.bySport).find((s) => s.lthrBpm !== undefined)?.lthrBpm;
    const lthr = knownLthr ?? (th.hrMaxBpm !== undefined ? th.hrMaxBpm * cfg.lthrFractionOfHrMax : undefined);
    const scaled = hrTss(trimp.value.trimp, lthr, profile, cfg);
    if (scaled.ok) {
      const estimated = knownLthr === undefined;
      metrics.hrTss = round1(scaled.value);
      candidates.hr = {
        value: scaled.value,
        quality: estimated ? 'low' : trimp.quality,
        warnings: estimated ? [...trimp.warnings, 'threshold_estimated'] : trimp.warnings,
      };
    }
  }

  // --- Ressenti (Foster) ---
  const foster = sessionRpe({ rpe: subjective.rpe, durationS }, cfg);
  if (foster.ok && subjective.rpe !== undefined) {
    metrics.sessionRpe = round1(foster.value);
    candidates.rpe = { value: (durationS / 3600) * rpeTssPerHour(subjective.rpe, cfg), quality: 'medium', warnings: ['heuristic_scale'] };
  }

  // --- Dernier recours : la durée seule ---
  if (inRange(durationS, 1, cfg.maxSessionS)) {
    candidates.duration = { value: (durationS / 3600) * cfg.durationTssPerHour[sport], quality: 'low', warnings: ['heuristic_scale'] };
  }

  // Première méthode fiable dans l'ordre de préférence ; à défaut, la première disponible.
  const available = cfg.priority[sport].filter((m) => candidates[m] !== undefined);
  const method = available.find((m) => candidates[m]?.quality !== 'low') ?? available[0];
  const chosen = method ? candidates[method] : undefined;
  if (method === undefined || chosen === undefined) return null;

  const usesThreshold = method === 'power' || method === 'pace' || method === 'hr';
  const warnings = th.backfilled && usesThreshold ? [...chosen.warnings, 'threshold_backfilled' as const] : chosen.warnings;
  return {
    value: round1(chosen.value),
    method,
    quality: chosen.quality,
    warnings: [...new Set(warnings)],
    metrics,
    engineVersion: ENGINE_VERSION,
    thresholdsAsOf: usesThreshold ? th.asOf : null,
  };
}
