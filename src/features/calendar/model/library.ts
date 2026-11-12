// library.ts — la bibliothèque de séances : les séances déjà construites, sans leurs doublons,
// prêtes à être reposées sur un autre jour. Fonctions pures.
import {
  newId, thresholdsAt,
  type Athlete, type AthleteId, type BlockId, type ISODate, type ISODateTime, type PlannedMetrics, type ResolvedThresholds, type StepBlock,
  type TemplateId, type Workout, type WorkoutDefinition, type WorkoutId, type WorkoutTemplate,
} from '../../../domain/index.ts';
import { plannedMetrics } from '../../../engine/index.ts';

export interface LibraryItem {
  /** Signature du contenu : deux séances identiques posées à deux dates ne font qu'une entrée. */
  key: string;
  /** Le modèle, ou l'exemplaire le plus récemment modifié de la séance. */
  source: Workout | WorkoutTemplate;
  /** Totaux à afficher : ceux de la séance, ou ceux du modèle calculés avec les seuils du jour. */
  planned: PlannedMetrics;
  /** Nombre de fois où cette séance figure au calendrier. */
  uses: number;
}

/** Contenu d'une séance, sans date ni identifiants : ce qui fait que deux séances sont « la même ». */
export function workoutSignature(w: Pick<WorkoutDefinition, 'sport' | 'title' | 'blocks'>): string {
  const structure = JSON.stringify(w.blocks, (key, value: unknown) => (key === 'id' ? undefined : value));
  return `${w.sport}|${w.title.trim().toLowerCase()}|${structure}`;
}

/**
 * La bibliothèque : les séances du calendrier (sans doublon), puis les modèles qui n'ont pas encore
 * été utilisés. Un modèle déjà posé apparaît une seule fois, sous la forme de sa séance.
 */
export function libraryItems(
  workouts: Readonly<Record<string, Workout>>,
  templates: readonly WorkoutTemplate[] = [],
  thresholds: ResolvedThresholds = { asOf: null, backfilled: false, bySport: {} },
): LibraryItem[] {
  const items = new Map<string, LibraryItem>();
  for (const w of Object.values(workouts)) {
    if (w.sport === 'rest' || w.blocks.length === 0) continue;
    const key = workoutSignature(w);
    const known = items.get(key);
    if (known === undefined) items.set(key, { key, source: w, planned: w.planned, uses: 1 });
    else {
      const newer = w.updatedAt > (known.source as Workout).updatedAt;
      items.set(key, { key, uses: known.uses + 1, source: newer ? w : known.source, planned: newer ? w.planned : known.planned });
    }
  }
  const used = [...items.values()].sort((a, b) => (b.source as Workout).updatedAt.localeCompare((a.source as Workout).updatedAt) || a.key.localeCompare(b.key));
  const unused: LibraryItem[] = [];
  for (const t of templates) {
    const key = workoutSignature(t);
    if (t.sport === 'rest' || t.blocks.length === 0 || items.has(key) || unused.some((item) => item.key === key)) continue;
    unused.push({ key, source: t, planned: plannedMetrics({ sport: t.sport, blocks: t.blocks }, thresholds).metrics, uses: 0 });
  }
  return [...used, ...unused];
}

export interface PlaceContext {
  athlete: Pick<Athlete, 'thresholds'> | null;
  athleteId: AthleteId;
  now: ISODateTime;
  /** Nombre de séances déjà prévues ce jour-là : la copie se place à la suite. */
  countOnDate: number;
}

/**
 * Pose une copie de `source` à `date`. C'est une nouvelle séance, indépendante de l'originale :
 * sans activité rapprochée, et avec une charge recalculée selon les seuils en vigueur à SA date.
 */
export function placeCopy(source: WorkoutDefinition, date: ISODate, ctx: PlaceContext): Workout {
  const { metrics } = plannedMetrics({ sport: source.sport, blocks: source.blocks }, thresholdsAt(ctx.athlete ?? { thresholds: [] }, date));
  return {
    sport: source.sport, title: source.title, blocks: source.blocks,
    id: newId<WorkoutId>(), athleteId: ctx.athleteId, planId: null, date, order: ctx.countOnDate,
    planned: metrics, activityId: null, matchedBy: null, createdAt: ctx.now, updatedAt: ctx.now,
    ...(source.description !== undefined ? { description: source.description } : {}),
  };
}

// --- Séances types proposées au premier démarrage ---
const step = (id: string, role: StepBlock['role'], seconds: number, target: StepBlock['target'], profile: StepBlock['profile'] = 'steady'): StepBlock =>
  ({ kind: 'step', id: id as BlockId, role, profile, duration: { kind: 'time', seconds }, target });
const pct = (basis: 'hr_max' | 'ftp', low: number, high: number): StepBlock['target'] => ({ kind: 'relative', basis, low, high });

/**
 * Trois modèles, un par sport, pour essayer le glisser-déposer dès l'ouverture. Leurs cibles sont
 * relatives (% FC max, % FTP) ou libres : ils sont utilisables avant même de saisir ses seuils.
 */
export function starterTemplates(athleteId: AthleteId): WorkoutTemplate[] {
  return [
    {
      id: 'modele-course' as TemplateId, athleteId, tags: ['modèle'], sport: 'run', title: 'Fractionné 6 × 3 min',
      description: 'Séance type. Les intervalles se courent vite mais réguliers ; la récupération en trottinant.',
      blocks: [
        step('mc-1', 'warmup', 900, pct('hr_max', 0.65, 0.75)),
        { kind: 'repeat', id: 'mc-2' as BlockId, count: 6, steps: [step('mc-3', 'active', 180, pct('hr_max', 0.88, 0.92)), step('mc-4', 'recovery', 120, pct('hr_max', 0.6, 0.7))] },
        step('mc-5', 'cooldown', 600, pct('hr_max', 0.6, 0.7)),
      ],
    },
    {
      id: 'modele-velo' as TemplateId, athleteId, tags: ['modèle'], sport: 'bike', title: 'Sweet spot 2 × 20 min',
      description: 'Séance type. Deux blocs soutenus juste sous le seuil.',
      blocks: [
        step('mv-1', 'warmup', 900, pct('ftp', 0.5, 0.7), 'ramp'),
        { kind: 'repeat', id: 'mv-2' as BlockId, count: 2, steps: [step('mv-3', 'active', 1200, pct('ftp', 0.88, 0.93)), step('mv-4', 'recovery', 300, pct('ftp', 0.5, 0.55))] },
        step('mv-5', 'cooldown', 600, pct('ftp', 0.45, 0.55)),
      ],
    },
    {
      id: 'modele-natation' as TemplateId, athleteId, tags: ['modèle'], sport: 'swim', title: 'Endurance 6 × 3 min',
      description: 'Séance type, aux sensations. Remplace les cibles par des allures une fois ton allure seuil saisie dans le Profil.',
      blocks: [
        step('mn-1', 'warmup', 600, { kind: 'open' }),
        { kind: 'repeat', id: 'mn-2' as BlockId, count: 6, steps: [step('mn-3', 'active', 180, { kind: 'open' }), step('mn-4', 'recovery', 30, { kind: 'open' })] },
        step('mn-5', 'cooldown', 300, { kind: 'open' }),
      ],
    },
  ];
}
