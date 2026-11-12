import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, type AthleteId, type BlockId, type ISODateTime, type RepeatBlock, type ResolvedThresholds, type StepBlock, type WorkoutBlock } from '../src/domain/index.ts';
import { plannedMetrics } from '../src/engine/index.ts';
import { createAthlete, removeSnapshot, upsertSnapshot } from '../src/features/athlete/thresholds.ts';
import { draftReducer, emptyDraft, moveBlock, toWorkout, type Draft } from '../src/features/workout-builder/model/draft.ts';
import { formatDistance, formatDuration, formatPace, parseDistance, parseDuration, parsePace, parsePercent } from '../src/features/workout-builder/model/format.ts';
import { targetModeOf } from '../src/features/workout-builder/model/presets.ts';
import { axisTicks, buildProfile, stepZone } from '../src/features/workout-builder/model/profile.ts';
import { targetOnBasis, zoneOfValue } from '../src/features/workout-builder/model/zones.ts';
import { createAppStore, type PersistencePort, type StoreMutation } from '../src/store/app-store.ts';

const NOW = '2026-11-12T12:00:00.000Z' as ISODateTime;
const DAY = isoDate('2026-11-12');
// Seuil course à 4:00/km (4,1667 m/s), FTP 250 W, FC max 200.
const TH: ResolvedThresholds = { asOf: DAY, backfilled: false, hrMaxBpm: 200, bySport: { run: { thresholdSpeedMps: 1000 / 240 }, bike: { ftpW: 250 } } };
const NONE: ResolvedThresholds = { asOf: null, backfilled: false, bySport: {} };
const step = (id: string, patch: Partial<StepBlock> = {}): StepBlock => ({
  kind: 'step', id: id as BlockId, role: 'active', profile: 'steady',
  duration: { kind: 'time', seconds: 600 }, target: { kind: 'relative', basis: 'ftp', low: 1, high: 1 }, ...patch,
});
const repeat = (id: string, count: number, steps: StepBlock[]): RepeatBlock => ({ kind: 'repeat', id: id as BlockId, count, steps });
const ids = (blocks: readonly WorkoutBlock[]) => blocks.map((b) => (b.kind === 'repeat' ? `${b.id}[${b.steps.map((s) => s.id).join(',')}]` : b.id));

test('saisie : durées, allures, pourcentages et distances', () => {
  assert.equal(parseDuration('15'), 900);
  assert.equal(parseDuration('0:45'), 45);
  assert.equal(parseDuration('1:30:00'), 5400);
  assert.equal(parseDuration('45s'), 45);
  assert.equal(parseDuration("4'30"), 270);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('0'), null);
  assert.equal(formatDuration(5400), '1:30:00');
  assert.equal(formatDuration(270), '4:30');
  assert.equal(parsePace('4:00', 'run'), 1000 / 240);
  assert.equal(parsePace('1:40', 'swim'), 1);
  assert.equal(parsePace('4:75', 'run'), null);
  assert.equal(formatPace(1000 / 255, 'run'), '4:15');
  assert.equal(parsePercent('85'), 0.85);
  assert.equal(parsePercent('92,5 %'), 0.925);
  assert.equal(parsePercent('0'), null);
  assert.equal(parseDistance('400', 'run'), 400);
  assert.equal(parseDistance('10', 'run'), 10_000);
  assert.equal(parseDistance('0,4', 'run'), 400);
  assert.equal(parseDistance('50', 'swim'), 50);
  assert.equal(parseDistance('1.5 km', 'swim'), 1500);
  assert.equal(formatDistance(1500), '1,5 km');
  assert.equal(formatDistance(400), '400 m');
});

test('zones : chaque référence a ses propres bornes', () => {
  assert.equal(zoneOfValue('ftp', 0.5), 1);
  assert.equal(zoneOfValue('ftp', 0.75), 2);
  assert.equal(zoneOfValue('ftp', 0.8), 3);
  assert.equal(zoneOfValue('ftp', 1.0), 4);
  assert.equal(zoneOfValue('ftp', 1.2), 5);
  assert.equal(zoneOfValue('hr_max', 0.8), 3);     // 80 % FC max : tempo
  assert.equal(zoneOfValue('ftp', 0.92), 4);       // 92 % FTP : seuil
  assert.equal(zoneOfValue('hr_max', 0.92), 5);    // 92 % FC max : au-delà
  const custom = { basis: 'ftp' as const, zones: [0.6, 0.8, 0.95, 1.1, null].map((high, i) => ({ label: `Z${i + 1}`, low: 0, high })) };
  assert.equal(zoneOfValue('ftp', 0.92, custom), 3);
  assert.equal(zoneOfValue('hr_max', 0.92, custom), 5);   // modèle d'une autre référence : ignoré
});

