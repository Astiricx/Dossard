import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, type AthleteId, type BlockId, type CycleId, type ISODateTime, type MacroCycle, type PlanId, type Workout, type WorkoutId } from '../src/domain/index.ts';
import { dragId, dropIntent, parseDayTarget, parseDragSource } from '../src/features/calendar/model/dnd.ts';
import { libraryItems, placeCopy } from '../src/features/calendar/model/library.ts';
import { buildTimeline, coverSpan, createSeasonPlan, makeRace, phaseOfWeek, phaseProblem, removeRace, upsertRace } from '../src/features/calendar/model/season.ts';
import { isoWeekNumber, makeWeekPlanned, weekRangeLabel, weekStartsFrom } from '../src/features/calendar/model/weeks.ts';
import { createAppStore, type PersistencePort, type Snapshot, type StoreMutation } from '../src/store/app-store.ts';
import { buildCalendar, moveWorkout } from '../src/store/calendar.ts';

const NOW = '2026-11-12T12:00:00.000Z' as ISODateTime;
const ATHLETE = 'local' as AthleteId;
const MONDAY = isoDate('2026-11-09');
const workout = (id: string, date: string, patch: Partial<Workout> = {}): Workout => ({
  id: id as WorkoutId, athleteId: ATHLETE, planId: null, date: isoDate(date), order: 0, sport: 'bike', title: `Séance ${id}`,
  blocks: [{ kind: 'step', id: `b-${id}` as BlockId, role: 'active', profile: 'steady', duration: { kind: 'time', seconds: 3600 }, target: { kind: 'relative', basis: 'ftp', low: 1, high: 1 } }],
  planned: { durationS: 3600, distanceM: 30_000, load: 100 }, activityId: null, matchedBy: null, createdAt: NOW, updatedAt: NOW, ...patch,
});
const macro = (id: string, phase: MacroCycle['phase'], start: string, end: string): MacroCycle =>
  ({ id: id as CycleId, planId: 'saison' as PlanId, parentId: null, level: 'macro', phase, name: phase, startDate: isoDate(start), endDate: isoDate(end) });

test('semaines : découpage, numéro ISO et libellé', () => {
  assert.deepEqual(weekStartsFrom(MONDAY, 3), ['2026-11-09', '2026-11-16', '2026-11-23']);
  assert.equal(isoWeekNumber(MONDAY), 46);
  assert.equal(isoWeekNumber(isoDate('2026-12-28')), 53);      // 2026 compte 53 semaines ISO
  assert.equal(isoWeekNumber(isoDate('2027-01-04')), 1);
  assert.equal(weekRangeLabel(MONDAY), '9 – 15 nov.');
  assert.equal(weekRangeLabel(isoDate('2026-11-30')), '30 nov. – 6 déc.');
});

test('totaux prévus de la semaine : sommes, totaux partiels et mémorisation', () => {
  const a = workout('a', '2026-11-10');
  const b = workout('b', '2026-11-10', { planned: { durationS: 1800, distanceM: null, load: 40 } });
  const c = workout('c', '2026-11-15', { planned: { durationS: 600, distanceM: 2000, load: null } });
  const outside = workout('d', '2026-11-16');
  const state = buildCalendar([a, b, c, outside], []);
  const select = makeWeekPlanned(MONDAY);
  const totals = select(state);
  assert.equal(totals.count, 3);
  assert.equal(totals.durationS, 6000);
  assert.equal(totals.distanceM, 32_000);
  assert.equal(totals.load, 140);
  assert.deepEqual([totals.durationPartial, totals.distancePartial, totals.loadPartial], [false, true, true]);
  assert.deepEqual(totals.dailyLoad, [0, 140, 0, 0, 0, 0, 0]);

  // Déplacer une séance d'une AUTRE semaine ne recalcule pas celle-ci : même objet renvoyé.
  const [moved] = moveWorkout(state, outside.id, isoDate('2026-11-20'), 0, NOW);
  assert.equal(select(moved), totals);
  // Faire entrer cette séance dans la semaine la recalcule aussitôt.
  const [entered] = moveWorkout(state, outside.id, isoDate('2026-11-11'), 0, NOW);
  assert.equal(select(entered).load, 240);
  assert.deepEqual(select(entered).dailyLoad, [0, 140, 100, 0, 0, 0, 0]);
});

test('bibliothèque : séances identiques regroupées, la plus récente sert de modèle', () => {
  const first = workout('a', '2026-11-10', { title: 'Seuil 2 × 20' });
  const again = workout('b', '2026-11-17', { title: 'seuil 2 × 20 ', updatedAt: '2026-11-13T08:00:00.000Z' as ISODateTime,
    blocks: first.blocks.map((block) => ({ ...block, id: 'autre' as BlockId })) });
  const other = workout('c', '2026-11-11', { title: 'Footing', sport: 'run' });
  const items = libraryItems({ a: first, b: again, c: other });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => [item.source.id, item.uses]), [['b', 2], ['c', 1]]);
});

test('poser une copie : séance neuve, charge recalculée avec les seuils de sa date', () => {
  const source = workout('a', '2026-11-10', { activityId: 'act' as never, matchedBy: 'manual', description: 'Rester souple' });
  const copy = placeCopy(source, isoDate('2026-11-18'), { athlete: null, athleteId: ATHLETE, now: NOW, countOnDate: 2 });
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.date, '2026-11-18');
  assert.equal(copy.order, 2);
  assert.equal(copy.activityId, null);
  assert.equal(copy.matchedBy, null);
  assert.equal(copy.description, 'Rester souple');
  assert.equal(copy.blocks, source.blocks);
  // 1 h à 100 % de FTP : la cible est relative, donc calculable même sans seuil déclaré.
  assert.deepEqual(copy.planned, { durationS: 3600, distanceM: null, load: 100 });
});

