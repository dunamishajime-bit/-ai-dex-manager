import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatQ102SideGross } from '../lib/production-display';
import { loadFormalBtAnchor } from '../lib/server/formal-bt-anchor';
test('Side sizing display keeps asymmetric sizes including PB SHORT', () => {
 const text = formatQ102SideGross({HIGH_VOL:{LONG:1,SHORT:.6},REV:{LONG:1.5,SHORT:1.25},PB:{LONG:2,SHORT:2.5},MR:{default:.75},BRK:{default:.75}});
 assert.match(text,/HIGH_VOL LONG 1.00x \/ SHORT 0.60x/);
 assert.match(text,/REV LONG 1.50x \/ SHORT 1.25x/);
 assert.match(text,/PB LONG 2.00x \/ SHORT 2.50x/);
 assert.match(text,/MR 0.75x/);
});
test('Formal BT reads current authoritative DD12.96 files and reconciles trades', async () => {
 const bt=await loadFormalBtAnchor('../..');
 assert.equal(bt.finalEquityJpy,4067358397.424793);
 assert.equal(bt.profitFactor,2.960180377096512);
 assert.equal(bt.maxDrawdownPct,-12.96457052048714);
 assert.equal(bt.trades,1358);
 assert.equal(bt.v12Wins,643);
 assert.equal(bt.v12Trades,995);
 assert.equal(bt.accounting,'PASS');
});
test('Every policy summary consumes Side sizing; formal page no old fixed BT',async()=>{
 for(const p of ['app/page.tsx','app/positions/page.tsx','components/layout/LiveProductionBanner.tsx','components/features/DecisionStatusPanel.tsx','lib/server/disdex-decision-status.ts']){
  const s=await readFile(p,'utf8');assert.match(s,/formatQ102SideGross/);assert.doesNotMatch(s,/familyGross\.(HIGH_VOL|REV|PB)/);
 }
 const s=await readFile('app/api/system/formal-priority-status/route.ts','utf8');
 assert.match(s,/loadFormalBtAnchor/);assert.doesNotMatch(s,/1229065462|1275|21\.296/);
});