test('allure absolue : convertie par la vitesse seuil, refusée sans elle', () => {
  const target = { kind: 'absolute', unit: 'mps', low: 1000 / 240, high: 1000 / 240 } as const;
  assert.deepEqual(targetOnBasis(target, 'run', TH), { basis: 'threshold_speed', low: 1, high: 1 });
  assert.equal(targetOnBasis(target, 'run', NONE), null);
  assert.equal(stepZone(step('a', { target }), 'run', TH), 4);
  assert.equal(stepZone(step('a', { target }), 'run', NONE), null);
  assert.equal(targetModeOf(target), 'pace');
  assert.equal(targetModeOf({ kind: 'rpe', value: 5 }), null);
});

test('profil : une répétition est dépliée, les abscisses se suivent', () => {
  const blocks = [
    step('w', { role: 'warmup', duration: { kind: 'time', seconds: 600 }, target: { kind: 'relative', basis: 'ftp', low: 0.6, high: 0.6 } }),
    repeat('r', 3, [step('on', { duration: { kind: 'time', seconds: 240 }, target: { kind: 'relative', basis: 'ftp', low: 1.1, high: 1.1 } }),
      step('off', { role: 'recovery', duration: { kind: 'time', seconds: 120 }, target: { kind: 'relative', basis: 'ftp', low: 0.5, high: 0.5 } })]),
  ];
  const p = buildProfile({ sport: 'bike', blocks }, TH);
  assert.equal(p.axis, 'time');
  assert.equal(p.approximate, false);
  assert.equal(p.total, 600 + 3 * 360);
  assert.equal(p.segments.length, 7);
  assert.deepEqual(p.segments.map((s) => s.zone), [2, 5, 1, 5, 1, 5, 1]);
  assert.deepEqual(p.boundaries, [600, 840, 960, 1200, 1320, 1560]);
  assert.deepEqual(p.segments[3]!.repeat, { index: 1, count: 3 });
  assert.equal(p.segments[3]!.blockId, 'r');
  assert.ok(Math.abs(p.maxIntensity - 1.1) < 1e-9);
  p.segments.forEach((s, i) => assert.equal(s.x0, i === 0 ? 0 : p.segments[i - 1]!.x1));
  assert.equal(p.total, plannedMetrics({ sport: 'bike', blocks }, TH).metrics.durationS);   // même durée que le moteur
});

test('profil : une rampe est découpée et change de zone en cours de route', () => {
  const ramp = step('r', { profile: 'ramp', duration: { kind: 'time', seconds: 800 }, target: { kind: 'relative', basis: 'ftp', low: 0.5, high: 1.1 } });
  const p = buildProfile({ sport: 'bike', blocks: [ramp] }, TH);
  assert.equal(p.segments.length, 8);
  assert.equal(p.segments[0]!.x1, 100);
  assert.deepEqual(p.segments.map((s) => s.zone), [1, 2, 2, 3, 3, 4, 4, 5]);
  assert.deepEqual(p.boundaries, []);
  // Rampe descendante (retour au calme) : le sens saisi est respecté.
  const down = buildProfile({ sport: 'bike', blocks: [{ ...ramp, target: { kind: 'relative', basis: 'ftp', low: 1.1, high: 0.5 } }] }, TH);
  assert.deepEqual(down.segments.map((s) => s.zone), [5, 4, 4, 3, 3, 2, 2, 1]);
  assert.ok(down.segments[0]!.intensity > down.segments[7]!.intensity);
  assert.deepEqual(axisTicks(3600, 'time'), [0, 600, 1200, 1800, 2400, 3000, 3600]);
  assert.deepEqual(axisTicks(1680, 'time'), [0, 300, 600, 900, 1200, 1500]);
  assert.deepEqual(axisTicks(10_000, 'distance'), [0, 2000, 4000, 6000, 8000, 10_000]);
});

