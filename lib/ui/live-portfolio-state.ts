export type LivePortfolioState<T> = {
  snapshot: T | null;
  error: string | null;
};

export function livePortfolioFailureState<T>(_previous: LivePortfolioState<T>, error: string): LivePortfolioState<T> {
  return { snapshot: null, error };
}
