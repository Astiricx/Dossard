// Tests du moteur sur des valeurs calculées à la main. Lancer : node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, isoDate, parseISODate, startOfWeek, thresholdsAt, type BlockId, type ResolvedThresholds, type StepBlock, type WorkoutBlock } from '../src/domain/index.ts';
import { banisterTrimp, banisterTrimpFromAverage, cleanSeries, DEFAULT_CONFIG, edwardsTrimp, fosterWeek, hrTss, normalizedPower, paceTss, plannedMetrics, powerTss, powerTssFromSummary, resolveActivityLoad, sessionRpe, thresholdSpeedFromRace } from '../src/engine/index.ts';

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `attendu ${expected} ± ${tolerance}, obtenu ${actual}`);
const constant = (value: number, seconds: number): number[] => Array.from({ length: seconds }, () => value);
const value = <T>(o: { ok: true; value: T } | { ok: false; reason: string }): T => { assert.ok(o.ok, o.ok ? '' : o.reason); return o.value; };
const reason = (o: { ok: boolean; reason?: string }): string | undefined => (o.ok ? undefined : o.reason);

// ---------- Dates ----------
test('dates : validation et arithmétique', () => {
  assert.equal(parseISODate('2026-02-30'), null);
  assert.equal(parseISODate('26-02-01'), null);
  assert.equal(addDays(isoDate('2026-03-28'), 2), '2026-03-30');           // traverse le changement d'heure européen
  assert.equal(startOfWeek(isoDate('2026-11-11')), '2026-11-09');          // mercredi → lundi
  assert.equal(startOfWeek(isoDate('2026-11-15'), 0), '2026-11-15');       // dimanche, semaine à l'américaine
});

// ---------- Puissance ----------
test('TSS : une heure à la FTP vaut exactement 100', () => {
  const r = value(powerTss({ powerW: constant(200, 3600), ftpW: 200 }));
  near(r.tss, 100, 1e-9); near(r.intensityFactor, 1, 1e-12); near(r.variabilityIndex, 1, 1e-12);
});
test('NP : un effort haché coûte plus que sa moyenne', () => {
  const power = Array.from({ length: 3600 }, (_, i) => (Math.floor(i / 300) % 2 === 0 ? 100 : 300));
  const r = value(powerTss({ powerW: power, ftpW: 250 }));
  near(r.avgPowerW, 200, 0.01);
  // Calcul exact : la moyenne glissante passe 1620 s à 300 W, 1621 s à 100 W et 330 s en transition
  // linéaire (moyenne de x⁴ sur 100→300 = 2,42e9). Somme / 3571 = 3,9436e9, racine quatrième = 250,6.
  near(r.normalizedPowerW, 250.6, 0.1);
  assert.ok(r.variabilityIndex > 1.2);
  assert.equal(normalizedPower(constant(200, 29)), null);
});
test('puissance : pics aberrants écartés, trous courts comblés', () => {
  const power: (number | null)[] = constant(200, 3600);
  power[500] = 6000; power[501] = -40; power[1200] = null; power[1201] = Number.NaN;
  const o = powerTss({ powerW: power, ftpW: 200 });
  assert.ok(o.ok);
  near(o.value.tss, 100, 0.01);
  assert.ok(o.warnings.includes('outliers_removed'));
});
test('puissance : enregistrement irrégulier et pause', () => {
  const every5s = Array.from({ length: 720 }, (_, i) => i * 5);
  near(value(powerTss({ powerW: constant(200, 720), timeS: every5s, ftpW: 200 })).tss, 100, 0.2);
  // 30 min, 15 min d'arrêt, 30 min : seules 60 min comptent.
  const timeS = [...Array.from({ length: 1800 }, (_, i) => i), ...Array.from({ length: 1800 }, (_, i) => 2700 + i)];
  const paused = value(powerTss({ powerW: constant(200, 3600), timeS, ftpW: 200 }));
  assert.equal(paused.timerS, 3600);
  near(paused.tss, 100, 1e-6);
});
test('puissance : cas limites', () => {
  assert.equal(reason(powerTss({ powerW: constant(200, 600), ftpW: undefined })), 'missing_threshold');
  assert.equal(reason(powerTss({ powerW: constant(200, 600), ftpW: 5 })), 'invalid_threshold');
  assert.equal(reason(powerTss({ powerW: [], ftpW: 200 })), 'missing_data');
  const mostlyMissing = Array.from({ length: 3600 }, (_, i) => (i % 100 < 40 ? 200 : null));
  assert.equal(reason(powerTss({ powerW: mostlyMissing, ftpW: 200 })), 'insufficient_data');
  const outdated = powerTss({ powerW: constant(230, 3600), ftpW: 200 });
  assert.ok(outdated.ok && outdated.warnings.includes('threshold_maybe_outdated'));
  const short = powerTss({ powerW: constant(300, 600), ftpW: 250 });
  assert.ok(short.ok && short.quality === 'medium' && short.warnings.includes('short_duration'));
  const summary = powerTssFromSummary({ avgPowerW: 180, movingS: 3600, ftpW: 200 });
  assert.ok(summary.ok && summary.quality === 'low');
  near(value(summary).tss, 81, 1e-9);
});
test('cleanSeries : horodatages désordonnés ignorés', () => {
  const s = cleanSeries([100, 999, 100, 100], [0, 0, 1, 2], { min: 0, max: 2500 }, DEFAULT_CONFIG);
  assert.equal(s.timerS, 3);
  assert.deepEqual([...s.samples], [100, 100, 100]);
});

