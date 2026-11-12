// primitives.ts — types de base partagés par tout le domaine.
// Conventions : unités SI dans les noms de champs (durationS, distanceM, powerW, speedMps, hrBpm) ;
// la conversion (km, min/km, h:mm) se fait uniquement à l'affichage.

declare const brand: unique symbol;
/** Type nominal : empêche de passer un WorkoutId là où un ActivityId est attendu. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type AthleteId = Brand<string, 'AthleteId'>;
export type PlanId = Brand<string, 'PlanId'>;
export type CycleId = Brand<string, 'CycleId'>;
export type EventId = Brand<string, 'EventId'>;
export type WorkoutId = Brand<string, 'WorkoutId'>;
export type TemplateId = Brand<string, 'TemplateId'>;
export type BlockId = Brand<string, 'BlockId'>;
export type ActivityId = Brand<string, 'ActivityId'>;

/** Jour civil 'AAAA-MM-JJ' dans le fuseau de l'athlète : c'est la clé du calendrier. */
export type ISODate = Brand<string, 'ISODate'>;
/** Instant UTC ISO 8601 ('2026-11-08T20:41:35Z'). */
export type ISODateTime = Brand<string, 'ISODateTime'>;

export const SPORTS = ['run', 'bike', 'swim', 'strength', 'other'] as const;
export type Sport = (typeof SPORTS)[number];

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: ISODate): number => Date.parse(`${d}T00:00:00Z`);
const fromMs = (t: number): ISODate => new Date(t).toISOString().slice(0, 10) as ISODate;

/** Valide une date venue de l'extérieur (fichier, API). Rejette '2026-02-30'. */
export function parseISODate(text: string): ISODate | null {
  if (!ISO_DATE.test(text)) return null;
  const t = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== text ? null : (text as ISODate);
}
/** Pour les littéraux sûrs (tests, constantes). Lève une erreur si la date est invalide. */
export function isoDate(text: string): ISODate {
  const d = parseISODate(text);
  if (d === null) throw new RangeError(`Date invalide : ${text}`);
  return d;
}
// L'arithmétique passe par UTC : aucun effet des changements d'heure.
export const addDays = (date: ISODate, n: number): ISODate => fromMs(ms(date) + Math.trunc(n) * DAY_MS);
export const diffDays = (from: ISODate, to: ISODate): number => Math.round((ms(to) - ms(from)) / DAY_MS);
export function startOfWeek(date: ISODate, firstDay: 0 | 1 = 1): ISODate {
  return addDays(date, -((new Date(ms(date)).getUTCDay() - firstDay + 7) % 7));
}
/** Jour local d'un instant, d'après le décalage UTC enregistré par la montre au moment de l'activité. */
export function localDateOf(instant: ISODateTime, utcOffsetMin: number): ISODate | null {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? null : fromMs(t + utcOffsetMin * 60_000);
}
export const newId = <T extends string>(): T => crypto.randomUUID() as T;
