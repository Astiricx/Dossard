import { card } from '../workout-builder/ui.tsx';
import { dragId } from './model/dnd.ts';
import type { LibraryItem } from './model/library.ts';
import { WorkoutChip } from './WorkoutChip.tsx';

interface Props {
  items: readonly LibraryItem[];
  onCreate: () => void;
}
export const chipOf = (item: LibraryItem) => ({ sport: item.source.sport, title: item.source.title, planned: item.planned });

/** Les séances déjà construites et les modèles, sans doublon. Glisser une vignette sur un jour y pose une COPIE. */
export function Library({ items, onCreate }: Props) {
  return (
    <aside className={`${card} p-3`} aria-label="Bibliothèque de séances">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Bibliothèque</h2>
        <span className="text-xs text-mute tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-mute">
          Aucune séance pour l'instant.{' '}
          <button type="button" className="font-medium text-racing underline underline-offset-2 hover:text-ink" onClick={onCreate}>Construis la première</button>
          , elle apparaîtra ici.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-mute">Glisse une séance sur un jour pour l'y planifier.</p>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:max-h-[32rem] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pr-1">
            {items.map((item) => (
              <li key={item.key} className="w-44 shrink-0 lg:w-auto">
                <WorkoutChip dragKey={dragId.library(item.key)} workout={chipOf(item)}
                  label={`${item.source.title} : glisser sur un jour pour planifier`}
                  note={item.uses > 1 ? `× ${item.uses}` : item.uses === 0 ? 'modèle' : undefined} />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
