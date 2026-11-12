// labels.ts — textes et couleurs de l'interface. Les zones portent toujours un libellé en plus de
// leur couleur : l'information ne repose jamais sur la couleur seule.
import type { IntensityTarget, Sport, StepRole } from '../../domain/index.ts';
import { formatPace, formatPercent, paceUnit } from './model/format.ts';
import type { TargetMode } from './model/presets.ts';
import type { PlannedWarning } from '../../engine/index.ts';
import type { ZoneIndex } from './model/zones.ts';

export const SPORT_LABELS: Record<Sport, string> = { run: 'Course', bike: 'Vélo', swim: 'Natation', strength: 'Renfo', other: 'Autre' };
/** Une couleur par sport, la même partout, toujours accompagnée du nom du sport. */
export const SPORT_COLORS: Record<Sport, string> = { run: '#38BDF8', bike: '#FBBF24', swim: '#2DD4BF', strength: '#A78BFA', other: '#A1A1AA' };
export const REST_COLOR = '#71717A';
export const ROLE_LABELS: Record<StepRole, string> = {
  warmup: 'Échauffement', active: 'Intervalle', recovery: 'Récupération', cooldown: 'Retour au calme', rest: 'Repos',
};
export const MODE_LABELS: Record<TargetMode, string> = { pace: 'Allure', hr_max: '% FC max', ftp: '% FTP', open: 'Libre' };

/** Bleu : endurance (Z1, Z2). Vert : tempo. Orange : seuil. Rouge : VMA / PMA et au-delà. */
export const ZONE_COLORS: Record<ZoneIndex, string> = { 1: '#8EC3EA', 2: '#3A82C6', 3: '#2FA36B', 4: '#F0A01E', 5: '#E0483A' };
export const ZONE_LABELS: Record<ZoneIndex, string> = { 1: 'Récupération', 2: 'Endurance', 3: 'Tempo', 4: 'Seuil', 5: 'VMA / PMA' };
/** Cible non convertible faute de seuil : gris neutre, jamais une couleur de zone. */
export const UNKNOWN_ZONE_COLOR = '#A1A1AA';
export const zoneColor = (zone: ZoneIndex | null): string => (zone === null ? UNKNOWN_ZONE_COLOR : ZONE_COLORS[zone]);

const BASIS_LABELS = { ftp: 'FTP', hr_max: 'FC max', lthr: 'FC seuil', threshold_speed: 'vitesse seuil' } as const;
const range = (low: string, high: string): string => (low === high ? low : `${low} à ${high}`);

export function describeTarget(target: IntensityTarget, sport: Sport): string {
  switch (target.kind) {
    case 'open': return 'Sans cible';
    case 'rpe': return `Effort perçu ${target.value}/10`;
    case 'relative': return `${range(formatPercent(target.low), formatPercent(target.high))} % ${BASIS_LABELS[target.basis]}`;
    case 'absolute':
      if (target.unit === 'mps') return `${range(formatPace(target.low, sport), formatPace(target.high, sport))} ${paceUnit(sport)}`;
      return `${range(String(Math.round(target.low)), String(Math.round(target.high)))} ${target.unit === 'w' ? 'W' : 'bpm'}`;
  }
}

export const WARNING_LABELS: Record<PlannedWarning, string> = {
  open_step: 'Une étape sans durée est comptée pour zéro.',
  unresolved_target: 'Charge non calculable : il manque un seuil dans ton profil pour convertir une cible.',
  heuristic_scale: 'Charge estimée : une cible en fréquence cardiaque ou sans cible est convertie par approximation.',
};
