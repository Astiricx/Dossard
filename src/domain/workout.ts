// workout.ts — la séance PRÉVUE et sa structure en blocs.
import type { IntensityBasis } from './athlete.ts';
import type { ActivityId, AthleteId, BlockId, ISODate, ISODateTime, PlanId, Sport, TemplateId, WorkoutId } from './primitives.ts';

export type BlockDuration =
  | { kind: 'time'; seconds: number }
  | { kind: 'distance'; meters: number }
  | { kind: 'open' };                                   // jusqu'à l'appui sur le bouton « lap »

/** Cible d'intensité. Relative : elle suit l'athlète quand ses seuils évoluent. */
export type IntensityTarget =
  | { kind: 'relative'; basis: IntensityBasis; low: number; high: number }   // fractions : 0.88 à 0.94
  | { kind: 'absolute'; unit: 'w' | 'bpm' | 'mps'; low: number; high: number }
  | { kind: 'rpe'; value: number }                                           // 1 à 10
  | { kind: 'open' };

export type StepRole = 'warmup' | 'active' | 'recovery' | 'cooldown' | 'rest';

export interface StepBlock {
  kind: 'step';
  id: BlockId;
  role: StepRole;
  duration: BlockDuration;
  target: IntensityTarget;
  /** 'ramp' : l'intensité va linéairement de low à high (échauffement progressif). */
  profile: 'steady' | 'ramp';
  cadence?: { low: number; high: number };
  label?: string;
}
/** Répétition. Un seul niveau d'imbrication : c'est aussi la limite du format de séance des montres. */
export interface RepeatBlock {
  kind: 'repeat';
  id: BlockId;
  count: number;
  steps: readonly StepBlock[];
}
export type WorkoutBlock = StepBlock | RepeatBlock;

/** Le contenu d'une séance, indépendant de sa date : partagé par Workout et WorkoutTemplate. */
export interface WorkoutDefinition {
  sport: Sport | 'rest';
  title: string;
  description?: string;
  blocks: readonly WorkoutBlock[];
}

/** Totaux prévus, calculés par engine/planned.ts à chaque modification des blocs. null = non calculable. */
export interface PlannedMetrics {
  durationS: number | null;
  distanceM: number | null;
  load: number | null;
}

export interface Workout extends WorkoutDefinition {
  id: WorkoutId;
  athleteId: AthleteId;
  planId: PlanId | null;
  date: ISODate;
  order: number;                // rang dans la journée
  planned: PlannedMetrics;
  /**
   * Lien prévu → réalisé. Il est porté par la séance, pas par l'activité : une resynchronisation
   * réécrit les activités sans jamais toucher à ce que l'athlète a rapproché.
   */
  activityId: ActivityId | null;
  matchedBy: 'auto' | 'manual' | null;
  templateId?: TemplateId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WorkoutTemplate extends WorkoutDefinition {
  id: TemplateId;
  athleteId: AthleteId;
  tags: readonly string[];
}
