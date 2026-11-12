// app-store.ts — le store global : colle les transitions pures (calendar.ts) à Zustand et à la base.
//
// Trois stores, trois rythmes de changement :
//   appStore   (ce fichier)  données de l'athlète. Change à chaque action validée. Persisté.
//   uiStore    (Sprint 2)    période affichée, sélection, feuille ouverte. Change souvent. Non persisté.
//   glisser-déposer          l'état « en cours de survol » reste dans dnd-kit : il change à chaque
//                            mouvement du doigt et ne doit JAMAIS traverser le store de données.
//                            Seul le lâcher appelle `actions.moveWorkout`.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ActivityId, ActivityStreams, Athlete, CompletedActivity, Cycle, CycleId, ISODate, ISODateTime, PlanId, TemplateId, TrainingPlan, Workout, WorkoutId, WorkoutTemplate } from '../domain/index.ts';
import { buildCalendar, EMPTY_CALENDAR, linkActivity, moveWorkout, putActivities, putWorkouts, removeActivity, removeWorkout, setActivity, type CalendarState, type Mutation } from './calendar.ts';

/** Tout ce que contient la base, relu au démarrage. */
export interface Snapshot {
  athlete: Athlete | null;
  plans: readonly TrainingPlan[];
  cycles: readonly Cycle[];
  templates: readonly WorkoutTemplate[];
  workouts: readonly Workout[];
  activities: readonly CompletedActivity[];
  /** Absent d'une base créée avant le Sprint 3. */
  settings?: AppSettings;
}

/**
 * Réglages de l'appareil, hors du profil sportif. Le token Garmin est un secret : il reste dans la
 * base locale du navigateur et ne doit JAMAIS être inclus dans un export ni dans le code compilé.
 */
export interface AppSettings {
  garminToken?: string;
  /** Adresse du micro-relais Cloudflare (relay/worker.js) qui fait le pont avec l'API Garmin. */
  garminRelayUrl?: string;
  /** true : les séances types de départ ont déjà été proposées. Elles ne reviennent pas si on les supprime. */
  starterSeeded?: boolean;
}

/** Écritures du store : celles du calendrier, plus le profil de l'athlète. */
export type StoreMutation =
  | Mutation
  | { table: 'athlete'; put: Athlete }
  | { table: 'plans'; put: readonly TrainingPlan[]; remove: readonly PlanId[] }
  | { table: 'cycles'; put: readonly Cycle[]; remove: readonly CycleId[] }
  | { table: 'templates'; put: readonly WorkoutTemplate[]; remove: readonly TemplateId[] }
  | { table: 'settings'; put: AppSettings }
  /** Séries temporelles : hors de l'état en mémoire, mais écrites dans la même transaction que leur activité. */
  | { table: 'streams'; put: readonly ActivityStreams[]; remove: readonly ActivityId[] }
  /** Restauration d'une sauvegarde : tout le contenu est remplacé, sauf les réglages de l'appareil. */
  | { table: 'all'; replace: Snapshot; streams: readonly ActivityStreams[] };

/**
 * Port de persistance. L'implémentation IndexedDB (Dexie) arrive au Sprint 2 ; les tests utilisent
 * une implémentation en mémoire. Le store ne sait pas où vont les données.
 */
export interface PersistencePort {
  load(): Promise<Snapshot>;
  /** Applique un lot d'écritures de façon atomique (une transaction). */
  commit(mutations: readonly StoreMutation[]): Promise<void>;
}

/**
 * Lecture des séries temporelles. Elles ne passent pas par le store : seule l'activité ouverte
 * charge les siennes, à la demande.
 */
export interface StreamsReader {
  read(id: ActivityId): Promise<ActivityStreams | null>;
  readAll(): Promise<ActivityStreams[]>;
}

export interface AppState {
  status: 'booting' | 'ready' | 'error';
  /** Dernière erreur de persistance, à afficher à l'utilisateur. */
  lastError: string | null;
  athlete: Athlete | null;
  plans: Readonly<Record<PlanId, TrainingPlan>>;
  cycles: Readonly<Record<CycleId, Cycle>>;
  templates: readonly WorkoutTemplate[];
  settings: AppSettings;
  calendar: CalendarState;
  actions: {
    boot(): Promise<void>;
    /** Crée ou remplace le profil de l'athlète (seuils datés, zones). */
    saveAthlete(athlete: Athlete): void;
    /** Crée ou remplace un plan (ses courses y sont imbriquées). */
    savePlan(plan: TrainingPlan): void;
    /** Crée ou remplace des cycles. La validation (chevauchements) est faite avant, par des fonctions pures. */
    saveCycles(cycles: readonly Cycle[]): void;
    removeCycle(id: CycleId): void;
    /** Fusionne `patch` dans les réglages. Une valeur `undefined` efface le réglage. */
    saveSettings(patch: { [K in keyof AppSettings]?: AppSettings[K] | undefined }): void;
    saveWorkouts(workouts: readonly Workout[]): void;
    moveWorkout(id: WorkoutId, toDate: ISODate, toIndex: number): void;
    removeWorkout(id: WorkoutId): void;
    linkActivity(workoutId: WorkoutId, activityId: ActivityId | null, by?: 'auto' | 'manual'): void;
    removeActivity(id: ActivityId): void;
    /** Crée ou remplace des modèles de séance (bibliothèque). */
    saveTemplates(templates: readonly WorkoutTemplate[]): void;
    /** Remplace toutes les données par celles d'une sauvegarde. Les réglages de l'appareil (clé Garmin) sont conservés. */
    restoreAll(snapshot: Snapshot, streams?: readonly ActivityStreams[]): void;
    /** Enregistre des activités importées et, dans la même transaction, leurs séries temporelles. */
    importActivities(activities: readonly CompletedActivity[], streams?: readonly ActivityStreams[]): void;
    /** Remplace une activité modifiée par l'athlète (ressenti, notes). */
    saveActivity(activity: CompletedActivity): void;
  };
}

