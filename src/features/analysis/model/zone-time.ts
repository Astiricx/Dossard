// zone-time.ts — temps passé dans chaque zone d'intensité, à partir d'une série enregistrée et des
// seuils de l'athlète. Fonctions pures.
import type { ActivityStreams, IntensityBasis, ResolvedThresholds, Sport, Stream } from '../../../domain/index.ts';
import { ZONES, zoneOfValue, type ZoneIndex } from '../../workout-builder/model/zones.ts';

/** La mesure sur laquelle on lit les zones. */
export type ZoneSource = 'hr' | 'power' | 'pace';
export interface ZoneOption {
  source: ZoneSource;
  /** Référence des pourcentages : FC max (ou FC seuil), FTP, vitesse seuil. */
  basis: IntensityBasis;
  /** Valeur de cette référence pour l'athlète, à la date de l'activité (bpm, W ou m/s). */
  reference: number;
}

/**
 * Les lectures possibles pour cette activité : il faut à la fois la série ET le seuil correspondant.
 * La première de la liste est celle affichée par défaut : la puissance à vélo, la FC sinon.
 */
export function zoneOptions(streams: Pick<ActivityStreams, 'hrBpm' | 'powerW' | 'speedMps'>, th: ResolvedThresholds, sport: Sport): ZoneOption[] {
  const sportTh = th.bySport[sport] ?? {};
  const usable = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;
  const options: ZoneOption[] = [];
  if (streams.hrBpm !== undefined) {
    if (usable(th.hrMaxBpm)) options.push({ source: 'hr', basis: 'hr_max', reference: th.hrMaxBpm });
    else if (usable(sportTh.lthrBpm)) options.push({ source: 'hr', basis: 'lthr', reference: sportTh.lthrBpm });
  }
  if (streams.powerW !== undefined && usable(sportTh.ftpW)) options.push({ source: 'power', basis: 'ftp', reference: sportTh.ftpW });
  if (streams.speedMps !== undefined && usable(sportTh.thresholdSpeedMps) && sport !== 'bike') options.push({ source: 'pace', basis: 'threshold_speed', reference: sportTh.thresholdSpeedMps });
  const first: ZoneSource = sport === 'bike' ? 'power' : 'hr';
  return options.sort((a, b) => Number(b.source === first) - Number(a.source === first));
}
export const streamOf = (streams: Pick<ActivityStreams, 'hrBpm' | 'powerW' | 'speedMps'>, source: ZoneSource): Stream | undefined =>
  source === 'hr' ? streams.hrBpm : source === 'power' ? streams.powerW : streams.speedMps;

export interface ZoneTime {
  zone: ZoneIndex;
  seconds: number;
  /** Part du temps mesuré, de 0 à 1. */
  share: number;
  /** Bornes de la zone dans l'unité de la série (bpm, W ou m/s). null : zone ouverte de ce côté. */
  low: number | null;
  high: number | null;
}
export interface ZoneBreakdown {
  zones: ZoneTime[];
  /** Temps pendant lequel la série porte une mesure. Les trous de capteur et les pauses n'y sont pas. */
  measuredS: number;
}

/** Pas de la série : l'écart le plus fréquent entre deux points (3 s pour une série stockée). */
function stepOf(timeS: readonly number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < timeS.length; i++) { const d = (timeS[i] ?? 0) - (timeS[i - 1] ?? 0); if (d > 0) diffs.push(d); }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? 1;
}

/**
 * Répartit le temps mesuré entre les zones 1 à 5 (la zone 5 est ouverte vers le haut).
 * `bounds` : borne haute des zones 1 à 4, en fraction de `reference` (voir zoneBounds).
 * Chaque point compte pour le pas de la série, jamais plus : une pause ne gonfle aucune zone.
 */
export function timeInZones(timeS: readonly number[], values: Stream, option: Pick<ZoneOption, 'basis' | 'reference'>, bounds: readonly number[]): ZoneBreakdown {
  const seconds: Record<ZoneIndex, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const step = stepOf(timeS);
  const custom = { basis: option.basis, zones: bounds.map((high, i) => ({ label: `Z${i + 1}`, low: i === 0 ? 0 : (bounds[i - 1] ?? 0), high })) };
  let measuredS = 0;
  if (option.reference > 0) {
    for (let i = 0; i < Math.min(timeS.length, values.length); i++) {
      const value = values[i], t = timeS[i], next = timeS[i + 1];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || t === undefined) continue;
      const dt = next !== undefined && next > t ? Math.min(next - t, step) : step;
      seconds[zoneOfValue(option.basis, value / option.reference, custom)] += dt;
      measuredS += dt;
    }
  }
  return {
    measuredS,
    zones: ZONES.map((zone) => ({
      zone, seconds: seconds[zone], share: measuredS > 0 ? seconds[zone] / measuredS : 0,
      low: zone === 1 ? null : (bounds[zone - 2] ?? 0) * option.reference,
      high: zone === 5 ? null : (bounds[zone - 1] ?? 0) * option.reference,
    })),
  };
}
