// match.ts — rapprochement automatique « prévu ↔ réalisé ». Fonction pure.
// Règle volontairement prudente : même jour, même sport, séance pas encore rapprochée. S'il reste
// plusieurs candidates, on prend celle dont la durée prévue est la plus proche ; en cas d'égalité
// on ne devine pas, et le rapprochement reste à faire à la main.
import type { ActivityId, CompletedActivity, Workout, WorkoutId } from '../../domain/index.ts';
import type { CalendarState } from '../../store/calendar.ts';

export interface MatchPair { workoutId: WorkoutId; activityId: ActivityId }

/** Séances du jour de l'activité qui peuvent lui être rapprochées (même sport, libres). */
export function matchCandidates(calendar: CalendarState, activity: CompletedActivity, taken: ReadonlySet<WorkoutId> = new Set()): Workout[] {
  return (calendar.workoutIdsByDate[activity.localDate] ?? [])
    .map((id) => calendar.workouts[id])
    .filter((w): w is Workout => w !== undefined && w.sport === activity.sport && w.activityId === null && !taken.has(w.id));
}

export function autoMatch(calendar: CalendarState, activityIds: readonly ActivityId[]): MatchPair[] {
  const linked = new Set(Object.values<Workout>(calendar.workouts).map((w) => w.activityId).filter((id) => id !== null));
  const activities = activityIds
    .map((id) => calendar.activities[id])
    .filter((a): a is CompletedActivity => a !== undefined && !linked.has(a.id))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const taken = new Set<WorkoutId>();
  const pairs: MatchPair[] = [];
  for (const activity of activities) {
    const candidates = matchCandidates(calendar, activity, taken);
    let chosen = candidates.length === 1 ? candidates[0] : undefined;
    if (candidates.length > 1 && candidates.every((w) => w.planned.durationS !== null)) {
      const ranked = candidates
        .map((w) => ({ w, gap: Math.abs((w.planned.durationS ?? 0) - activity.summary.movingS) }))
        .sort((a, b) => a.gap - b.gap);
      if (ranked[0] !== undefined && ranked[1] !== undefined && ranked[0].gap < ranked[1].gap) chosen = ranked[0].w;
    }
    if (chosen === undefined) continue;
    taken.add(chosen.id);
    pairs.push({ workoutId: chosen.id, activityId: activity.id });
  }
  return pairs;
}