const byId = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]));
const fromSnapshot = (snap: Snapshot) => ({
  athlete: snap.athlete,
  plans: byId(snap.plans) as Record<PlanId, TrainingPlan>,
  cycles: byId(snap.cycles) as Record<CycleId, Cycle>,
  templates: snap.templates,
  settings: snap.settings ?? {},
  calendar: buildCalendar(snap.workouts, snap.activities),
});

export function createAppStore(port: PersistencePort, clock: () => ISODateTime = () => new Date().toISOString() as ISODateTime): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => {
    // File d'écriture : les lots partent dans l'ordre des actions, un seul à la fois.
    let writes: Promise<void> = Promise.resolve();
    let booting: Promise<void> | null = null;

    /**
     * Mise à jour optimiste : l'écran change tout de suite, la base suit. Si une écriture échoue,
     * on ne tente pas de défaire action par action : on relit la base, seule source de vérité.
     */
    const enqueue = (mutations: readonly StoreMutation[]): void => {
      if (mutations.length === 0) return;
      writes = writes
        .then(() => port.commit(mutations))
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          try { set({ ...fromSnapshot(await port.load()), lastError: message }); }
          catch { set({ status: 'error', lastError: message }); }
        });
    };
    const apply = (transition: (calendar: CalendarState) => readonly [CalendarState, readonly StoreMutation[]]): void => {
      const before = get().calendar;
      const [calendar, mutations] = transition(before);
      if (calendar === before) return;
      set({ calendar });
      enqueue(mutations);
    };

    return {
      status: 'booting',
      lastError: null,
      athlete: null,
      plans: {},
      cycles: {},
      templates: [],
      settings: {},
      calendar: EMPTY_CALENDAR,
      actions: {
        // Un seul chargement, même si boot() est appelé deux fois (React le fait en mode strict) : un
        // second chargement lancé avant les premières écritures écraserait l'état avec une base périmée.
        boot() {
          booting ??= (async () => {
            try { set({ ...fromSnapshot(await port.load()), status: 'ready', lastError: null }); }
            catch (error) {
              booting = null;                                   // un échec n'interdit pas de réessayer
              set({ status: 'error', lastError: error instanceof Error ? error.message : String(error) });
            }
          })();
          return booting;
        },
        saveAthlete: (athlete) => {
          if (athlete === get().athlete) return;
          set({ athlete });
          enqueue([{ table: 'athlete', put: athlete }]);
        },
        savePlan: (plan) => {
          if (get().plans[plan.id] === plan) return;
          set({ plans: { ...get().plans, [plan.id]: plan } });
          enqueue([{ table: 'plans', put: [plan], remove: [] }]);
        },
        saveCycles: (cycles) => {
          if (cycles.length === 0) return;
          set({ cycles: { ...get().cycles, ...byId(cycles) } });
          enqueue([{ table: 'cycles', put: cycles, remove: [] }]);
        },
        removeCycle: (id) => {
          const { [id]: removed, ...rest } = get().cycles;
          if (removed === undefined) return;
          set({ cycles: rest as Record<CycleId, Cycle> });
          enqueue([{ table: 'cycles', put: [], remove: [id] }]);
        },
        saveSettings: (patch) => {
          const settings: AppSettings = { ...get().settings, ...patch };
          for (const key of Object.keys(settings) as (keyof AppSettings)[]) if (settings[key] === undefined) delete settings[key];
          set({ settings });
          enqueue([{ table: 'settings', put: settings }]);
        },
        saveWorkouts: (workouts) => apply((c) => putWorkouts(c, workouts, clock())),
        moveWorkout: (id, toDate, toIndex) => apply((c) => moveWorkout(c, id, toDate, toIndex, clock())),
        removeWorkout: (id) => apply((c) => removeWorkout(c, id, clock())),
        linkActivity: (workoutId, activityId, by = 'manual') => apply((c) => linkActivity(c, workoutId, activityId, by, clock())),
        removeActivity: (id) => apply((c) => {
          const [next, mutations] = removeActivity(c, id, clock());
          return [next, next === c ? mutations : [...mutations, { table: 'streams', put: [], remove: [id] }]];
        }),
        saveActivity: (activity) => apply((c) => setActivity(c, activity)),
        saveTemplates: (templates) => {
          if (templates.length === 0) return;
          const ids = new Set(templates.map((t) => t.id));
          set({ templates: [...get().templates.filter((t) => !ids.has(t.id)), ...templates] });
          enqueue([{ table: 'templates', put: templates, remove: [] }]);
        },
        restoreAll: (snapshot, streams = []) => {
          const { settings: _ignored, ...content } = snapshot;
          set({ ...fromSnapshot({ ...content, settings: get().settings }), lastError: null });
          enqueue([{ table: 'all', replace: content, streams }]);
        },
        importActivities: (activities, streams = []) => apply((c) => {
          const [next, mutations] = putActivities(c, activities);
          return [next, streams.length === 0 ? mutations : [...mutations, { table: 'streams', put: streams, remove: [] }]];
        }),
      },
    };
  });
}
// Côté React (Sprint 2) : const ids = useStore(appStore, (s) => workoutIdsOn(date)(s.calendar));
