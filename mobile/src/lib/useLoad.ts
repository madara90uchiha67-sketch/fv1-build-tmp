import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError } from "./api";

interface LoadState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  refresh: () => void;
}

// Carga datos al enfocar la pantalla (así se actualizan al volver de un formulario) y permite recargar.
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const run = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const execute = useCallback(async (mode: "initial" | "refresh" | "silent") => {
    const id = ++run.current;
    const controller = new AbortController();
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const result = await loaderRef.current(controller.signal);
      if (id !== run.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== run.current) return;
      if (e instanceof ApiError && e.kind === "aborted") return;
      setError(e);
    } finally {
      if (id === run.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void execute("initial");
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // La primera carga ya la hizo el efecto anterior; al volver al foco se refresca sin parpadeo.
      if (first.current) {
        first.current = false;
        return;
      }
      void execute("silent");
    }, [execute]),
  );

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => void execute("initial"),
    refresh: () => void execute("refresh"),
  };
}
