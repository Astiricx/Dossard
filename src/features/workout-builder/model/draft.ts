// draft.ts — le brouillon du constructeur et ses transitions. Aucune dépendance à React.
//
// Le brouillon vit dans le composant (useReducer), pas dans le store global : il change à chaque
// frappe, alors que le store ne doit recevoir que des séances validées. `toWorkout` fait le pont.
import { newId, type AthleteId, type BlockId, type ISODate, type ISODateTime, type PlannedMetrics, type ResolvedThresholds, type Sport, type StepBlock, type StepRole, type Workout, type WorkoutBlock, type WorkoutId } from '../../../domain/index.ts';
import { adaptTarget, createRepeat, createStep } from './presets.ts';

export interface Draft {
  sport: Sport;
  title: string;
  description: string;
  date: ISODate;
  blocks: readonly WorkoutBlock[];
}

export type StepPatch = Partial<Pick<StepBlock, 'role' | 'duration' | 'target' | 'profile' | 'label'>>;

export type DraftAction =
  | { type: 'meta'; patch: Partial<Pick<Draft, 'title' | 'description' | 'date'>> }
  | { type: 'sport'; sport: Sport; thresholds: ResolvedThresholds }
  | { type: 'addStep'; role: StepRole; thresholds: ResolvedThresholds; intoRepeat?: BlockId }
  | { type: 'addRepeat'; thresholds: ResolvedThresholds }
  | { type: 'updateStep'; id: BlockId; patch: StepPatch }
  | { type: 'repeatCount'; id: BlockId; count: number }
  | { type: 'duplicate'; id: BlockId }
  | { type: 'remove'; id: BlockId }
  | { type: 'move'; activeId: BlockId; overId: BlockId }
  | { type: 'replace'; draft: Draft };

export const emptyDraft = (date: ISODate, sport: Sport = 'run'): Draft => ({ sport, title: '', description: '', date, blocks: [] });

export function draftFromWorkout(workout: Workout): Draft {
  return {
    sport: workout.sport === 'rest' ? 'run' : workout.sport,
    title: workout.title, description: workout.description ?? '', date: workout.date, blocks: workout.blocks,
  };
}

/** Applique `fn` à l'étape `id`, où qu'elle soit. Ne recrée que les objets sur le chemin modifié. */
function mapStep(blocks: readonly WorkoutBlock[], id: BlockId, fn: (step: StepBlock) => StepBlock): readonly WorkoutBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === 'step') {
      if (block.id !== id) return block;
      changed = true;
      return fn(block);
    }
    const index = block.steps.findIndex((s) => s.id === id);
    if (index === -1) return block;
    changed = true;
    return { ...block, steps: block.steps.map((s, i) => (i === index ? fn(s) : s)) };
  });
  return changed ? next : blocks;
}

const cloneStep = (step: StepBlock): StepBlock => ({ ...step, id: newId<BlockId>() });
const cloneBlock = (block: WorkoutBlock): WorkoutBlock =>
  block.kind === 'step' ? cloneStep(block) : { ...block, id: newId<BlockId>(), steps: block.steps.map(cloneStep) };

/** Insère une copie juste après l'original. */
function duplicateIn<T extends WorkoutBlock>(list: readonly T[], id: BlockId, clone: (item: T) => T): readonly T[] | null {
  const index = list.findIndex((b) => b.id === id);
  if (index === -1) return null;
  return [...list.slice(0, index + 1), clone(list[index]!), ...list.slice(index + 1)];
}

function moveIn<T extends { id: BlockId }>(list: readonly T[], activeId: BlockId, overId: BlockId): readonly T[] | null {
  const from = list.findIndex((b) => b.id === activeId);
  const to = list.findIndex((b) => b.id === overId);
  if (from === -1 || to === -1) return null;
  if (from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Réordonne après un glisser-déposer. Un bloc ne change jamais de conteneur : un bloc de premier
 * niveau reste au premier niveau (s'il est lâché sur une étape d'une répétition, c'est la
 * répétition qui sert de cible), et une étape de répétition reste dans sa répétition.
 */
export function moveBlock(blocks: readonly WorkoutBlock[], activeId: BlockId, overId: BlockId): readonly WorkoutBlock[] {
  if (activeId === overId) return blocks;
  if (blocks.some((b) => b.id === activeId)) {
    const overTop = blocks.find((b) => b.id === overId || (b.kind === 'repeat' && b.steps.some((s) => s.id === overId)));
    return overTop === undefined ? blocks : (moveIn(blocks, activeId, overTop.id) ?? blocks);
  }
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind !== 'repeat') return block;
    const steps = moveIn(block.steps, activeId, overId);
    if (steps === null || steps === block.steps) return block;
    changed = true;
    return { ...block, steps };
  });
  return changed ? next : blocks;
}

