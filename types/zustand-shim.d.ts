// Déclaration minimale de l'API de Zustand utilisée par app-store.ts, pour vérifier le typage dans
// un environnement sans accès à npm. À SUPPRIMER dès que `npm install zustand` a été fait.
declare module 'zustand/vanilla' {
  export interface StoreApi<T> {
    getState(): T;
    setState(partial: Partial<T> | ((state: T) => Partial<T>)): void;
    subscribe(listener: (state: T, previous: T) => void): () => void;
  }
  export function createStore<T>(): (
    initializer: (set: StoreApi<T>['setState'], get: StoreApi<T>['getState'], api: StoreApi<T>) => T,
  ) => StoreApi<T>;
}
