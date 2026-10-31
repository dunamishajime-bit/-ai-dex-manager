import { DIST_TERMINAL_LIVE_CONFIG } from './disterminal-live-config';
import type { RankRow } from './realtime-ranking';

/**
 * Build-time coverage is a hint, never evidence that a strategy is currently
 * running or has emitted an entry signal. Live observations always win.
 */
export type RankingStrategyBadge = {
  logic: string;
  side: 'LONG' | 'SHORT' | 'WAIT' | 'UNKNOWN';
  fresh: boolean;
  source: 'OBSERVED' | 'CONFIG_ONLY';
  sourceRoutes: string[];
};

const configuredCoverage = new Map<string, string[]>();
function register(symbol: string, logic: string) {
  const key = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(key)) return;
  const values = configuredCoverage.get(key) ?? [];
  if (!values.includes(logic)) values.push(logic);
  configuredCoverage.set(key, values);
}
// This is compatibility metadata, not a current-Production membership proof.
for (const symbol of DIST_TERMINAL_LIVE_CONFIG.v12Symbols) register(symbol, 'V12_V4');
for (const symbol of DIST_TERMINAL_LIVE_CONFIG.quality102Runtime.symbols) register(symbol, 'Q102');
register('PENGUUSDT', 'PENGU');
register('FETUSDT', 'FET');
register('HYPEUSDT', 'HYPE');
register('ZECUSDT', 'ZEC');

export function rankingStrategyBadges(symbol: string, observed: readonly RankRow[]): RankingStrategyBadge[] {
  const normalized = symbol.trim().toUpperCase();
  const badges: RankingStrategyBadge[] = [];
  const byKey = new Map<string, RankingStrategyBadge>();
  const observedLogics = new Set<string>();
  for (const row of observed) {
    if (row.symbol.toUpperCase() !== normalized || row.logic === 'MARKET' || row.logic === '—') continue;
    observedLogics.add(row.logic);
    const side = row.side === 'LONG' || row.side === 'SHORT' || row.side === 'WAIT' ? row.side : 'UNKNOWN';
    const key = row.logic + ':' + side;
    const existing = byKey.get(key);
    if (existing) {
      existing.fresh = existing.fresh || row.fresh;
      if (row.sourceRoute && !existing.sourceRoutes.includes(row.sourceRoute)) existing.sourceRoutes.push(row.sourceRoute);
      continue;
    }
    const badge: RankingStrategyBadge = {
      logic: row.logic, side, fresh: row.fresh, source: 'OBSERVED',
      sourceRoutes: row.sourceRoute ? [row.sourceRoute] : [],
    };
    byKey.set(key, badge);
    badges.push(badge);
  }
  for (const logic of configuredCoverage.get(normalized) ?? []) {
    if (!observedLogics.has(logic)) {
      badges.push({ logic, side: 'UNKNOWN', fresh: false, source: 'CONFIG_ONLY', sourceRoutes: [] });
    }
  }
  return badges;
}
