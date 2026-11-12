// CalendarView.tsx — l'onglet Calendrier : la saison (macro) et la grille des semaines (micro).
//
// Un seul DndContext couvre la bibliothèque et la grille. Pendant le glissement, rien ne passe par
// le store : seul le lâcher est traduit en intention (model/dnd.ts), puis exécuté.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { addDays, startOfWeek, thresholdsAt, type ActivityId, type ISODate, type ISODateTime, type WorkoutId } from '../../domain/index.ts';
import { appStore, useApp } from '../../app/store.ts';
import { LOCAL_ATHLETE_ID, localToday } from '../athlete/thresholds.ts';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ghostButton, iconButton, PlusIcon, primaryButton, tab } from '../workout-builder/ui.tsx';
import { ImportPanel } from '../import/ImportPanel.tsx';
import { ActivityDialog } from './ActivityDialog.tsx';
import { chipOf, Library } from './Library.tsx';
import { dropIntent, parseDragSource } from './model/dnd.ts';
import { libraryItems, placeCopy, type LibraryItem } from './model/library.ts';
import { macroCycles, seasonPlan } from './model/season.ts';
import { longDate, weekStartsFrom } from './model/weeks.ts';
import { SeasonView } from './SeasonView.tsx';
import { WeekGrid } from './WeekGrid.tsx';
import { ChipBody, chipShell, type ChipContent } from './WorkoutChip.tsx';

const WEEKS_SHOWN = 6;

interface Props {
  onCreate: (date: ISODate) => void;
  onEdit: (id: WorkoutId) => void;
}

