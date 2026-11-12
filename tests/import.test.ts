import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { isoDate, type ActivityId, type Athlete, type AthleteId, type BlockId, type CompletedActivity, type ISODateTime, type Workout, type WorkoutId } from '../src/domain/index.ts';
import { backupFileName, buildBackup, parseBackup, serializeBackup } from '../src/features/backup/backup.ts';
import { libraryItems, placeCopy, starterTemplates } from '../src/features/calendar/model/library.ts';
import { makeWeekSummary } from '../src/features/calendar/model/weeks.ts';
import { activityFingerprint, fingerprintId } from '../src/features/import/fingerprint.ts';
import type { FitDecoder, FitMessages } from '../src/features/import/fit/messages.ts';
import { fitTimeToMs, parseFit, sportFromFit } from '../src/features/import/fit/normalize.ts';
import { fetchRecentGarminFiles, GARMIN_API, garminFailureText, readAccessToken, readActivityIds } from '../src/features/import/garmin/client.ts';
import { autoMatch } from '../src/features/import/match.ts';
import { defaultTitle, importFiles, planImport, readFiles, type ReadResult, type SourceFile } from '../src/features/import/pipeline.ts';
import { looksLikeZip, unzip } from '../src/features/import/zip.ts';
import { createAppStore, type PersistencePort, type Snapshot, type StoreMutation } from '../src/store/app-store.ts';
import { buildCalendar, removeActivity } from '../src/store/calendar.ts';

const NOW = '2026-11-12T12:00:00.000Z' as ISODateTime;
const ATHLETE_ID = 'local' as AthleteId;
// Seuil course 4:00/km, FTP 250 W, FC max 200 : valables depuis le 1er janvier 2026.
const ATHLETE: Athlete = {
  id: ATHLETE_ID, displayName: 'Test', timezone: 'America/Argentina/Cordoba', firstDayOfWeek: 1, zones: {},
  thresholds: [{ validFrom: isoDate('2026-01-01'), hrMaxBpm: 200, hrRestBpm: 50, bySport: { run: { thresholdSpeedMps: 1000 / 240 }, bike: { ftpW: 250 } } }],
};
const CTX = { fallbackOffsetMin: () => 0 };
const FIT_EPOCH_S = 631_065_600;
const fitTime = (iso: string): number => Date.parse(iso) / 1000 - FIT_EPOCH_S;

/** Footing de 10 km en 40 min, parti le 10 nov. 2026 à 07:30 heure de Córdoba (UTC−3). */
const RUN: FitMessages = {
  activityMesgs: [{ timestamp: fitTime('2026-11-10T11:12:00Z'), localTimestamp: fitTime('2026-11-10T08:12:00Z') }],
  sessionMesgs: [{ startTime: fitTime('2026-11-10T10:30:00Z'), sport: 'running', subSport: 'generic', totalElapsedTime: 2520.4, totalTimerTime: 2400, totalDistance: 10_000, avgHeartRate: 162, maxHeartRate: 181, totalAscent: 35, enhancedAvgSpeed: 4.167 }],
};
/** Une heure de vélo à 250 W constants, une mesure par seconde. */
const BIKE: FitMessages = {
  sessionMesgs: [{ startTime: new Date('2026-11-11T16:00:00Z'), sport: 'cycling', totalElapsedTime: 3600, totalTimerTime: 3600, totalDistance: 32_000, avgPower: 250, avgHeartRate: 150 }],
  recordMesgs: Array.from({ length: 3601 }, (_, i) => ({ timestamp: new Date(Date.parse('2026-11-11T16:00:00Z') + i * 1000), power: 250, heartRate: 150 })),
};
const encode = (messages: FitMessages): ArrayBuffer => {
  const bytes = new TextEncoder().encode(JSON.stringify(messages, (_k, v: unknown) => v));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
/** Décodeur de test : le « fichier » est le JSON des messages. Le vrai SDK n'est pas chargé. */
const decode: FitDecoder = async (buffer) => {
  const text = new TextDecoder().decode(buffer);
  if (!text.startsWith('{')) return { ok: false, reason: 'not_fit' };
  const messages = JSON.parse(text, (key, value: unknown) => (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && key !== 'wktName' ? new Date(value) : value)) as FitMessages;
  return { ok: true, messages };
};
const file = (name: string, messages: FitMessages, externalId?: string): SourceFile => ({ name, buffer: encode(messages), ...(externalId ? { externalId } : {}) });
const read = async (...files: SourceFile[]): Promise<ReadResult[]> => readFiles(files, decode, CTX);
const plan = (results: ReadResult[], existing: CompletedActivity[] = [], athlete: Athlete | null = ATHLETE) =>
  planImport(results, { existing, athlete, athleteId: ATHLETE_ID, now: NOW });
const workout = (id: string, date: string, patch: Partial<Workout> = {}): Workout => ({
  id: id as WorkoutId, athleteId: ATHLETE_ID, planId: null, date: isoDate(date), order: 0, sport: 'run', title: `Séance ${id}`,
  blocks: [{ kind: 'step', id: `b-${id}` as BlockId, role: 'active', profile: 'steady', duration: { kind: 'time', seconds: 2400 }, target: { kind: 'open' } }],
  planned: { durationS: 2400, distanceM: 9000, load: 60 }, activityId: null, matchedBy: null, createdAt: NOW, updatedAt: NOW, ...patch,
});

/** Écrit une archive ZIP minimale (une entrée compressée, une stockée) pour tester le lecteur. */
function makeZip(entries: { name: string; data: Uint8Array; store?: boolean }[]): ArrayBuffer {
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name), body = e.store ? e.data : new Uint8Array(deflateRawSync(e.data));
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, e.store ? 0 : 8, true); lv.setUint32(18, body.length, true); lv.setUint32(22, e.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const dir = new Uint8Array(46 + name.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(10, e.store ? 0 : 8, true); dv.setUint32(20, body.length, true); dv.setUint32(24, e.data.length, true); dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true);
    dir.set(name, 46);
    chunks.push(local, body); central.push(dir); offset += local.length + body.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0; for (const c of all) { out.set(c, at); at += c.length; }
  return out.buffer;
}

