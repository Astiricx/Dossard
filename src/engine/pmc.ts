// pmc.ts — condition physique, fatigue et forme (Performance Management Chart).
//
//   CTL (condition) : moyenne mobile exponentielle de la charge quotidienne sur 42 jours ;
//   ATL (fatigue)   : la même sur 7 jours ;
//   TSB (forme)     : CTL − ATL.
// Moyenne mobile exponentielle : valeur du jour = valeur de la veille + (charge du jour − valeur de
// la veille) / N. Un jour sans séance compte pour une charge de 0 : c'est lui qui fait redescendre
// la fatigue. Convention retenue pour la forme : CTL − ATL du même jour, donc APRÈS la séance du
// jour (TrainingPeaks affiche la différence de la veille, c'est-à-dire la forme AVANT la séance).
import { addDays, diffDays, type ISODate } from '../domain/index.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';

export interface PmcDay {
  date: ISODate;
  /** Charge du jour, échelle TSS. */
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
}
export interface PmcOptions {
  /** Valeurs de la veille du premier jour. Par défaut 0 : la courbe part de zéro. */
  seed?: { ctl: number; atl: number };
  config?: EngineConfig;
}

/** Plus de dix ans de courbe quotidienne : au-delà, les bornes sont sûrement fausses. */
const MAX_DAYS = 3660;

/**
 * Une ligne par jour de `from` à `to` inclus. `dailyLoad` : charge totale par date ; un jour absent,
 * ou une valeur négative ou non finie, vaut 0. Bornes inversées ou démesurées : tableau vide.
 */
export function performanceCurve(dailyLoad: ReadonlyMap<ISODate, number>, from: ISODate, to: ISODate, options: PmcOptions = {}): PmcDay[] {
  const { ctlDays, atlDays } = (options.config ?? DEFAULT_CONFIG).pmc;
  const days = diffDays(from, to) + 1;
  if (!(days >= 1) || days > MAX_DAYS || !(ctlDays >= 1) || !(atlDays >= 1)) return [];
  let ctl = Math.max(0, options.seed?.ctl ?? 0), atl = Math.max(0, options.seed?.atl ?? 0);
  const out: PmcDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const raw = dailyLoad.get(date);
    const load = raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 0;
    ctl += (load - ctl) / ctlDays;
    atl += (load - atl) / atlDays;
    out.push({ date, load, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

/** Variation de la condition physique sur les 7 derniers jours de la courbe (« rampe »). null : moins de 8 jours. */
export function rampRate(curve: readonly PmcDay[]): number | null {
  const last = curve[curve.length - 1], weekAgo = curve[curve.length - 8];
  return last !== undefined && weekAgo !== undefined ? last.ctl - weekAgo.ctl : null;
}
