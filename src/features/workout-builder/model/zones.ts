// zones.ts — dans quelle zone tombe une cible ? Fonctions pures.
//
// Une zone se lit sur la référence dans laquelle la cible est exprimée : 80 % de la FC max et 80 %
// de la FTP ne sont pas la même zone. Les bornes par défaut ci-dessous sont des modèles publiés
// (Coggan pour la puissance, cinq zones classiques pour la FC max, Friel pour la FC seuil et
// l'allure). L'athlète peut les remplacer, sport par sport, via `Athlete.zones`.
import type { Athlete, IntensityBasis, IntensityTarget, ResolvedThresholds, Sport, ZoneModel } from '../../../domain/index.ts';

export type ZoneIndex = 1 | 2 | 3 | 4 | 5;
export const ZONES: readonly ZoneIndex[] = [1, 2, 3, 4, 5];

/** Borne haute des zones 1 à 4, en fraction de la référence. Au-dessus de la dernière : zone 5 et plus. */
export const DEFAULT_ZONE_BOUNDS: Record<IntensityBasis, readonly [number, number, number, number]> = {
  ftp: [0.55, 0.75, 0.9, 1.05],
  hr_max: [0.6, 0.7, 0.8, 0.9],
  lthr: [0.85, 0.9, 0.95, 1.0],
  threshold_speed: [0.78, 0.88, 0.95, 1.02],
};

export function zoneBounds(basis: IntensityBasis, custom?: ZoneModel): readonly number[] {
  if (custom === undefined || custom.basis !== basis) return DEFAULT_ZONE_BOUNDS[basis];
  const highs = custom.zones.slice(0, 4).map((z) => z.high);
  return highs.length === 4 && highs.every((h): h is number => h !== null && Number.isFinite(h)) ? highs : DEFAULT_ZONE_BOUNDS[basis];
}

export function zoneOfValue(basis: IntensityBasis, value: number, custom?: ZoneModel): ZoneIndex {
  const index = zoneBounds(basis, custom).findIndex((high) => value <= high);
  return (index === -1 ? 5 : index + 1) as ZoneIndex;
}

export interface BasisRange { basis: IntensityBasis; low: number; high: number }

/**
 * Exprime une cible en fraction de sa propre référence. Une cible absolue (allure, watts, bpm) a
 * besoin du seuil correspondant : sans lui, on renvoie null plutôt que d'inventer une zone.
 */
export function targetOnBasis(target: IntensityTarget, sport: Sport, th: ResolvedThresholds): BasisRange | null {
  if (target.kind === 'relative') return { basis: target.basis, low: target.low, high: target.high };
  if (target.kind !== 'absolute') return null;
  const sportTh = th.bySport[sport] ?? {};
  const candidates: readonly (readonly [IntensityBasis, number | undefined])[] =
    target.unit === 'w' ? [['ftp', sportTh.ftpW]]
    : target.unit === 'mps' ? [['threshold_speed', sportTh.thresholdSpeedMps]]
    : [['hr_max', th.hrMaxBpm], ['lthr', sportTh.lthrBpm]];
  for (const [basis, reference] of candidates) {
    if (reference !== undefined && reference > 0) return { basis, low: target.low / reference, high: target.high / reference };
  }
  return null;
}

export const zoneModelFor = (zones: Athlete['zones'] | undefined, sport: Sport): ZoneModel | undefined => zones?.[sport];
