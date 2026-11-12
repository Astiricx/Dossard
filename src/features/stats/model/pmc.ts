// pmc.ts — prépare la courbe de performance pour l'onglet Statistiques : charges quotidiennes
// réalisées, projection d'après les séances prévues, et lecture de la forme. Fonctions pures.
import { addDays, type CompletedActivity, type ISODate, type Workout } from '../../../domain/index.ts';
import { performanceCurve, rampRate, type PmcDay } from '../../../engine/index.ts';

/** Charge réalisée par jour : somme des charges des activités de ce jour. */
export function dailyRealizedLoad(activities: Iterable<CompletedActivity>): Map<ISODate, number> {
  const byDay = new Map<ISODate, number>();
  for (const a of activities) if (a.load !== null && a.load.value > 0) byDay.set(a.localDate, (byDay.get(a.localDate) ?? 0) + a.load.value);
  return byDay;
}
/** Charge prévue par jour APRÈS `today` : séances à venir, pas encore réalisées, dont la charge est calculable. */
export function dailyPlannedLoad(workouts: Iterable<Workout>, today: ISODate): Map<ISODate, number> {
  const byDay = new Map<ISODate, number>();
  for (const w of workouts) {
    if (w.date <= today || w.activityId !== null || w.planned.load === null || !(w.planned.load > 0)) continue;
    byDay.set(w.date, (byDay.get(w.date) ?? 0) + w.planned.load);
  }
  return byDay;
}

export interface PmcPoint {
  date: ISODate;
  /** Charge du jour : réalisée dans le passé, prévue dans le futur. */
  load: number;
  /** Valeurs constatées. null dans le futur. */
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** Projection d'après les séances prévues. null dans le passé ; égale au constaté aujourd'hui, pour que les traits se rejoignent. */
  ctlPlan: number | null;
  atlPlan: number | null;
  tsbPlan: number | null;
}
export interface Pmc {
  points: PmcPoint[];
  /** État d'aujourd'hui. null : aucune activité avec une charge. */
  today: PmcDay | null;
  /** Variation de la condition physique sur 7 jours. */
  ramp: number | null;
  firstDate: ISODate | null;
  /** true : moins de 42 jours d'historique. La condition physique part de zéro et reste sous-estimée. */
  warmingUp: boolean;
}

export const PROJECTION_MAX_DAYS = 42;

/**
 * Courbe complète, du premier jour d'activité à aujourd'hui, puis projection jusqu'à la dernière
 * séance prévue (42 jours au plus). La projection suppose que chaque séance prévue est réalisée
 * telle quelle, et que les jours sans séance sont des jours de repos.
 */
export function buildPmc(activities: Iterable<CompletedActivity>, workouts: Iterable<Workout>, today: ISODate): Pmc {
  const realized = dailyRealizedLoad(activities);
  const firstDate = [...realized.keys()].sort()[0] ?? null;
  if (firstDate === null || firstDate > today) return { points: [], today: null, ramp: null, firstDate: null, warmingUp: true };
  const past = performanceCurve(realized, firstDate, today);
  const now = past[past.length - 1] as PmcDay;
  const points: PmcPoint[] = past.map((d) => ({ date: d.date, load: d.load, ctl: d.ctl, atl: d.atl, tsb: d.tsb, ctlPlan: null, atlPlan: null, tsbPlan: null }));

  const planned = dailyPlannedLoad(workouts, today);
  const lastPlanned = [...planned.keys()].sort().pop();
  if (lastPlanned !== undefined) {
    const limit = addDays(today, PROJECTION_MAX_DAYS);
    const future = performanceCurve(planned, addDays(today, 1), lastPlanned < limit ? lastPlanned : limit, { seed: { ctl: now.ctl, atl: now.atl } });
    if (future.length > 0) {
      Object.assign(points[points.length - 1] as PmcPoint, { ctlPlan: now.ctl, atlPlan: now.atl, tsbPlan: now.tsb });
      for (const d of future) points.push({ date: d.date, load: d.load, ctl: null, atl: null, tsb: null, ctlPlan: d.ctl, atlPlan: d.atl, tsbPlan: d.tsb });
    }
  }
  return { points, today: now, ramp: rampRate(past), firstDate, warmingUp: past.length < 42 };
}

/** Ne garde que les `days` derniers jours avant aujourd'hui (et toute la projection). null : tout l'historique. */
export function lastDays(points: readonly PmcPoint[], today: ISODate, days: number | null): PmcPoint[] {
  if (days === null) return [...points];
  const from = addDays(today, -days);
  return points.filter((p) => p.date >= from);
}

export type FormState = 'detraining' | 'fresh' | 'neutral' | 'productive' | 'overload';
/**
 * Lecture de la forme (TSB). CONVENTION d'usage courant chez les entraîneurs, pas une loi
 * physiologique : les seuils varient d'un athlète à l'autre et se règlent ici.
 */
export const FORM_BANDS: readonly { above: number; state: FormState }[] = [
  { above: 25, state: 'detraining' }, { above: 5, state: 'fresh' }, { above: -10, state: 'neutral' }, { above: -30, state: 'productive' },
];
export const formState = (tsb: number): FormState => FORM_BANDS.find((band) => tsb > band.above)?.state ?? 'overload';
export const FORM_TEXT: Record<FormState, { label: string; hint: string }> = {
  detraining: { label: 'Très frais', hint: 'La charge récente est faible : la condition physique baisse.' },
  fresh: { label: 'Frais', hint: 'Zone visée pour un jour de course.' },
  neutral: { label: 'Neutre', hint: 'Fatigue et condition physique s’équilibrent.' },
  productive: { label: 'En charge', hint: 'Fatigue d’un bloc d’entraînement normal.' },
  overload: { label: 'Très fatigué', hint: 'Fatigue élevée : surveille tes sensations et prévois du repos.' },
};