function removeBlock(blocks: readonly WorkoutBlock[], id: BlockId): readonly WorkoutBlock[] {
  const next: WorkoutBlock[] = [];
  for (const block of blocks) {
    if (block.id === id) continue;
    if (block.kind === 'repeat' && block.steps.some((s) => s.id === id)) {
      const steps = block.steps.filter((s) => s.id !== id);
      if (steps.length > 0) next.push({ ...block, steps });    // une répétition vidée disparaît
      continue;
    }
    next.push(block);
  }
  return next.length === blocks.length && next.every((b, i) => b === blocks[i]) ? blocks : next;
}

const withBlocks = (draft: Draft, blocks: readonly WorkoutBlock[]): Draft => (blocks === draft.blocks ? draft : { ...draft, blocks });

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'replace': return action.draft;
    case 'meta': return { ...draft, ...action.patch };
    case 'sport': {
      if (action.sport === draft.sport) return draft;
      const adapt = (s: StepBlock) => adaptTarget(s, action.sport, action.thresholds);
      const blocks = draft.blocks.map((b): WorkoutBlock => (b.kind === 'step' ? adapt(b) : { ...b, steps: b.steps.map(adapt) }));
      return { ...draft, sport: action.sport, blocks };
    }
    case 'addStep': {
      const step = createStep(action.role, draft.sport, action.thresholds);
      if (action.intoRepeat === undefined) return withBlocks(draft, [...draft.blocks, step]);
      return withBlocks(draft, draft.blocks.map((b) => (b.kind === 'repeat' && b.id === action.intoRepeat ? { ...b, steps: [...b.steps, step] } : b)));
    }
    case 'addRepeat': return withBlocks(draft, [...draft.blocks, createRepeat(draft.sport, action.thresholds)]);
    case 'updateStep': return withBlocks(draft, mapStep(draft.blocks, action.id, (s) => ({ ...s, ...action.patch })));
    case 'repeatCount': {
      const count = Math.min(99, Math.max(1, Math.round(action.count)));
      if (!Number.isFinite(count)) return draft;
      return withBlocks(draft, draft.blocks.map((b) => (b.kind === 'repeat' && b.id === action.id && b.count !== count ? { ...b, count } : b)));
    }
    case 'duplicate': {
      const top = duplicateIn(draft.blocks, action.id, cloneBlock);
      if (top !== null) return withBlocks(draft, top);
      return withBlocks(draft, draft.blocks.map((b): WorkoutBlock => {
        if (b.kind !== 'repeat') return b;
        const steps = duplicateIn(b.steps, action.id, cloneStep);
        return steps === null ? b : { ...b, steps };
      }));
    }
    case 'remove': return withBlocks(draft, removeBlock(draft.blocks, action.id));
    case 'move': return withBlocks(draft, moveBlock(draft.blocks, action.activeId, action.overId));
  }
}

export interface SaveContext {
  /** La séance d'origine en cas de modification ; absente pour une création. */
  existing?: Workout;
  athleteId: AthleteId;
  planned: PlannedMetrics;
  now: ISODateTime;
  /** Nombre de séances déjà prévues ce jour-là : une nouvelle séance se place à la suite. */
  countOnDate: number;
}

/** Raison pour laquelle le brouillon ne peut pas être enregistré, ou null s'il est valide. */
export function draftProblem(draft: Draft): 'no_blocks' | null {
  return draft.blocks.length === 0 ? 'no_blocks' : null;
}

export function toWorkout(draft: Draft, ctx: SaveContext): Workout {
  const title = draft.title.trim() || 'Séance';
  const description = draft.description.trim();
  const base = ctx.existing;
  const { description: _previous, ...kept } = base ?? ({} as Partial<Workout>);
  return {
    planId: null, activityId: null, matchedBy: null, createdAt: ctx.now,
    ...kept,
    id: base?.id ?? newId<WorkoutId>(),
    athleteId: base?.athleteId ?? ctx.athleteId,
    order: base !== undefined && base.date === draft.date ? base.order : ctx.countOnDate,
    sport: draft.sport, title, date: draft.date, blocks: draft.blocks, planned: ctx.planned, updatedAt: ctx.now,
    ...(description !== '' ? { description } : {}),
  };
}
