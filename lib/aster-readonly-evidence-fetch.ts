/** Reviewed evidence-only Aster transport, shared by scoped maintenance. */
const ALLOWED = new Set(['/fapi/v3/time','/fapi/v3/balance','/fapi/v3/positionRisk','/fapi/v3/openOrders']);

export function assertSharedAsterReadBudget(path: unknown): void {
  if (path !== '/var/lib/disdex/shared/aster-rate-budget.json') {
    throw new Error('ASTER_EVIDENCE_SHARED_RATE_BUDGET_REQUIRED');
  }
}

export function createAsterReadonlyEvidenceFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let url: URL;
    try {url = new URL(raw);} catch {throw new Error('ASTER_EVIDENCE_HTTP_NOT_ALLOWED');}
    if (method !== 'GET' || url.origin !== 'https://fapi.asterdex.com' || !ALLOWED.has(url.pathname)) {
      throw new Error('ASTER_EVIDENCE_HTTP_NOT_ALLOWED');
    }
    return fetchImpl(input, {...init, redirect: 'error'});
  };
}