// ---------- Fréquence cardiaque ----------
const profile = { hrMaxBpm: 190, hrRestBpm: 50, sex: 'male' as const };
test('TRIMP de Banister : valeurs de référence', () => {
  // FC 162 = 80 % de la réserve. Homme : 60 × 0,8 × 0,64 × e^(1,92 × 0,8) = 142,7
  near(value(banisterTrimp({ hrBpm: constant(162, 3600) }, profile)).trimp, 142.7, 0.1);
  // Femme : 60 × 0,8 × 0,86 × e^(1,67 × 0,8) = 157,0
  near(value(banisterTrimp({ hrBpm: constant(162, 3600) }, { ...profile, sex: 'female' })).trimp, 157.0, 0.1);
  near(value(banisterTrimpFromAverage({ avgHrBpm: 162, durationS: 3600 }, profile)).trimp, 142.7, 0.1);
});
test('TRIMP : la moyenne sous-estime une séance variable', () => {
  const intervals = Array.from({ length: 3600 }, (_, i) => (Math.floor(i / 180) % 2 === 0 ? 130 : 180));
  const fromStream = value(banisterTrimp({ hrBpm: intervals }, profile)).trimp;
  const fromAverage = value(banisterTrimpFromAverage({ avgHrBpm: 155, durationS: 3600 }, profile)).trimp;
  assert.ok(fromStream > fromAverage * 1.05, `${fromStream} contre ${fromAverage}`);
});
test('TRIMP : artefacts, trous et profils invalides', () => {
  const hr: (number | null)[] = constant(162, 3600);
  for (let i = 1000; i < 1020; i++) hr[i] = 245;            // capteur optique calé sur la cadence
  for (let i = 2000; i < 2300; i++) hr[i] = null;           // ceinture décrochée 5 min
  const o = banisterTrimp({ hrBpm: hr }, profile);
  assert.ok(o.ok);
  near(o.value.trimp, 142.7, 0.1);                          // extrapolé sur les secondes manquantes
  assert.equal(o.value.peakHrBpm, 162);
  assert.ok(o.warnings.includes('outliers_removed'));
  assert.equal(reason(banisterTrimp({ hrBpm: constant(150, 600) }, {})), 'missing_threshold');
  assert.equal(reason(banisterTrimp({ hrBpm: constant(150, 600) }, { hrMaxBpm: 120, hrRestBpm: 100 })), 'invalid_threshold');
  const assumed = banisterTrimp({ hrBpm: constant(150, 600) }, { hrMaxBpm: 190 });
  assert.ok(assumed.ok && assumed.warnings.includes('hr_rest_assumed') && assumed.warnings.includes('sex_assumed'));
  const above = banisterTrimp({ hrBpm: constant(196, 600) }, profile);
  assert.ok(above.ok && above.warnings.includes('hr_above_max'));
});
test('hrTSS : une heure à la FC seuil vaut 100', () => {
  const trimp = value(banisterTrimp({ hrBpm: constant(170, 3600) }, profile)).trimp;
  near(value(hrTss(trimp, 170, profile)), 100, 1e-9);
  assert.equal(reason(hrTss(trimp, 60, profile)), 'invalid_threshold');
});
test('TRIMP d\'Edwards', () => {
  // 30 min à 75 % (zone 3) + 30 min à 95 % (zone 5) = 90 + 150
  const hr = [...constant(142.5, 1800), ...constant(180.5, 1800)];
  const r = value(edwardsTrimp({ hrBpm: hr }, 190));
  near(r.trimp, 240, 1e-9);
  assert.deepEqual(r.secondsInZone, [0, 0, 1800, 0, 1800]);
});

