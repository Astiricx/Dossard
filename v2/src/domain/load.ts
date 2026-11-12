// load.ts — la charge d'une activité telle qu'elle est stockée (le calcul est dans engine/).
import type { ISODate } from './primitives.ts';

/** Origine de la charge retenue. L'ordre de préférence par sport est dans engine/config.ts. */
export type LoadMethod = 'power' | 'pace' | 'hr' | 'rpe' | 'duration';
export type LoadQuality = 'high' | 'medium' | 'low';

export type LoadWarning =
  | 'short_duration'            // moins de 20 min : la puissance normalisée est peu fiable
  | 'data_gaps'                 // trous dans la série (capteur décroché)
  | 'outliers_removed'          // valeurs aberrantes écartées
  | 'summary_only'              // calcul sur une moyenne, pas sur la série : sous-estime les séances variables
  | 'threshold_backfilled'      // seuil postérieur à l'activité appliqué rétroactivement
  | 'threshold_estimated'       // seuil déduit (ex. FC seuil = fraction de la FC max)
  | 'threshold_maybe_outdated'  // intensité > 105 % du seuil pendant plus d'une heure : seuil à retester
  | 'hr_rest_assumed'
  | 'sex_assumed'               // coefficients de Banister masculins appliqués par défaut
  | 'hr_above_max'              // FC au-dessus de la FC max déclarée pendant plus d'une minute
  | 'elevation_ignored'         // allure non corrigée du dénivelé
  | 'heuristic_scale';          // conversion vers l'échelle TSS par une table empirique

/** Toutes les mesures calculables, conservées côte à côte pour pouvoir les comparer. */
export interface LoadMetrics {
  tss?: number;                 // puissance ou allure
  intensityFactor?: number;
  normalizedPowerW?: number;
  trimp?: number;               // Banister
  hrTss?: number;               // TRIMP ramené à l'échelle TSS
  sessionRpe?: number;          // Foster, unités arbitraires (RPE × minutes)
}

export interface ActivityLoad {
  /** Charge canonique, échelle TSS : 100 = une heure au seuil. C'est elle qui alimente CTL / ATL. */
  value: number;
  method: LoadMethod;
  quality: LoadQuality;
  warnings: readonly LoadWarning[];
  metrics: LoadMetrics;
  /** Version de l'algorithme : si elle change, la charge est recalculée. */
  engineVersion: number;
  /** Date du jeu de seuils utilisé : si ce jeu est modifié, la charge est recalculée. */
  thresholdsAsOf: ISODate | null;
}
