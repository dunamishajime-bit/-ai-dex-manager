import assert from 'node:assert/strict';
import test from 'node:test';
import type { RankRow } from '../lib/realtime-ranking';
import { rankingStrategyBadges } from '../lib/realtime-ranking-strategy-display';

const row = (symbol: string, logic: string, side: string, fresh = true, sourceRoute?: string): RankRow => ({
  id: logic + ':' + symbol + ':' + side,
  symbol, logic, side, fresh, checkedAt: Date.now(), reason: '',
  score: null, scoreKind: 'UNAVAILABLE', scoreLabel: '',
  gates: [], ...(sourceRoute ? { sourceRoute } : {}),
});

test('V12 and Q102 monitored currencies keep a clearly qualified configured logic name without a signal', () => {
  const v12 = rankingStrategyBadges('BTCUSDT', []);
  const q102 = rankingStrategyBadges('SUIUSDT', []);
  assert(v12.some(x => x.logic === 'V12_V4' && x.side === 'UNKNOWN' && x.source === 'CONFIG_ONLY'));
  assert(q102.some(x => x.logic === 'Q102' && x.side === 'UNKNOWN' && x.source === 'CONFIG_ONLY'));
});

test('observed logic and side supersede config-only entries, but other observed routes remain', () => {
  const badges = rankingStrategyBadges('BTCUSDT', [
    row('BTCUSDT', 'V12_V4', 'LONG', true, 'REC_G1'),
    row('BTCUSDT', 'V12_V4', 'LONG', true, 'REC_G2'),
    row('BTCUSDT', 'V12_V4', 'SHORT', false, 'REC_Y12'),
  ]);
  assert.equal(badges.filter(x => x.logic === 'V12_V4').length, 2);
  assert.deepEqual(badges[0].sourceRoutes, ['REC_G1', 'REC_G2']);
  assert.equal(badges[0].source, 'OBSERVED');
  assert.equal(badges[0].side, 'LONG');
  assert.equal(badges[1].fresh, false);
});

test('stale observations are never overwritten with fabricated current directions', () => {
  const badges = rankingStrategyBadges('RENDERUSDT', [row('RENDERUSDT', 'Q102', 'WAIT', false)]);
  assert.equal(badges.length, 1);
  assert.equal(badges[0].source, 'OBSERVED');
  assert.equal(badges[0].side, 'WAIT');
  assert.equal(badges[0].fresh, false);
});

test('ZEC has a configured long sleeve, while unknown markets are not falsely assigned a strategy', () => {
  assert(rankingStrategyBadges('ZECUSDT', []).some(x => x.logic === 'ZEC' && x.source === 'CONFIG_ONLY'));
  assert.deepEqual(rankingStrategyBadges('UNLISTEDUSDT', []), []);
});

test('symbol boundaries are respected and empty errors are not linked to unrelated market rows', () => {
  assert.equal(rankingStrategyBadges('ETHUSDT', [row('BTCUSDT', 'Q102', 'SHORT')]).some(x=>x.logic==='Q102'), false);
  assert.equal(rankingStrategyBadges('BTCUSDT', [row('—','V12_V4','WAIT')]).some(x=>x.source==='OBSERVED'),false);
});
