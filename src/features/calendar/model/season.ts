// season.ts — la saison : phases de préparation (macrocycles) et courses. Fonctions pures.
//
// Application à un seul athlète : une seule saison (un TrainingPlan) porte toutes les phases et
// toutes les courses. Elle est créée à la première saisie et s'étend toute seule pour les contenir.
import {
  addDays, diffDays, newId, parseISODate, startOfWeek,
  type AthleteId, type Cycle, type CycleId, type EventId, type ISODate, type ISODateTime, type MacroCycle, type PlanId, type RaceEvent, type TrainingPlan,
} from '../../../domain/index.ts';

export type Phase = MacroCycle['phase'];
export const PHASE_LABELS: Record<Phase, string> = {
  base: 'Base', build: 'Développement', peak: 'Pic de forme', taper: 'Affûtage', race: 'Compétition', transition: 'Récupération',
};
/** Une couleur par phase, toujours accompagnée de son nom. */
export const PHASE_COLORS: Record<Phase, string> = {
  base: '#38BDF8', build: '#F59E0B', peak: '#F472B6', taper: '#A78BFA', race: '#EF4444', transition: '#34D399',
};
/** Les phases proposées à la saisie. Les autres valeurs du modèle restent lisibles si elles existent. */
export const PHASE_CHOICES: readonly Phase[] = ['base', 'build', 'taper', 'transition'];
export const PRIORITY_LABELS: Record<RaceEvent['priority'], string> = { A: 'Objectif A', B: 'Objectif B', C: 'Objectif C' };

export const SEASON_PLAN_ID = 'saison' as PlanId;
export const seasonPlan = (plans: Readonly<Record<string, TrainingPlan>>): TrainingPlan | undefined =>
  plans[SEASON_PLAN_ID] ?? Object.values(plans)[0];

export function createSeasonPlan(athleteId: AthleteId, today: ISODate, now: ISODateTime): TrainingPlan {
  const startDate = startOfWeek(today);
  return {
    id: SEASON_PLAN_ID, athleteId, name: 'Saison', startDate, endDate: addDays(startDate, 52 * 7 - 1),
    sports: ['run'], events: [], targetEventId: null, createdAt: now, updatedAt: now,
  };
}
/** Étend la saison pour qu'elle contienne [start, end]. Renvoie le même objet si rien ne change. */
export function coverSpan(plan: TrainingPlan, start: ISODate, end: ISODate, now: ISODateTime): TrainingPlan {
  const startDate = start < plan.startDate ? start : plan.startDate;
  const endDate = end > plan.endDate ? end : plan.endDate;
  return startDate === plan.startDate && endDate === plan.endDate ? plan : { ...plan, startDate, endDate, updatedAt: now };
}

export const macroCycles = (cycles: Readonly<Record<string, Cycle>>): MacroCycle[] =>
  Object.values(cycles).filter((c): c is MacroCycle => c.level === 'macro').sort((a, b) => a.startDate.localeCompare(b.startDate));
export const phaseAt = (macros: readonly MacroCycle[], date: ISODate): MacroCycle | undefined =>
  macros.find((m) => m.startDate <= date && date <= m.endDate);
/** Phase qui couvre le plus de jours de la semaine. */
export function phaseOfWeek(macros: readonly MacroCycle[], weekStart: ISODate): MacroCycle | undefined {
  const weekEnd = addDays(weekStart, 6);
  let best: MacroCycle | undefined, bestDays = 0;
  for (const m of macros) {
    const from = m.startDate > weekStart ? m.startDate : weekStart;
    const to = m.endDate < weekEnd ? m.endDate : weekEnd;
    const days = from <= to ? diffDays(from, to) + 1 : 0;
    if (days > bestDays) { best = m; bestDays = days; }
  }
  return best;
}

