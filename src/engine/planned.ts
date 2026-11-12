// planned.ts — durée, distance et charge PRÉVUES d'une séance, déduites de ses blocs.
// Même échelle que la charge réalisée : c'est ce qui rend « prévu contre réalisé » comparable.
import type { PlannedMetrics, ResolvedThresholds, Sport, StepBlock, WorkoutBlock, WorkoutDefinition } from '../domain/index.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { rpeTssPerHour } from './foster.ts';
import { clamp, isFiniteNumber } from './outcome.ts';
import { paceExponent } from './pace.ts';

const MAX_REPEATS = 99;
const MAX_INTENSITY = 2.5;

export type PlannedWarning =
  | 'open_step'           // étape sans durée : comptée pour zéro
  | 'unresolved_target'   // cible absolue sans le seuil correspondant, ou distance sans vitesse seuil
  | 'heuristic_scale';    // intensité déduite d'un RPE, d'une FC ou d'un rôle

/** Déplie les répétitions : 5 × (4 min + 2 min) donne 10 étapes. */
export function flattenBlocks(blocks: readonly WorkoutBlock[]): StepBlock[] {
  const steps: StepBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'step') { steps.push(block); continue; }
    const count = isFiniteNumber(block.count) ? clamp(Math.round(block.count), 1, MAX_REPEATS) : 1;
    for (let i = 0; i < count; i++) steps.push(...block.steps);
  }
  return steps;
}

export interface StepIntensity { low: number; high: number; heuristic: boolean }

/** Intensité d'une étape en fraction du seuil (1 = au seuil). null si la cible n'est pas résoluble. */
export function stepIntensity(step: StepBlock, sport: Sport, th: ResolvedThresholds, cfg: EngineConfig = DEFAULT_CONFIG): StepIntensity | null {
  const range = (low: number, high: number, heuristic: boolean): StepIntensity | null => {
    if (!isFiniteNumber(low) || !isFiniteNumber(high)) return null;
    const a = clamp(Math.min(low, high), 0, MAX_INTENSITY);
    return { low: a, high: clamp(Math.max(low, high), a, MAX_INTENSITY), heuristic };
  };
  const sportTh = th.bySport[sport] ?? {};
  const lthr = sportTh.lthrBpm ?? (th.hrMaxBpm !== undefined ? th.hrMaxBpm * cfg.lthrFractionOfHrMax : undefined);
  const target = step.target;
  switch (target.kind) {
    case 'open': { const i = cfg.openIntensityByRole[step.role]; return range(i, i, true); }
    case 'rpe': { const i = Math.sqrt(rpeTssPerHour(target.value, cfg) / 100); return range(i, i, true); }
    case 'relative': {
      if (target.basis === 'ftp' || target.basis === 'threshold_speed') return range(target.low, target.high, false);
      if (target.basis === 'lthr') return range(target.low, target.high, true);
      // % de FC max : converti en % de FC seuil.
      const ratio = th.hrMaxBpm !== undefined && lthr !== undefined && lthr > 0 ? th.hrMaxBpm / lthr : 1 / cfg.lthrFractionOfHrMax;
      return range(target.low * ratio, target.high * ratio, true);
    }
    case 'absolute': {
      const reference = target.unit === 'w' ? sportTh.ftpW : target.unit === 'mps' ? sportTh.thresholdSpeedMps : lthr;
      if (reference === undefined || !(reference > 0)) return null;
      return range(target.low / reference, target.high / reference, target.unit === 'bpm');
    }
  }
}

/** Moyenne de intensité^k sur l'étape. Pour une rampe, intégrale exacte de low à high. */
function meanPower(i: StepIntensity, k: 2 | 3, ramp: boolean): number {
  if (!ramp) return ((i.low + i.high) / 2) ** k;
  return k === 2
    ? (i.low ** 2 + i.low * i.high + i.high ** 2) / 3
    : ((i.low + i.high) * (i.low ** 2 + i.high ** 2)) / 4;
}

export function plannedMetrics(
  workout: Pick<WorkoutDefinition, 'sport' | 'blocks'>,
  th: ResolvedThresholds,
  cfg: EngineConfig = DEFAULT_CONFIG,
): { metrics: PlannedMetrics; warnings: PlannedWarning[] } {
  if (workout.sport === 'rest') return { metrics: { durationS: 0, distanceM: 0, load: 0 }, warnings: [] };
  const sport = workout.sport;
  const k = paceExponent(sport);
  const thresholdSpeed = sport === 'run' || sport === 'swim' ? th.bySport[sport]?.thresholdSpeedMps : undefined;
  const warnings = new Set<PlannedWarning>();
  let durationS = 0, distanceM = 0, load = 0;
  let durationKnown = true, distanceKnown = true, loadKnown = true;

  for (const step of flattenBlocks(workout.blocks)) {
    const intensity = stepIntensity(step, sport, th, cfg);
    if (intensity?.heuristic) warnings.add('heuristic_scale');
    const speed = intensity && thresholdSpeed !== undefined ? ((intensity.low + intensity.high) / 2) * thresholdSpeed : undefined;

    let seconds: number | null = null;
    let meters: number | null = null;
    const d = step.duration;
    if (d.kind === 'open') { warnings.add('open_step'); seconds = 0; meters = 0; }
    else if (d.kind === 'time') {
      seconds = isFiniteNumber(d.seconds) ? Math.max(0, d.seconds) : null;
      meters = seconds !== null && speed !== undefined ? seconds * speed : null;
    } else {
      meters = isFiniteNumber(d.meters) ? Math.max(0, d.meters) : null;
      seconds = meters !== null && speed !== undefined && speed > 0 ? meters / speed : null;
    }

    if (seconds === null) durationKnown = false; else durationS += seconds;
    if (meters === null) distanceKnown = false; else distanceM += meters;
    if (intensity === null || seconds === null) { loadKnown = false; warnings.add('unresolved_target'); }
    else load += (seconds / 3600) * meanPower(intensity, k, step.profile === 'ramp') * 100;
  }
  return {
    metrics: {
      durationS: durationKnown ? Math.round(durationS) : null,
      distanceM: distanceKnown ? Math.round(distanceM) : null,
      load: loadKnown ? Math.round(load * 10) / 10 : null,
    },
    warnings: [...warnings],
  };
}
