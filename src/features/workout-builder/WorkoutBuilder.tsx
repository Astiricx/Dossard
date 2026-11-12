// WorkoutBuilder.tsx — le constructeur de séance : en-tête, profil, totaux, blocs, enregistrement.
//
// Pour modifier une autre séance, le parent change la prop `key` (ex. key={workoutId ?? 'new'}) :
// le composant repart alors d'un brouillon neuf, sans effet de synchronisation à écrire.
import { useMemo, useReducer } from 'react';
import { SPORTS, thresholdsAt, type ISODate, type ISODateTime, type Workout, type WorkoutId } from '../../domain/index.ts';
import { plannedMetrics } from '../../engine/index.ts';
import { useApp } from '../../app/store.ts';
import { LOCAL_ATHLETE_ID, localToday } from '../athlete/thresholds.ts';
import { BlockList } from './BlockList.tsx';
import { ROLE_LABELS, SPORT_LABELS } from './labels.ts';
import { draftFromWorkout, draftProblem, draftReducer, emptyDraft, toWorkout } from './model/draft.ts';
import { BUILDER_ROLES } from './model/presets.ts';
import { buildProfile } from './model/profile.ts';
import { SummaryBar } from './SummaryBar.tsx';
import { card, fieldLabel, ghostButton, input, PlusIcon, primaryButton, SportBadge } from './ui.tsx';
import { WorkoutProfileChart } from './WorkoutProfileChart.tsx';

const NO_THRESHOLDS = { thresholds: [] } as const;

interface Props {
  /** Séance à modifier ; absent pour en créer une. */
  workoutId?: WorkoutId;
  initialDate?: ISODate;
  onSaved?: (workout: Workout) => void;
  onCancel?: () => void;
  onOpenProfile?: () => void;
}

export function WorkoutBuilder({ workoutId, initialDate, onSaved, onCancel, onOpenProfile }: Props) {
  const athlete = useApp((s) => s.athlete);
  const existing = useApp((s) => (workoutId === undefined ? undefined : s.calendar.workouts[workoutId]));
  const saveWorkouts = useApp((s) => s.actions.saveWorkouts);
  const [draft, dispatch] = useReducer(draftReducer, undefined, () =>
    existing !== undefined ? draftFromWorkout(existing) : emptyDraft(initialDate ?? localToday()));
  const countOnDate = useApp((s) => s.calendar.workoutIdsByDate[draft.date]?.length ?? 0);

  // Les seuils sont ceux en vigueur À LA DATE de la séance : une séance de mars se lit avec la FTP de mars.
  const thresholds = useMemo(() => thresholdsAt(athlete ?? NO_THRESHOLDS, draft.date), [athlete, draft.date]);
  const planned = useMemo(() => plannedMetrics({ sport: draft.sport, blocks: draft.blocks }, thresholds), [draft.sport, draft.blocks, thresholds]);
  const profile = useMemo(() => buildProfile({ sport: draft.sport, blocks: draft.blocks }, thresholds, athlete?.zones),
    [draft.sport, draft.blocks, thresholds, athlete?.zones]);
  const problem = draftProblem(draft);

  const save = (): void => {
    if (problem !== null) return;
    const workout = toWorkout(draft, {
      ...(existing !== undefined ? { existing } : {}),
      athleteId: athlete?.id ?? LOCAL_ATHLETE_ID,
      planned: planned.metrics,
      now: new Date().toISOString() as ISODateTime,
      countOnDate,
    });
    saveWorkouts([workout]);
    onSaved?.(workout);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <section className="space-y-4 lg:order-2 lg:sticky lg:top-4">
        <div className={`${card} p-4`}>
          <WorkoutProfileChart profile={profile} sport={draft.sport} />
        </div>
        <div className={`${card} p-4`}>
          <SummaryBar metrics={planned.metrics} warnings={planned.warnings} {...(onOpenProfile ? { onOpenProfile } : {})} />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={`${primaryButton} flex-1`} disabled={problem !== null} onClick={save}>
            {existing !== undefined ? 'Enregistrer les modifications' : 'Enregistrer la séance'}
          </button>
          {onCancel ? <button type="button" className={ghostButton} onClick={onCancel}>Annuler</button> : null}
        </div>
        {problem === 'no_blocks' ? <p className="text-xs text-mute">Ajoute au moins un bloc pour enregistrer la séance.</p> : null}
      </section>

      <section className="space-y-4 lg:order-1">
        <div className={`${card} grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_10rem]`}>
          <label className="block">
            <span className={fieldLabel}>Titre</span>
            <input className={input} value={draft.title} placeholder="Ex. 6 × 1000 m au seuil" maxLength={80}
              onChange={(event) => dispatch({ type: 'meta', patch: { title: event.currentTarget.value } })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Date</span>
            <input className={input} type="date" value={draft.date}
              onChange={(event) => { if (event.currentTarget.value !== '') dispatch({ type: 'meta', patch: { date: event.currentTarget.value as ISODate } }); }} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className={fieldLabel}>Sport</legend>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((sport) => (
                <label key={sport} className="cursor-pointer">
                  <input type="radio" name="sport" className="peer sr-only" checked={draft.sport === sport}
                    onChange={() => dispatch({ type: 'sport', sport, thresholds })} />
                  <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 text-sm text-mute transition-colors hover:border-line-strong hover:text-ink peer-checked:border-racing peer-checked:bg-racing/15 peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-racing">
                    <SportBadge sport={sport} compact />{SPORT_LABELS[sport]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <BlockList blocks={draft.blocks} sport={draft.sport} thresholds={thresholds} zones={athlete?.zones} dispatch={dispatch} />

        <div className={`${card} p-3`}>
          <p className={fieldLabel}>Ajouter un bloc</p>
          <div className="flex flex-wrap gap-2">
            {BUILDER_ROLES.map((role) => (
              <button key={role} type="button" className={ghostButton} onClick={() => dispatch({ type: 'addStep', role, thresholds })}>
                <PlusIcon /> {ROLE_LABELS[role]}
              </button>
            ))}
            <button type="button" className={ghostButton} onClick={() => dispatch({ type: 'addRepeat', thresholds })}>
              <PlusIcon /> Répétition
            </button>
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Consignes (facultatif)</span>
          <textarea className={`${input} h-20 py-2`} value={draft.description} maxLength={500}
            onChange={(event) => dispatch({ type: 'meta', patch: { description: event.currentTarget.value } })} />
        </label>
      </section>
    </div>
  );
}