test('FIT : sport, époque FIT, fuseau du départ et mesures de la session', () => {
  assert.equal(fitTimeToMs(0), null);
  assert.equal(fitTimeToMs(fitTime('2026-11-10T10:30:00Z')), Date.parse('2026-11-10T10:30:00Z'));
  assert.equal(sportFromFit('running', 'trail'), 'run');
  // Le SDK officiel écrit les énumérations en camelCase ; d'autres décodeurs en snake_case.
  assert.equal(sportFromFit('fitnessEquipment', 'indoorCycling'), 'bike');
  assert.equal(sportFromFit('fitness_equipment', 'indoor_cycling'), 'bike');
  assert.equal(sportFromFit('fitnessEquipment', 'treadmill'), 'run');
  assert.equal(sportFromFit('eBiking', 'generic'), 'bike');
  assert.equal(sportFromFit('training', 'strengthTraining'), 'strength');
  assert.equal(sportFromFit('training', 'cardioTraining'), 'other');
  assert.equal(sportFromFit('hiking', undefined), 'other');
  // Triathlon : trois disciplines, deux transitions ; les transitions ne deviennent pas des séances.
  const triathlon = parseFit({ sessionMesgs: (['swimming', 'transition', 'cycling', 'transition', 'running'] as const).map((sport, i) =>
    ({ startTime: fitTime(`2026-11-08T1${i}:00:00Z`), sport, totalTimerTime: 1200 })) }, CTX);
  assert.deepEqual(triathlon.ok && triathlon.activities.map((a) => a.sport), ['swim', 'bike', 'run']);
  assert.equal(sportFromFit('fitness_equipment', 'indoor_cycling'), 'bike');
  assert.equal(sportFromFit('training', 'strength_training'), 'strength');
  assert.equal(sportFromFit('hiking', undefined), 'other');
  assert.equal(sportFromFit(1, undefined), 'other');                 // énumération non convertie : pas de supposition

  const parsed = parseFit(RUN, CTX);
  assert.ok(parsed.ok);
  const [run] = parsed.activities;
  assert.equal(run?.startTime, '2026-11-10T10:30:00.000Z');
  assert.equal(run?.utcOffsetMin, -180);                             // lu dans le fichier, pas sur l'ordinateur
  assert.equal(run?.localDate, '2026-11-10');
  assert.deepEqual(run?.summary, { elapsedS: 2520, movingS: 2400, distanceM: 10_000, elevationGainM: 35, avgHrBpm: 162, maxHrBpm: 181, avgSpeedMps: 4.167 });
  assert.equal(run?.streams, null);

  // Sortie à 23 h locale : sans fuseau dans le fichier, c'est celui de l'appareil qui tranche le jour.
  const late: FitMessages = { sessionMesgs: [{ startTime: fitTime('2026-11-11T02:00:00Z'), sport: 'running', totalTimerTime: 1800 }] };
  const local = parseFit(late, { fallbackOffsetMin: () => -180 });
  assert.ok(local.ok);
  assert.equal(local.activities[0]?.localDate, '2026-11-10');
  assert.deepEqual(parseFit({ sessionMesgs: [] }, CTX), { ok: false, reason: 'no_session' });
  assert.deepEqual(parseFit({ sessionMesgs: [{ sport: 'running', totalTimerTime: 60 }] }, CTX), { ok: false, reason: 'no_start_time' });
  assert.deepEqual(parseFit({ sessionMesgs: [{ startTime: fitTime('2026-11-10T10:30:00Z'), sport: 'running' }] }, CTX), { ok: false, reason: 'no_duration' });
});

