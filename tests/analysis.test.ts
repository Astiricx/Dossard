// Sprint 5 : sous-échantillonnage des séries, temps en zones, ressenti, courbe de performance (PMC).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, thresholdsAt, type ActivityId, type ActivityStreams, type Athlete, type AthleteId, type BlockId, type CompletedActivity, type ISODate, type ISODateTime, type Workout, type WorkoutId } from '../src/domain/index.ts';
import { downsample, performanceCurve, rampRate } from '../src/engine/index.ts';
import { axisDomain, chartRows, effortMetric, smooth } from '../src/features/analysis/model/chart-rows.ts';
import { fosterLoad, withSubjective } from '../src/features/analysis/model/subjective.ts';
import { timeInZones, zoneOptions } from '../src/features/analysis/model/zone-time.ts';
import { buildBackup, parseBackup, serializeBackup } from '../src/features/backup/backup.ts';
import type { FitMessages } from '../src/features/import/fit/messages.ts';
import { parseFit } from '../src/features/import/fit/normalize.ts';
import { planImport, type ReadResult } from '../src/features/import/pipeline.ts';
import { STREAM_STEP_S } from '../src/features/import/streams.ts';
import { buildPmc, dailyPlannedLoad, formState, lastDays } from '../src/features/stats/model/pmc.ts';
import { zoneBounds } from '../src/features/workout-builder/model/zones.ts';
import { createAppStore, type PersistencePort, type Snapshot, type StoreMutation } from '../src/store/app-store.ts';

const NOW = '2026-11-12T12:00:00.000Z' as ISODateTime;
const ATHLETE_ID = 'local' as AthleteId;
const ATHLETE: Athlete = {
  id: ATHLETE_ID, displayName: 'Test', timezone: 'America/Argentina/Cordoba', firstDayOfWeek: 1, zones: {},
  thresholds: [{ validFrom: isoDate('2026-01-01'), hrMaxBpm: 200, hrRestBpm: 50, bySport: { run: { thresholdSpeedMps: 4 }, bike: { ftpW: 250 } } }],
};
const TH = thresholdsAt(ATHLETE, isoDate('2026-11-11'));
const near = (actual: number | null | undefined, expected: number, tolerance = 1e-9): void =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

/** Une heure de vélo à 250 W et 150 bpm, une mesure par seconde, avec les champs que l'on doit ignorer. */
const BIKE: FitMessages = {
  sessionMesgs: [{ startTime: new Date('2026-11-11T16:00:00Z'), sport: 'cycling', totalElapsedTime: 3600, totalTimerTime: 3600, totalDistance: 32_000, avgPower: 250, avgHeartRate: 150 }],
  recordMesgs: Array.from({ length: 3601 }, (_, i) => ({
    timestamp: new Date(Date.parse('2026-11-11T16:00:00Z') + i * 1000), power: 250, heartRate: 150, enhancedSpeed: 8.888,
    positionLat: -374_000_000 + i, positionLong: -765_000_000, temperature: 21, verticalOscillation: 82, cadence: 90,
  })) as FitMessages['recordMesgs'],
};
const read = (messages: FitMessages): ReadResult[] => {
  const parsed = parseFit(messages, { fallbackOffsetMin: () => -180 });
  assert.ok(parsed.ok);
  return [{ file: 'sortie.fit', ok: true, activities: parsed.activities }];
};
const plan = (messages: FitMessages, existing: CompletedActivity[] = []) => planImport(read(messages), { existing, athlete: ATHLETE, athleteId: ATHLETE_ID, now: NOW });

test('sous-échantillonnage : un point par tranche de 3 s, moyenne des mesures, trous et pauses respectés', () => {
  // 0 à 8 s à 1 Hz, puis une pause, puis 30 et 31 s.
  const timeS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 30, 31];
  const hr = [100, 110, 120, 130, null, 150, null, undefined, null, 160, 170];
  const speed = [3, 3, 3.01, 4, 4, 4, 5, 5, 5, 2.555, 2.555];
  const out = downsample(timeS, { hr, speed }, 3, { speed: 2 });
  assert.deepEqual(out.timeS, [0, 3, 6, 30]);                       // la pause (9 à 29 s) ne crée aucun point
  assert.deepEqual(out.columns.hr, [110, 140, null, 165]);          // moyenne des valeurs présentes ; null si aucune
  assert.deepEqual(out.columns.speed, [3, 4, 5, 2.56]);             // arrondi à 2 décimales

  // Une heure à 1 Hz devient 1 200 points : trois fois moins.
  const hour = downsample(Array.from({ length: 3600 }, (_, i) => i), { p: Array.from({ length: 3600 }, (_, i) => (i % 3) * 30) });
  assert.equal(hour.timeS.length, 1200);
  assert.ok(hour.columns.p.every((v) => v === 30));                 // (0 + 30 + 60) / 3
  // « Smart recording » (pas irrégulier), horodatages invalides ou désordonnés : jamais d'exception.
  assert.deepEqual(downsample([10, 2, Number.NaN, -5, 2.5], { v: [1, 3, 9, 9, 5] }).timeS, [0, 9]);
  assert.deepEqual(downsample([10, 2, Number.NaN, -5, 2.5], { v: [1, 3, 9, 9, 5] }).columns.v, [4, 1]);
  assert.deepEqual(downsample([], { v: [] }), { timeS: [], columns: { v: [] } });
  assert.deepEqual(downsample([0, 1], { v: [1, 2] }, 0).timeS, []);
});

