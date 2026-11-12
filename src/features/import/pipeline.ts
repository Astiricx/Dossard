// pipeline.ts — de fichiers bruts à des activités enregistrées, en trois temps :
//   1. readFiles   : ouvre les archives, décode le FIT, normalise (asynchrone, sans état) ;
//   2. planImport  : identifie, dédoublonne, calcule la charge (PUR : c'est lui que les tests visent) ;
//   3. importFiles : applique le plan au store et rapproche les séances prévues.
import { thresholdsAt, type ActivityId, type ActivityStreams, type Athlete, type AthleteId, type CompletedActivity, type ISODateTime, type Sport } from '../../domain/index.ts';
import { resolveActivityLoad } from '../../engine/index.ts';
import type { AppState } from '../../store/app-store.ts';
import { findRecording, fingerprintId, indexByRecording, recordingKey, sameContent } from './fingerprint.ts';
import type { FitDecoder } from './fit/messages.ts';
import { parseFit, type ParseContext, type ParsedActivity } from './fit/normalize.ts';
import type { FileFailure } from './labels.ts';
import { autoMatch } from './match.ts';
import { toStoredStreams } from './streams.ts';
import { looksLikeZip, unzip } from './zip.ts';

export interface SourceFile {
  name: string;
  buffer: ArrayBuffer;
  /** Identifiant de l'activité chez Garmin, quand le fichier vient de la synchronisation. */
  externalId?: string;
}
export type ReadResult =
  | { file: string; ok: true; activities: ParsedActivity[]; externalId?: string }
  | { file: string; ok: false; reason: FileFailure; detail?: string };

const isFitName = (name: string): boolean => /\.fit$/i.test(name) && !name.startsWith('__MACOSX/');

