// athlete.ts — l'athlète, ses seuils datés et ses zones.
import type { AthleteId, ISODate, Sport } from './primitives.ts';

export interface SportThresholds {
  ftpW?: number;               // puissance au seuil (vélo, ou course avec capteur de puissance)
  lthrBpm?: number;            // fréquence cardiaque au seuil lactique
  thresholdSpeedMps?: number;  // vitesse au seuil : allure tenable ~1 h en course, CSS en natation
}

/**
 * Seuils valables à partir d'une date. On ne modifie jamais un seuil : on en ajoute un nouveau.
 * Une séance de mars reste ainsi évaluée avec la FTP de mars, et l'historique ne se réécrit pas
 * quand l'athlète progresse. Un instantané peut être partiel : les champs absents sont hérités.
 */
export interface ThresholdSnapshot {
  validFrom: ISODate;
  hrMaxBpm?: number;
  hrRestBpm?: number;
  bySport?: Partial<Record<Sport, SportThresholds>>;
  origin?: 'test' | 'race' | 'device' | 'estimate';
  note?: string;
}

/** Seuils applicables à une date donnée, après héritage. */
export interface ResolvedThresholds {
  asOf: ISODate | null;        // null : l'athlète n'a déclaré aucun seuil
  backfilled: boolean;         // true : la date précède le premier instantané connu
  hrMaxBpm?: number;
  hrRestBpm?: number;
  bySport: Partial<Record<Sport, SportThresholds>>;
}

export type IntensityBasis = 'ftp' | 'hr_max' | 'lthr' | 'threshold_speed';
export interface Zone {
  label: string;
  low: number;                 // fraction de la référence (0.75 = 75 %)
  high: number | null;         // null : zone ouverte vers le haut
}
export interface ZoneModel {
  basis: IntensityBasis;
  zones: readonly Zone[];      // contiguës, de la plus facile à la plus dure
}

export interface Athlete {
  id: AthleteId;
  displayName: string;
  sex?: 'male' | 'female';     // sert uniquement aux coefficients du TRIMP de Banister
  birthDate?: ISODate;
  weightKg?: number;
  timezone: string;            // IANA, ex. 'America/Argentina/Cordoba'
  firstDayOfWeek: 0 | 1;
  thresholds: readonly ThresholdSnapshot[];
  zones: Partial<Record<Sport, ZoneModel>>;
}

export function thresholdsAt(athlete: Pick<Athlete, 'thresholds'>, date: ISODate): ResolvedThresholds {
  const sorted = [...athlete.thresholds].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const first = sorted[0];
  if (first === undefined) return { asOf: null, backfilled: false, bySport: {} };
  const applicable = sorted.filter((s) => s.validFrom <= date);
  const backfilled = applicable.length === 0;
  const resolved: ResolvedThresholds = { asOf: null, backfilled, bySport: {} };
  for (const snap of backfilled ? [first] : applicable) {
    resolved.asOf = snap.validFrom;
    if (snap.hrMaxBpm !== undefined) resolved.hrMaxBpm = snap.hrMaxBpm;
    if (snap.hrRestBpm !== undefined) resolved.hrRestBpm = snap.hrRestBpm;
    for (const [sport, values] of Object.entries(snap.bySport ?? {}) as [Sport, SportThresholds][]) {
      resolved.bySport[sport] = { ...resolved.bySport[sport], ...values };
    }
  }
  return resolved;
}