test('charge réalisée : calculée par le moteur avec les seuils en vigueur à la date de la sortie', async () => {
  const { put, counts } = plan(await read(file('run.fit', RUN), file('bike.fit', BIKE)));
  assert.deepEqual(counts, { imported: 2, updated: 0, unchanged: 0, failed: 0 });
  const [run, bike] = put;
  // 10 km en 40 min de course = 4:00/km, exactement l'allure seuil : IF 1, donc 100 × 40/60 = 66,7.
  assert.equal(run?.load?.method, 'pace');
  assert.equal(run?.load?.value, 66.7);
  assert.equal(run?.load?.thresholdsAsOf, '2026-01-01');
  assert.equal(run?.title, 'Course du matin');                       // 07:30 à Córdoba
  // 1 h à 250 W constants pour une FTP de 250 W : puissance normalisée 250, TSS 100, sur la série.
  assert.equal(bike?.load?.method, 'power');
  assert.equal(bike?.load?.value, 100);
  assert.equal(bike?.load?.metrics.normalizedPowerW, 250);
  assert.equal(bike?.load?.quality, 'high');
  assert.equal(bike?.hasStreams, true);

  // Avant le premier relevé de seuils : le seuil est appliqué rétroactivement, et c'est signalé.
  const old: FitMessages = { sessionMesgs: [{ ...RUN.sessionMesgs![0], startTime: fitTime('2025-06-01T10:30:00Z') }] };
  const [early] = plan(await read(file('old.fit', old))).put;
  assert.ok(early?.load?.warnings.includes('threshold_backfilled'));
  // Sans aucun seuil : la charge retombe sur la fréquence cardiaque ou la durée, jamais sur une invention.
  const [bare] = plan(await read(file('run.fit', RUN)), [], null).put;
  assert.equal(bare?.load?.method, 'duration');
  assert.equal(bare?.load?.quality, 'low');
});

