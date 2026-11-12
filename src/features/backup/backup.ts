// backup.ts — sauvegarde et restauration de toutes les données, en JSON. Fonctions pures.
//
// La sauvegarde contient le profil, les seuils, la saison, les modèles, les séances et les
// activités. Elle ne contient JAMAIS les réglages de l'appareil : la clé Garmin est un secret, et
// un fichier de sauvegarde finit tôt ou tard dans une boîte mail ou un dossier partagé.
import { parseISODate, SPORTS, type ActivityStreams, type Athlete, type CompletedActivity, type Cycle, type TrainingPlan, type Workout, type WorkoutTemplate } from '../../domain/index.ts';
import type { Snapshot } from '../../store/app-store.ts';

export const BACKUP_FORMAT = 'dossard-sauvegarde';
/** Version 2 (Sprint 5) : ajoute les séries temporelles. Une sauvegarde en version 1 reste lisible. */
export const BACKUP_VERSION = 2;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  data: BackupContent & { streams: readonly ActivityStreams[] };
}
export type BackupContent = Required<Omit<Snapshot, 'settings'>>;

export function buildBackup(content: BackupContent, exportedAt: string, streams: readonly ActivityStreams[] = []): BackupFile {
  const { athlete, plans, cycles, templates, workouts, activities } = content;       // liste fermée : rien d'autre ne sort
  // Seules les séries d'une activité présente sont exportées : pas de données orphelines.
  const ids = new Set(activities.map((a) => a.id));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data: { athlete, plans, cycles, templates, workouts, activities, streams: streams.filter((s) => ids.has(s.activityId)) } };
}
export const serializeBackup = (backup: BackupFile): string => JSON.stringify(backup);
/** « dossard-sauvegarde-2026-11-12.json » */
export const backupFileName = (exportedAt: string): string => `dossard-sauvegarde-${exportedAt.slice(0, 10)}.json`;

