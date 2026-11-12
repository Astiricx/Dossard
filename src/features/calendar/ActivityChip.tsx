import type { ActivityId } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { SPORT_COLORS, SPORT_LABELS } from '../workout-builder/labels.ts';
import { formatDistance, formatDuration } from '../workout-builder/model/format.ts';
import { CheckIcon } from '../workout-builder/ui.tsx';

interface Props {
  id: ActivityId;
  /** true : affichée sous la séance prévue à laquelle elle est rapprochée. */
  attached?: boolean;
  onOpen: (id: ActivityId) => void;
}

/**
 * Une activité RÉALISÉE dans la grille. Elle se distingue d'une séance prévue par trois signes à la
 * fois : fond et bordure verts, coche, et le mot « Réalisé ». Elle ne se déplace pas : sa date est
 * celle de l'enregistrement.
 */
export function ActivityChip({ id, attached = false, onOpen }: Props) {
  const activity = useApp((s) => s.calendar.activities[id]);
  if (activity === undefined) return null;
  const sport = SPORT_LABELS[activity.sport];
  const load = activity.load !== null ? Math.round(activity.load.value) : null;
  return (
    <button type="button" onClick={() => onOpen(id)}
      aria-label={`Réalisé : ${activity.title}, ${sport}, ${formatDuration(activity.summary.movingS)}${load !== null ? `, charge ${load}` : ''}. Ouvrir le détail.`}
      className={`relative block w-full rounded-md border border-done/50 bg-done/10 py-1.5 pr-2 pl-3 text-left transition-colors hover:border-done hover:bg-done/20 focus-visible:outline-2 focus-visible:outline-done ${
        attached ? 'rounded-t-none' : ''}`}>
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-md" style={{ backgroundColor: SPORT_COLORS[activity.sport] }} aria-hidden="true" />
      {attached ? null : <span className="block truncate text-xs font-medium text-ink">{activity.title}</span>}
      <span className={`flex items-center gap-1 text-[11px] text-ink tabular-nums ${attached ? '' : 'mt-0.5'}`}>
        <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-done [&>svg]:size-3.5"><CheckIcon />Réalisé</span>
        <span className="ml-auto shrink-0 font-semibold" title="Charge réalisée">{load ?? '—'}</span>
      </span>
      <span className="block truncate text-[11px] text-mute tabular-nums">
        {formatDuration(activity.summary.movingS)}{activity.summary.distanceM !== undefined ? `, ${formatDistance(activity.summary.distanceM)}` : ''}
      </span>
    </button>
  );
}