test('anti-doublon : même enregistrement = même activité, quel que soit le nombre d’imports', async () => {
  const first = plan(await read(file('run.fit', RUN)));
  const stored = first.put[0]!;
  assert.equal(activityFingerprint(stored), '2026-11-10T10:30:00Z|run|2520');
  assert.equal(stored.id, fingerprintId(stored));

  // Même fichier redéposé, sous un autre nom : rien à écrire.
  const again = plan(await read(file('copie (2).fit', RUN)), [stored]);
  assert.deepEqual(again.counts, { imported: 0, updated: 0, unchanged: 1, failed: 0 });
  assert.equal(again.put.length, 0);
  // Deux fois dans le même lot : une seule activité.
  const twice = plan(await read(file('a.fit', RUN), file('b.fit', RUN)));
  assert.deepEqual([twice.counts.imported, twice.counts.unchanged, twice.put.length], [1, 1, 1]);

  // Enregistrement retouché (raccourci) : même départ, même sport → mise à jour, même identifiant,
  // et ce que l'athlète avait saisi est conservé.
  const withRpe = { ...stored, subjective: { rpe: 6 }, title: 'Seuil au parc' };
  const trimmed: FitMessages = { ...RUN, sessionMesgs: [{ ...RUN.sessionMesgs![0], totalElapsedTime: 2000, totalTimerTime: 1900, totalDistance: 8000 }] };
  const updated = plan(await read(file('run.fit', trimmed)), [withRpe]);
  assert.deepEqual(updated.counts, { imported: 0, updated: 1, unchanged: 0, failed: 0 });
  assert.equal(updated.put[0]?.id, stored.id);
  assert.equal(updated.put[0]?.summary.distanceM, 8000);
  assert.deepEqual(updated.put[0]?.subjective, { rpe: 6 });
  assert.equal(updated.put[0]?.title, 'Seuil au parc');

  // Un changement de seuils modifie la charge : réimporter met à jour, sans dupliquer.
  const fitter: Athlete = { ...ATHLETE, thresholds: [{ ...ATHLETE.thresholds[0]!, bySport: { run: { thresholdSpeedMps: 1000 / 230 } } }] };
  const recomputed = plan(await read(file('run.fit', RUN)), [stored], fitter);
  assert.equal(recomputed.counts.updated, 1);
  assert.ok((recomputed.put[0]?.load?.value ?? 99) < 66.7);

  // Une autre sortie le même jour (départ différent) reste une autre activité.
  const evening: FitMessages = { sessionMesgs: [{ ...RUN.sessionMesgs![0], startTime: fitTime('2026-11-10T21:00:00Z') }] };
  assert.equal(plan(await read(file('soir.fit', evening)), [stored]).counts.imported, 1);
});

test('lot de fichiers : archives ZIP ouvertes, fichiers illisibles signalés sans bloquer les autres', async () => {
  const fit = new Uint8Array(encode(RUN));
  const zip = makeZip([{ name: 'activite.fit', data: fit }, { name: 'lisezmoi.txt', data: new TextEncoder().encode('bonjour'), store: true }, { name: 'dossier/', data: new Uint8Array(), store: true }]);
  assert.ok(looksLikeZip(zip));
  assert.ok(!looksLikeZip(encode(RUN)));
  assert.deepEqual((await unzip(zip)).map((e) => [e.name, e.bytes.length]), [['activite.fit', fit.length], ['lisezmoi.txt', 7]]);

  const results = await read(
    { name: '12345_ACTIVITY.zip', buffer: zip },
    { name: 'photo.jpg', buffer: new TextEncoder().encode('JFIF').buffer as ArrayBuffer },
    { name: 'vide.zip', buffer: makeZip([{ name: 'lisezmoi.txt', data: new Uint8Array([1]), store: true }]) },
    file('reglages.fit', { sessionMesgs: [] }),
    file('bike.fit', BIKE),
  );
  assert.deepEqual(results.map((r) => (r.ok ? `ok:${r.activities.length}` : r.reason)), ['ok:1', 'not_fit', 'empty_zip', 'no_session', 'ok:1']);
  assert.deepEqual(plan(results).counts, { imported: 2, updated: 0, unchanged: 0, failed: 3 });
  await assert.rejects(unzip(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]).buffer as ArrayBuffer), /table des matières/);
  assert.equal(defaultTitle('bike', '2026-11-11T22:30:00Z', -180), 'Sortie vélo du soir');
});

test('rapprochement automatique : même jour, même sport, sans deviner en cas d’égalité', async () => {
  const { put } = plan(await read(file('run.fit', RUN), file('bike.fit', BIKE)));
  const run = put[0]!, bike = put[1]!;
  const one = buildCalendar([workout('w1', '2026-11-10'), workout('w2', '2026-11-11'), workout('w3', '2026-11-11', { sport: 'bike' })], put);
  assert.deepEqual(autoMatch(one, put.map((a) => a.id)), [{ workoutId: 'w1', activityId: run.id }, { workoutId: 'w3', activityId: bike.id }]);
  // Deux séances de course le même jour : la durée prévue la plus proche des 40 min réalisées l'emporte.
  const two = buildCalendar([workout('court', '2026-11-10', { planned: { durationS: 1200, distanceM: null, load: 20 } }), workout('long', '2026-11-10', { order: 1 })], put);
  assert.deepEqual(autoMatch(two, [run.id]), [{ workoutId: 'long', activityId: run.id }]);
  // Égalité parfaite : on laisse la main à l'athlète.
  assert.deepEqual(autoMatch(buildCalendar([workout('a', '2026-11-10'), workout('b', '2026-11-10', { order: 1 })], put), [run.id]), []);
  // Déjà rapprochée, ou séance déjà prise : rien.
  assert.deepEqual(autoMatch(buildCalendar([workout('w1', '2026-11-10', { activityId: run.id, matchedBy: 'manual' }), workout('w4', '2026-11-10', { order: 1 })], put), [run.id]), []);
});

