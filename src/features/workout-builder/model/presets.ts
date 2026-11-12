// presets.ts — valeurs de départ d'un bloc et modes de cible proposés par sport. Fonctions pures.
import { newId, type BlockId, type IntensityTarget, type RepeatBlock, type ResolvedThresholds, type Sport, type StepBlock, type StepRole } from '../../../domain/index.ts';

/** Les trois saisies demandées, plus « libre » (aucune cible : footing de récupération, trot). */
export type TargetMode = 'pace' | 'hr_max' | 'ftp' | 'open';
/** Rôles proposés dans l'interface. 'rest' (arrêt complet) reste lisible s'il vient d'un import. */
export const BUILDER_ROLES: readonly StepRole[] = ['warmup', 'active', 'recovery', 'cooldown'];

const MODES: Record<Sport, readonly TargetMode[]> = {
  run: ['pace', 'hr_max', 'ftp', 'open'],
  bike: ['ftp', 'hr_max', 'open'],
  swim: ['pace', 'hr_max', 'open'],
  strength: ['hr_max', 'open'],
  other: ['hr_max', 'open'],
};
export const targetModesFor = (sport: Sport): readonly TargetMode[] => MODES[sport];

/** null : la cible existe dans le modèle (RPE, watts, bpm, % FC seuil) mais n'a pas de saisie dédiée ici. */
export function targetModeOf(target: IntensityTarget): TargetMode | null {
  if (target.kind === 'open') return 'open';
  if (target.kind === 'absolute') return target.unit === 'mps' ? 'pace' : null;
  if (target.kind === 'relative') return target.basis === 'hr_max' ? 'hr_max' : target.basis === 'ftp' ? 'ftp' : null;
  return null;
}

// Fourchettes de départ par rôle, en fraction de la référence. Simples points de départ à ajuster.
const RANGES: Record<Exclude<TargetMode, 'open'>, Record<StepRole, readonly [number, number]>> = {
  hr_max: { warmup: [0.65, 0.75], active: [0.88, 0.92], recovery: [0.6, 0.7], cooldown: [0.6, 0.7], rest: [0.5, 0.6] },
  ftp: { warmup: [0.5, 0.65], active: [1.0, 1.05], recovery: [0.45, 0.55], cooldown: [0.45, 0.55], rest: [0.3, 0.4] },
  pace: { warmup: [0.72, 0.8], active: [1.0, 1.03], recovery: [0.65, 0.72], cooldown: [0.7, 0.78], rest: [0.5, 0.6] },
};
/** Vitesse de départ quand la vitesse seuil est inconnue : 5:00/km à pied, 2:00/100 m dans l'eau. */
const NEUTRAL_SPEED_MPS: Partial<Record<Sport, number>> = { run: 1000 / 300, swim: 100 / 120 };
const DURATIONS_S: Record<StepRole, number> = { warmup: 900, active: 240, recovery: 120, cooldown: 600, rest: 60 };

export function defaultTarget(mode: TargetMode, role: StepRole, sport: Sport, th: ResolvedThresholds): IntensityTarget {
  if (mode === 'open') return { kind: 'open' };
  const [low, high] = RANGES[mode][role];
  if (mode !== 'pace') return { kind: 'relative', basis: mode, low, high };
  const reference = th.bySport[sport]?.thresholdSpeedMps;
  if (reference !== undefined && reference > 0) return { kind: 'absolute', unit: 'mps', low: low * reference, high: high * reference };
  const neutral = NEUTRAL_SPEED_MPS[sport] ?? 3;
  return { kind: 'absolute', unit: 'mps', low: neutral, high: neutral };
}

export function createStep(role: StepRole, sport: Sport, th: ResolvedThresholds, mode: TargetMode = targetModesFor(sport)[0]!): StepBlock {
  return {
    kind: 'step', id: newId<BlockId>(), role, profile: 'steady',
    duration: { kind: 'time', seconds: DURATIONS_S[role] },
    target: defaultTarget(mode, role, sport, th),
  };
}

export function createRepeat(sport: Sport, th: ResolvedThresholds): RepeatBlock {
  return { kind: 'repeat', id: newId<BlockId>(), count: 5, steps: [createStep('active', sport, th), createStep('recovery', sport, th)] };
}

/** Au changement de sport, une cible devenue impossible (allure à vélo) est remplacée par le défaut du sport. */
export function adaptTarget(step: StepBlock, sport: Sport, th: ResolvedThresholds): StepBlock {
  const mode = targetModeOf(step.target);
  if (mode === null || targetModesFor(sport).includes(mode)) return step;
  return { ...step, target: defaultTarget(targetModesFor(sport)[0]!, step.role, sport, th) };
}
