import { useDraggable } from '@dnd-kit/core';
import type { PlannedMetrics, Sport } from '../../domain/index.ts';
import { REST_COLOR, SPORT_COLORS, SPORT_LABELS } from '../workout-builder/labels.ts';
import { formatDuration } from '../workout-builder/model/format.ts';

/** Ce qu'une vignette affiche d'une séance prévue ou d'un modèle. */
export interface ChipContent { sport: Sport | 'rest'; title: string; planned: PlannedMetrics }

/** Contenu d'une vignette de séance : commun à la grille, à la bibliothèque et à l'aperçu de glissement. */
export function ChipBody({ workout, note }: { workout: ChipContent; note?: string }) {
  const color = workout.sport === 'rest' ? REST_COLOR : SPORT_COLORS[workout.sport];
  const sport = workout.sport === 'rest' ? 'Repos' : SPORT_LABELS[workout.sport];
  return (
    <>
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-md" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{workout.title}</span>
        {workout.planned.load !== null ? <span className="shrink-0 text-xs font-semibold text-ink tabular-nums" title="Charge prévue">{Math.round(workout.planned.load)}</span> : null}
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute tabular-nums">
        <span className="shrink-0">{sport}</span>
        {workout.planned.durationS !== null ? <span className="truncate">{formatDuration(workout.planned.durationS)}</span> : null}
        {note !== undefined ? <span className="ml-auto shrink-0">{note}</span> : null}
      </span>
    </>
  );
}

export const chipShell =
  'relative block w-full touch-manipulation rounded-md border border-line bg-raised py-1.5 pr-2 pl-3 text-left transition-colors ' +
  'hover:border-racing/70 hover:bg-racing/10 focus-visible:outline-2 focus-visible:outline-racing';

interface Props {
  /** Identifiant dnd-kit : `dragId.workout(...)` ou `dragId.library(...)`. */
  dragKey: string;
  workout: ChipContent;
  note?: string;
  label: string;
  /** true : la séance est réalisée, elle ne se déplace plus (son activité, elle, a une date fixe). */
  locked?: boolean;
  onClick?: () => void;
}

/** Vignette déplaçable. Un clic l'ouvre ; un glissement (souris, appui long au doigt, ou clavier) la déplace. */
export function WorkoutChip({ dragKey, workout, note, label, locked = false, onClick }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragKey, disabled: locked });
  return (
    <button type="button" ref={setNodeRef} {...attributes} {...listeners} aria-label={label} onClick={onClick}
      className={`${chipShell} ${locked ? 'cursor-pointer rounded-b-none border-b-0' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-35' : ''}`}>
      <ChipBody workout={workout} {...(note !== undefined ? { note } : {})} />
    </button>
  );
}