test('prévu contre réalisé : totaux de la semaine, import répété sans effet, suppression', async () => {
  const written: StoreMutation[] = [];
  const empty: Snapshot = { athlete: ATHLETE, plans: [], cycles: [], templates: [], workouts: [workout('w1', '2026-11-10'), workout('w3', '2026-11-11', { sport: 'bike', planned: { durationS: 3600, distanceM: null, load: 95 } })], activities: [] };
  const port: PersistencePort = { load: async () => empty, commit: async (mutations) => { written.push(...mutations); } };
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  const deps = { decode, store, athleteId: ATHLETE_ID, now: () => NOW, fallbackOffsetMin: () => 0 };
  const week = makeWeekSummary(isoDate('2026-11-09'));

  const before = week(store.getState().calendar);
  assert.deepEqual([before.planned.load, before.completed.count, before.completed.load], [155, 0, 0]);

  const outcome = await importFiles([file('run.fit', RUN), file('bike.fit', BIKE), file('run-bis.fit', RUN)], deps);
  assert.deepEqual(outcome.counts, { imported: 2, updated: 0, unchanged: 1, failed: 0 });
  assert.equal(outcome.matched, 2);
  const after = week(store.getState().calendar);
  assert.deepEqual(after.completed, { count: 2, durationS: 6000, distanceM: 42_000, load: 166.7, loadPartial: false, dailyLoad: [0, 66.7, 100, 0, 0, 0, 0] });
  assert.deepEqual(after.planned, before.planned);                   // rapprocher ne change pas le prévu
  assert.equal(store.getState().calendar.workouts['w1' as WorkoutId]?.matchedBy, 'auto');

  // Réimporter toute la semaine : aucun total ne change, aucune écriture d'activité.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const writesBefore = written.length;
  const second = await importFiles([file('run.fit', RUN), file('bike.fit', BIKE)], deps);
  assert.deepEqual(second.counts, { imported: 0, updated: 0, unchanged: 2, failed: 0 });
  assert.equal(week(store.getState().calendar), after);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(written.length, writesBefore);

  // Supprimer une activité libère sa séance et retire sa charge de la semaine.
  const runId = outcome.reports[0]!.ok ? outcome.reports[0]!.items[0]!.id : ('' as ActivityId);
  store.getState().actions.removeActivity(runId);
  assert.equal(store.getState().calendar.workouts['w1' as WorkoutId]?.activityId, null);
  assert.equal(week(store.getState().calendar).completed.load, 100);
  assert.equal(removeActivity(store.getState().calendar, 'inconnue' as ActivityId, NOW)[1].length, 0);
});

