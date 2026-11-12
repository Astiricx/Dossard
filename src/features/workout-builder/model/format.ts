// format.ts — conversion texte ↔ valeurs SI pour les champs du constructeur. Fonctions pures.
// Toute fonction parse* renvoie null quand le texte n'est pas exploitable : le champ garde alors
// la dernière valeur valide et s'affiche en erreur, la séance n'est jamais corrompue.
import type { Sport } from '../../../domain/index.ts';

const MAX_DURATION_S = 24 * 3600;
const MAX_DISTANCE_M = 1_000_000;

/** '15' → 15 min ; '0:45' → 45 s ; '1:30:00' → 1 h 30 ; '45s' → 45 s. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[′']/g, ':').replace(/[″"]$/, '');
  const seconds = /^(\d+)\s*s$/.exec(t);
  if (seconds) return bounded(Number(seconds[1]), 1, MAX_DURATION_S);
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  const total = n.length === 1 ? n[0]! * 60 : n.length === 2 ? n[0]! * 60 + n[1]! : n[0]! * 3600 + n[1]! * 60 + n[2]!;
  return bounded(total, 1, MAX_DURATION_S);
}
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Distance de référence de l'allure : le kilomètre, sauf en natation (100 m). */
export const paceBaseM = (sport: Sport): number => (sport === 'swim' ? 100 : 1000);
export const paceUnit = (sport: Sport): string => (sport === 'swim' ? '/100 m' : '/km');

/** '4:15' → vitesse en m/s. Un nombre seul vaut des minutes ('5' → 5:00). */
export function parsePace(text: string, sport: Sport): number | null {
  const t = text.trim().replace(/[′']/g, ':').replace(/[″"]$/, '');
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (!match) return null;
  const sec = Number(match[1]) * 60 + Number(match[2] ?? 0);
  if (Number(match[2] ?? 0) > 59 || sec < 20 || sec > 1800) return null;
  return paceBaseM(sport) / sec;
}
export function formatPace(speedMps: number, sport: Sport): string {
  if (!(speedMps > 0)) return '';
  return formatDuration(paceBaseM(sport) / speedMps);
}

/** '85' → 0.85. Bornes larges : 1 % à 250 %. */
export function parsePercent(text: string): number | null {
  const t = text.trim().replace(',', '.').replace(/\s*%$/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = bounded(Number(t), 1, 250);
  return v === null ? null : v / 100;
}
export const formatPercent = (fraction: number): string => String(Math.round(fraction * 1000) / 10);

/**
 * '400' → 400 m ; '10 km' → 10 000 m ; '0,4' → 400 m. Sans unité, un nombre inférieur à 100 est lu
 * en kilomètres (sauf en natation, toujours en mètres) : personne ne programme un bloc de 12 mètres.
 */
export function parseDistance(text: string, sport: Sport): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*(km|m)?$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  const inKm = match[2] === 'km' || (match[2] === undefined && sport !== 'swim' && value < 100);
  return bounded(Math.round(inKm ? value * 1000 : value), 1, MAX_DISTANCE_M);
}
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${String(Math.round(meters / 10) / 100).replace('.', ',')} km`;
  return `${Math.round(meters)} m`;
}

export function parseCount(text: string): number | null {
  return /^\d{1,2}$/.test(text.trim()) ? bounded(Number(text.trim()), 1, 99) : null;
}
export function parseInteger(min: number, max: number): (text: string) => number | null {
  return (text) => (/^\d{1,4}$/.test(text.trim()) ? bounded(Number(text.trim()), min, max) : null);
}

function bounded(v: number, min: number, max: number): number | null {
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}
