import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

// Runs an async function when `deps` change and tracks its result, like a
// tiny version of libraries such as TanStack Query. Old data is kept while
// new data loads, so switching the range doesn't flash an empty chart.
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // Keep the latest fn without re-running the effect every render.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    // If deps change before the request finishes, ignore its late answer.
    let cancelled = false;
    setLoading(true);
    fnRef.current().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(undefined);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, loading, reload };
}

// The current time, refreshed every `intervalMs`, so "4 minutes ago"
// keeps counting without a reload.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