test('Garmin : échange de la clé, téléchargement des nouveautés par le relais, et pannes traitées comme des résultats', async () => {
  assert.equal(readAccessToken('eyJhbGciOi.abc.def\n'), 'eyJhbGciOi.abc.def');
  assert.equal(readAccessToken('{"access_token":"t0k"}'), 't0k');
  assert.equal(readAccessToken('<html>erreur</html> page'), null);
  assert.deepEqual(readActivityIds([{ activityId: 42 }, { activityId: '43' }]), ['42', '43']);
  assert.deepEqual(readActivityIds({ activities: [] }), []);
  assert.equal(readActivityIds([{ id: 1 }]), null);                  // forme inattendue : on ne devine pas
  assert.equal(readActivityIds('oups'), null);

  const RELAY = 'https://relais.exemple.workers.dev';
  const calls: string[] = [];
  const ok = (body: BodyInit): Response => new Response(body, { status: 200 });
  const api: typeof fetch = async (input, init) => {
    const url = String(input), auth = new Headers(init?.headers).get('Authorization');
    calls.push(`${init?.method ?? 'GET'} ${url.replace(RELAY, '')} ${auth}`);
    if (url.endsWith(GARMIN_API.tokenPath)) return auth === 'ApiKey bonne-cle' ? ok('jeton.de.test') : new Response('', { status: 401 });
    if (url.includes(`${GARMIN_API.searchPath}?`)) return ok(JSON.stringify([{ activityId: 3 }, { activityId: 2 }, { activityId: 1 }]));
    if (url.endsWith('/2')) return new Response('', { status: 404 });
    return ok(new Uint8Array(encode(RUN)));
  };
  const result = await fetchRecentGarminFiles('bonne-cle', { fetch: api, relayUrl: `${RELAY}/`, online: () => true, knownIds: new Set(['1']) });
  assert.ok(result.ok);
  assert.deepEqual([result.listed, result.alreadyKnown, result.failedDownloads, result.files.map((f) => f.externalId)], [3, 1, 1, ['3']]);
  assert.deepEqual(calls, [
    `POST ${GARMIN_API.tokenPath} ApiKey bonne-cle`,
    `GET ${GARMIN_API.searchPath}?start=0&limit=20 Bearer jeton.de.test`,
    'GET /download-service/files/activity/3 Bearer jeton.de.test',
    'GET /download-service/files/activity/2 Bearer jeton.de.test',
  ]);
  // Les fichiers obtenus passent par le même import : l'activité porte l'identifiant Garmin.
  const [fromGarmin] = plan(await read(...result.files)).put;
  assert.deepEqual([fromGarmin?.source.provider, fromGarmin?.source.externalId], ['garmin', '3']);

  assert.deepEqual(await fetchRecentGarminFiles('mauvaise', { fetch: api, relayUrl: RELAY, online: () => true, knownIds: new Set() }), { ok: false, failure: { kind: 'unauthorized', step: 'token', status: 401 } });
  // Sans relais, rien n'est tenté : l'appel direct serait bloqué par le navigateur.
  const never: typeof fetch = async () => { throw new Error('aucun appel attendu'); };
  assert.deepEqual(await fetchRecentGarminFiles('bonne-cle', { fetch: never, relayUrl: undefined, online: () => true, knownIds: new Set() }), { ok: false, failure: { kind: 'no_relay' } });
  assert.deepEqual(await fetchRecentGarminFiles('bonne-cle', { fetch: never, relayUrl: 'pas une adresse', online: () => true, knownIds: new Set() }), { ok: false, failure: { kind: 'no_relay' } });
  // Relais injoignable (adresse fausse, pas déployé) : fetch lève une TypeError.
  const deadFetch: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await fetchRecentGarminFiles('bonne-cle', { fetch: deadFetch, relayUrl: RELAY, online: () => true, knownIds: new Set() }), { ok: false, failure: { kind: 'relay_unreachable', step: 'token' } });
  assert.match(garminFailureText({ kind: 'relay_unreachable', step: 'token' }).body, /Tester le relais.*Exporter le fichier d’origine/s);
  assert.deepEqual(await fetchRecentGarminFiles('bonne-cle', { fetch: deadFetch, relayUrl: RELAY, online: () => false, knownIds: new Set() }), { ok: false, failure: { kind: 'offline' } });
});

