import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * True only once the client has hydrated. Server-rendered/first-paint value
 * is always false (getServerSnapshot), so this never mismatches SSR — the
 * useSyncExternalStore-based equivalent of the old
 * `useState(false)` + `useEffect(() => setMounted(true), [])` idiom, without
 * a synchronous setState call inside an effect.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
