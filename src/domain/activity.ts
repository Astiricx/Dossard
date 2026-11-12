// activity.ts — la séance RÉALISÉE, telle que la montre l'a enregistrée.
import type { ActivityLoad } from './load.ts';
import type { ActivityId, AthleteId, ISODate, ISODateTime, Sport } from './primitives.ts';

export interface ActivitySource {
  provider: 'garmin' | 'strava' | 'file' | 'manual';
  /** Identifiant chez le fournisseur. (provider, externalId) est unique : réimporter ne duplique jamais. */
  externalId: string | null;
  device?: string;
  importedAt: ISODateTime;
}

export interface ActivitySummary {
  elapsedS: number;             // du départ à l'arrêt, pauses comprises
  movingS: number;              // temps chronométré, hors pauses
  distanceM?: number;
  elevationGainM?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  avgPowerW?: number;
  normalizedPowerW?: number;    // fournie par l'appareil ; recalculée si la série existe
  avgSpeedMps?: number;
  avgCadenceRpm?: number;
  energyKj?: number;
}

export interface Lap {
  index: number;
  startOffsetS: number;
  elapsedS: number;
  distanceM?: number;
  avgHrBpm?: number;
  avgPowerW?: number;
  avgSpeedMps?: number;
  /** 'workout_step' : le tour correspond à une étape de la séance prévue, ce qui permet la superposition. */
  trigger?: 'manual' | 'distance' | 'time' | 'workout_step';
}

/** Ce que l'athlète déclare après la séance. Jamais écrasé par une synchronisation. */
export interface SubjectiveFeedback {
  rpe?: number;                 // échelle CR-10 de Borg, base de la méthode de Foster
  fatigue?: 1 | 2 | 3 | 4 | 5;
  /** Sensations pendant la séance : 1 = très mauvaises, 5 = excellentes. */
  feeling?: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface CompletedActivity {
  id: ActivityId;
  athleteId: AthleteId;
  source: ActivitySource;
  sport: Sport;
  subSport?: string;            // 'trail', 'indoor', 'open_water'…
  title: string;
  description?: string;
  startTime: ISODateTime;
  utcOffsetMin: number;
  /** Jour local du départ, figé à l'import : une sortie à 23 h à Córdoba reste ce jour-là vue de Paris. */
  localDate: ISODate;
  summary: ActivitySummary;
  laps: readonly Lap[];
  hasStreams: boolean;          // les séries sont stockées à part (voir ActivityStreams)
  subjective: SubjectiveFeedback;
  load: ActivityLoad | null;    // null : rien de calculable
  isRace: boolean;
}

/** null ou undefined = échantillon manquant (capteur décroché). */
export type Stream = readonly (number | null | undefined)[];

/**
 * Séries temporelles, en colonnes. Elles vivent hors du store, dans leur propre table, et ne sont
 * chargées que pour l'activité ouverte : une sortie de 3 h pèse environ 10 000 points par capteur.
 */
export interface ActivityStreams {
  activityId: ActivityId;
  /** Secondes depuis le départ. Le pas peut être irrégulier (« smart recording » de Garmin). */
  timeS: readonly number[];
  hrBpm?: Stream;
  powerW?: Stream;
  speedMps?: Stream;
  cadenceRpm?: Stream;
  altitudeM?: Stream;
  distanceM?: Stream;
  latLng?: readonly (readonly [number, number] | null)[];
}
