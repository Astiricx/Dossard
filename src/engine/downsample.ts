// downsample.ts — réduit des séries de capteur à un point par tranche de temps, pour le stockage
// et l'affichage. Les calculs de charge, eux, se font AVANT, sur la série complète.
import type { Stream } from '../domain/index.ts';

export interface Downsampled<K extends string> {
  /** Début de chaque tranche, en secondes depuis le départ. Une tranche sans enregistrement (pause) est absente. */
  timeS: number[];
  columns: Record<K, (number | null)[]>;
}

/**
 * Découpe le temps en tranches de `stepS` secondes et garde, par tranche, la MOYENNE des valeurs
 * mesurées de chaque colonne (null si le capteur n'a rien donné). Moyenner plutôt que garder un
 * point sur trois évite qu'un pic isolé soit, au hasard, conservé ou effacé.
 * `digits` : nombre de décimales conservées par colonne (0 par défaut).
 */
export function downsample<K extends string>(
  timeS: readonly number[],
  columns: Readonly<Partial<Record<K, Stream>>>,
  stepS = 3,
  digits: Readonly<Partial<Record<K, number>>> = {} as Readonly<Partial<Record<K, number>>>,
): Downsampled<K> {
  const names = Object.keys(columns) as K[];
  const empty = (): Downsampled<K> => ({ timeS: [], columns: Object.fromEntries(names.map((n) => [n, []])) as unknown as Record<K, (number | null)[]> });
  if (!(stepS > 0) || !Number.isFinite(stepS)) return empty();
  // tranche → par colonne : [somme, nombre de valeurs]
  const buckets = new Map<number, Float64Array>();
  for (let i = 0; i < timeS.length; i++) {
    const t = timeS[i];
    if (t === undefined || !Number.isFinite(t) || t < 0) continue;
    const key = Math.floor(t / stepS);
    let sums = buckets.get(key);
    if (sums === undefined) { sums = new Float64Array(names.length * 2); buckets.set(key, sums); }
    for (let c = 0; c < names.length; c++) {
      const value = columns[names[c] as K]?.[i];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      sums[c * 2] = (sums[c * 2] ?? 0) + value;
      sums[c * 2 + 1] = (sums[c * 2 + 1] ?? 0) + 1;
    }
  }
  const out = empty();
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const sums = buckets.get(key) as Float64Array;
    out.timeS.push(key * stepS);
    names.forEach((name, c) => {
      const count = sums[c * 2 + 1] ?? 0;
      const factor = 10 ** (digits[name] ?? 0);
      out.columns[name].push(count > 0 ? Math.round(((sums[c * 2] ?? 0) / count) * factor) / factor : null);
    });
  }
  return out;
}
