// app-store.ts — le store global : colle les transitions pures (calendar.ts) à Zustand et à la base.
//
// Trois stores, trois rythmes de changement :
//   appStore   (ce fichier)  données de l'athlète. Change à chaque action validée. Persisté.
//   uiStore    (Sprint 2)    période affichée, sélection, feuille ouverte. Change souvent. Non persisté.
//   glisser-déposer          l'état « en cours de survol » reste dans dnd-kit : il change à chaque
//                            mouvement du doigt et ne doit JAMAIS traverser le store de données.
//                            Seul le lâcher appelle `actions.moveWorkout`.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ActivityId, Athlete, CompletedActivity, Cycle, CycleId, ISODate, ISODateTime, PlanId, TrainingPlan, Workout, WorkoutId, WorkoutTemplate } from '../domain/index.ts';
import { buildCalendar, EMPTY_CALENDAR, linkActivity, moveWorkout, putActivities, putWorkouts, removeWorkout, type CalendarState, type Mutation, type Transition } from './calendar.ts';

/** Tout ce que contient la base, relu au démarrage. */
export interface Snapshot {
  athlete: Athlete | null;
  plans: readonly TrainingPlan[];
  cycles: readonly Cycle[];
  templates: readonly WorkoutTemplate[];
  workouts: readonly Workout[];
  activities: readonly CompletedActivity[];
}

/**
 * Port de persistance. L'implémentation IndexedDB (Dexie) arrive au Sprint 2 ; les tests utilisent
 * une implémentation en mémoire. Le store ne sait pas où vont les données.
 */
export interface PersistencePort {
  load(): Promise<Snapshot>;
  /** Applique un lot d'écritures de façon atomique (une transaction). */
  commit(mutations: readonly Mutation[]): Promise<void>;
}

export interface AppState {
  status: 'booting' | 'ready' | 'error';
  /** Dernière erreur de persistance, à afficher à l'utilisateur. */
  lastError: string | null;
  athlete: Athlete | null;
  plans: Readonly<Record<PlanId, TrainingPlan>>;
  cycles: Readonly<Record<CycleId, Cycle>>;
  templates: readonly WorkoutTemplate[];
  calendar: CalendarState;
  actions: {
    boot(): Promise<void>;
    saveWorkouts(workouts: readonly Workout[]): void;
    moveWorkout(id: WorkoutId, toDate: ISODate, toIndex: number): void;
    removeWorkout(id: WorkoutId): void;
    linkActivity(workoutId: WorkoutId, activityId: ActivityId | null): void;
    importActivities(activities: readonly CompletedActivity[]): void;
  };
}

const byId = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]));
const fromSnapshot = (snap: Snapshot) => ({
  athlete: snap.athlete,
  plans: byId(snap.plans) as Record<PlanId, TrainingPlan>,
  cycles: byId(snap.cycles) as Record<CycleId, Cycle>,
  templates: snap.templates,
  calendar: buildCalendar(snap.workouts, snap.activities),
});

export function createAppStore(port: PersistencePort, clock: () => ISODateTime = () => new Date().toISOString() as ISODateTime): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => {
    // File d'écriture : les lots partent dans l'ordre des actions, un seul à la fois.
    let writes: Promise<void> = Promise.resolve();

    /**
     * Mise à jour optimiste : l'écran change tout de suite, la base suit. Si une écriture échoue,
     * on ne tente pas de défaire action par action : on relit la base, seule source de vérité.
     */
    const apply = (transition: (calendar: CalendarState) => Transition): void => {
      const before = get().calendar;
      const [calendar, mutations] = transition(before);
      if (calendar === before) return;
      set({ calendar });
      if (mutations.length === 0) return;
      writes = writes
        .then(() => port.commit(mutations))
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          try { set({ ...fromSnapshot(await port.load()), lastError: message }); }
          catch { set({ status: 'error', lastError: message }); }
        });
    };

    return {
      status: 'booting',
      lastError: null,
      athlete: null,
      plans: {},
      cycles: {},
      templates: [],
      calendar: EMPTY_CALENDAR,
      actions: {
        async boot() {
          try { set({ ...fromSnapshot(await port.load()), status: 'ready', lastError: null }); }
          catch (error) { set({ status: 'error', lastError: error instanceof Error ? error.message : String(error) }); }
        },
        saveWorkouts: (workouts) => apply((c) => putWorkouts(c, workouts, clock())),
        moveWorkout: (id, toDate, toIndex) => apply((c) => moveWorkout(c, id, toDate, toIndex, clock())),
        removeWorkout: (id) => apply((c) => removeWorkout(c, id, clock())),
        linkActivity: (workoutId, activityId) => apply((c) => linkActivity(c, workoutId, activityId, 'manual', clock())),
        importActivities: (activities) => apply((c) => putActivities(c, activities)),
      },
    };
  });
}
// Côté React (Sprint 2) : const ids = useStore(appStore, (s) => workoutIdsOn(date)(s.calendar));