export type PhaseProblem = 'bad_dates' | 'inverted' | 'overlap';
export const PHASE_PROBLEM_TEXT: Record<PhaseProblem, string> = {
  bad_dates: 'Indique une date de début et une date de fin.',
  inverted: 'La fin doit être après le début.',
  overlap: 'Cette phase en chevauche une autre. Deux phases ne peuvent pas couvrir le même jour.',
};
/** Invariant du modèle : deux macrocycles frères ne se chevauchent pas. `candidate.id` s'ignore lui-même. */
export function phaseProblem(macros: readonly MacroCycle[], candidate: Pick<MacroCycle, 'startDate' | 'endDate'> & { id?: CycleId }): PhaseProblem | null {
  if (parseISODate(candidate.startDate) === null || parseISODate(candidate.endDate) === null) return 'bad_dates';
  if (candidate.endDate < candidate.startDate) return 'inverted';
  return macros.some((m) => m.id !== candidate.id && m.startDate <= candidate.endDate && candidate.startDate <= m.endDate) ? 'overlap' : null;
}
export const makePhase = (planId: PlanId, phase: Phase, startDate: ISODate, endDate: ISODate): MacroCycle =>
  ({ id: newId<CycleId>(), planId, parentId: null, level: 'macro', phase, name: PHASE_LABELS[phase], startDate, endDate });

export function makeRace(name: string, date: ISODate, priority: RaceEvent['priority']): RaceEvent {
  return { id: newId<EventId>(), name: name.trim() || 'Course', date, priority, format: 'run', legs: {} };
}
const PRIORITY_RANK: Record<RaceEvent['priority'], number> = { A: 0, B: 1, C: 2 };
/** Ajoute ou remplace une course. L'objectif du plan est la course A la plus proche dans le temps. */
export function upsertRace(plan: TrainingPlan, race: RaceEvent, now: ISODateTime): TrainingPlan {
  const events = [...plan.events.filter((e) => e.id !== race.id), race].sort((a, b) => a.date.localeCompare(b.date));
  return { ...coverSpan(plan, race.date, race.date, now), events, targetEventId: targetOf(events), updatedAt: now };
}
export function removeRace(plan: TrainingPlan, id: EventId, now: ISODateTime): TrainingPlan {
  const events = plan.events.filter((e) => e.id !== id);
  return events.length === plan.events.length ? plan : { ...plan, events, targetEventId: targetOf(events), updatedAt: now };
}
const targetOf = (events: readonly RaceEvent[]): EventId | null =>
  [...events].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.date.localeCompare(b.date))[0]?.id ?? null;
export const racesOn = (plan: TrainingPlan | undefined, date: ISODate): readonly RaceEvent[] =>
  plan?.events.filter((e) => e.date === date) ?? [];

// --- Frise de la saison : tout est exprimé en fraction (0 à 1) de la période affichée. ---
export interface Timeline {
  start: ISODate;
  end: ISODate;
  days: number;
  months: readonly { key: string; label: string; left: number; width: number }[];
  phases: readonly { cycle: MacroCycle; left: number; width: number }[];
  races: readonly { race: RaceEvent; left: number }[];
  /** Position d'aujourd'hui, ou null s'il est hors de la période. */
  today: number | null;
}
const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'] as const;
const MIN_WEEKS = 26;
const monthStart = (date: ISODate): ISODate => `${date.slice(0, 7)}-01` as ISODate;
function nextMonth(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`) as ISODate;
}

/** Période : du début du mois de la première chose à montrer jusqu'à la fin du mois de la dernière, 26 semaines au moins. */
export function buildTimeline(macros: readonly MacroCycle[], races: readonly RaceEvent[], today: ISODate): Timeline {
  const starts = [today, ...macros.map((m) => m.startDate), ...races.map((r) => r.date)].sort();
  const ends = [addDays(today, MIN_WEEKS * 7), ...macros.map((m) => m.endDate), ...races.map((r) => r.date)].sort();
  const start = monthStart(starts[0] ?? today);
  const end = addDays(nextMonth(ends[ends.length - 1] ?? today), -1);
  const days = diffDays(start, end) + 1;
  const at = (date: ISODate): number => diffDays(start, date) / days;
  const months: { key: string; label: string; left: number; width: number }[] = [];
  for (let m = start; m <= end && months.length < 60; m = nextMonth(m)) {
    const next = nextMonth(m);
    months.push({ key: m, label: `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''}${m.slice(5, 7) === '01' || m === start ? ` ${m.slice(0, 4)}` : ''}`, left: at(m), width: diffDays(m, next) / days });
  }
  return {
    start, end, days, months,
    phases: macros.map((cycle) => ({ cycle, left: at(cycle.startDate), width: (diffDays(cycle.startDate, cycle.endDate) + 1) / days })),
    races: races.map((race) => ({ race, left: at(race.date) + 0.5 / days })),
    today: today >= start && today <= end ? at(today) + 0.5 / days : null,
  };
}