test('sauvegarde JSON : aller-retour complet, sans la clé Garmin, et refus des fichiers douteux', async () => {
  const { put, streams } = plan(await read(file('run.fit', RUN)));
  const linked = workout('w1', '2026-11-10', { activityId: put[0]!.id, matchedBy: 'auto' });
  const orphan = workout('w2', '2026-11-11', { activityId: 'disparue' as ActivityId, matchedBy: 'manual' });
  const content = { athlete: ATHLETE, plans: [], cycles: [], templates: starterTemplates(ATHLETE_ID), workouts: [linked, orphan], activities: put };
  const text = serializeBackup(buildBackup({ ...content, settings: { garminToken: 'SECRET-GARMIN-1234' } } as never, NOW, streams));
  assert.ok(!text.includes('SECRET-GARMIN-1234'));
  assert.ok(!text.includes('garminToken'));
  assert.equal(backupFileName(NOW), 'dossard-sauvegarde-2026-11-12.json');

  const parsed = parseBackup(text);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.counts, { streams: 0, workouts: 2, activities: 1, thresholds: 1, phases: 0, races: 0, templates: 3 });
  assert.deepEqual(parsed.content.activities, put);
  assert.deepEqual(parsed.content.athlete, ATHLETE);
  assert.equal(parsed.content.workouts[0]?.activityId, put[0]!.id);
  assert.equal(parsed.content.workouts[1]?.activityId, null);        // lien vers une activité absente : retiré

  assert.deepEqual(parseBackup('pas du json'), { ok: false, problem: 'not_json' });
  assert.deepEqual(parseBackup('{"foo":1}'), { ok: false, problem: 'not_a_backup' });
  assert.deepEqual(parseBackup('{"app":"dossard","preparations":[]}'), { ok: false, problem: 'v1_export' });
  assert.deepEqual(parseBackup(text.replace('"version":2', '"version":99')), { ok: false, problem: 'newer_version' });
  const broken = JSON.parse(text) as { data: { workouts: { date: string }[] } };
  broken.data.workouts[1]!.date = '2026-02-30';
  assert.deepEqual(parseBackup(JSON.stringify(broken)), { ok: false, problem: 'invalid_content', detail: 'workouts, élément 2' });

  // Restauration : tout est remplacé, la clé de l'appareil est conservée, une seule écriture atomique.
  const written: StoreMutation[] = [];
  const port: PersistencePort = { load: async () => ({ athlete: null, plans: [], cycles: [], templates: [], workouts: [workout('ancienne', '2026-10-01')], activities: [], settings: { garminToken: 'cle-locale' } }), commit: async (m) => { written.push(...m); } };
  const store = createAppStore(port, () => NOW);
  await store.getState().actions.boot();
  store.getState().actions.restoreAll(parsed.content);
  const state = store.getState();
  assert.deepEqual(Object.keys(state.calendar.workouts), ['w1', 'w2']);
  assert.deepEqual(state.calendar.activityIdsByDate['2026-11-10' as never], [put[0]!.id]);
  assert.equal(state.settings.garminToken, 'cle-locale');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(written.map((m) => m.table), ['all']);
  assert.ok(!JSON.stringify(written).includes('cle-locale'));
});

test('bibliothèque : trois modèles de départ, utilisables sans seuils, sans doublon une fois posés', () => {
  const templates = starterTemplates(ATHLETE_ID);
  assert.deepEqual(templates.map((t) => t.sport), ['run', 'bike', 'swim']);
  const fresh = libraryItems({}, templates);
  assert.deepEqual(fresh.map((item) => [item.source.title, item.uses, item.planned.durationS]), [['Fractionné 6 × 3 min', 0, 3300], ['Sweet spot 2 × 20 min', 0, 4500], ['Endurance 6 × 3 min', 0, 2160]]);
  assert.ok(fresh.every((item) => item.planned.load !== null && item.planned.load > 0));
  // Vélo, calcul à la main (charge = heures × intensité² × 100) :
  //   rampe 15 min de 50 à 70 % : moyenne de i² = (0,25 + 0,35 + 0,49) / 3 → 9,08
  //   2 × 20 min à 90,5 % → 54,60 ; 2 × 5 min à 52,5 % → 4,59 ; 10 min à 50 % → 4,17. Total 72,4.
  assert.equal(fresh[1]?.planned.load, 72.4);
  const placed = placeCopy(templates[1]!, isoDate('2026-11-14'), { athlete: ATHLETE, athleteId: ATHLETE_ID, now: NOW, countOnDate: 0 });
  assert.equal(placed.planned.load, 72.4);
  assert.equal('tags' in placed, false);
  const after = libraryItems({ [placed.id]: placed }, templates);
  assert.deepEqual(after.map((item) => [item.source.title, item.uses]), [['Sweet spot 2 × 20 min', 1], ['Fractionné 6 × 3 min', 0], ['Endurance 6 × 3 min', 0]]);
});

test('démarrage : deux appels à boot() ne chargent la base qu’une fois et n’écrasent pas les premières écritures', async () => {
  let loads = 0;
  const empty: Snapshot = { athlete: null, plans: [], cycles: [], templates: [], workouts: [], activities: [] };
  const port: PersistencePort = { load: async () => { loads++; await new Promise((r) => setTimeout(r, 5)); return empty; }, commit: async () => {} };
  const store = createAppStore(port, () => NOW);
  const first = store.getState().actions.boot();
  const second = store.getState().actions.boot();          // React, en mode strict, lance les effets deux fois
  await first;
  store.getState().actions.saveTemplates(starterTemplates(ATHLETE_ID));
  await second;
  assert.equal(loads, 1);
  assert.equal(store.getState().templates.length, 3);
});