// ---------- Foster ----------
test('Foster : charge de séance, monotonie, contrainte', () => {
  assert.equal(value(sessionRpe({ rpe: 7, durationS: 3600 })), 420);
  assert.equal(reason(sessionRpe({ rpe: 11, durationS: 3600 })), 'invalid_rpe');
  assert.equal(reason(sessionRpe({ rpe: 5, durationS: 0 })), 'invalid_duration');
  assert.equal(reason(sessionRpe({ rpe: undefined, durationS: 3600 })), 'missing_data');
  const week = fosterWeek([300, 0, 300, 0, 300, 0, 0]);
  assert.equal(week.load, 900);
  near(week.monotony ?? 0, 0.8018, 0.001);
  near(week.strain ?? 0, 721.6, 0.5);
  assert.equal(fosterWeek([100, 100, 100, 100, 100, 100, 100]).monotony, null);   // écart-type nul
  assert.equal(fosterWeek([0, 0, 0, 0, 0, 0, 0]).strain, null);
  assert.equal(fosterWeek([Number.NaN, -50, 200, 0, 0, 0, 0]).load, 200);
});

// ---------- Allure ----------
test('TSS à l\'allure : course et natation', () => {
  const threshold = thresholdSpeedFromRace(10_000, 2370);          // 10 km en 39:30
  assert.ok(threshold !== null);
  near(threshold, 4.121, 0.002);                                    // 4'03/km tenable une heure
  near(value(paceTss({ sport: 'run', distanceM: 10_000, movingS: 2370, thresholdSpeedMps: threshold })).tss, 69.0, 0.2);
  near(value(paceTss({ sport: 'swim', distanceM: 3000, movingS: 3600, thresholdSpeedMps: 1 })).tss, 57.87, 0.01);
  assert.equal(reason(paceTss({ sport: 'run', distanceM: 50_000, movingS: 3600, thresholdSpeedMps: 4 })), 'implausible_value');
  assert.equal(reason(paceTss({ sport: 'bike', distanceM: 30_000, movingS: 3600, thresholdSpeedMps: 4 })), 'unsupported_sport');
  assert.equal(thresholdSpeedFromRace(100, 12), null);
});

// ---------- Cascade ----------
const th: ResolvedThresholds = { asOf: isoDate('2026-01-01'), backfilled: false, hrMaxBpm: 190, hrRestBpm: 50, bySport: { run: { thresholdSpeedMps: 4, lthrBpm: 172 }, bike: { ftpW: 250 } } };
test('cascade : la méthode la plus fiable disponible l\'emporte', () => {
  const flat = resolveActivityLoad({ sport: 'run', summary: { elapsedS: 3600, movingS: 3600, distanceM: 12_000 }, subjective: {} }, { thresholds: th });
  assert.equal(flat?.method, 'pace');
  near(flat?.value ?? 0, 69.4, 0.1);                                // IF = 3,333 / 4
  // Trail : l'allure ignore le dénivelé (qualité basse), la FC est préférée.
  const trail = resolveActivityLoad({ sport: 'run', summary: { elapsedS: 3600, movingS: 3600, distanceM: 9000, elevationGainM: 500, avgHrBpm: 165 }, subjective: { rpe: 7 } }, { thresholds: th, sex: 'male' });
  assert.equal(trail?.method, 'hr');
  assert.ok(trail?.metrics.trimp !== undefined && trail.metrics.sessionRpe === 420 && trail.metrics.tss !== undefined);
  const strength = resolveActivityLoad({ sport: 'strength', summary: { elapsedS: 2700, movingS: 2700, avgHrBpm: 110 }, subjective: { rpe: 6 } }, { thresholds: th });
  assert.equal(strength?.method, 'rpe');
  near(strength?.value ?? 0, 52.5, 0.01);                           // 0,75 h × 70
  const bare = resolveActivityLoad({ sport: 'other', summary: { elapsedS: 7200, movingS: 7200 }, subjective: {} }, { thresholds: { asOf: null, backfilled: false, bySport: {} } });
  assert.deepEqual([bare?.method, bare?.quality, bare?.value], ['duration', 'low', 60]);
  const ride = resolveActivityLoad({ sport: 'bike', summary: { elapsedS: 3600, movingS: 3600 }, subjective: {} }, { thresholds: { ...th, backfilled: true }, streams: { timeS: Array.from({ length: 3600 }, (_, i) => i), powerW: constant(250, 3600) } });
  assert.deepEqual([ride?.method, ride?.value, ride?.quality], ['power', 100, 'high']);
  assert.ok(ride?.warnings.includes('threshold_backfilled'));
  assert.equal(resolveActivityLoad({ sport: 'run', summary: { elapsedS: 0, movingS: 0 }, subjective: {} }, { thresholds: th }), null);
});