test('glisser-déposer : le lâcher devient un déplacement, une copie, ou rien', () => {
  const state = buildCalendar([workout('a', '2026-11-10'), workout('b', '2026-11-12'), workout('c', '2026-11-12', { order: 1 })], []);
  assert.deepEqual(parseDragSource(dragId.workout('a' as WorkoutId)), { kind: 'workout', id: 'a' });
  assert.deepEqual(parseDragSource(dragId.library('run|x')), { kind: 'library', key: 'run|x' });
  assert.equal(parseDayTarget('day:2026-02-30'), null);
  assert.deepEqual(dropIntent('w:a', 'day:2026-11-12', state), { type: 'move', id: 'a', toDate: '2026-11-12', toIndex: 2 });
  assert.deepEqual(dropIntent('lib:clé', 'day:2026-11-14', state), { type: 'copy', key: 'clé', toDate: '2026-11-14' });
  assert.equal(dropIntent('w:a', 'day:2026-11-10', state), null);     // reposée sur son jour
  assert.equal(dropIntent('w:a', null, state), null);                 // lâchée hors de la grille
  assert.equal(dropIntent('w:inconnue', 'day:2026-11-12', state), null);
  assert.equal(dropIntent('w:a', 'w:b', state), null);
});

test('phases : chevauchement refusé, phase dominante de la semaine', () => {
  const base = macro('m1', 'base', '2026-11-02', '2026-11-29');
  const build = macro('m2', 'build', '2026-11-30', '2026-12-27');
  assert.equal(phaseProblem([base, build], { startDate: isoDate('2026-12-28'), endDate: isoDate('2027-01-10') }), null);
  assert.equal(phaseProblem([base, build], { startDate: isoDate('2026-11-29'), endDate: isoDate('2026-12-05') }), 'overlap');
  assert.equal(phaseProblem([base], { startDate: isoDate('2026-12-10'), endDate: isoDate('2026-12-01') }), 'inverted');
  assert.equal(phaseProblem([base], { id: base.id, startDate: base.startDate, endDate: isoDate('2026-12-06') }), null);   // se modifier soi-même
  const cut = [macro('m1', 'base', '2026-11-02', '2026-11-11'), macro('m2', 'build', '2026-11-12', '2026-12-27')];
  assert.equal(phaseOfWeek(cut, MONDAY)?.phase, 'build');      // 3 jours de base, 4 de développement
  assert.equal(phaseOfWeek(cut, isoDate('2027-02-01')), undefined);
});

test('courses : objectif du plan, saison étendue, frise en fractions', () => {
  const today = isoDate('2026-11-12');
  let plan = createSeasonPlan(ATHLETE, today, NOW);
  assert.equal(plan.startDate, '2026-11-09');
  assert.equal(coverSpan(plan, plan.startDate, plan.endDate, NOW), plan);
  const b = makeRace('Cross', isoDate('2026-12-13'), 'B');
  const a = makeRace('Marathon', isoDate('2028-04-09'), 'A');
  plan = upsertRace(upsertRace(plan, b, NOW), a, NOW);
  assert.deepEqual(plan.events.map((e) => e.name), ['Cross', 'Marathon']);
  assert.equal(plan.targetEventId, a.id);
  assert.equal(plan.endDate, '2028-04-09');                    // la saison s'étend jusqu'à la course
  assert.equal(removeRace(plan, a.id, NOW).targetEventId, b.id);

  const line = buildTimeline([macro('m1', 'base', '2026-11-09', '2026-12-06')], [b], today);
  assert.equal(line.start, '2026-11-01');
  assert.equal(line.end, '2027-05-31');                        // 26 semaines au moins, mois entiers
  assert.equal(line.months.length, 7);
  assert.ok(Math.abs(line.months.reduce((sum, m) => sum + m.width, 0) - 1) < 1e-9);
  const phase = line.phases[0]!;
  assert.ok(Math.abs(phase.left - 8 / line.days) < 1e-9);
  assert.ok(Math.abs(phase.width - 28 / line.days) < 1e-9);
  assert.ok(line.today !== null && line.today > 0 && line.today < phase.left + phase.width);
});

test('store : plans, phases et réglages sont persistés ; le token s’efface vraiment', async () => {
  const written: StoreMutation[] = [];
  const empty: Snapshot = { athlete: null, plans: [], cycles: [], templates: [], workouts: [], activities: [] };
  const port: PersistencePort = { load: async () => empty, commit: async (mutations) => { written.push(...mutations); } };
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  assert.deepEqual(store.getState().settings, {});              // base d'avant le Sprint 3 : pas de réglages

  const { savePlan, saveCycles, removeCycle, saveSettings } = store.getState().actions;
  const plan = createSeasonPlan(ATHLETE, isoDate('2026-11-12'), NOW);
  const phase = macro('m1', 'base', '2026-11-09', '2026-12-06');
  savePlan(plan); saveCycles([phase]); removeCycle(phase.id); removeCycle(phase.id);
  saveSettings({ garminToken: 'jeton-de-test-1234' });
  assert.equal(store.getState().settings.garminToken, 'jeton-de-test-1234');
  saveSettings({ garminToken: undefined });
  assert.equal('garminToken' in store.getState().settings, false);
  assert.equal(store.getState().plans[plan.id], plan);
  assert.deepEqual(store.getState().cycles, {});

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(written.map((m) => m.table), ['plans', 'cycles', 'cycles', 'settings', 'settings']);
  assert.deepEqual(written[4], { table: 'settings', put: {} });
});