export function CalendarView({ onCreate, onEdit }: Props) {
  const today = useMemo(() => localToday(), []);
  const [level, setLevel] = useState<'micro' | 'macro'>('micro');
  // La semaine en cours est la deuxième ligne : on voit d'où l'on vient et où l'on va.
  const [firstWeek, setFirstWeek] = useState<ISODate>(() => addDays(startOfWeek(today), -7));
  const [dragging, setDragging] = useState<ChipContent | null>(null);
  const [openActivity, setOpenActivity] = useState<ActivityId | null>(null);
  const [planning, setPlanning] = useState<ISODate | null>(null);
  const lastDragEnd = useRef(0);

  const workouts = useApp((s) => s.calendar.workouts);
  const plans = useApp((s) => s.plans);
  const cycles = useApp((s) => s.cycles);
  const templates = useApp((s) => s.templates);
  const athlete = useApp((s) => s.athlete);
  // Les modèles n'ont pas de date : leurs totaux sont calculés avec les seuils du jour.
  const library = useMemo(() => libraryItems(workouts, templates, thresholdsAt(athlete ?? { thresholds: [] }, today)), [workouts, templates, athlete, today]);
  const macros = useMemo(() => macroCycles(cycles), [cycles]);
  const weeks = useMemo(() => weekStartsFrom(firstWeek, WEEKS_SHOWN), [firstWeek]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Au doigt : un appui de 180 ms saisit la séance ; un geste immédiat fait défiler la grille.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const place = (item: LibraryItem, date: ISODate): void => {
    const state = appStore.getState();
    state.actions.saveWorkouts([placeCopy(item.source, date, {
      athlete: state.athlete, athleteId: state.athlete?.id ?? LOCAL_ATHLETE_ID,
      now: new Date().toISOString() as ISODateTime, countOnDate: state.calendar.workoutIdsByDate[date]?.length ?? 0,
    })]);
  };
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragging(null);
    lastDragEnd.current = Date.now();
    const state = appStore.getState();
    const intent = dropIntent(active.id, over?.id, state.calendar);
    if (intent === null) return;
    if (intent.type === 'move') { state.actions.moveWorkout(intent.id, intent.toDate, intent.toIndex); return; }
    const item = library.find((entry) => entry.key === intent.key);
    if (item !== undefined) place(item, intent.toDate);
  };
  // Relâcher une vignette sur elle-même produit aussi un clic : on l'ignore juste après un glissement.
  const edit = (id: WorkoutId): void => { if (Date.now() - lastDragEnd.current > 300) onEdit(id); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-line bg-panel p-1" role="group" aria-label="Niveau de planification">
          <button type="button" className={tab} aria-pressed={level === 'micro'} onClick={() => setLevel('micro')}>Semaines</button>
          <button type="button" className={tab} aria-pressed={level === 'macro'} onClick={() => setLevel('macro')}>Saison</button>
        </div>
        {level === 'micro' ? (
          <>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={iconButton} aria-label="Semaines précédentes" onClick={() => setFirstWeek(addDays(firstWeek, -7 * (WEEKS_SHOWN - 1)))}><ChevronLeftIcon /></button>
              <button type="button" className={ghostButton} onClick={() => setFirstWeek(addDays(startOfWeek(today), -7))}>Aujourd'hui</button>
              <button type="button" className={iconButton} aria-label="Semaines suivantes" onClick={() => setFirstWeek(addDays(firstWeek, 7 * (WEEKS_SHOWN - 1)))}><ChevronRightIcon /></button>
            </div>
            <button type="button" className={primaryButton} onClick={() => onCreate(today)}><PlusIcon /> Nouvelle séance</button>
          </>
        ) : null}
      </div>

      {level === 'micro' ? <ImportPanel /> : null}

      {level === 'macro' ? (
        <SeasonView today={today} onOpenWeek={(date) => { setFirstWeek(startOfWeek(date)); setLevel('micro'); }} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={pointerWithin}
          onDragStart={({ active }) => {
            const source = parseDragSource(active.id);
            setDragging(source === null ? null : source.kind === 'workout' ? (workouts[source.id] ?? null) : (() => { const item = library.find((entry) => entry.key === source.key); return item ? chipOf(item) : null; })());
          }}
          onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
            <Library items={library} onCreate={() => onCreate(today)} />
            <WeekGrid weeks={weeks} today={today} macros={macros} plan={seasonPlan(plans)} onPlan={setPlanning} onEdit={edit} onOpenActivity={setOpenActivity} />
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging !== null ? (
              <div className={`${chipShell} w-44 cursor-grabbing border-racing shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8)]`}><ChipBody workout={dragging} /></div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {openActivity !== null ? <ActivityDialog id={openActivity} onClose={() => setOpenActivity(null)} /> : null}
      {planning !== null ? (
        <QuickPlan date={planning} library={library} onClose={() => setPlanning(null)}
          onCreate={() => { const date = planning; setPlanning(null); onCreate(date); }}
          onPlace={(item) => { place(item, planning); setPlanning(null); }} />
      ) : null}
    </div>
  );
}

interface QuickPlanProps {
  date: ISODate;
  library: readonly LibraryItem[];
  onClose: () => void;
  onCreate: () => void;
  onPlace: (item: LibraryItem) => void;
}
/** Planification rapide d'un jour : une séance neuve, ou une copie d'une séance de la bibliothèque. Sans glisser-déposer. */
function QuickPlan({ date, library, onClose, onCreate, onPlace }: QuickPlanProps) {
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="planifier-titre"
        className="carbon-card max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-line p-4 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center gap-2">
          <h2 id="planifier-titre" className="flex-1 text-base font-semibold text-ink">Planifier le {longDate(date)}</h2>
          <button type="button" className={iconButton} aria-label="Fermer" onClick={onClose}><CloseIcon /></button>
        </div>
        <button type="button" ref={first} className={`${primaryButton} mt-3 w-full`} onClick={onCreate}><PlusIcon /> Construire une nouvelle séance</button>
        {library.length > 0 ? (
          <>
            <p className="mt-4 mb-2 text-xs font-medium text-mute">Ou reprendre une séance de la bibliothèque</p>
            <ul className="space-y-1.5">
              {library.map((item) => (
                <li key={item.key}>
                  <button type="button" className={`${chipShell} cursor-pointer`} onClick={() => onPlace(item)}><ChipBody workout={chipOf(item)} /></button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
