import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, type ActivityId, type AthleteId, type CompletedActivity, type ISODate, type ISODateTime, type Workout, type WorkoutId } from '../src/domain/index.ts';
import { createAppStore, type PersistencePort, type Snapshot } from '../src/store/app-store.ts';
import { buildCalendar, linkActivity, moveWorkout, putActivities, putWorkouts, removeWorkout, type Mutation } from '../src/store/calendar.ts';
import { makeWeekTotals, workoutIdsOn } from '../src/store/selectors.ts';

const NOW = '2026-11-12T12:00:00.000Z' as ISODateTime;
const athleteId = 'louis' as AthleteId;
const workout = (id: string, date: string, order: number, load = 50): Workout => ({
  id: id as WorkoutId, athleteId, planId: null, date: isoDate(date), order, sport: 'run', title: id, blocks: [],
  planned: { durationS: 3600, distanceM: null, load }, activityId: null, matchedBy: null, createdAt: NOW, updatedAt: NOW,
});
const activity = (id: string, date: string, hour: string, load: number, rpe?: number): CompletedActivity => ({
  id: id as ActivityId, athleteId, source: { provider: 'strava', externalId: id, importedAt: NOW }, sport: 'run', title: id,
  startTime: `${date}T${hour}:00Z` as ISODateTime, utcOffsetMin: -180, localDate: isoDate(date),
  summary: { elapsedS: 3000, movingS: 3000 }, laps: [], hasStreams: false, subjective: rpe === undefined ? {} : { rpe },
  load: { value: load, method: 'pace', quality: 'medium', warnings: [], metrics: {}, engineVersion: 1, thresholdsAsOf: null }, isRace: false,
});
const MON = isoDate('2026-11-09'), TUE = isoDate('2026-11-10'), THU = isoDate('2026-11-12'), SAT = isoDate('2026-11-14');
const week = () => buildCalendar(
  [workout('a', MON, 0), workout('b', TUE, 0), workout('c', TUE, 1), workout('d', THU, 0), workout('e', SAT, 0)],
  [activity('x', MON, '18:00', 40)],
);

