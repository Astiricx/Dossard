// messages.ts — la partie des messages FIT que l'application lit. Les noms sont ceux produits par
// le SDK officiel (@garmin/fitsdk), vérifiés sur ses types en version 21.221 : clés « xxxMesgs »,
// champs en camelCase, échelles appliquées (secondes, mètres, m/s), énumérations converties en
// texte camelCase (« running », « fitnessEquipment », « indoorCycling »).
// Tout est optionnel : un fichier FIT ne contient que ce que l'appareil a enregistré.

/** Date JS (option convertDateTimesToDates), ou secondes depuis l'époque FIT (31/12/1989 00:00 UTC). */
export type FitTime = Date | number;

export interface FitSession {
  startTime?: FitTime;
  timestamp?: FitTime;
  sport?: string | number;
  subSport?: string | number;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistance?: number;
  totalAscent?: number;
  totalCalories?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPower?: number;
  normalizedPower?: number;
  avgSpeed?: number;
  enhancedAvgSpeed?: number;
  avgCadence?: number;
}
export interface FitRecord {
  timestamp?: FitTime;
  heartRate?: number;
  power?: number;
  speed?: number;
  enhancedSpeed?: number;
  cadence?: number;
  distance?: number;
}
export interface FitActivity { timestamp?: FitTime; localTimestamp?: FitTime }
export interface FitMessages {
  sessionMesgs?: readonly FitSession[];
  recordMesgs?: readonly FitRecord[];
  activityMesgs?: readonly FitActivity[];
  workoutMesgs?: readonly { wktName?: string }[];
  fileIdMesgs?: readonly { type?: string | number; manufacturer?: string | number; garminProduct?: string | number; product?: string | number }[];
}

/** Décode le contenu binaire d'un fichier .fit. Injecté : les tests n'ont pas besoin du SDK. */
export type FitDecoder = (buffer: ArrayBuffer) => Promise<{ ok: true; messages: FitMessages } | { ok: false; reason: 'not_fit' | 'corrupt'; detail?: string }>;
