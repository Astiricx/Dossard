// dnd.ts — traduit un lâcher dnd-kit en intention métier. Pur : la règle se teste sans navigateur,
// et le composant n'a plus qu'à exécuter l'intention.
import { parseISODate, type ISODate, type WorkoutId } from '../../../domain/index.ts';
import type { CalendarState } from '../../../store/calendar.ts';

export const dragId = {
  workout: (id: WorkoutId): string => `w:${id}`,
  library: (key: string): string => `lib:${key}`,
  day: (date: ISODate): string => `day:${date}`,
};

export type DragSource = { kind: 'workout'; id: WorkoutId } | { kind: 'library'; key: string };
export function parseDragSource(id: string | number): DragSource | null {
  const text = String(id);
  if (text.startsWith('w:') && text.length > 2) return { kind: 'workout', id: text.slice(2) as WorkoutId };
  if (text.startsWith('lib:') && text.length > 4) return { kind: 'library', key: text.slice(4) };
  return null;
}
export const parseDayTarget = (id: string | number): ISODate | null => {
  const text = String(id);
  return text.startsWith('day:') ? parseISODate(text.slice(4)) : null;
};

export type DropIntent =
  | { type: 'move'; id: WorkoutId; toDate: ISODate; toIndex: number }
  | { type: 'copy'; key: string; toDate: ISODate };

/** null : lâcher hors d'un jour, source inconnue, ou séance reposée sur son propre jour. */
export function dropIntent(activeId: string | number, overId: string | number | null | undefined, calendar: CalendarState): DropIntent | null {
  if (overId === null || overId === undefined) return null;
  const source = parseDragSource(activeId);
  const toDate = parseDayTarget(overId);
  if (source === null || toDate === null) return null;
  if (source.kind === 'library') return { type: 'copy', key: source.key, toDate };
  const workout = calendar.workouts[source.id];
  if (workout === undefined || workout.date === toDate) return null;
  return { type: 'move', id: source.id, toDate, toIndex: calendar.workoutIdsByDate[toDate]?.length ?? 0 };
}
