import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AsterDirectTradeExecutor } from "../../lib/direct-trade-executor";
import { evaluateIdleNormalizedQuantity } from "../../lib/idle-priority-short-live";
const root=path.resolve("docs/research/results/gate-fixes-bt-20261008");
const exchange=JSON.parse(fs.readFileSync(path.join(root,"support/venue-filters-observed-20261007.json"),"utf8"));
const executor=new AsterDirectTradeExecutor({getExchangeInfo:async()=>exchange} as any);
const prices:Record<string,number>={AVAXUSDT:8.83,JUPUSDT:.287,DOGEUSDT:.097,DOTUSDT:1.11,RENDERUSDT:1.234,TIAUSDT:.675,TAOUSDT:299.5};
const vectors:any[]=[];
async function main(){
 for(const [symbol,base] of Object.entries(prices)) for(const equity of [66.12791313,100,1000,10000]) for(let i=0;i<10;i++){
  const referencePrice=base*(.75+i*.051),requested=equity/referencePrice;
  const n=await executor.normalizeMarketQuantity(symbol,requested,referencePrice);
  assert.equal(Number(n.quantityText),n.quantity,"wire text must preserve normalized quantity");
  const result=evaluateIdleNormalizedQuantity({equity,referencePrice,normalized:n});
  assert.equal(result.accepted,true,symbol+":"+equity+":"+referencePrice);
  assert.ok(result.notionalUsd<=equity+1e-9);
  const strict=n.notional/equity>=1-1e-6;
  vectors.push({symbol,equity,referencePrice,normalized:n,result,oldStrictAccepted:strict});
 }
 fs.writeFileSync(path.join(root,"quantity-production-vectors.json"),JSON.stringify(vectors,null,2));
 console.log(JSON.stringify({vectors:vectors.length,correctedAccepted:vectors.length,oldStrictAccepted:vectors.filter(x=>x.oldStrictAccepted).length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
