// WeekGrid.tsx — la grille « tableur » : une ligne par semaine, du lundi au dimanche, et sa synthèse
// prévu / réalisé.
import { memo, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { ActivityId, ISODate, MacroCycle, RaceEvent, TrainingPlan, WorkoutId } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { formatDistance, formatDuration } from '../workout-builder/model/format.ts';
import { CheckIcon, FlagIcon, PlusIcon } from '../workout-builder/ui.tsx';
import { ActivityChip } from './ActivityChip.tsx';
import { dragId } from './model/dnd.ts';
import { PHASE_COLORS, PHASE_LABELS, phaseOfWeek, racesOn } from './model/season.ts';
import { DAY_NAMES, dayOfMonth, isoWeekNumber, longDate, makeWeekSummary, monthName, weekDays, weekRangeLabel, type WeekSummary } from './model/weeks.ts';
import { WorkoutChip } from './WorkoutChip.tsx';

const COLUMNS = 'grid grid-cols-[7rem_repeat(7,minmax(6.75rem,1fr))_10.5rem]';
const NO_WORKOUTS: readonly WorkoutId[] = [];
const NO_ACTIVITIES: readonly ActivityId[] = [];

interface Handlers {
  onPlan: (date: ISODate) => void;
  onEdit: (id: WorkoutId) => void;
  onOpenActivity: (id: ActivityId) => void;
}
interface Props extends Handlers {
  weeks: readonly ISODate[];
  today: ISODate;
  macros: readonly MacroCycle[];
  plan: TrainingPlan | undefined;
}

export function WeekGrid({ weeks, today, macros, plan, ...handlers }: Props) {
  const calendar = useApp((s) => s.calendar);
  // Un sélecteur mémorisé par semaine : une ligne dont rien n'a changé garde le même objet.
  const selectors = useMemo(() => weeks.map((week) => makeWeekSummary(week)), [weeks]);
  const totals = selectors.map((select) => select(calendar));
  const maxLoad = Math.max(1, ...totals.map((t) => Math.max(t.planned.load, t.completed.load)));

  return (
    <div className="carbon-card overflow-x-auto rounded-xl border border-line">
      <div className="min-w-[65rem]" role="table" aria-label="Calendrier d'entraînement par semaine">
        <div className={`${COLUMNS} border-b border-line text-xs font-medium text-mute`} role="row">
          <div className="px-3 py-2" role="columnheader">Semaine</div>
          {DAY_NAMES.map((name) => <div key={name} className="border-l border-line px-2 py-2" role="columnheader">{name}</div>)}
          <div className="border-l border-line px-3 py-2" role="columnheader">Synthèse</div>
        </div>
        {weeks.map((week, i) => (
          <WeekRow key={week} week={week} today={today} summary={totals[i] as WeekSummary} maxLoad={maxLoad}
            phase={phaseOfWeek(macros, week)} plan={plan} {...handlers} />
        ))}
      </div>
    </div>
  );
}

interface RowProps extends Handlers {
  week: ISODate;
  today: ISODate;
  summary: WeekSummary;
  maxLoad: number;
  phase: MacroCycle | undefined;
  plan: TrainingPlan | undefined;
}
const WeekRow = memo(function WeekRow({ week, today, summary, maxLoad, phase, plan, ...handlers }: RowProps) {
  const days = useMemo(() => weekDays(week), [week]);
  const current = today >= week && today <= (days[6] as ISODate);
  return (
    <div className={`${COLUMNS} border-b border-line last:border-b-0 ${current ? 'bg-racing/[0.04]' : ''}`} role="row">
      <div className={`px-3 py-2 ${current ? 'shadow-[inset_3px_0_0_var(--color-racing)]' : ''}`} role="rowheader">
        <p className="text-sm font-semibold text-ink tabular-nums">S{isoWeekNumber(week)}</p>
        <p className="text-[11px] text-mute tabular-nums">{weekRangeLabel(week)}</p>
        {phase !== undefined ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink">
            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: PHASE_COLORS[phase.phase] }} aria-hidden="true" />
            <span className="truncate">{PHASE_LABELS[phase.phase]}</span>
          </p>
        ) : null}
      </div>
      {days.map((date, i) => (
        <DayCell key={date} date={date} isToday={date === today} planned={summary.planned.dailyLoad[i] ?? 0} done={summary.completed.dailyLoad[i] ?? 0}
          races={racesOn(plan, date)} {...handlers} />
      ))}
      <WeekSynthesis summary={summary} maxLoad={maxLoad} />
    </div>
  );
});

