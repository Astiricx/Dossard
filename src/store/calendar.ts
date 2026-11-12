// calendar.ts — l'état du calendrier et ses transitions, sans aucune dépendance (ni React, ni Zustand).
//
// Pourquoi cette forme :
// 1. Entités normalisées (`workouts`, `activities`) : chaque objet existe une seule fois.
// 2. Index par jour (`workoutIdsByDate`) : une case du calendrier ne s'abonne qu'à SON tableau d'ids.
// 3. Partage structurel strict : une transition ne recrée que ce qui change réellement. Déplacer une
//    séance du mardi au jeudi remplace deux tableaux sur des centaines ; seules deux cases se redessinent.
// 4. Chaque transition renvoie aussi la liste des écritures à persister : le store reste synchrone,
//    la base suit en arrière-plan.
import type { ActivityId, CompletedActivity, ISODate, ISODateTime, Workout, WorkoutId } from '../domain/index.ts';

export interface CalendarState {
  readonly workouts: Readonly<Record<WorkoutId, Workout>>;
  readonly activities: Readonly<Record<ActivityId, CompletedActivity>>;
  /** Ordonné : l'ordre du tableau est l'ordre d'affichage dans la journée. */
  readonly workoutIdsByDate: Readonly<Record<ISODate, readonly WorkoutId[]>>;
  /** Ordonné par heure de départ. */
  readonly activityIdsByDate: Readonly<Record<ISODate, readonly ActivityId[]>>;
  /**
   * Premier jour dont la charge réalisée a changé. CTL et ATL étant des moyennes exponentielles,
   * tout ce qui précède ce jour reste valide : on ne recalcule que la suite (Sprint 2).
   */
  readonly loadDirtyFrom: ISODate | null;
}

export type Mutation =
  | { table: 'workouts'; put: readonly Workout[]; remove: readonly WorkoutId[] }
  | { table: 'activities'; put: readonly CompletedActivity[]; remove: readonly ActivityId[] };

export type Transition = readonly [state: CalendarState, mutations: readonly Mutation[]];
const unchanged = (state: CalendarState): Transition => [state, []];

export const EMPTY_CALENDAR: CalendarState = {
  workouts: {}, activities: {}, workoutIdsByDate: {}, activityIdsByDate: {}, loadDirtyFrom: null,
};

const earliest = (a: ISODate | null, b: ISODate): ISODate => (a === null || b < a ? b : a);
const withoutKey = <K extends string, V>(record: Readonly<Record<K, V>>, key: K): Record<K, V> => {
  const { [key]: _removed, ...rest } = record;
  return rest as Record<K, V>;
};
/** Remplace la liste d'un jour ; supprime la clé si la liste est vide. */
const setDay = <Id extends string>(index: Readonly<Record<ISODate, readonly Id[]>>, date: ISODate, ids: readonly Id[]) =>
  ids.length === 0 ? withoutKey(index, date) : { ...index, [date]: ids };

/** Construit l'état au démarrage à partir de ce que contient la base. */
export function buildCalendar(workouts: readonly Workout[], activities: readonly CompletedActivity[]): CalendarState {
  const workoutIdsByDate: Record<ISODate, WorkoutId[]> = {};
  for (const w of [...workouts].sort((a, b) => a.order - b.order)) (workoutIdsByDate[w.date] ??= []).push(w.id);
  const activityIdsByDate: Record<ISODate, ActivityId[]> = {};
  for (const a of [...activities].sort((x, y) => x.startTime.localeCompare(y.startTime))) (activityIdsByDate[a.localDate] ??= []).push(a.id);
  return {
    workouts: Object.fromEntries(workouts.map((w) => [w.id, w])) as Record<WorkoutId, Workout>,
    activities: Object.fromEntries(activities.map((a) => [a.id, a])) as Record<ActivityId, CompletedActivity>,
    workoutIdsByDate,
    activityIdsByDate,
    loadDirtyFrom: null,
  };
}