test('déplacer une séance ne recrée que les deux journées concernées', () => {
  const before = week();
  const [after, mutations] = moveWorkout(before, 'b' as WorkoutId, THU, 0, NOW);
  assert.deepEqual(after.workoutIdsByDate[TUE], ['c']);
  assert.deepEqual(after.workoutIdsByDate[THU], ['b', 'd']);
  // Références inchangées pour tout le reste : ces cases ne se redessinent pas.
  assert.equal(after.workoutIdsByDate[MON], before.workoutIdsByDate[MON]);
  assert.equal(after.workoutIdsByDate[SAT], before.workoutIdsByDate[SAT]);
  assert.equal(after.workouts['a' as WorkoutId], before.workouts['a' as WorkoutId]);
  assert.equal(after.activities, before.activities);
  // Écritures : la séance déplacée et les deux dont le rang a changé (c : 1 → 0, d : 0 → 1).
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0]?.put.map((w) => w.id).sort(), ['b', 'c', 'd']);
  assert.deepEqual([after.workouts['b' as WorkoutId]?.date, after.workouts['d' as WorkoutId]?.order], [THU, 1]);
});
test('lâcher une séance à sa place ne déclenche rien', () => {
  const before = week();
  const [after, mutations] = moveWorkout(before, 'c' as WorkoutId, TUE, 1, NOW);
  assert.equal(after, before);
  assert.equal(mutations.length, 0);
  assert.equal(moveWorkout(before, 'inconnue' as WorkoutId, TUE, 0, NOW)[0], before);
});
test('réordonner dans la journée, positions hors bornes', () => {
  const [after] = moveWorkout(week(), 'c' as WorkoutId, TUE, -5, NOW);
  assert.deepEqual(after.workoutIdsByDate[TUE], ['c', 'b']);
  const [end] = moveWorkout(week(), 'a' as WorkoutId, TUE, 99, NOW);
  assert.deepEqual(end.workoutIdsByDate[TUE], ['b', 'c', 'a']);
  assert.equal(end.workoutIdsByDate[MON], undefined);                 // journée vidée : la clé disparaît
  assert.equal(workoutIdsOn(MON)(end), workoutIdsOn(isoDate('2030-01-01'))(end));   // même tableau vide partagé
});
test('créer, modifier la date, supprimer', () => {
  const [created] = putWorkouts(week(), [workout('f', TUE, 0)], NOW);
  assert.deepEqual(created.workoutIdsByDate[TUE], ['b', 'c', 'f']);
  assert.equal(created.workouts['f' as WorkoutId]?.order, 2);
  const [moved] = putWorkouts(created, [{ ...workout('f', SAT, 0) }], NOW);
  assert.deepEqual([moved.workoutIdsByDate[TUE], moved.workoutIdsByDate[SAT]], [['b', 'c'], ['e', 'f']]);
  const [removed, mutations] = removeWorkout(moved, 'b' as WorkoutId, NOW);
  assert.deepEqual(removed.workoutIdsByDate[TUE], ['c']);
  assert.deepEqual([mutations[0]?.remove, mutations[0]?.put.map((w) => w.id)], [['b'], ['c']]);
});
test('import d\'activités : idempotent, ressenti conservé, charge à recalculer', () => {
  const start = week();
  const [first] = putActivities(start, [activity('y', TUE, '19:00', 60), activity('z', TUE, '07:00', 30)]);
  assert.deepEqual(first.activityIdsByDate[TUE], ['z', 'y']);          // triées par heure de départ
  assert.equal(first.loadDirtyFrom, TUE);
  const rated = { ...first, activities: { ...first.activities, ['y' as ActivityId]: { ...activity('y', TUE, '19:00', 60), subjective: { rpe: 8 } } } };
  const [again] = putActivities(rated, [activity('y', TUE, '19:00', 65), activity('x', MON, '18:00', 40)]);
  assert.deepEqual(again.activityIdsByDate[TUE], ['z', 'y']);          // pas de doublon
  assert.equal(again.activities['y' as ActivityId]?.subjective.rpe, 8);
  assert.equal(again.activities['y' as ActivityId]?.load?.value, 65);
  assert.equal(again.loadDirtyFrom, MON);
});
test('une activité n\'est reliée qu\'à une seule séance', () => {
  const [one] = linkActivity(week(), 'a' as WorkoutId, 'x' as ActivityId, 'auto', NOW);
  const [two, mutations] = linkActivity(one, 'b' as WorkoutId, 'x' as ActivityId, 'manual', NOW);
  assert.deepEqual([two.workouts['a' as WorkoutId]?.activityId, two.workouts['b' as WorkoutId]?.matchedBy], [null, 'manual']);
  assert.equal(mutations[0]?.put.length, 2);
  assert.equal(linkActivity(two, 'b' as WorkoutId, 'fantome' as ActivityId, 'manual', NOW)[0], two);
});
test('totaux de la semaine : mémorisés tant que la semaine ne change pas', () => {
  const totals = makeWeekTotals(MON);
  const state = week();
  const first = totals(state);
  assert.deepEqual([first.planned.count, first.planned.load, first.completed.load], [5, 250, 40]);
  assert.deepEqual(first.dailyCompletedLoad, [40, 0, 0, 0, 0, 0, 0]);
  const [elsewhere] = putWorkouts(state, [workout('later', '2026-12-25', 0)], NOW);
  assert.equal(totals(elsewhere), first);                               // autre semaine : même référence
  const [inside] = moveWorkout(state, 'e' as WorkoutId, isoDate('2026-11-20'), 0, NOW);
  assert.equal(totals(inside).planned.count, 4);
});

// ---------- Store complet (avec une doublure de Zustand, voir tests/README) ----------
function memoryPort(initial: Snapshot): PersistencePort & { committed: Mutation[][]; failNext: boolean } {
  const rows = new Map(initial.workouts.map((w) => [w.id, w]));
  return {
    committed: [], failNext: false,
    async load() { return { ...initial, workouts: [...rows.values()] }; },
    async commit(mutations) {
      if (this.failNext) { this.failNext = false; throw new Error('quota dépassé'); }
      this.committed.push([...mutations]);
      for (const m of mutations) if (m.table === 'workouts') { m.put.forEach((w) => rows.set(w.id, w)); m.remove.forEach((id) => rows.delete(id)); }
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
test('store : mise à jour optimiste, puis retour à la base si l\'écriture échoue', async () => {
  const port = memoryPort({ athlete: null, plans: [], cycles: [], templates: [], workouts: [workout('a', MON, 0), workout('b', TUE, 0)], activities: [] });
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  assert.equal(store.getState().status, 'ready');

  store.getState().actions.moveWorkout('a' as WorkoutId, TUE, 0);
  assert.deepEqual(store.getState().calendar.workoutIdsByDate[TUE as ISODate], ['a', 'b']);   // visible immédiatement
  await settle();
  assert.equal(port.committed.length, 1);

  port.failNext = true;
  store.getState().actions.removeWorkout('b' as WorkoutId);
  assert.equal(store.getState().calendar.workouts['b' as WorkoutId], undefined);
  await settle();
  assert.ok(store.getState().calendar.workouts['b' as WorkoutId] !== undefined);               // restaurée depuis la base
  assert.equal(store.getState().lastError, 'quota dépassé');
  assert.deepEqual(store.getState().calendar.workoutIdsByDate[TUE as ISODate], ['a', 'b']);
});
