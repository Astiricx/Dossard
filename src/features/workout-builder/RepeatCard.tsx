import type { Dispatch } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Athlete, RepeatBlock, ResolvedThresholds, Sport } from '../../domain/index.ts';
import type { DraftAction } from './model/draft.ts';
import { parseCount } from './model/format.ts';
import { StepCard } from './StepCard.tsx';
import { CopyIcon, ghostButton, GripIcon, iconButton, ParsedField, PlusIcon, TrashIcon } from './ui.tsx';

interface Props {
  block: RepeatBlock;
  sport: Sport;
  thresholds: ResolvedThresholds;
  zones: Athlete['zones'] | undefined;
  dispatch: Dispatch<DraftAction>;
}

/** Une répétition : « 5 × (intervalle + récupération) ». Ses étapes se réordonnent entre elles. */
export function RepeatCard({ block, sport, thresholds, zones, dispatch }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-xl border border-line bg-panel p-2 ${isDragging ? 'relative z-10 shadow-xl ring-2 ring-racing/50' : ''}`}
    >
      <div className="flex items-center gap-1">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
          className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`} aria-label="Déplacer : répétition">
          <GripIcon />
        </button>
        <span className="text-sm font-semibold text-ink">Répéter</span>
        <ParsedField label="Nombre de répétitions" className="w-16" value={block.count} format={String} parse={parseCount}
          onCommit={(count) => dispatch({ type: 'repeatCount', id: block.id, count })} inputMode="numeric" />
        <span className="text-sm text-mute">fois</span>
        <span className="flex-1" />
        <button type="button" className={iconButton} aria-label="Dupliquer : répétition" onClick={() => dispatch({ type: 'duplicate', id: block.id })}>
          <CopyIcon />
        </button>
        <button type="button" className={iconButton} aria-label="Supprimer : répétition" onClick={() => dispatch({ type: 'remove', id: block.id })}>
          <TrashIcon />
        </button>
      </div>
      <SortableContext items={block.steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
        <ul className="mt-2 space-y-2">
          {block.steps.map((step) => (
            <StepCard key={step.id} step={step} sport={sport} thresholds={thresholds} zones={zones} dispatch={dispatch} nested />
          ))}
        </ul>
      </SortableContext>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={ghostButton} onClick={() => dispatch({ type: 'addStep', role: 'active', thresholds, intoRepeat: block.id })}>
          <PlusIcon /> Intervalle
        </button>
        <button type="button" className={ghostButton} onClick={() => dispatch({ type: 'addStep', role: 'recovery', thresholds, intoRepeat: block.id })}>
          <PlusIcon /> Récupération
        </button>
      </div>
    </li>
  );
}