export type BackupProblem = 'not_json' | 'not_a_backup' | 'v1_export' | 'newer_version' | 'invalid_content';
export const BACKUP_PROBLEM_TEXT: Record<BackupProblem, string> = {
  not_json: 'Ce fichier n’est pas un fichier JSON lisible.',
  not_a_backup: 'Ce fichier n’est pas une sauvegarde de Dossard.',
  v1_export: 'Ce fichier est un export de l’ancienne version de Dossard. Sa reprise n’est pas encore disponible.',
  newer_version: 'Cette sauvegarde vient d’une version plus récente de l’application. Mets l’application à jour avant de la restaurer.',
  invalid_content: 'La sauvegarde est abîmée : rien n’a été modifié.',
};
export interface BackupCounts { streams: number; workouts: number; activities: number; thresholds: number; phases: number; races: number; templates: number }
export type BackupParse =
  | { ok: true; content: BackupContent; streams: ActivityStreams[]; exportedAt: string; counts: BackupCounts }
  | { ok: false; problem: BackupProblem; detail?: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isDate = (v: unknown): boolean => typeof v === 'string' && parseISODate(v) !== null;
const isSport = (v: unknown, allowRest = false): boolean => (SPORTS as readonly unknown[]).includes(v) || (allowRest && v === 'rest');
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Contrôles de forme : assez pour qu'aucun objet restauré ne fasse planter l'écran ou les calculs.
const CHECKS: { [K in Exclude<keyof BackupContent, 'athlete'>]: (v: Json) => boolean } = {
  plans: (v) => isText(v['id']) && isDate(v['startDate']) && isDate(v['endDate']) && Array.isArray(v['events'])
    && (v['events'] as unknown[]).every((e) => isObject(e) && isText(e['id']) && isDate(e['date']) && ['A', 'B', 'C'].includes(e['priority'] as string)),
  cycles: (v) => isText(v['id']) && isText(v['planId']) && isDate(v['startDate']) && isDate(v['endDate']) && ['macro', 'meso', 'micro'].includes(v['level'] as string),
  templates: (v) => isText(v['id']) && isSport(v['sport'], true) && typeof v['title'] === 'string' && Array.isArray(v['blocks']),
  workouts: (v) => isText(v['id']) && isDate(v['date']) && isSport(v['sport'], true) && typeof v['title'] === 'string' && Array.isArray(v['blocks']) && isObject(v['planned'])
    && (v['activityId'] === null || isText(v['activityId'])),
  activities: (v) => isText(v['id']) && isDate(v['localDate']) && isSport(v['sport']) && isText(v['startTime']) && !Number.isNaN(Date.parse(v['startTime'] as string))
    && isObject(v['summary']) && isNumber((v['summary'] as Json)['movingS']) && isNumber((v['summary'] as Json)['elapsedS'])
    && isObject(v['source']) && isObject(v['subjective']) && (v['load'] === null || (isObject(v['load']) && isNumber((v['load'] as Json)['value']))),
};
const isAthlete = (v: unknown): boolean => isObject(v) && isText(v['id']) && Array.isArray(v['thresholds'])
  && (v['thresholds'] as unknown[]).every((t) => isObject(t) && isDate(t['validFrom'])) && isObject(v['zones']);

const STREAM_COLUMNS = ['hrBpm', 'powerW', 'speedMps'] as const;
const isStreams = (v: unknown): boolean => isObject(v) && isText(v['activityId'])
  && Array.isArray(v['timeS']) && (v['timeS'] as unknown[]).every(isNumber)
  && STREAM_COLUMNS.every((name) => v[name] === undefined || (Array.isArray(v[name]) && (v[name] as unknown[]).length === (v['timeS'] as unknown[]).length
    && (v[name] as unknown[]).every((x) => x === null || isNumber(x))));

/** Lit une sauvegarde. Tout ou rien : un seul objet invalide et le fichier entier est refusé. */
export function parseBackup(text: string): BackupParse {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, problem: 'not_json' }; }
  if (!isObject(json)) return { ok: false, problem: 'not_a_backup' };
  if (json['format'] !== BACKUP_FORMAT) return { ok: false, problem: json['app'] === 'dossard' ? 'v1_export' : 'not_a_backup' };
  if (!isNumber(json['version']) || !isObject(json['data'])) return { ok: false, problem: 'invalid_content', detail: 'en-tête' };
  if (json['version'] > BACKUP_VERSION) return { ok: false, problem: 'newer_version' };
  const data = json['data'];
  if (data['athlete'] !== null && !isAthlete(data['athlete'])) return { ok: false, problem: 'invalid_content', detail: 'profil' };
  for (const key of Object.keys(CHECKS) as (keyof typeof CHECKS)[]) {
    const list = data[key];
    if (!Array.isArray(list)) return { ok: false, problem: 'invalid_content', detail: key };
    const bad = list.findIndex((item) => !isObject(item) || !CHECKS[key](item));
    if (bad !== -1) return { ok: false, problem: 'invalid_content', detail: `${key}, élément ${bad + 1}` };
  }
  const content: BackupContent = {
    athlete: data['athlete'] as Athlete | null, plans: data['plans'] as TrainingPlan[], cycles: data['cycles'] as Cycle[],
    templates: data['templates'] as WorkoutTemplate[], workouts: data['workouts'] as Workout[], activities: data['activities'] as CompletedActivity[],
  };
  // Séries : absentes d'une sauvegarde en version 1. Celles d'une activité inconnue sont écartées.
  const rawStreams = data['streams'] ?? [];
  if (!Array.isArray(rawStreams)) return { ok: false, problem: 'invalid_content', detail: 'streams' };
  const badStream = rawStreams.findIndex((item) => !isStreams(item));
  if (badStream !== -1) return { ok: false, problem: 'invalid_content', detail: `streams, élément ${badStream + 1}` };
  const activityIds = new Set(content.activities.map((a) => a.id));
  const streams = (rawStreams as ActivityStreams[]).filter((s) => activityIds.has(s.activityId));
  // `hasStreams` dit la vérité de CE fichier : une activité sans ses séries pourra être complétée par un réimport.
  const withStreams = new Set(streams.map((s) => s.activityId));
  content.activities = content.activities.map((a) => (a.hasStreams === withStreams.has(a.id) ? a : { ...a, hasStreams: withStreams.has(a.id) }));
  // Un rapprochement vers une activité absente de la sauvegarde serait un lien mort : on le retire.
  const known = new Set(content.activities.map((a) => a.id));
  content.workouts = content.workouts.map((w) => (w.activityId !== null && !known.has(w.activityId) ? { ...w, activityId: null, matchedBy: null } : w));
  return {
    ok: true, content, streams, exportedAt: isText(json['exportedAt']) ? json['exportedAt'] : '',
    counts: {
      streams: streams.length, workouts: content.workouts.length, activities: content.activities.length, thresholds: content.athlete?.thresholds.length ?? 0,
      phases: content.cycles.filter((c) => c.level === 'macro').length, races: content.plans.reduce((n, p) => n + p.events.length, 0), templates: content.templates.length,
    },
  };
}