test('import : séries allégées (FC, vitesse, puissance), sans GPS, et charge calculée sur la série complète', () => {
  const first = plan(BIKE);
  const [activity] = first.put, [streams] = first.streams;
  assert.ok(activity && streams);
  assert.equal(activity.hasStreams, true);
  assert.deepEqual(Object.keys(streams).sort(), ['activityId', 'hrBpm', 'powerW', 'speedMps', 'timeS']);   // ni position, ni température, ni cadence
  assert.equal(streams.activityId, activity.id);
  assert.equal(streams.timeS.length, 1201);                          // 3 601 mesures → une toutes les 3 s
  assert.deepEqual([streams.timeS[0], streams.timeS[1], streams.timeS[1200]], [0, 3, 3600]);
  assert.deepEqual([streams.hrBpm?.[600], streams.powerW?.[600], streams.speedMps?.[600]], [150, 250, 8.89]);
  assert.ok(JSON.stringify(streams).length < 25_000);                // une heure pèse une vingtaine de Ko
  assert.equal(activity.load?.method, 'power');
  near(activity.load?.value, 100, 0.1);                              // 1 h à la FTP = 100, calculé AVANT l'allègement

  // Réimport du même fichier : rien à écrire.
  assert.deepEqual(plan(BIKE, [activity]).counts, { imported: 0, updated: 0, unchanged: 1, failed: 0 });
  // Activité importée avant le Sprint 5 (sans séries) : le réimport la complète, sans changer d'identifiant.
  const old = { ...activity, hasStreams: false, subjective: { rpe: 6 } };
  const refill = plan(BIKE, [old]);
  assert.deepEqual(refill.counts, { imported: 0, updated: 1, unchanged: 0, failed: 0 });
  assert.deepEqual([refill.put[0]?.id, refill.put[0]?.hasStreams, refill.put[0]?.subjective.rpe, refill.streams.length], [activity.id, true, 6, 1]);
  // Fichier sans aucun enregistrement : pas de séries, et l'activité le dit.
  const bare = plan({ sessionMesgs: BIKE.sessionMesgs! });
  assert.deepEqual([bare.put[0]?.hasStreams, bare.streams.length], [false, 0]);
  assert.equal(STREAM_STEP_S, 3);
});

test('temps en zones : chaque point compte pour son pas, les trous et les pauses pour rien', () => {
  // FC max 200 : Z1 ≤ 120, Z2 ≤ 140, Z3 ≤ 160, Z4 ≤ 180, Z5 au-delà.
  const values = [...Array(10).fill(110), ...Array(20).fill(150), ...Array(5).fill(190), null, 120, 121];
  const timeS = values.map((_, i) => i * 3);
  timeS[36] = 600; timeS[37] = 603;                                  // une pause de 8 min avant les deux derniers points
  const option = { basis: 'hr_max' as const, reference: 200 };
  const { zones, measuredS } = timeInZones(timeS, values, option, zoneBounds('hr_max'));
  assert.deepEqual(zones.map((z) => z.seconds), [33, 3, 60, 0, 15]);  // 120 bpm = 60 % : encore Z1 ; 121 : Z2
  assert.equal(measuredS, 111);                                       // 37 points mesurés × 3 s ; le trou n'est pas compté
  near(zones.reduce((sum, z) => sum + z.share, 0), 1);
  assert.deepEqual(zones.map((z) => [z.low, z.high]), [[null, 120], [120, 140], [140, 160], [160, 180], [180, null]]);
  // Série vide ou référence nulle : des zéros, pas d'exception ni de division par zéro.
  assert.equal(timeInZones([], [], option, zoneBounds('hr_max')).measuredS, 0);
  assert.equal(timeInZones(timeS, values, { basis: 'hr_max', reference: 0 }, zoneBounds('hr_max')).zones[0]?.share, 0);

  // Lectures proposées : il faut la série ET le seuil. Puissance d'abord à vélo, FC d'abord à pied.
  const all = { hrBpm: [150], powerW: [200], speedMps: [3] };
  assert.deepEqual(zoneOptions(all, TH, 'bike').map((o) => [o.source, o.reference]), [['power', 250], ['hr', 200]]);
  assert.deepEqual(zoneOptions(all, TH, 'run').map((o) => [o.source, o.basis]), [['hr', 'hr_max'], ['pace', 'threshold_speed']]);   // pas de FTP en course
  assert.deepEqual(zoneOptions({ speedMps: [3] }, thresholdsAt({ thresholds: [] }, isoDate('2026-11-11')), 'run'), []);
});

