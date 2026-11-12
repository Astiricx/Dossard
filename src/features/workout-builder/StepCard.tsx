import type { Dispatch } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Athlete, ResolvedThresholds, Sport, StepBlock, StepRole } from '../../domain/index.ts';
import { DurationEditor } from './DurationEditor.tsx';
import { ROLE_LABELS, ZONE_LABELS, zoneColor } from './labels.ts';
import type { DraftAction } from './model/draft.ts';
import { BUILDER_ROLES } from './model/presets.ts';
import { stepZone } from './model/profile.ts';
import { TargetEditor } from './TargetEditor.tsx';
import { CopyIcon, GripIcon, iconButton, Select, TrashIcon } from './ui.tsx';

interface Props {
  step: StepBlock;
  sport: Sport;
  thresholds: ResolvedThresholds;
  zones: Athlete['zones'] | undefined;
  dispatch: Dispatch<DraftAction>;
  /** true : étape d'une répétition (présentation plus compacte, sans bordure propre). */
  nested?: boolean;
}

/** Une étape de la séance : rôle, durée, cible. Déplaçable par sa poignée, à la souris, au doigt ou au clavier. */
export function StepCard({ step, sport, thresholds, zones, dispatch, nested = false }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const zone = stepZone(step, sport, thresholds, zones);
  const roles: readonly StepRole[] = BUILDER_ROLES.includes(step.role) ? BUILDER_ROLES : [...BUILDER_ROLES, step.role];
  const canRamp = step.target.kind === 'relative' || step.target.kind === 'absolute';
  const name = ROLE_LABELS[step.role].toLowerCase();

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex gap-1 overflow-hidden rounded-xl border border-line py-2 pr-1 pl-2.5 ${
        nested ? 'bg-carbon' : 'bg-panel'
      } ${isDragging ? 'z-10 shadow-xl ring-2 ring-racing/50' : ''}`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: zoneColor(zone) }} aria-hidden="true" />
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
        className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`} aria-label={`Déplacer : ${name}`}>
        <GripIcon />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Select label="Rôle de l'étape" className="flex-1" value={step.role}
            options={roles.map((value) => ({ value, label: ROLE_LABELS[value] }))}
            onChange={(role) => dispatch({ type: 'updateStep', id: step.id, patch: { role } })} />
          <span className="hidden shrink-0 text-xs text-mute sm:inline">
            {zone === null ? 'Zone inconnue' : `Z${zone} ${ZONE_LABELS[zone]}`}
          </span>
        </div>
        <DurationEditor duration={step.duration} sport={sport}
          onChange={(duration) => dispatch({ type: 'updateStep', id: step.id, patch: { duration } })} />
        <TargetEditor target={step.target} role={step.role} sport={sport} thresholds={thresholds}
          onChange={(target) => dispatch({ type: 'updateStep', id: step.id, patch: { target } })} />
        {canRamp ? (
          <label className="flex items-center gap-2 text-xs text-mute">
            <input type="checkbox" className="size-4 accent-racing" checked={step.profile === 'ramp'}
              onChange={(event) => dispatch({ type: 'updateStep', id: step.id, patch: { profile: event.currentTarget.checked ? 'ramp' : 'steady' } })} />
            Progressif : l'intensité passe de la première valeur à la seconde
          </label>
        ) : null}
      </div>
      <div className="flex flex-col">
        <button type="button" className={iconButton} aria-label={`Dupliquer : ${name}`} onClick={() => dispatch({ type: 'duplicate', id: step.id })}>
          <CopyIcon />
        </button>
        <button type="button" className={iconButton} aria-label={`Supprimer : ${name}`} onClick={() => dispatch({ type: 'remove', id: step.id })}>
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
