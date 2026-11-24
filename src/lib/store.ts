import { useSyncExternalStore } from 'react';

/** 最小限の外部ストア（React の useSyncExternalStore 用） */
export function createStore<T>(initial: T) {
  let state = initial;
  const ls = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      ls.forEach((l) => l());
    },
    subscribe(l: () => void) {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
