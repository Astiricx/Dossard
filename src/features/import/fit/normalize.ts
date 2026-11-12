// normalize.ts — transforme les messages d'un fichier FIT en activités du domaine. Fonction pure :
// aucune horloge, aucun accès réseau, aucune dépendance au SDK. Une session FIT = une activité
// (un triathlon enregistré en multisport donne donc une activité par discipline).
import { localDateOf, type ActivitySummary, type CompletedActivity, type ISODateTime, type Sport } from '../../../domain/index.ts';
import type { FitMessages, FitRecord, FitSession, FitTime } from './messages.ts';

/** Secondes entre l'époque Unix et l'époque FIT (31 décembre 1989, 00:00 UTC). */
const FIT_EPOCH_S = 631_065_600;
export function fitTimeToMs(value: FitTime | undefined): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? (value + FIT_EPOCH_S) * 1000 : null;
}

// Le SDK officiel écrit les énumérations en camelCase (« fitnessEquipment », « eBiking ») ; d'autres
// décodeurs les écrivent en snake_case. On compare donc sans casse ni séparateur.
const plain = (value: string | number | undefined): string => (typeof value === 'string' ? value.toLowerCase().replace(/[^a-z]/g, '') : '');
const SPORTS: Record<string, Sport> = {
  running: 'run', cycling: 'bike', ebiking: 'bike', swimming: 'swim',
  training: 'strength', fitnessequipment: 'strength', hiit: 'strength',
};
/** Le sport FIT, complété par le sous-sport quand il change la nature de l'effort. */
export function sportFromFit(sport: FitSession['sport'], subSport: FitSession['subSport']): Sport {
  const key = plain(sport), sub = plain(subSport);
  if (key === 'fitnessequipment' && /cycling|spin|bike/.test(sub)) return 'bike';
  if (key === 'fitnessequipment' && /treadmill|running/.test(sub)) return 'run';
  if ((key === 'training' || key === 'fitnessequipment') && /cardio|elliptical|stair|rowing/.test(sub)) return 'other';
  return SPORTS[key] ?? 'other';
}