test('graphique : lignes par point, coupure aux pauses, axe borné sur la zone utile', () => {
  const streams: ActivityStreams = { activityId: 'a' as ActivityId, timeS: [0, 3, 6, 60, 63], hrBpm: [120, 122, null, 140, 141], speedMps: [3, 3, 3, 0, 3] };
  assert.equal(effortMetric(streams, 'run'), 'speed');
  assert.equal(effortMetric({ powerW: [1], speedMps: [1] }, 'bike'), 'power');
  assert.equal(effortMetric({ powerW: [1], speedMps: [1] }, 'run'), 'speed');
  assert.equal(effortMetric({}, 'run'), null);
  const rows = chartRows(streams, 'speed', 3);
  assert.deepEqual(rows.map((r) => r.t), [0, 3, 6, 9, 60, 63]);       // une ligne vide à 9 s : la courbe s'interrompt
  assert.deepEqual(rows[3], { t: 9, effort: null, hr: null });
  assert.deepEqual(rows.map((r) => r.hr), [120, 122, null, null, 140, 141]);
  assert.deepEqual(smooth([1, null, 3, 5, undefined], 3), [1, null, 4, 4, null]);
  const many = Array.from({ length: 200 }, (_, i) => ({ t: i * 3, effort: i === 50 ? 0 : 3 + (i % 5) * 0.1, hr: null }));
  const domain = axisDomain(many, 'effort');
  assert.ok(domain !== null && domain[0] > 2 && domain[1] < 4);       // l'arrêt isolé (0 m/s) n'écrase pas l'échelle
  assert.equal(axisDomain(many, 'hr'), null);
});

test('ressenti : la charge de Foster s’ajoute, sans jamais remplacer une charge mesurée', () => {
  const [measured] = plan(BIKE).put;
  assert.ok(measured);
  const rated = withSubjective(measured, { rpe: 7, feeling: 4, note: '  Jambes lourdes au début.  ' }, TH);
  assert.deepEqual(rated.subjective, { rpe: 7, feeling: 4, note: 'Jambes lourdes au début.' });
  assert.equal(fosterLoad(rated), 420);                               // RPE 7 × 60 min
  assert.equal(rated.load?.metrics.sessionRpe, 420);
  assert.deepEqual([rated.load?.method, rated.load?.value], [measured.load?.method, measured.load?.value]);   // la charge mesurée ne bouge pas
  const cleared = withSubjective(rated, { rpe: undefined, note: '   ' }, TH);
  assert.deepEqual(cleared.subjective, { feeling: 4 });
  assert.equal(cleared.load?.metrics.sessionRpe, undefined);
  assert.equal(fosterLoad(cleared), null);
  assert.equal(withSubjective(measured, { rpe: 42 }, TH).subjective.rpe, undefined);   // hors échelle : ignoré

  // Séance sans capteur (renforcement) : estimée à la durée, puis à l'effort perçu dès qu'il est saisi.
  const strength: CompletedActivity = { ...measured, id: 'renfo' as ActivityId, sport: 'strength', summary: { elapsedS: 2700, movingS: 2700 }, subjective: {}, load: null, hasStreams: false };
  const estimated = withSubjective(strength, {}, TH);
  assert.equal(estimated.load?.method, 'duration');
  const felt = withSubjective(estimated, { rpe: 8 }, TH);
  assert.equal(felt.load?.method, 'rpe');
  assert.equal(felt.load?.metrics.sessionRpe, 360);                   // 8 × 45 min
  assert.ok((felt.load?.value ?? 0) > (estimated.load?.value ?? 0));
});

