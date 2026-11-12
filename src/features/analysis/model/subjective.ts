// subjective.ts — le ressenti saisi par l'athlète, et son effet sur la charge. Fonctions pures.
import type { CompletedActivity, ResolvedThresholds, SubjectiveFeedback } from '../../../domain/index.ts';
import { resolveActivityLoad, sessionRpe } from '../../../engine/index.ts';

export const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/** Repères de l'échelle CR-10 utilisée par la méthode de Foster. */
export const RPE_TEXT: Record<number, string> = {
  1: 'Très, très facile', 2: 'Facile', 3: 'Modéré', 4: 'Assez dur', 5: 'Dur', 6: 'Dur', 7: 'Très dur', 8: 'Très dur', 9: 'Presque maximal', 10: 'Maximal',
};
export const FEELING_VALUES = [1, 2, 3, 4, 5] as const;
export const FEELING_TEXT: Record<number, string> = { 1: 'Très mauvaises', 2: 'Mauvaises', 3: 'Moyennes', 4: 'Bonnes', 5: 'Excellentes' };
export const NOTE_MAX_LENGTH = 2000;

/** Une valeur `undefined` efface le champ. */
export type SubjectivePatch = { [K in keyof SubjectiveFeedback]?: SubjectiveFeedback[K] | undefined };

/** Charge de Foster : RPE × durée en minutes, en unités arbitraires. null sans RPE. */
export function fosterLoad(activity: Pick<CompletedActivity, 'summary' | 'subjective'>): number | null {
  const { movingS, elapsedS } = activity.summary;
  const result = sessionRpe({ rpe: activity.subjective.rpe, durationS: movingS > 0 ? movingS : elapsedS });
  return result.ok ? Math.round(result.value) : null;
}

/**
 * Applique un ressenti à une activité et met sa charge à jour.
 *  - Charge mesurée (puissance, allure, FC) : elle ne bouge pas. Seule la mesure de Foster, gardée à
 *    côté pour comparer charge objective et charge ressentie, est recalculée.
 *  - Charge estimée faute de mieux (effort perçu ou durée seule) : elle est recalculée, car le RPE
 *    devient alors la meilleure information disponible.
 */
export function withSubjective(activity: CompletedActivity, patch: SubjectivePatch, thresholds: ResolvedThresholds, sex?: 'male' | 'female'): CompletedActivity {
  const subjective: { -readonly [K in keyof SubjectiveFeedback]: SubjectiveFeedback[K] } = { ...activity.subjective };
  for (const key of Object.keys(patch) as (keyof SubjectiveFeedback)[]) {
    const value = patch[key];
    if (value === undefined) delete subjective[key]; else (subjective as Record<string, unknown>)[key] = value;
  }
  if (subjective.note !== undefined) {
    const note = subjective.note.trim().slice(0, NOTE_MAX_LENGTH);
    if (note === '') delete subjective.note; else subjective.note = note;
  }
  if (subjective.rpe !== undefined && !(subjective.rpe >= 1 && subjective.rpe <= 10)) delete subjective.rpe;

  const fresh = resolveActivityLoad({ sport: activity.sport, summary: activity.summary, subjective }, { thresholds, ...(sex !== undefined ? { sex } : {}) });
  const current = activity.load;
  const measured = current !== null && (current.method === 'power' || current.method === 'pace' || current.method === 'hr');
  let load = fresh;
  if (measured) {
    const { sessionRpe: _old, ...metrics } = current.metrics;
    const foster = fresh?.metrics.sessionRpe;
    load = { ...current, metrics: foster !== undefined ? { ...metrics, sessionRpe: foster } : metrics };
  }
  return { ...activity, subjective, load };
}