test('profil : axe en distance, ou largeur supposée et signalée', () => {
  const km = step('k', { duration: { kind: 'distance', meters: 1000 }, target: { kind: 'relative', basis: 'hr_max', low: 0.8, high: 0.8 } });
  // Avec vitesse seuil : la distance est convertie en temps (intensité 0,8/0,9 du seuil).
  const timed = buildProfile({ sport: 'run', blocks: [km] }, TH);
  assert.equal(timed.axis, 'time');
  assert.ok(Math.abs(timed.total - 1000 / ((0.8 / 0.9) * (1000 / 240))) < 1e-6);
  // Sans seuil : seul l'axe distance est exact.
  const byDistance = buildProfile({ sport: 'run', blocks: [km] }, NONE);
  assert.equal(byDistance.axis, 'distance');
  assert.equal(byDistance.total, 1000);
  assert.equal(byDistance.approximate, false);
  // Mélange temps + distance sans seuil : axe temps, largeur de la distance supposée.
  const mixed = buildProfile({ sport: 'run', blocks: [km, step('t', { target: { kind: 'open' } })] }, NONE);
  assert.equal(mixed.axis, 'time');
  assert.equal(mixed.approximate, true);
  assert.deepEqual(mixed.segments.map((s) => s.approximateWidth), [true, false]);
  // Cible absolue sans seuil : hauteur indicative, aucune zone inventée.
  const pace = step('p', { target: { kind: 'absolute', unit: 'mps', low: 4, high: 4 } });
  const unresolved = buildProfile({ sport: 'run', blocks: [pace] }, NONE).segments[0]!;
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.zone, null);
  assert.equal(buildProfile({ sport: 'run', blocks: [] }, TH).segments.length, 0);
});

test('brouillon : ajouter, modifier, dupliquer, supprimer', () => {
  let d: Draft = emptyDraft(DAY, 'bike');
  d = draftReducer(d, { type: 'addStep', role: 'warmup', thresholds: TH });
  d = draftReducer(d, { type: 'addRepeat', thresholds: TH });
  d = draftReducer(d, { type: 'addStep', role: 'cooldown', thresholds: TH });
  assert.deepEqual(d.blocks.map((b) => b.kind), ['step', 'repeat', 'step']);
  const rep = d.blocks[1] as RepeatBlock;
  assert.deepEqual(rep.steps.map((s) => s.role), ['active', 'recovery']);
  assert.deepEqual(rep.steps[0]!.target, { kind: 'relative', basis: 'ftp', low: 1, high: 1.05 });

  const inner = rep.steps[0]!.id;
  const before = d;
  d = draftReducer(d, { type: 'updateStep', id: inner, patch: { duration: { kind: 'time', seconds: 300 } } });
  assert.equal((d.blocks[1] as RepeatBlock).steps[0]!.duration.kind === 'time' && ((d.blocks[1] as RepeatBlock).steps[0]!.duration as { seconds: number }).seconds, 300);
  assert.equal(d.blocks[0], before.blocks[0]);                       // partage structurel : les autres blocs sont intacts
  assert.equal(d.blocks[2], before.blocks[2]);
  assert.equal(draftReducer(d, { type: 'updateStep', id: 'absent' as BlockId, patch: { profile: 'ramp' } }), d);

  d = draftReducer(d, { type: 'repeatCount', id: rep.id, count: 250 });
  assert.equal((d.blocks[1] as RepeatBlock).count, 99);
  d = draftReducer(d, { type: 'duplicate', id: rep.id });
  assert.equal(d.blocks.length, 4);
  const copy = d.blocks[2] as RepeatBlock;
  assert.notEqual(copy.id, rep.id);
  assert.notEqual(copy.steps[0]!.id, inner);                         // identifiants neufs jusque dans les étapes
  d = draftReducer(d, { type: 'remove', id: copy.steps[0]!.id });
  d = draftReducer(d, { type: 'remove', id: copy.steps[1]!.id });
  assert.equal(d.blocks.length, 3);                                  // répétition vidée : elle disparaît
  assert.equal(draftReducer(d, { type: 'remove', id: 'absent' as BlockId }), d);
});

test('brouillon : changer de sport remplace les cibles devenues impossibles', () => {
  let d: Draft = emptyDraft(DAY, 'run');
  d = draftReducer(d, { type: 'addStep', role: 'active', thresholds: TH });
  assert.equal(targetModeOf((d.blocks[0] as StepBlock).target), 'pace');
  assert.ok(Math.abs(((d.blocks[0] as StepBlock).target as { low: number }).low - 1000 / 240) < 1e-9);   // allure au seuil
  d = draftReducer(d, { type: 'sport', sport: 'bike', thresholds: TH });
  assert.deepEqual((d.blocks[0] as StepBlock).target, { kind: 'relative', basis: 'ftp', low: 1, high: 1.05 });
});