test('PMC : moyennes mobiles exponentielles sur 42 et 7 jours, vérifiées à la main', () => {
  const day = (n: number): ISODate => isoDate(new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10));
  // 100 de charge tous les jours : CTL(n) = 100 × (1 − (41/42)ⁿ), ATL(n) = 100 × (1 − (6/7)ⁿ).
  const steady = new Map(Array.from({ length: 60 }, (_, i) => [day(i), 100] as const));
  const curve = performanceCurve(steady, day(0), day(59));
  assert.equal(curve.length, 60);
  near(curve[0]?.ctl, 100 / 42); near(curve[0]?.atl, 100 / 7); near(curve[0]?.tsb, 100 / 42 - 100 / 7);
  near(curve[41]?.ctl, 100 * (1 - (41 / 42) ** 42), 1e-9);            // ≈ 63,7 après 42 jours
  near(curve[6]?.atl, 100 * (1 - (6 / 7) ** 7), 1e-9);                // ≈ 66,0 après 7 jours
  assert.ok((curve[59]?.tsb ?? 0) < 0);                               // charge constante : la fatigue reste devant
  near(rampRate(curve), (curve[59]?.ctl ?? 0) - (curve[52]?.ctl ?? 0));
  assert.equal(rampRate(curve.slice(0, 7)), null);

  // Repos complet : chaque jour, la condition perd 1/42 et la fatigue 1/7. La forme redevient positive.
  const rest = performanceCurve(new Map(), day(60), day(69), { seed: { ctl: 60, atl: 90 } });
  near(rest[0]?.ctl, 60 * 41 / 42); near(rest[0]?.atl, 90 * 6 / 7);
  near(rest[9]?.ctl, 60 * (41 / 42) ** 10); near(rest[9]?.atl, 90 * (6 / 7) ** 10);
  assert.ok((rest[9]?.tsb ?? 0) > 0);
  // Deux séances le même jour s'additionnent en amont ; valeurs invalides = 0 ; bornes inversées = rien.
  const odd = performanceCurve(new Map([[day(0), Number.NaN], [day(1), -50], [day(2), 84]]), day(0), day(2));
  assert.deepEqual(odd.map((d) => d.load), [0, 0, 84]);
  near(odd[2]?.ctl, 2); near(odd[2]?.atl, 12);
  assert.deepEqual(performanceCurve(steady, day(5), day(4)), []);
  assert.deepEqual(performanceCurve(steady, day(0), isoDate('2099-01-01')), []);
});