/** « réalisé / prévu » sur une ligne ; une seule valeur quand l'autre n'existe pas. */
function Versus({ done, planned, hasDone, hasPlanned }: { done: string; planned: string; hasDone: boolean; hasPlanned: boolean }) {
  if (!hasDone) return <>{planned}</>;
  // Sur deux lignes : la colonne est étroite, et « 30,25 km / ≥ 42,32 km » n'y tient pas sur une seule.
  return <><span className="block text-done">{done}</span>{hasPlanned ? <span className="block font-normal text-mute">/ {planned}</span> : null}</>;
}

function WeekSynthesis({ summary, maxLoad }: { summary: WeekSummary; maxLoad: number }) {
  const { planned, completed } = summary;
  const hasPlanned = planned.count > 0, hasDone = completed.count > 0;
  if (!hasPlanned && !hasDone) return <div className="border-l border-line px-3 py-2" role="cell"><p className="text-xs text-mute">Rien de prévu</p></div>;
  const atLeast = (partial: boolean): string => (partial ? '≥ ' : '');
  const width = (load: number): string => `${Math.min(100, Math.round((load / maxLoad) * 100))}%`;
  return (
    <div className="border-l border-line px-3 py-2" role="cell">
      <dl className="space-y-1">
        <div>
          <dt className="text-[11px] text-mute">{hasDone ? (hasPlanned ? 'Charge réalisée / prévue' : 'Charge réalisée') : 'Charge prévue'}</dt>
          <dd className="flex items-baseline gap-1 tabular-nums">
            {hasDone ? <span className="text-2xl leading-7 font-semibold tracking-tight text-done">{atLeast(completed.loadPartial)}{Math.round(completed.load)}</span> : null}
            {hasPlanned ? (
              <span className={hasDone ? 'text-sm font-medium text-mute' : 'text-2xl leading-7 font-semibold tracking-tight text-ink'}>
                {hasDone ? '/ ' : ''}{atLeast(planned.loadPartial)}{Math.round(planned.load)}
              </span>
            ) : null}
          </dd>
          {/* Deux barres sur la même échelle : le prévu en rouge, le réalisé en vert juste dessous. */}
          <div className="mt-1 space-y-0.5" aria-hidden="true">
            {hasPlanned ? <div className="h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-racing" style={{ width: width(planned.load) }} /></div> : null}
            {hasDone ? <div className="h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-done" style={{ width: width(completed.load) }} /></div> : null}
          </div>
        </div>
        <div className="flex justify-between gap-2 text-xs">
          <dt className="text-mute">Durée</dt>
          <dd className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
            <Versus hasDone={hasDone} hasPlanned={hasPlanned} done={formatDuration(completed.durationS)} planned={`${atLeast(planned.durationPartial)}${formatDuration(planned.durationS)}`} />
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-xs">
          <dt className="text-mute">Distance</dt>
          <dd className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
            <Versus hasDone={hasDone} hasPlanned={hasPlanned && !(planned.distanceM === 0 && planned.distancePartial)} done={formatDistance(completed.distanceM)}
              planned={planned.distanceM === 0 && planned.distancePartial ? '—' : `${atLeast(planned.distancePartial)}${formatDistance(planned.distanceM)}`} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

interface CellProps extends Handlers {
  date: ISODate;
  isToday: boolean;
  planned: number;
  done: number;
  races: readonly RaceEvent[];
}
/** Une case du calendrier. Elle ne s'abonne qu'à SES listes : déplacer une séance redessine deux cases. */
const DayCell = memo(function DayCell({ date, isToday, planned, done, races, onPlan, onEdit, onOpenActivity }: CellProps) {
  const workoutIds = useApp((s) => s.calendar.workoutIdsByDate[date] ?? NO_WORKOUTS);
  const activityIds = useApp((s) => s.calendar.activityIdsByDate[date] ?? NO_ACTIVITIES);
  const { setNodeRef, isOver } = useDroppable({ id: dragId.day(date) });
  return (
    <div ref={setNodeRef} role="cell"
      // Un clic dans le vide de la case planifie. Un clic sur une vignette a une autre cible : il l'ouvre.
      onClick={(event) => { if (event.target === event.currentTarget) onPlan(date); }}
      className={`group/day flex min-h-28 cursor-pointer flex-col gap-1 border-l border-line p-1.5 transition-colors hover:bg-white/[0.03] ${
        isOver ? 'bg-racing/15 shadow-[inset_0_0_0_2px_var(--color-racing)]' : ''}`}>
      <div className="pointer-events-none flex items-center gap-1">
        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${
          isToday ? 'bg-racing-deep text-white' : 'text-mute'}`}>
          {dayOfMonth(date)}
        </span>
        {dayOfMonth(date) === 1 ? <span className="text-[11px] text-mute">{monthName(date)}</span> : null}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold tabular-nums">
          {done > 0 ? <span className="inline-flex items-center text-done [&>svg]:size-3" title="Charge réalisée du jour"><CheckIcon />{Math.round(done)}</span> : null}
          {planned > 0 ? <span className={done > 0 ? 'font-normal text-mute' : 'text-ink'} title="Charge prévue du jour">{Math.round(planned)}</span> : null}
        </span>
        <button type="button" aria-label={`Planifier une séance le ${longDate(date)}`} onClick={() => onPlan(date)}
          className="pointer-events-auto inline-flex size-6 items-center justify-center rounded-md text-mute opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-racing/15 hover:text-racing focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-racing [@media(hover:none)]:opacity-100 [&>svg]:size-4">
          <PlusIcon />
        </button>
      </div>
      {races.map((race) => (
        <p key={race.id} className="pointer-events-none flex items-center gap-1 rounded-md border border-racing/60 bg-racing/15 px-1.5 py-1 text-[11px] font-medium text-ink [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-racing">
          <FlagIcon /><span className="truncate">{race.name}</span><span className="ml-auto shrink-0 font-semibold">{race.priority}</span>
        </p>
      ))}
      {workoutIds.map((id) => <PlannedChip key={id} id={id} onEdit={onEdit} onOpenActivity={onOpenActivity} />)}
      {activityIds.map((id) => <UnplannedActivity key={id} id={id} onOpen={onOpenActivity} />)}
    </div>
  );
});

/** Une séance prévue ; si elle est rapprochée, son activité est affichée juste dessous, collée à elle. */
function PlannedChip({ id, onEdit, onOpenActivity }: { id: WorkoutId; onEdit: (id: WorkoutId) => void; onOpenActivity: (id: ActivityId) => void }) {
  const workout = useApp((s) => s.calendar.workouts[id]);
  // Le lien n'est suivi que si l'activité existe encore.
  const activityId = useApp((s) => { const linked = s.calendar.workouts[id]?.activityId ?? null; return linked !== null && s.calendar.activities[linked] !== undefined ? linked : null; });
  if (workout === undefined) return null;
  const done = activityId !== null;
  return (
    <div>
      <WorkoutChip dragKey={dragId.workout(id)} workout={workout} locked={done}
        label={done ? `${workout.title} : séance réalisée, ouvrir` : `${workout.title} : ouvrir, ou glisser vers un autre jour`} onClick={() => onEdit(id)} />
      {activityId !== null ? <ActivityChip id={activityId} attached onOpen={onOpenActivity} /> : null}
    </div>
  );
}

/** Une activité du jour qui n'est rapprochée d'aucune séance. Les autres sont affichées sous leur séance. */
function UnplannedActivity({ id, onOpen }: { id: ActivityId; onOpen: (id: ActivityId) => void }) {
  const linked = useApp((s) => { for (const key in s.calendar.workouts) if (s.calendar.workouts[key as WorkoutId]?.activityId === id) return true; return false; });
  return linked ? null : <ActivityChip id={id} onOpen={onOpen} />;
}
