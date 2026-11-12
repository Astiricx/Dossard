// series.ts — nettoyage d'une série brute de capteur avant tout calcul.
import type { Stream } from '../domain/index.ts';
import type { EngineConfig } from './config.ts';

export interface CleanSeries {
  /** Un échantillon par seconde de chrono. NaN = donnée manquante. */
  samples: Float64Array;
  timerS: number;       // durée chronométrée, pauses exclues
  validS: number;       // secondes portant une valeur valide
  coverage: number;     // validS / timerS, entre 0 et 1
  outliers: number;     // échantillons écartés car hors bornes
}

/**
 * Ramène une série à 1 Hz et écarte ce qui n'est pas mesuré. Dans l'ordre :
 * 1. horodatages non finis, dupliqués ou désordonnés : ignorés ;
 * 2. valeurs nulles, non finies ou hors bornes : marquées manquantes ;
 * 3. pas irrégulier (« smart recording ») : chaque valeur est tenue jusqu'à la suivante ;
 * 4. écart supérieur à maxSampleGapS : c'est une pause, le temps n'est pas compté ;
 * 5. trous de maxFillS secondes au plus : comblés par la dernière valeur valide.
 * Sans `timeS`, la série est supposée déjà à 1 Hz.
 */
export function cleanSeries(
  raw: Stream,
  timeS: readonly number[] | undefined,
  bounds: { min: number; max: number },
  cfg: EngineConfig,
): CleanSeries {
  const n = timeS ? Math.min(raw.length, timeS.length) : raw.length;
  const out: number[] = [];
  let outliers = 0;
  let previousT = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < n && out.length < cfg.maxSessionS; i++) {
    const t = timeS ? timeS[i] : i;
    if (t === undefined || !Number.isFinite(t) || t <= previousT) continue;
    previousT = t;

    const v = raw[i];
    const finite = typeof v === 'number' && Number.isFinite(v);
    const value = finite && v >= bounds.min && v <= bounds.max ? v : Number.NaN;
    if (finite && Number.isNaN(value)) outliers++;

    const nextT = timeS?.[i + 1];
    const span = nextT !== undefined && Number.isFinite(nextT) && nextT > t ? nextT - t : 1;
    const seconds = span <= cfg.maxSampleGapS ? Math.max(1, Math.round(span)) : 1;
    for (let k = 0; k < seconds; k++) out.push(value);
  }

  const samples = Float64Array.from(out);
  let lastValid = Number.NaN;
  let validS = 0;
  for (let i = 0; i < samples.length; ) {
    const current = samples[i]!;
    if (!Number.isNaN(current)) { lastValid = current; validS++; i++; continue; }
    let end = i;
    while (end < samples.length && Number.isNaN(samples[end]!)) end++;
    if (end - i <= cfg.maxFillS && !Number.isNaN(lastValid)) { samples.fill(lastValid, i, end); validS += end - i; }
    i = end;
  }
  const timerS = samples.length;
  return { samples, timerS, validS, coverage: timerS === 0 ? 0 : validS / timerS, outliers };
}
