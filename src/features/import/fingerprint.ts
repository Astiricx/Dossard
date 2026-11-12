// fingerprint.ts — l'empreinte d'une activité et la détection des doublons. Fonctions pures.
//
// Une montre ne peut pas enregistrer deux activités du même sport qui démarrent à la même seconde :
// (seconde de départ, sport) désigne donc UN enregistrement. La durée complète l'empreinte et sert
// à distinguer « le même fichier, déposé une seconde fois » de « le même enregistrement, modifié ».
import type { ActivityId, CompletedActivity } from '../../domain/index.ts';

type Identity = Pick<CompletedActivity, 'startTime' | 'sport'> & { summary: Pick<CompletedActivity['summary'], 'elapsedS'> };

/** Départ ramené à la seconde, en UTC : « 2026-11-12T10:03:22Z ». */
export const startSecond = (startTime: string): string => `${new Date(startTime).toISOString().slice(0, 19)}Z`;
/** Clé d'un enregistrement : départ à la seconde et sport. */
export const recordingKey = (a: Pick<Identity, 'startTime' | 'sport'>): string => `${startSecond(a.startTime)}|${a.sport}`;

/** Empreinte complète : départ à la seconde, sport, durée totale en secondes. */
export const activityFingerprint = (a: Identity): string => `${recordingKey(a)}|${Math.round(a.summary.elapsedS)}`;
export const fingerprintId = (a: Identity): ActivityId => `fit:${activityFingerprint(a)}` as ActivityId;

/** Index des activités connues, pour retrouver en temps constant celle qui correspond à un fichier. */
export function indexByRecording(activities: Iterable<CompletedActivity>): Map<string, CompletedActivity> {
  const index = new Map<string, CompletedActivity>();
  for (const a of activities) index.set(recordingKey(a), a);
  return index;
}
export const findRecording = (index: ReadonlyMap<string, CompletedActivity>, candidate: Identity): CompletedActivity | undefined =>
  index.get(recordingKey(candidate));

/**
 * true si l'activité relue est identique à celle déjà stockée : mêmes mesures, même charge.
 * La date d'import et ce que l'athlète a saisi (ressenti) n'entrent pas dans la comparaison.
 */
export function sameContent(stored: CompletedActivity, incoming: CompletedActivity): boolean {
  const essence = (a: CompletedActivity): string =>
    JSON.stringify([a.sport, a.subSport ?? null, a.startTime, a.utcOffsetMin, a.localDate, a.summary, a.load, a.source.externalId]);
  return essence(stored) === essence(incoming);
}
