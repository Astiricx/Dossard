// streams.ts — ce que l'on garde des séries d'un fichier FIT. Règle de sobriété : uniquement ce que
// les graphiques utilisent (temps, fréquence cardiaque, vitesse, puissance), à un point toutes les
// 3 secondes. Ni GPS, ni température, ni dynamique de course : rien de tout cela n'est stocké.
import type { ActivityId, ActivityStreams } from '../../domain/index.ts';
import { downsample } from '../../engine/index.ts';
import type { ParsedActivity } from './fit/normalize.ts';

export const STREAM_STEP_S = 3;

/**
 * Séries à stocker pour une activité, ou null s'il n'y a rien d'exploitable. La vitesse reste en
 * m/s (unité du modèle) : elle est convertie en allure à l'affichage, selon le sport.
 */
export function toStoredStreams(activityId: ActivityId, raw: NonNullable<ParsedActivity['streams']>): ActivityStreams | null {
  const { timeS, columns } = downsample(raw.timeS, { hrBpm: raw.hrBpm, powerW: raw.powerW, speedMps: raw.speedMps }, STREAM_STEP_S, { speedMps: 2 });
  if (timeS.length < 2) return null;
  const kept = (column: (number | null)[]): boolean => column.some((value) => value !== null);
  const out: { -readonly [K in keyof ActivityStreams]: ActivityStreams[K] } = { activityId, timeS };
  if (raw.hrBpm !== undefined && kept(columns.hrBpm)) out.hrBpm = columns.hrBpm;
  if (raw.powerW !== undefined && kept(columns.powerW)) out.powerW = columns.powerW;
  if (raw.speedMps !== undefined && kept(columns.speedMps)) out.speedMps = columns.speedMps;
  return out.hrBpm === undefined && out.powerW === undefined && out.speedMps === undefined ? null : out;
}
