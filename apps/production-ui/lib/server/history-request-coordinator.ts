export type HistoryRequestCoordinator<T> = {
  readonly lastError: Error | undefined;
  readonly lastRunUsedStale: boolean;
  run(work: () => Promise<T>): Promise<T>;
};

export function createHistoryRequestCoordinator<T>(): HistoryRequestCoordinator<T> {
  let inFlight: Promise<T> | null = null;
  let lastValue: T | undefined;
  let hasValue = false;
  let lastError: Error | undefined;
  let lastRunUsedStale = false;

  const coordinator: HistoryRequestCoordinator<T> = {
    get lastError() {
      return lastError;
    },
    get lastRunUsedStale() {
      return lastRunUsedStale;
    },
    run(work) {
      if (inFlight) return inFlight;

      lastRunUsedStale = false;
      const promise = Promise.resolve()
        .then(work)
        .then((value) => {
          lastValue = value;
          hasValue = true;
          lastError = undefined;
          return value;
        })
        .catch((error: unknown) => {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!hasValue) throw lastError;
          lastRunUsedStale = true;
          return lastValue as T;
        })
        .finally(() => {
          if (inFlight === promise) inFlight = null;
        });

      inFlight = promise;
      return promise;
    },
  };

  return coordinator;
}