/** Réaligne `order` sur la position dans le tableau ; ne recrée que les séances dont le rang change. */
function reindex(workouts: Record<WorkoutId, Workout>, ids: readonly WorkoutId[], date: ISODate, now: ISODateTime, touched: Map<WorkoutId, Workout>): void {
  ids.forEach((id, order) => {
    const w = workouts[id];
    if (w === undefined || (w.order === order && w.date === date)) return;
    const next = { ...w, date, order, updatedAt: now };
    workouts[id] = next;
    touched.set(id, next);
  });
}

/** Crée ou remplace des séances. Une séance nouvelle se place en fin de journée. */
export function putWorkouts(state: CalendarState, incoming: readonly Workout[], now: ISODateTime): Transition {
  if (incoming.length === 0) return unchanged(state);
  const workouts = { ...state.workouts };
  let index = state.workoutIdsByDate;
  const touched = new Map<WorkoutId, Workout>();
  for (const w of incoming) {
    const previous = workouts[w.id];
    if (previous !== undefined && previous.date !== w.date) {
      index = setDay(index, previous.date, (index[previous.date] ?? []).filter((id) => id !== w.id));
    }
    const day = index[w.date] ?? [];
    if (!day.includes(w.id)) index = setDay(index, w.date, [...day, w.id]);
    workouts[w.id] = w;
    touched.set(w.id, w);
  }
  for (const date of new Set(incoming.map((w) => w.date))) reindex(workouts, index[date] ?? [], date, now, touched);
  return [{ ...state, workouts, workoutIdsByDate: index }, [{ table: 'workouts', put: [...touched.values()], remove: [] }]];
}

/** Glisser-déposer : déplace une séance vers `toDate`, à la position `toIndex`. */
export function moveWorkout(state: CalendarState, id: WorkoutId, toDate: ISODate, toIndex: number, now: ISODateTime): Transition {
  const workout = state.workouts[id];
  if (workout === undefined) return unchanged(state);
  const fromDate = workout.date;
  const source = (state.workoutIdsByDate[fromDate] ?? []).filter((x) => x !== id);
  const target = fromDate === toDate ? source : (state.workoutIdsByDate[toDate] ?? []).filter((x) => x !== id);
  const position = Number.isFinite(toIndex) ? Math.max(0, Math.min(target.length, Math.trunc(toIndex))) : target.length;
  const destination = [...target.slice(0, position), id, ...target.slice(position)];

  // Lâcher une séance là où elle était ne doit rien déclencher : ni rendu, ni écriture.
  if (fromDate === toDate && (state.workoutIdsByDate[fromDate] ?? [])[position] === id) return unchanged(state);

  const workouts = { ...state.workouts };
  const touched = new Map<WorkoutId, Workout>();
  let index = state.workoutIdsByDate;
  if (fromDate !== toDate) { index = setDay(index, fromDate, source); reindex(workouts, source, fromDate, now, touched); }
  index = setDay(index, toDate, destination);
  reindex(workouts, destination, toDate, now, touched);
  return [{ ...state, workouts, workoutIdsByDate: index }, [{ table: 'workouts', put: [...touched.values()], remove: [] }]];
}

export function removeWorkout(state: CalendarState, id: WorkoutId, now: ISODateTime): Transition {
  const workout = state.workouts[id];
  if (workout === undefined) return unchanged(state);
  const workouts = withoutKey(state.workouts, id);
  const remaining = (state.workoutIdsByDate[workout.date] ?? []).filter((x) => x !== id);
  const touched = new Map<WorkoutId, Workout>();
  reindex(workouts, remaining, workout.date, now, touched);
  return [
    { ...state, workouts, workoutIdsByDate: setDay(state.workoutIdsByDate, workout.date, remaining) },
    [{ table: 'workouts', put: [...touched.values()], remove: [id] }],
  ];
}

/** Rapproche (ou délie, avec null) une séance prévue et une activité réalisée. */
export function linkActivity(state: CalendarState, workoutId: WorkoutId, activityId: ActivityId | null, by: 'auto' | 'manual', now: ISODateTime): Transition {
  const workout = state.workouts[workoutId];
  if (workout === undefined || workout.activityId === activityId) return unchanged(state);
  if (activityId !== null && state.activities[activityId] === undefined) return unchanged(state);
  const workouts = { ...state.workouts };
  const put: Workout[] = [];
  // Une activité ne peut être reliée qu'à une seule séance : on libère l'ancienne.
  if (activityId !== null) {
    for (const other of Object.values<Workout>(workouts)) {
      if (other.activityId !== activityId) continue;
      const freed = { ...other, activityId: null, matchedBy: null, updatedAt: now };
      workouts[other.id] = freed;
      put.push(freed);
    }
  }
  const linked = { ...workout, activityId, matchedBy: activityId === null ? null : by, updatedAt: now };
  workouts[workoutId] = linked;
  put.push(linked);
  return [{ ...state, workouts }, [{ table: 'workouts', put, remove: [] }]];
}