// ---------- Seuils datés ----------
test('seuils : héritage et application rétroactive', () => {
  const athlete = { thresholds: [
    { validFrom: isoDate('2026-06-01'), bySport: { bike: { ftpW: 260 } } },
    { validFrom: isoDate('2026-01-01'), hrMaxBpm: 190, bySport: { bike: { ftpW: 240, lthrBpm: 168 } } },
  ] };
  const march = thresholdsAt(athlete, isoDate('2026-03-15'));
  assert.deepEqual([march.bySport.bike?.ftpW, march.asOf, march.backfilled], [240, '2026-01-01', false]);
  const july = thresholdsAt(athlete, isoDate('2026-07-01'));
  assert.deepEqual([july.bySport.bike?.ftpW, july.bySport.bike?.lthrBpm, july.hrMaxBpm], [260, 168, 190]);   // FC héritées
  assert.equal(thresholdsAt(athlete, isoDate('2025-06-01')).backfilled, true);
  assert.equal(thresholdsAt({ thresholds: [] }, isoDate('2026-01-01')).asOf, null);
});

// ---------- Charge prévue ----------
const step = (role: StepBlock['role'], seconds: number, low: number, high = low, profile: StepBlock['profile'] = 'steady'): StepBlock =>
  ({ kind: 'step', id: `${role}-${seconds}` as BlockId, role, duration: { kind: 'time', seconds }, target: { kind: 'relative', basis: 'ftp', low, high }, profile });
test('charge prévue : rampe, répétitions, cibles non résolues', () => {
  const blocks: WorkoutBlock[] = [
    step('warmup', 600, 0.5, 0.75, 'ramp'),
    { kind: 'repeat', id: 'r' as BlockId, count: 5, steps: [step('active', 240, 1.05), step('recovery', 120, 0.5)] },
    step('cooldown', 600, 0.55),
  ];
  const vo2 = plannedMetrics({ sport: 'bike', blocks }, th);
  assert.equal(vo2.metrics.durationS, 3000);
  near(vo2.metrics.load ?? 0, 52.6, 0.05);        // 6,60 + 5 × (7,35 + 0,83) + 5,04
  assert.equal(vo2.metrics.distanceM, null);       // à vélo, la distance dépend du terrain

  const run = plannedMetrics({ sport: 'run', blocks: [{ kind: 'step', id: 'k' as BlockId, role: 'active', duration: { kind: 'distance', meters: 8000 }, target: { kind: 'relative', basis: 'threshold_speed', low: 1, high: 1 }, profile: 'steady' }] }, th);
  assert.deepEqual(run.metrics, { durationS: 2000, distanceM: 8000, load: 55.6 });   // 8 km à 4 m/s

  const noFtp = plannedMetrics({ sport: 'bike', blocks: [{ ...step('active', 1200, 0), target: { kind: 'absolute', unit: 'w', low: 200, high: 220 } }] }, { asOf: null, backfilled: false, bySport: {} });
  assert.equal(noFtp.metrics.load, null);
  assert.ok(noFtp.warnings.includes('unresolved_target'));
  assert.deepEqual(plannedMetrics({ sport: 'rest', blocks: [] }, th).metrics, { durationS: 0, distanceM: 0, load: 0 });
});