const positive = (v: number | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const round = (v: number | undefined, digits = 0): number | undefined =>
  v === undefined ? undefined : Math.round(v * 10 ** digits) / 10 ** digits;

/** Activité lue dans le fichier, avant identification, dédoublonnage et calcul de charge. */
export interface ParsedActivity {
  sport: Sport;
  subSport?: string;
  startTime: ISODateTime;
  utcOffsetMin: number;
  localDate: CompletedActivity['localDate'];
  summary: ActivitySummary;
  /** Nom de la séance structurée suivie sur la montre, s'il y en avait une. */
  workoutName?: string;
  device?: string;
  /**
   * Séries à pleine résolution, telles qu'enregistrées : elles servent au calcul de charge (puissance
   * normalisée, TRIMP). Ce qui est stocké en base en est une version allégée (voir import/streams.ts).
   */
  streams: { timeS: number[]; hrBpm?: (number | null)[]; powerW?: (number | null)[]; speedMps?: (number | null)[] } | null;
}
export type ParseFailure = 'no_session' | 'no_start_time' | 'no_duration';
export type ParseResult = { ok: true; activities: ParsedActivity[] } | { ok: false; reason: ParseFailure };

export interface ParseContext {
  /** Décalage UTC (minutes) à appliquer quand le fichier ne le donne pas : celui de l'appareil qui importe. */
  fallbackOffsetMin: (instantMs: number) => number;
}

function buildStreams(records: readonly FitRecord[], startMs: number, endMs: number): ParsedActivity['streams'] {
  const timeS: number[] = [], hr: (number | null)[] = [], power: (number | null)[] = [], speed: (number | null)[] = [];
  let hasHr = false, hasPower = false, hasSpeed = false;
  const nonNegative = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
  for (const r of records) {
    const t = fitTimeToMs(r.timestamp);
    if (t === null || t < startMs || t > endMs) continue;
    timeS.push((t - startMs) / 1000);
    // Seuls quatre champs sont lus : position GPS, température et dynamique de course sont ignorées.
    const h = positive(r.heartRate) ?? null, p = nonNegative(r.power), v = nonNegative(r.enhancedSpeed ?? r.speed);
    hasHr ||= h !== null; hasPower ||= p !== null; hasSpeed ||= v !== null && v > 0;
    hr.push(h); power.push(p); speed.push(v);
  }
  if (timeS.length < 2 || (!hasHr && !hasPower && !hasSpeed)) return null;
  return { timeS, ...(hasHr ? { hrBpm: hr } : {}), ...(hasPower ? { powerW: power } : {}), ...(hasSpeed ? { speedMps: speed } : {}) };
}

export function parseFit(messages: FitMessages, ctx: ParseContext): ParseResult {
  const sessions = messages.sessionMesgs ?? [];
  if (sessions.length === 0) return { ok: false, reason: 'no_session' };
  // Le message « activity » donne l'heure locale : c'est la seule source fiable du fuseau du départ.
  const activityMesg = messages.activityMesgs?.[0];
  const utcMs = fitTimeToMs(activityMesg?.timestamp), localMs = fitTimeToMs(activityMesg?.localTimestamp);
  const fileOffset = utcMs !== null && localMs !== null ? Math.round((localMs - utcMs) / 900_000) * 15 : null;   // fuseaux au quart d'heure
  const workoutName = messages.workoutMesgs?.[0]?.wktName?.trim();
  const id = messages.fileIdMesgs?.[0];
  const device = [id?.manufacturer, id?.garminProduct ?? id?.product].filter((part) => typeof part === 'string').join(' ');

  const activities: ParsedActivity[] = [];
  let failure: ParseFailure = 'no_start_time';
  for (const session of sessions) {
    // Une transition de triathlon est une session à part entière dans le fichier, mais pas une séance.
    if (plain(session.sport) === 'transition') { failure = 'no_session'; continue; }
    const startMs = fitTimeToMs(session.startTime);
    if (startMs === null) continue;
    const elapsedS = positive(session.totalElapsedTime) ?? positive(session.totalTimerTime);
    if (elapsedS === undefined) { failure = 'no_duration'; continue; }
    const movingS = Math.min(elapsedS, positive(session.totalTimerTime) ?? elapsedS);
    const distanceM = positive(session.totalDistance);
    const sport = sportFromFit(session.sport, session.subSport);
    const utcOffsetMin = fileOffset !== null && Math.abs(fileOffset) <= 14 * 60 ? fileOffset : ctx.fallbackOffsetMin(startMs);
    const startTime = new Date(Math.round(startMs / 1000) * 1000).toISOString() as ISODateTime;
    const localDate = localDateOf(startTime, utcOffsetMin);
    if (localDate === null) continue;
    const avgSpeedMps = positive(session.enhancedAvgSpeed) ?? positive(session.avgSpeed) ?? (distanceM !== undefined && movingS > 0 ? distanceM / movingS : undefined);
    const fields: { [K in keyof ActivitySummary]?: ActivitySummary[K] | undefined } = {
      distanceM: round(distanceM), elevationGainM: round(positive(session.totalAscent)),
      avgHrBpm: round(positive(session.avgHeartRate)), maxHrBpm: round(positive(session.maxHeartRate)),
      avgPowerW: round(positive(session.avgPower)), normalizedPowerW: round(positive(session.normalizedPower)),
      avgSpeedMps: round(avgSpeedMps, 3), avgCadenceRpm: round(positive(session.avgCadence)),
    };
    const summary: ActivitySummary = { elapsedS: Math.round(elapsedS), movingS: Math.round(movingS) };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) (summary as unknown as Record<string, number>)[key] = value;
    const subSport = typeof session.subSport === 'string' && session.subSport !== 'generic' ? session.subSport : undefined;
    activities.push({
      sport, startTime, utcOffsetMin, localDate, summary,
      ...(subSport !== undefined ? { subSport } : {}),
      ...(workoutName ? { workoutName } : {}),
      ...(device !== '' ? { device } : {}),
      streams: buildStreams(messages.recordMesgs ?? [], startMs, startMs + elapsedS * 1000),
    });
  }
  return activities.length > 0 ? { ok: true, activities } : { ok: false, reason: failure };
}
