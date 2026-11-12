// dexie-port.ts — persistance locale (IndexedDB via Dexie). Seul fichier qui connaît Dexie :
// le store ne voit que l'interface PersistencePort.
import Dexie, { type Table } from 'dexie';
import type { ActivityStreams, Athlete, CompletedActivity, Cycle, TrainingPlan, Workout, WorkoutTemplate } from '../domain/index.ts';
import type { AppSettings, PersistencePort, StreamsReader } from '../store/app-store.ts';

/** Les réglages tiennent dans une seule ligne, de clé fixe. */
const SETTINGS_KEY = 'app';
type SettingsRow = AppSettings & { key: string };

type Database = Dexie & {
  athlete: Table<Athlete, string>;
  plans: Table<TrainingPlan, string>;
  cycles: Table<Cycle, string>;
  templates: Table<WorkoutTemplate, string>;
  workouts: Table<Workout, string>;
  activities: Table<CompletedActivity, string>;
  settings: Table<SettingsRow, string>;
  streams: Table<ActivityStreams, string>;
};

const db = new Dexie('dossard-v2') as Database;
// Seuls les champs indexés sont listés. Changer le schéma = ajouter une version, jamais modifier une ancienne.
db.version(1).stores({
  athlete: 'id',
  plans: 'id',
  cycles: 'id, planId',
  templates: 'id',
  workouts: 'id, date',
  activities: 'id, localDate',
});
// Sprint 3 : réglages de l'appareil (token Garmin). Les tables existantes sont conservées telles quelles.
db.version(2).stores({ settings: 'key' });
// Sprint 5 : séries temporelles (un enregistrement par activité, hors de la table des activités pour
// que le démarrage ne les charge pas). Migration purement additive : Dexie conserve les tables
// existantes et leur contenu, donc aucune fonction de conversion n'est nécessaire. Les activités
// déjà en base gardent `hasStreams: false` jusqu'à leur réimport, et leur ressenti (`subjective`)
// accepte le nouveau champ `feeling` sans transformation, puisqu'il est facultatif.
db.version(3).stores({ streams: 'activityId' });

export const dexiePort: PersistencePort = {
  async load() {
    const [athletes, plans, cycles, templates, workouts, activities, settingsRow] = await Promise.all([
      db.athlete.toArray(), db.plans.toArray(), db.cycles.toArray(), db.templates.toArray(), db.workouts.toArray(), db.activities.toArray(),
      db.settings.get(SETTINGS_KEY),
    ]);
    const { key: _key, ...settings } = settingsRow ?? { key: SETTINGS_KEY };
    return { athlete: athletes[0] ?? null, plans, cycles, templates, workouts, activities, settings };
  },
  /** Un lot = une transaction : tout est écrit, ou rien. */
  async commit(mutations) {
    await db.transaction('rw', [db.athlete, db.plans, db.cycles, db.templates, db.workouts, db.activities, db.settings, db.streams], async () => {
      for (const mutation of mutations) {
        switch (mutation.table) {
          case 'athlete': await db.athlete.put(mutation.put); break;
          case 'settings': await db.settings.put({ ...mutation.put, key: SETTINGS_KEY }); break;
          case 'all': {
            // Restauration : on vide tout sauf les réglages de l'appareil, puis on réécrit la sauvegarde.
            const { athlete, plans, cycles, templates, workouts, activities } = mutation.replace;
            await Promise.all([db.athlete.clear(), db.plans.clear(), db.cycles.clear(), db.templates.clear(), db.workouts.clear(), db.activities.clear(), db.streams.clear()]);
            if (athlete !== null) await db.athlete.put(athlete);
            await db.plans.bulkPut([...plans]);
            await db.cycles.bulkPut([...cycles]);
            await db.templates.bulkPut([...templates]);
            await db.workouts.bulkPut([...workouts]);
            await db.activities.bulkPut([...activities]);
            await db.streams.bulkPut([...mutation.streams]);
            break;
          }
          case 'streams':
            if (mutation.remove.length > 0) await db.streams.bulkDelete([...mutation.remove]);
            if (mutation.put.length > 0) await db.streams.bulkPut([...mutation.put]);
            break;
          case 'plans':
          case 'cycles':
          case 'templates':
          case 'workouts':
          case 'activities': {
            const table = db[mutation.table] as unknown as Table<{ id: string }, string>;
            if (mutation.remove.length > 0) await table.bulkDelete([...mutation.remove]);
            if (mutation.put.length > 0) await table.bulkPut([...mutation.put]);
          }
        }
      }
    });
  },
};

export const dexieStreams: StreamsReader = {
  read: async (id) => (await db.streams.get(id)) ?? null,
  readAll: () => db.streams.toArray(),
};
