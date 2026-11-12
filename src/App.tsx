// App.tsx — la coquille de l'application : en-tête, trois onglets, et l'ouverture du constructeur
// de séance depuis le calendrier (jour vide ou séance posée).
import { useEffect, useMemo, useState } from 'react';
import type { ISODate, WorkoutId } from './domain/index.ts';
import { appStore, useApp } from './app/store.ts';
import { GarminTokenCard } from './features/athlete/GarminTokenCard.tsx';
import { ThresholdsForm } from './features/athlete/ThresholdsForm.tsx';
import { StatsView } from './features/stats/StatsView.tsx';
import { LOCAL_ATHLETE_ID } from './features/athlete/thresholds.ts';
import { BackupCard } from './features/backup/BackupCard.tsx';
import { CalendarView } from './features/calendar/CalendarView.tsx';
import { starterTemplates } from './features/calendar/model/library.ts';
import { longDate } from './features/calendar/model/weeks.ts';
import { formatDistance, formatDuration } from './features/workout-builder/model/format.ts';
import { card, iconButton, SportBadge, tab, TrashIcon } from './features/workout-builder/ui.tsx';
import { WorkoutBuilder } from './features/workout-builder/WorkoutBuilder.tsx';

type View = 'calendar' | 'sessions' | 'stats' | 'profile';
const VIEWS: readonly (readonly [View, string])[] = [['calendar', 'Calendrier'], ['sessions', 'Séances'], ['stats', 'Statistiques'], ['profile', 'Profil']];

interface Editing {
  id: WorkoutId | null;
  date?: ISODate;
  /** Change à chaque ouverture du constructeur : il repart d'un brouillon neuf. */
  session: number;
  /** Où revenir après « Enregistrer » ou « Annuler ». */
  from: View;
}

export default function App() {
  const status = useApp((s) => s.status);
  const lastError = useApp((s) => s.lastError);
  const workouts = useApp((s) => s.calendar.workouts);
  const removeWorkout = useApp((s) => s.actions.removeWorkout);
  const [view, setView] = useState<View>('calendar');
  const [editing, setEditing] = useState<Editing>({ id: null, session: 0, from: 'sessions' });

  useEffect(() => { void appStore.getState().actions.boot(); }, []);
  // Premier démarrage : si la bibliothèque est vide, trois séances types y sont déposées. Une seule
  // fois : le réglage `starterSeeded` empêche qu'elles reviennent après avoir été écartées.
  useEffect(() => {
    if (status !== 'ready') return;
    const state = appStore.getState();
    if (state.settings.starterSeeded === true) return;
    if (state.templates.length === 0 && Object.keys(state.calendar.workouts).length === 0) {
      state.actions.saveTemplates(starterTemplates(state.athlete?.id ?? LOCAL_ATHLETE_ID));
    }
    state.actions.saveSettings({ starterSeeded: true });
  }, [status]);

  const list = useMemo(
    () => Object.values(workouts).sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order),
    [workouts],
  );
  const open = (id: WorkoutId | null, from: View, date?: ISODate): void => {
    setEditing((e) => ({ id, from, session: e.session + 1, ...(date !== undefined ? { date } : {}) }));
    setView('sessions');
  };
  const close = (): void => {
    const back = editing.from;
    setEditing((e) => ({ id: null, from: 'sessions', session: e.session + 1 }));
    setView(back);
  };
  /** Changer d'onglet à la main abandonne une édition ouverte depuis le calendrier. */
  const go = (name: View): void => {
    if (editing.from === 'calendar' && name !== 'profile') setEditing((e) => ({ id: null, from: 'sessions', session: e.session + 1 }));
    setView(name);
  };
  const fromCalendar = editing.from === 'calendar';

  return (
    <div className="min-h-dvh bg-carbon text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-carbon/90 backdrop-blur">
        <div className="racing-stripe h-1" aria-hidden="true" />
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-ink italic">
            <span className="racing-stripe inline-block h-5 w-7 -skew-x-12" aria-hidden="true" />
            Dossard
          </h1>
          <nav className="ml-auto flex gap-1" aria-label="Sections">
            {VIEWS.map(([name, label]) => (
              <button key={name} type="button" className={tab} aria-current={view === name ? 'page' : undefined} onClick={() => go(name)}>{label}</button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[96rem] space-y-6 px-4 py-4">
        {lastError !== null ? (
          <p role="alert" className="rounded-lg border border-racing bg-racing/15 px-3 py-2 text-sm text-ink">
            L'enregistrement a échoué ({lastError}). L'écran affiche de nouveau ce qui est réellement stocké sur cet appareil.
          </p>
        ) : null}

        {status === 'booting' ? <p className="text-sm text-mute">Chargement de tes données…</p>
          : status === 'error' ? <p className="text-sm">Impossible de lire les données stockées sur cet appareil. Recharge la page.</p>
          : view === 'calendar' ? <CalendarView onCreate={(date) => open(null, 'calendar', date)} onEdit={(id) => open(id, 'calendar')} />
          : view === 'stats' ? <StatsView />
          : view === 'profile' ? <div className="space-y-4"><ThresholdsForm /><GarminTokenCard /><BackupCard /></div>
          : (
            <div className="mx-auto max-w-6xl space-y-6">
              {fromCalendar ? (
                <p className="text-sm text-mute">
                  {editing.id !== null ? 'Modification d’une séance du calendrier.' : `Nouvelle séance${editing.date !== undefined ? ` pour le ${longDate(editing.date)}` : ''}.`}
                  {' '}Enregistre ou annule pour revenir au calendrier.
                </p>
              ) : null}
              <WorkoutBuilder
                key={editing.session}
                {...(editing.id !== null ? { workoutId: editing.id } : {})}
                {...(editing.date !== undefined ? { initialDate: editing.date } : {})}
                onSaved={close}
                {...(editing.id !== null || fromCalendar ? { onCancel: close } : {})}
                onOpenProfile={() => setView('profile')}
              />
              {fromCalendar ? null : (
                <section>
                  <h2 className="mb-2 text-base font-semibold">Séances enregistrées</h2>
                  {list.length === 0 ? (
                    <p className="text-sm text-mute">Aucune séance pour l'instant. Construis-en une ci-dessus, puis enregistre-la.</p>
                  ) : (
                    <ul className={`${card} divide-y divide-line`}>
                      {list.map((workout) => (
                        <li key={workout.id} className="flex items-center gap-2 py-1 pr-1 pl-3 transition-colors hover:bg-white/[0.03]">
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left focus-visible:outline-2 focus-visible:outline-racing" onClick={() => open(workout.id, 'sessions')}>
                            <span className="w-24 shrink-0 text-xs text-mute tabular-nums">{longDate(workout.date)}</span>
                            <SportBadge sport={workout.sport} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{workout.title}</span>
                            <span className="hidden shrink-0 text-xs text-mute tabular-nums sm:inline">
                              {[workout.planned.durationS !== null ? formatDuration(workout.planned.durationS) : null,
                                workout.planned.distanceM !== null && workout.planned.distanceM > 0 ? formatDistance(workout.planned.distanceM) : null]
                                .filter((part) => part !== null).join(', ')}
                            </span>
                            <span className="w-12 shrink-0 text-right text-base font-semibold tabular-nums" title="Charge prévue">
                              {workout.planned.load !== null ? Math.round(workout.planned.load) : '—'}
                            </span>
                          </button>
                          <button type="button" className={iconButton} aria-label={`Supprimer : ${workout.title}`} onClick={() => removeWorkout(workout.id)}>
                            <TrashIcon />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}
      </main>
    </div>
  );
}
