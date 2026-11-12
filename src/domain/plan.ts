// plan.ts — le plan d'entraînement et sa périodisation.
import type { AthleteId, CycleId, EventId, ISODate, ISODateTime, PlanId, Sport } from './primitives.ts';

export interface RaceEvent {
  id: EventId;
  name: string;
  date: ISODate;
  priority: 'A' | 'B' | 'C';
  format: 'run' | 'trail' | 'triathlon' | 'duathlon' | 'bike' | 'swim' | 'other';
  /** Distance par discipline, en mètres. Triathlon M : { swim: 1500, bike: 40000, run: 10000 }. */
  legs: Partial<Record<Sport, number>>;
  goal?: { timeS?: number; note?: string };
  result?: { timeS?: number; rank?: string; note?: string };
}

export interface TrainingPlan {
  id: PlanId;
  athleteId: AthleteId;
  name: string;
  startDate: ISODate;
  endDate: ISODate;             // incluse
  sports: readonly Sport[];
  events: readonly RaceEvent[]; // objets-valeurs du plan : imbriqués
  targetEventId: EventId | null;
  retrospective?: string;       // bilan écrit une fois le plan terminé
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Le statut se déduit des dates : le stocker créerait une donnée qui peut mentir. */
export type PlanStatus = 'upcoming' | 'active' | 'completed';
export const planStatus = (plan: Pick<TrainingPlan, 'startDate' | 'endDate'>, today: ISODate): PlanStatus =>
  today < plan.startDate ? 'upcoming' : today > plan.endDate ? 'completed' : 'active';

// --- Cycles : macro > méso > micro. Entités à plat reliées par parentId (voir ARCHITECTURE.md). ---
// Invariants, vérifiés à l'écriture par le store (Sprint 2) :
//   un enfant est inclus dans les dates de son parent ; deux frères ne se chevauchent pas ;
//   un microcycle dure 7 jours et commence le premier jour de semaine de l'athlète.

interface CycleBase {
  id: CycleId;
  planId: PlanId;
  parentId: CycleId | null;
  name: string;
  startDate: ISODate;
  endDate: ISODate;             // incluse
  notes?: string;
}
export interface MacroCycle extends CycleBase {
  level: 'macro';
  parentId: null;
  phase: 'base' | 'build' | 'peak' | 'taper' | 'race' | 'transition';
}
export interface MesoCycle extends CycleBase {
  level: 'meso';
  focus: 'endurance' | 'tempo' | 'threshold' | 'vo2max' | 'speed' | 'race_specific' | 'recovery';
}
export interface MicroCycle extends CycleBase {
  level: 'micro';
  kind: 'load' | 'recovery' | 'test' | 'taper' | 'race';
  /** Objectifs de la semaine, comparés au prévu et au réalisé dans la grille. */
  target?: { load?: number; durationS?: number; bySport?: Partial<Record<Sport, { durationS?: number; distanceM?: number }>> };
}
export type Cycle = MacroCycle | MesoCycle | MicroCycle;
