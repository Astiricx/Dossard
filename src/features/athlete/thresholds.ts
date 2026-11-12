// thresholds.ts — ajout et retrait d'un relevé de seuils daté. Fonctions pures.
import { type Athlete, type AthleteId, type ISODate, type ThresholdSnapshot } from '../../domain/index.ts';

/** Application à un seul athlète, sans compte : son identifiant est fixe. */
export const LOCAL_ATHLETE_ID = 'local' as AthleteId;

export function createAthlete(timezone: string): Athlete {
  return { id: LOCAL_ATHLETE_ID, displayName: 'Athlète', timezone, firstDayOfWeek: 1, thresholds: [], zones: {} };
}

/** Ajoute un relevé. S'il en existe déjà un à cette date, le nouveau le remplace. Trié par date. */
export function upsertSnapshot(athlete: Athlete, snapshot: ThresholdSnapshot): Athlete {
  const others = athlete.thresholds.filter((s) => s.validFrom !== snapshot.validFrom);
  return { ...athlete, thresholds: [...others, snapshot].sort((a, b) => a.validFrom.localeCompare(b.validFrom)) };
}

export function removeSnapshot(athlete: Athlete, validFrom: ISODate): Athlete {
  const thresholds = athlete.thresholds.filter((s) => s.validFrom !== validFrom);
  return thresholds.length === athlete.thresholds.length ? athlete : { ...athlete, thresholds };
}

/** Jour civil local de l'appareil. */
export function localToday(now: Date = new Date()): ISODate {
  const two = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` as ISODate;
}
