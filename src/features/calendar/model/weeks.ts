// weeks.ts — découpage en semaines et totaux PRÉVUS d'une semaine. Fonctions pures.
import { addDays, type ISODate } from '../../../domain/index.ts';
import type { CalendarState } from '../../../store/calendar.ts';

export const weekDays = (weekStart: ISODate): ISODate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
export const weekStartsFrom = (first: ISODate, count: number): ISODate[] =>
  Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, i) => addDays(first, i * 7));

export interface WeekPlanned {
  count: number;
  durationS: number;
  distanceM: number;
  load: number;
  /** true : au moins une séance n'a pas de durée, de distance ou de charge calculable. Le total est alors un minimum. */
  durationPartial: boolean;
  distancePartial: boolean;
  loadPartial: boolean;
  /** Charge prévue par jour, du premier au dernier jour de la semaine. */
  dailyLoad: readonly number[];
}
const NONE: readonly never[] = [];

/**
 * Totaux prévus d'une semaine, mémorisés comme `makeWeekTotals` : le calcul n'est refait que si
 * une séance de CETTE semaine a changé. Déplacer une séance ne recalcule que deux lignes au plus.
 * À instancier une fois par ligne de la grille (useMemo).
 */
export function makeWeekPlanned(weekStart: ISODate): (s: CalendarState) => WeekPlanned {
  const days = weekDays(weekStart);
  let lastDeps: readonly unknown[] = [];
  let last: WeekPlanned | null = null;
  return (s) => {
    const byDay = days.map((d) => (s.workoutIdsByDate[d] ?? NONE).map((id) => s.workouts[id]));
    const deps = byDay.flat();
    if (last !== null && deps.length === lastDeps.length && deps.every((dep, i) => dep === lastDeps[i])) return last;
    const total = { count: 0, durationS: 0, distanceM: 0, load: 0, durationPartial: false, distancePartial: false, loadPartial: false };
    const dailyLoad = byDay.map((list) => {
      let dayLoad = 0;
      for (const w of list) {
        if (w === undefined || w.sport === 'rest') continue;
        total.count++;
        if (w.planned.durationS === null) total.durationPartial = true; else total.durationS += w.planned.durationS;
        if (w.planned.distanceM === null) total.distancePartial = true; else total.distanceM += w.planned.distanceM;
        if (w.planned.load === null) total.loadPartial = true; else dayLoad += w.planned.load;
      }
      total.load += dayLoad;
      return dayLoad;
    });
    lastDeps = deps;
    last = { ...total, dailyLoad };
    return last;
  };
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;
export const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
const parts = (date: ISODate): { y: number; m: number; d: number } => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return { y, m, d };
};
export const dayOfMonth = (date: ISODate): number => parts(date).d;
export const monthName = (date: ISODate): string => MONTHS[parts(date).m - 1] ?? '';
/** « 12 nov. » */
export const shortDate = (date: ISODate): string => `${parts(date).d} ${monthName(date)}`;
/** « 12 nov. 2026 » */
export const longDate = (date: ISODate): string => `${shortDate(date)} ${parts(date).y}`;
/** « 9 – 15 nov. » ou « 30 nov. – 6 déc. » */
export function weekRangeLabel(weekStart: ISODate): string {
  const end = addDays(weekStart, 6);
  return parts(weekStart).m === parts(end).m ? `${parts(weekStart).d} – ${shortDate(end)}` : `${shortDate(weekStart)} – ${shortDate(end)}`;
}

/** Numéro de semaine ISO 8601 (la semaine 1 contient le premier jeudi de l'année). */
export function isoWeekNumber(date: ISODate): number {
  const t = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(t.getTime() + (3 - ((t.getUTCDay() + 6) % 7)) * 86_400_000);
  const firstJan = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - firstJan) / (7 * 86_400_000)) + 1;
}

// --- Prévu contre réalisé ---
export interface WeekCompleted {
  count: number;
  durationS: number;
  distanceM: number;
  load: number;
  /** true : au moins une activité n'a pas de charge calculable. Le total est alors un minimum. */
  loadPartial: boolean;
  dailyLoad: readonly number[];
}
export interface WeekSummary { planned: WeekPlanned; completed: WeekCompleted }

/**
 * Prévu et réalisé d'une semaine, côte à côte. Mémorisé comme `makeWeekPlanned` : importer une
 * activité ne recalcule que la semaine où elle tombe. Chaque activité compte une seule fois, à sa
 * date, qu'elle soit rapprochée d'une séance ou non.
 */
export function makeWeekSummary(weekStart: ISODate): (s: CalendarState) => WeekSummary {
  const days = weekDays(weekStart);
  const selectPlanned = makeWeekPlanned(weekStart);
  let lastDeps: readonly unknown[] = [];
  let lastPlanned: WeekPlanned | null = null;
  let last: WeekSummary | null = null;
  return (s) => {
    const planned = selectPlanned(s);
    const byDay = days.map((d) => (s.activityIdsByDate[d] ?? NONE).map((id) => s.activities[id]));
    const deps = byDay.flat();
    if (last !== null && planned === lastPlanned && deps.length === lastDeps.length && deps.every((dep, i) => dep === lastDeps[i])) return last;
    const total = { count: 0, durationS: 0, distanceM: 0, load: 0, loadPartial: false };
    const dailyLoad = byDay.map((list) => {
      let dayLoad = 0;
      for (const a of list) {
        if (a === undefined) continue;
        total.count++;
        total.durationS += a.summary.movingS;
        total.distanceM += a.summary.distanceM ?? 0;
        if (a.load === null) total.loadPartial = true; else dayLoad += a.load.value;
      }
      total.load += dayLoad;
      return dayLoad;
    });
    lastDeps = deps;
    lastPlanned = planned;
    last = { planned, completed: { ...total, dailyLoad } };
    return last;
  };
}