test('glisser-déposer : un bloc ne change jamais de conteneur', () => {
  const blocks = [step('a'), repeat('r', 2, [step('x'), step('y'), step('z')]), step('b')];
  assert.deepEqual(ids(moveBlock(blocks, 'a' as BlockId, 'b' as BlockId)), ['r[x,y,z]', 'b', 'a']);
  assert.deepEqual(ids(moveBlock(blocks, 'b' as BlockId, 'y' as BlockId)), ['a', 'b', 'r[x,y,z]']);   // lâché sur une étape interne : la répétition sert de cible
  assert.deepEqual(ids(moveBlock(blocks, 'z' as BlockId, 'x' as BlockId)), ['a', 'r[z,x,y]', 'b']);
  assert.equal(moveBlock(blocks, 'x' as BlockId, 'a' as BlockId), blocks);                            // étape interne vers l'extérieur : refusé
  assert.equal(moveBlock(blocks, 'a' as BlockId, 'a' as BlockId), blocks);
  const moved = moveBlock(blocks, 'z' as BlockId, 'x' as BlockId);
  assert.equal(moved[0], blocks[0]);
});

test('enregistrement : la séance porte la charge du moteur et garde son lien avec le réalisé', () => {
  let d: Draft = { ...emptyDraft(DAY, 'bike'), title: '  3 × 10 min  ' };
  d = { ...d, blocks: [repeat('r', 3, [step('on'), step('off', { role: 'recovery', duration: { kind: 'time', seconds: 300 }, target: { kind: 'relative', basis: 'ftp', low: 0.6, high: 0.6 } })])] };
  const planned = plannedMetrics(d, TH).metrics;
  assert.equal(planned.durationS, 2700);
  assert.equal(planned.load, 59);            // 3 × (600 s à IF 1 = 16,67) + 3 × (300 s à IF 0,6 = 3)
  const created = toWorkout(d, { athleteId: 'louis' as AthleteId, planned, now: NOW, countOnDate: 2 });
  assert.equal(created.title, '3 × 10 min');
  assert.equal(created.order, 2);
  assert.equal(created.planned.load, 59);
  assert.equal('description' in created, false);

  const linked = { ...created, activityId: 'act' as never, matchedBy: 'manual' as const, description: 'ancienne note' };
  const later = '2026-11-13T08:00:00.000Z' as ISODateTime;
  const edited = toWorkout({ ...d, title: 'Seuil' }, { existing: linked, athleteId: 'autre' as AthleteId, planned, now: later, countOnDate: 5 });
  assert.equal(edited.id, created.id);
  assert.equal(edited.athleteId, 'louis');
  assert.equal(edited.activityId, 'act');
  assert.equal(edited.order, 2);
  assert.equal(edited.createdAt, NOW);
  assert.equal(edited.updatedAt, later);
  assert.equal('description' in edited, false);   // note effacée dans le formulaire : elle disparaît
});

test('profil athlète : relevés datés, enregistrés par le store', async () => {
  let athlete = createAthlete('America/Argentina/Cordoba');
  athlete = upsertSnapshot(athlete, { validFrom: isoDate('2026-11-01'), hrMaxBpm: 207 });
  athlete = upsertSnapshot(athlete, { validFrom: isoDate('2026-03-01'), hrMaxBpm: 205 });
  athlete = upsertSnapshot(athlete, { validFrom: isoDate('2026-11-01'), hrMaxBpm: 206, hrRestBpm: 48 });
  assert.deepEqual(athlete.thresholds.map((s) => [s.validFrom, s.hrMaxBpm]), [['2026-03-01', 205], ['2026-11-01', 206]]);
  assert.equal(removeSnapshot(athlete, isoDate('2020-01-01')), athlete);

  const committed: StoreMutation[][] = [];
  const port: PersistencePort = {
    async load() { return { athlete: null, plans: [], cycles: [], templates: [], workouts: [], activities: [] }; },
    async commit(mutations) { committed.push([...mutations]); },
  };
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  store.getState().actions.saveAthlete(athlete);
  store.getState().actions.saveAthlete(athlete);          // même objet : aucune écriture
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.getState().athlete, athlete);
  assert.deepEqual(committed, [[{ table: 'athlete', put: athlete }]]);
});