/**
 * Importe des activités (synchronisation). Idempotent : réimporter une activité la remplace.
 * Ce que l'athlète a saisi (`subjective`) est conservé, jamais écrasé par la source.
 */
export function putActivities(state: CalendarState, incoming: readonly CompletedActivity[]): Transition {
  if (incoming.length === 0) return unchanged(state);
  const activities = { ...state.activities };
  let index = state.activityIdsByDate;
  let dirty = state.loadDirtyFrom;
  const put: CompletedActivity[] = [];
  for (const raw of incoming) {
    const previous = activities[raw.id];
    const activity = previous ? { ...raw, subjective: { ...raw.subjective, ...previous.subjective } } : raw;
    if (previous !== undefined && previous.localDate !== activity.localDate) {
      index = setDay(index, previous.localDate, (index[previous.localDate] ?? []).filter((id) => id !== activity.id));
      dirty = earliest(dirty, previous.localDate);
    }
    activities[activity.id] = activity;
    const day = [...(index[activity.localDate] ?? []).filter((id) => id !== activity.id), activity.id]
      .sort((a, b) => (activities[a]?.startTime ?? '').localeCompare(activities[b]?.startTime ?? ''));
    index = setDay(index, activity.localDate, day);
    dirty = earliest(dirty, activity.localDate);
    put.push(activity);
  }
  return [{ ...state, activities, activityIdsByDate: index, loadDirtyFrom: dirty }, [{ table: 'activities', put, remove: [] }]];
}

/**
 * Remplace une activité existante telle quelle : c'est la voie des modifications faites par
 * l'athlète (ressenti, titre). `putActivities`, lui, protège le ressenti contre un réimport.
 */
export function setActivity(state: CalendarState, activity: CompletedActivity): Transition {
  const previous = state.activities[activity.id];
  if (previous === undefined || previous === activity || previous.localDate !== activity.localDate) return unchanged(state);
  return [
    { ...state, activities: { ...state.activities, [activity.id]: activity }, loadDirtyFrom: earliest(state.loadDirtyFrom, activity.localDate) },
    [{ table: 'activities', put: [activity], remove: [] }],
  ];
}

/** Supprime une activité. La séance qui lui était rapprochée redevient « à faire ». */
export function removeActivity(state: CalendarState, id: ActivityId, now: ISODateTime): Transition {
  const activity = state.activities[id];
  if (activity === undefined) return unchanged(state);
  const workouts = { ...state.workouts };
  const freed: Workout[] = [];
  for (const w of Object.values<Workout>(workouts)) {
    if (w.activityId !== id) continue;
    const next = { ...w, activityId: null, matchedBy: null, updatedAt: now };
    workouts[w.id] = next;
    freed.push(next);
  }
  const day = (state.activityIdsByDate[activity.localDate] ?? []).filter((x) => x !== id);
  const next: CalendarState = {
    ...state,
    workouts: freed.length > 0 ? workouts : state.workouts,
    activities: withoutKey(state.activities, id),
    activityIdsByDate: setDay(state.activityIdsByDate, activity.localDate, day),
    loadDirtyFrom: earliest(state.loadDirtyFrom, activity.localDate),
  };
  const mutations: Mutation[] = [{ table: 'activities', put: [], remove: [id] }];
  if (freed.length > 0) mutations.unshift({ table: 'workouts', put: freed, remove: [] });
  return [next, mutations];
}

/** À appeler une fois les courbes de charge recalculées. */
export const markLoadClean = (state: CalendarState): CalendarState =>
  state.loadDirtyFrom === null ? state : { ...state, loadDirtyFrom: null };
