// labels.ts — textes de l'import et de la charge réalisée.
import type { LoadMethod, LoadQuality, LoadWarning } from '../../domain/index.ts';
import type { ParseFailure } from './fit/normalize.ts';

export type FileFailure = ParseFailure | 'not_fit' | 'corrupt' | 'bad_zip' | 'empty_zip' | 'unreadable';
export const FAILURE_TEXT: Record<FileFailure, string> = {
  not_fit: 'Ce n’est pas un fichier FIT.',
  corrupt: 'Fichier FIT illisible ou tronqué.',
  bad_zip: 'Archive ZIP illisible.',
  empty_zip: 'L’archive ne contient aucun fichier .fit.',
  unreadable: 'Le fichier n’a pas pu être lu.',
  no_session: 'Le fichier ne contient pas d’activité (réglages, parcours ou séance à faire).',
  no_start_time: 'L’activité n’a pas d’heure de départ.',
  no_duration: 'L’activité n’a pas de durée.',
};

export const METHOD_TEXT: Record<LoadMethod, string> = {
  power: 'puissance (TSS)', pace: 'allure', hr: 'fréquence cardiaque (TRIMP)', rpe: 'effort perçu', duration: 'durée seule',
};
export const QUALITY_TEXT: Record<LoadQuality, string> = { high: 'fiable', medium: 'correcte', low: 'approximative' };
export const WARNING_TEXT: Record<LoadWarning, string> = {
  short_duration: 'Moins de 20 minutes : la puissance normalisée est peu fiable.',
  data_gaps: 'Des trous dans les mesures (capteur décroché).',
  outliers_removed: 'Des valeurs aberrantes ont été écartées.',
  summary_only: 'Calcul sur une moyenne, pas sur la série : sous-estime les séances variables.',
  threshold_backfilled: 'Seuil postérieur à l’activité, appliqué rétroactivement.',
  threshold_estimated: 'FC au seuil estimée à partir de la FC max.',
  threshold_maybe_outdated: 'Intensité au-dessus du seuil pendant longtemps : seuil à retester.',
  hr_rest_assumed: 'FC de repos non renseignée : valeur par défaut.',
  sex_assumed: 'Sexe non renseigné : coefficients masculins du TRIMP.',
  hr_above_max: 'FC au-dessus de la FC max déclarée : FC max à vérifier.',
  elevation_ignored: 'Allure non corrigée du dénivelé.',
  heuristic_scale: 'Converti vers l’échelle de charge par une table empirique.',
};
