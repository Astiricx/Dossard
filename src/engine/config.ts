// config.ts — tous les réglages du moteur au même endroit. Aucun nombre magique ailleurs.
import type { LoadMethod, Sport, StepRole } from '../domain/index.ts';

/** À incrémenter dès qu'une formule change : les charges stockées sont alors recalculées. */
export const ENGINE_VERSION = 1;

export interface EngineConfig {
  power: { minW: number; maxW: number };
  hr: { minBpm: number; maxBpm: number };
  /** Au-delà de cet écart entre deux échantillons, c'est une pause : le chrono est arrêté. */
  maxSampleGapS: number;
  /** Trou de capteur comblé par la dernière valeur connue s'il ne dépasse pas cette durée. */
  maxFillS: number;
  /** En dessous de cette part de données valides, le calcul est refusé plutôt que faussé. */
  minCoverage: number;
  goodCoverage: number;
  maxSessionS: number;
  /** Constantes de temps (en jours) de la condition physique (CTL) et de la fatigue (ATL). */
  pmc: { ctlDays: number; atlDays: number };
  defaultHrRestBpm: number;
  /** HEURISTIQUE : FC au seuil estimée en fraction de la FC max quand elle est inconnue. */
  lthrFractionOfHrMax: number;
  /** HEURISTIQUE : charge horaire équivalente (échelle TSS) pour un RPE de 1 à 10. À calibrer par athlète. */
  rpeTssPerHour: readonly number[];
  /** HEURISTIQUE : dernier recours quand on ne connaît que la durée. */
  durationTssPerHour: Record<Sport, number>;
  /** HEURISTIQUE : intensité supposée d'une étape sans cible, selon son rôle. */
  openIntensityByRole: Record<StepRole, number>;
  /** Ordre de préférence des méthodes, par sport. */
  priority: Record<Sport, readonly LoadMethod[]>;
}

export const DEFAULT_CONFIG: EngineConfig = {
  power: { minW: 0, maxW: 2500 },
  hr: { minBpm: 30, maxBpm: 230 },
  maxSampleGapS: 10,
  maxFillS: 5,
  minCoverage: 0.5,
  goodCoverage: 0.9,
  maxSessionS: 48 * 3600,
  pmc: { ctlDays: 42, atlDays: 7 },
  defaultHrRestBpm: 60,
  lthrFractionOfHrMax: 0.9,
  rpeTssPerHour: [20, 30, 40, 50, 60, 70, 80, 100, 120, 140],
  durationTssPerHour: { run: 55, bike: 50, swim: 50, strength: 40, other: 30 },
  openIntensityByRole: { warmup: 0.6, active: 0.85, recovery: 0.5, cooldown: 0.55, rest: 0 },
  priority: {
    run: ['power', 'pace', 'hr', 'rpe', 'duration'],
    bike: ['power', 'hr', 'rpe', 'duration'],
    swim: ['pace', 'hr', 'rpe', 'duration'],      // la FC au poignet est peu fiable dans l'eau
    strength: ['rpe', 'hr', 'duration'],          // ni la FC ni la puissance ne décrivent la musculation
    other: ['hr', 'rpe', 'duration'],
  },
};
