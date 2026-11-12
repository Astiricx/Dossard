// store.ts — l'unique instance du store, et le hook React qui s'y abonne.
import { useStore } from 'zustand';
import { createAppStore, type AppState } from '../store/app-store.ts';
import { dexiePort, dexieStreams } from './dexie-port.ts';

export const appStore = createAppStore(dexiePort);
/** Lecture des séries temporelles, à la demande (elles ne sont pas dans le store). */
export const streamsReader = dexieStreams;

/**
 * S'abonne à une tranche du store. Le sélecteur doit renvoyer une référence stable (une valeur
 * du store, pas un tableau ou un objet construit à la volée), sinon le composant se redessine en boucle.
 */
export const useApp = <T>(selector: (state: AppState) => T): T => useStore(appStore, selector);
