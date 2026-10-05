import test from 'node:test';import assert from 'node:assert/strict';import { ownedHypeProtectionLevels } from '../lib/hype-zec-priority-capacity';
test('priority reduction keeps actual HYPE75 STOP and TP instead of rebuilding legacy levels',()=>{
 const p:any={symbol:'HYPEUSDT',quantity:2};const s:any={positions:[{symbol:'HYPEUSDT',quantity:2,stopPrice:8.5,takeProfitPrice:16}]};
 assert.deepEqual(ownedHypeProtectionLevels(s,p),{stopPrice:8.5,takeProfitPrice:16});assert.throws(()=>ownedHypeProtectionLevels(s,{...p,quantity:3}));
});