/** Ouvre et décode chaque fichier. Une archive ZIP donne un résultat par fichier .fit qu'elle contient. */
export async function readFiles(files: readonly SourceFile[], decode: FitDecoder, ctx: ParseContext): Promise<ReadResult[]> {
  const results: ReadResult[] = [];
  const readOne = async (name: string, buffer: ArrayBuffer, externalId: string | undefined): Promise<void> => {
    const decoded = await decode(buffer);
    if (!decoded.ok) { results.push({ file: name, ok: false, reason: decoded.reason, ...(decoded.detail !== undefined ? { detail: decoded.detail } : {}) }); return; }
    const parsed = parseFit(decoded.messages, ctx);
    results.push(parsed.ok
      ? { file: name, ok: true, activities: parsed.activities, ...(externalId !== undefined ? { externalId } : {}) }
      : { file: name, ok: false, reason: parsed.reason });
  };
  for (const file of files) {
    try {
      if (!looksLikeZip(file.buffer)) { await readOne(file.name, file.buffer, file.externalId); continue; }
      let entries;
      try { entries = await unzip(file.buffer, isFitName); }
      catch (error) { results.push({ file: file.name, ok: false, reason: 'bad_zip', detail: error instanceof Error ? error.message : String(error) }); continue; }
      if (entries.length === 0) { results.push({ file: file.name, ok: false, reason: 'empty_zip' }); continue; }
      for (const entry of entries) {
        const bytes = entry.bytes;
        await readOne(entries.length === 1 ? file.name : `${file.name} › ${entry.name}`,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, entries.length === 1 ? file.externalId : undefined);
      }
    } catch (error) {
      results.push({ file: file.name, ok: false, reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export type ItemStatus = 'imported' | 'updated' | 'unchanged';
export type FileReport =
  | { file: string; ok: true; items: readonly { status: ItemStatus; id: ActivityId; title: string }[] }
  | { file: string; ok: false; reason: FileFailure; detail?: string };
export interface ImportPlan {
  /** Activités à écrire : les nouvelles et celles dont le contenu a changé. Jamais deux fois la même. */
  put: CompletedActivity[];
  /** Séries allégées des activités de `put` qui en ont. Écrites dans la même transaction qu'elles. */
  streams: ActivityStreams[];
  reports: FileReport[];
  counts: Record<ItemStatus | 'failed', number>;
}
export interface PlanContext {
  existing: Iterable<CompletedActivity>;
  athlete: Pick<Athlete, 'thresholds' | 'sex'> | null;
  athleteId: AthleteId;
  now: ISODateTime;
}

const SPORT_TITLES: Record<Sport, string> = { run: 'Course', bike: 'Sortie vélo', swim: 'Natation', strength: 'Renfo', other: 'Activité' };
/** « Course du matin » : le fichier FIT ne porte pas de titre. L'heure est celle du lieu de départ. */
export function defaultTitle(sport: Sport, startTime: string, utcOffsetMin: number): string {
  const hour = new Date(Date.parse(startTime) + utcOffsetMin * 60_000).getUTCHours();
  const moment = hour < 5 ? 'de nuit' : hour < 11 ? 'du matin' : hour < 14 ? 'de midi' : hour < 18 ? 'de l’après-midi' : 'du soir';
  return `${SPORT_TITLES[sport]} ${moment}`;
}

/**
 * Décide, pour chaque activité lue, si elle est nouvelle, modifiée ou déjà connue.
 * Une activité déjà connue garde son identifiant : sa séance rapprochée et le ressenti saisi par
 * l'athlète sont donc conservés, et le total de la semaine ne peut pas la compter deux fois.
 * La charge est calculée avec les seuils en vigueur à la date de l'activité.
 */
export function planImport(read: readonly ReadResult[], ctx: PlanContext): ImportPlan {
  const index = indexByRecording(ctx.existing);
  const put = new Map<ActivityId, CompletedActivity>();
  const streams = new Map<ActivityId, ActivityStreams>();
  const counts: ImportPlan['counts'] = { imported: 0, updated: 0, unchanged: 0, failed: 0 };
  const reports: FileReport[] = [];
  for (const result of read) {
    if (!result.ok) { counts.failed++; reports.push(result); continue; }
    const items: { status: ItemStatus; id: ActivityId; title: string }[] = [];
    for (const parsed of result.activities) {
      const known = findRecording(index, parsed);
      const subjective = known?.subjective ?? {};
      const thresholds = thresholdsAt(ctx.athlete ?? { thresholds: [] }, parsed.localDate);
      const load = resolveActivityLoad({ sport: parsed.sport, summary: parsed.summary, subjective }, {
        thresholds, ...(ctx.athlete?.sex !== undefined ? { sex: ctx.athlete.sex } : {}), ...(parsed.streams !== null ? { streams: parsed.streams } : {}),
      });
      const externalId = result.externalId ?? known?.source.externalId ?? null;
      const device = parsed.device ?? known?.source.device;
      const id = known?.id ?? fingerprintId(parsed);
      const stored = parsed.streams !== null ? toStoredStreams(id, parsed.streams) : null;
      const activity: CompletedActivity = {
        id,
        athleteId: known?.athleteId ?? ctx.athleteId,
        source: { provider: result.externalId !== undefined ? 'garmin' : (known?.source.provider ?? 'file'), externalId, importedAt: ctx.now, ...(device !== undefined ? { device } : {}) },
        sport: parsed.sport,
        ...(parsed.subSport !== undefined ? { subSport: parsed.subSport } : {}),
        title: known?.title ?? parsed.workoutName ?? defaultTitle(parsed.sport, parsed.startTime, parsed.utcOffsetMin),
        ...(known?.description !== undefined ? { description: known.description } : {}),
        startTime: parsed.startTime, utcOffsetMin: parsed.utcOffsetMin, localDate: parsed.localDate,
        summary: parsed.summary, laps: known?.laps ?? [], hasStreams: stored !== null || (known?.hasStreams ?? false), subjective, load, isRace: known?.isRace ?? false,
      };
      // Une activité importée avant que les séries ne soient conservées est complétée au réimport.
      const gainsStreams = stored !== null && known !== undefined && !known.hasStreams;
      const status: ItemStatus = known === undefined ? 'imported' : sameContent(known, activity) && !gainsStreams ? 'unchanged' : 'updated';
      counts[status]++;
      items.push({ status, id: activity.id, title: activity.title });
      if (status === 'unchanged') continue;
      // Le même enregistrement présent deux fois dans le lot : la seconde lecture sera « déjà connue ».
      index.set(recordingKey(activity), activity);
      put.set(activity.id, activity);
      if (stored !== null) streams.set(activity.id, stored); else streams.delete(activity.id);
    }
    reports.push({ file: result.file, ok: true, items });
  }
  return { put: [...put.values()], streams: [...streams.values()], reports, counts };
}

export interface ImportOutcome extends Omit<ImportPlan, 'put' | 'streams'> {
  /** Séances prévues rapprochées automatiquement d'une activité importée. */
  matched: number;
}
export interface ImportDeps {
  decode: FitDecoder;
  store: { getState: () => Pick<AppState, 'athlete' | 'calendar' | 'actions'> };
  athleteId: AthleteId;
  now: () => ISODateTime;
  fallbackOffsetMin: (instantMs: number) => number;
}

/** Importe un lot de fichiers (.fit ou .zip) et renvoie le compte rendu à afficher. */
export async function importFiles(files: readonly SourceFile[], deps: ImportDeps): Promise<ImportOutcome> {
  const read = await readFiles(files, deps.decode, { fallbackOffsetMin: deps.fallbackOffsetMin });
  // L'état est lu APRÈS le décodage (asynchrone) : le plan part de ce que contient le store à cet instant.
  const before = deps.store.getState();
  const { put, streams, reports, counts } = planImport(read, {
    existing: Object.values(before.calendar.activities), athlete: before.athlete, athleteId: before.athlete?.id ?? deps.athleteId, now: deps.now(),
  });
  before.actions.importActivities(put, streams);
  const pairs = autoMatch(deps.store.getState().calendar, put.map((a) => a.id));
  for (const pair of pairs) deps.store.getState().actions.linkActivity(pair.workoutId, pair.activityId, 'auto');
  return { reports, counts, matched: pairs.length };
}
