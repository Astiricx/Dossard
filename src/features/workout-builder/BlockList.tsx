import type { Dispatch } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Athlete, BlockId, ResolvedThresholds, Sport, WorkoutBlock } from '../../domain/index.ts';
import type { DraftAction } from './model/draft.ts';
import { RepeatCard } from './RepeatCard.tsx';
import { StepCard } from './StepCard.tsx';

interface Props {
  blocks: readonly WorkoutBlock[];
  sport: Sport;
  thresholds: ResolvedThresholds;
  zones: Athlete['zones'] | undefined;
  dispatch: Dispatch<DraftAction>;
}

/**
 * La liste ordonnée des blocs. Un seul DndContext pour toute la séance ; chaque répétition a son
 * propre SortableContext. L'état « en cours de glissement » reste dans dnd-kit : seul le lâcher
 * produit une action, et c'est `moveBlock` (pur, testé) qui décide si le déplacement est permis.
 */
export function BlockList({ blocks, sport, thresholds, zones, dispatch }: Props) {
  const sensors = useSensors(
    // 6 px avant de démarrer : un simple toucher sur la poignée ne déclenche pas de glissement.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over === null || active.id === over.id) return;
    dispatch({ type: 'move', activeId: String(active.id) as BlockId, overId: String(over.id) as BlockId });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {blocks.map((block) =>
            block.kind === 'step' ? (
              <StepCard key={block.id} step={block} sport={sport} thresholds={thresholds} zones={zones} dispatch={dispatch} />
            ) : (
              <RepeatCard key={block.id} block={block} sport={sport} thresholds={thresholds} zones={zones} dispatch={dispatch} />
            ),
          )}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