test('PMC de la saison : réalisé jusqu’à aujourd’hui, projection d’après les séances prévues', () => {
  const today = isoDate('2026-11-12');
  const [base] = plan(BIKE).put;
  assert.ok(base);
  const act = (id: string, date: string, value: number | null): CompletedActivity =>
    ({ ...base, id: id as ActivityId, localDate: isoDate(date), load: value === null ? null : { ...base.load!, value } });
  const workout = (id: string, date: string, load: number | null, activityId: string | null = null): Workout => ({
    id: id as WorkoutId, athleteId: ATHLETE_ID, planId: null, date: isoDate(date), order: 0, sport: 'run', title: id,
    blocks: [{ kind: 'step', id: `b-${id}` as BlockId, role: 'active', profile: 'steady', duration: { kind: 'time', seconds: 3600 }, target: { kind: 'open' } }],
    planned: { durationS: 3600, distanceM: null, load }, activityId: activityId as ActivityId | null, matchedBy: null, createdAt: NOW, updatedAt: NOW,
  });
  const activities = [act('a', '2026-11-08', 84), act('b', '2026-11-10', 42), act('c', '2026-11-10', 42), act('sans-charge', '2026-11-11', null)];
  const workouts = [workout('passée', '2026-11-11', 500), workout('faite', '2026-11-13', 500, 'a'), workout('demain', '2026-11-13', 70), workout('plus-tard', '2026-11-15', 35), workout('sans-charge', '2026-11-16', null)];
  assert.deepEqual([...dailyPlannedLoad(workouts, today)], [['2026-11-13', 70], ['2026-11-15', 35]]);   // ni le passé, ni les séances déjà faites

  const pmc = buildPmc(activities, workouts, today);
  assert.equal(pmc.firstDate, '2026-11-08');
  assert.deepEqual(pmc.points.map((p) => p.date), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.deepEqual(pmc.points.map((p) => p.load), [84, 0, 84, 0, 0, 70, 0, 35]);
  near(pmc.points[0]?.ctl, 2); near(pmc.points[0]?.atl, 12);
  const now = pmc.points[4], tomorrow = pmc.points[5];
  assert.ok(now && tomorrow && pmc.today);
  // Aujourd'hui porte les deux tracés (constaté et projection) pour qu'ils se rejoignent.
  assert.deepEqual([now.ctl, now.ctlPlan, now.tsbPlan], [pmc.today.ctl, pmc.today.ctl, pmc.today.tsb]);
  assert.deepEqual([tomorrow.ctl, tomorrow.atl, tomorrow.tsb], [null, null, null]);
  near(tomorrow.ctlPlan, pmc.today.ctl + (70 - pmc.today.ctl) / 42);
  near(tomorrow.atlPlan, pmc.today.atl + (70 - pmc.today.atl) / 7);
  assert.equal(pmc.warmingUp, true);                                  // moins de 42 jours d'historique
  assert.equal(pmc.ramp, null);
  assert.deepEqual(lastDays(pmc.points, today, 2).map((p) => p.date)[0], '2026-11-10');
  assert.equal(lastDays(pmc.points, today, null).length, 8);

  assert.deepEqual(buildPmc([], workouts, today), { points: [], today: null, ramp: null, firstDate: null, warmingUp: true });
  assert.deepEqual([30, 10, 0, -20, -45].map(formState), ['detraining', 'fresh', 'neutral', 'productive', 'overload']);
});

test('store et sauvegarde : les séries suivent leur activité, de l’import à la restauration', async () => {
  const batches: StoreMutation[][] = [];
  const empty: Snapshot = { athlete: ATHLETE, plans: [], cycles: [], templates: [], workouts: [], activities: [] };
  const port: PersistencePort = { load: async () => empty, commit: async (mutations) => { batches.push([...mutations]); } };
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const { put, streams } = plan(BIKE);
  const id = put[0]!.id;

  store.getState().actions.importActivities(put, streams);
  await flush();
  assert.deepEqual(batches[0]?.map((m) => m.table), ['activities', 'streams']);   // une seule transaction pour les deux
  // Ressenti : enregistré, puis conservé par un réimport du même fichier.
  store.getState().actions.saveActivity(withSubjective(store.getState().calendar.activities[id]!, { rpe: 6, feeling: 2 }, TH));
  store.getState().actions.importActivities(put, streams);
  assert.deepEqual(store.getState().calendar.activities[id]?.subjective, { rpe: 6, feeling: 2 });
  await flush();

  // Sauvegarde version 2 : les séries font l'aller-retour ; celles d'une activité absente sont écartées.
  const content = { ...empty, activities: Object.values(store.getState().calendar.activities) };
  const orphan: ActivityStreams = { activityId: 'inconnue' as ActivityId, timeS: [0, 3], hrBpm: [100, 101] };
  const text = serializeBackup(buildBackup(content as never, NOW, [...streams, orphan]));
  const parsed = parseBackup(text);
  assert.ok(parsed.ok);
  assert.deepEqual([parsed.counts.streams, parsed.streams[0]?.timeS.length, parsed.content.activities[0]?.hasStreams], [1, 1201, true]);
  // Sauvegarde version 1 (avant le Sprint 5) : toujours lisible, les activités sont marquées « sans séries ».
  const v1 = JSON.parse(text) as { version: number; data: { streams?: unknown } };
  v1.version = 1; delete v1.data.streams;
  const old = parseBackup(JSON.stringify(v1));
  assert.ok(old.ok);
  assert.deepEqual([old.streams.length, old.content.activities[0]?.hasStreams, old.content.activities[0]?.subjective.rpe], [0, false, 6]);
  // Séries abîmées (colonne plus courte que le temps) : tout le fichier est refusé.
  const broken = JSON.parse(text) as { data: { streams: { hrBpm: number[] }[] } };
  broken.data.streams[0]!.hrBpm = [1, 2, 3];
  assert.deepEqual(parseBackup(JSON.stringify(broken)), { ok: false, problem: 'invalid_content', detail: 'streams, élément 1' });

  batches.length = 0;
  store.getState().actions.restoreAll(parsed.content, parsed.streams);
  store.getState().actions.removeActivity(id);
  await flush();
  const restore = batches[0]?.[0];
  assert.ok(restore?.table === 'all' && restore.streams.length === 1);
  assert.deepEqual(batches[1], [{ table: 'activities', put: [], remove: [id] }, { table: 'streams', put: [], remove: [id] }]);   // les séries partent avec l'activité
});
