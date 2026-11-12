// selectors.ts — lecture de l'état. Règle : un sélecteur renvoie toujours la MÊME référence tant que
// son résultat n'a pas changé, sinon le composant abonné se redessine à chaque modification du store.
import type { ActivityId, CompletedActivity, ISODate, Workout, WorkoutId } from '../domain/index.ts';
import { addDays } from '../domain/index.ts';
import type { CalendarState } from '../store/calendar.ts';

/** Tableau vide partagé : renvoyer `[]` créerait une nouvelle référence à chaque appel. */
const NONE: readonly never[] = Object.freeze([]);

export const workoutIdsOn = (date: ISODate) => (s: CalendarState): readonly WorkoutId[] => s.workoutIdsByDate[date] ?? NONE;
export const activityIdsOn = (date: ISODate) => (s: CalendarState): readonly ActivityId[] => s.activityIdsByDate[date] ?? NONE;
export const workoutById = (id: WorkoutId) => (s: CalendarState): Workout | undefined => s.workouts[id];
export const activityById = (id: ActivityId) => (s: CalendarState): CompletedActivity | undefined => s.activities[id];

export interface WeekTotals {
  planned: { count: number; durationS: number; load: number };
  completed: { count: number; durationS: number; load: number };
  dailyCompletedLoad: readonly number[];    // 7 valeurs : entrée de fosterWeek() et du graphique
}

/**
 * Totaux d'une semaine, mémorisés. Le calcul n'est refait que si l'un des objets de la semaine a
 * changé de référence : modifier une séance en mars ne recalcule pas les totaux de novembre.
 * À instancier une fois par ligne de la grille (useMemo).
 */
export function makeWeekTotals(weekStart: ISODate): (s: CalendarState) => WeekTotals {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  let lastDeps: readonly unknown[] = [];
  let lastResult: WeekTotals | null = null;
  return (s) => {
    const workouts = days.flatMap((d) => (s.workoutIdsByDate[d] ?? NONE).map((id) => s.workouts[id]));
    const activitiesByDay = days.map((d) => (s.activityIdsByDate[d] ?? NONE).map((id) => s.activities[id]));
    const deps = [...workouts, ...activitiesByDay.flat()];
    if (lastResult !== null && deps.length === lastDeps.length && deps.every((dep, i) => dep === lastDeps[i])) return lastResult;

    const planned = { count: 0, durationS: 0, load: 0 };
    for (const w of workouts) {
      if (w === undefined || w.sport === 'rest') continue;
      planned.count++;
      planned.durationS += w.planned.durationS ?? 0;
      planned.load += w.planned.load ?? 0;
    }
    const completed = { count: 0, durationS: 0, load: 0 };
    const dailyCompletedLoad = activitiesByDay.map((list) => {
      let dayLoad = 0;
      for (const a of list) {
        if (a === undefined) continue;
        completed.count++;
        completed.durationS += a.summary.movingS;
        dayLoad += a.load?.value ?? 0;
      }
      completed.load += dayLoad;
      return dayLoad;
    });
    lastDeps = deps;
    lastResult = { planned, completed, dailyCompletedLoad };
    return lastResult;
  };
}
