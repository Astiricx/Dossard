// chart-rows.ts — met les séries stockées (en colonnes) dans la forme que lit le graphique (en lignes).
import type { ActivityStreams, Sport, Stream } from '../../../domain/index.ts';

/** La mesure d'effort tracée avec la fréquence cardiaque : la puissance si elle existe à vélo, sinon la vitesse. */
export type EffortMetric = 'power' | 'speed';
export function effortMetric(streams: Pick<ActivityStreams, 'powerW' | 'speedMps'>, sport: Sport): EffortMetric | null {
  if (streams.powerW !== undefined && (sport === 'bike' || streams.speedMps === undefined)) return 'power';
  return streams.speedMps !== undefined ? 'speed' : streams.powerW !== undefined ? 'power' : null;
}

export interface ChartRow {
  /** Secondes depuis le départ. */
  t: number;
  effort: number | null;
  hr: number | null;
}

/** Moyenne glissante centrée sur `window` points, qui ignore les valeurs manquantes. */
export function smooth(values: Stream, window: number): (number | null)[] {
  const half = Math.max(0, Math.floor(window / 2));
  return Array.from(values, (value, i) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; count++; }
    }
    return sum / count;
  });
}

/** La vitesse GPS est bruitée d'un point à l'autre : elle est lissée sur 5 points (15 s) pour l'affichage. */
const SPEED_SMOOTHING_POINTS = 5;

/**
 * Une ligne par point. Après un trou de plus de deux pas (pause de la montre), une ligne vide est
 * insérée : la courbe s'interrompt au lieu de relier d'un trait deux instants éloignés.
 */
export function chartRows(streams: ActivityStreams, effort: EffortMetric | null, stepS: number): ChartRow[] {
  const column = effort === 'power' ? streams.powerW : effort === 'speed' ? smooth(streams.speedMps ?? [], SPEED_SMOOTHING_POINTS) : undefined;
  const value = (stream: Stream | undefined, i: number): number | null => {
    const v = stream?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const rows: ChartRow[] = [];
  streams.timeS.forEach((t, i) => {
    const previous = streams.timeS[i - 1];
    if (previous !== undefined && t - previous > 2 * stepS) rows.push({ t: previous + stepS, effort: null, hr: null });
    rows.push({ t, effort: value(column, i), hr: value(streams.hrBpm, i) });
  });
  return rows;
}

/**
 * Bornes de l'axe vertical : du 2e au 98e centile, avec une marge. Sans cela, un arrêt à un feu
 * (vitesse nulle) ou un pic isolé écraserait toute la courbe utile dans un coin du graphique.
 */
export function axisDomain(rows: readonly ChartRow[], key: 'effort' | 'hr'): [number, number] | null {
  const values = rows.map((row) => row[key]).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const at = (q: number): number => values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0;
  const low = at(0.02), high = at(0.98), margin = Math.max((high - low) * 0.12, high * 0.02, 1e-6);
  return [Math.max(0, low - margin), high + margin];
}
