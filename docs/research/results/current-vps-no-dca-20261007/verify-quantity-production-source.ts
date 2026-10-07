import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {AsterDirectTradeExecutor} from "@/lib/direct-trade-executor";
async function main(){
const root=path.resolve("docs/research/results/current-vps-no-dca-20261007");
const info=JSON.parse(fs.readFileSync(path.join(root,"venue-filters-observed-20261007.json"),"utf8"));
const cases=JSON.parse(fs.readFileSync(path.join(root,"quantity-test-vectors.json"),"utf8"));
const executor=new AsterDirectTradeExecutor({getExchangeInfo:async()=>info} as any);
let passed=0;
for(const c of cases){
 let quantity=0,reason:string|null=null;
 try{quantity=(await executor.normalizeMarketQuantity(c.symbol,c.requested,c.price)).quantity;}
 catch(e){const msg=String(e);reason=msg.includes("Quantity ")?"VENUE_MIN_QTY":msg.includes("Notional ")?"VENUE_MIN_NOTIONAL":"VENUE_FILTER_MISSING";}
 assert.equal(reason,c.reason,JSON.stringify(c));
 assert.ok(Math.abs(quantity-c.quantity)<=Math.max(1e-9,c.quantity*1e-12),JSON.stringify({c,quantity}));
 passed++;
}
fs.writeFileSync(path.join(root,"quantity-source-parity.json"),JSON.stringify({runtimeSha:"eabfeb1750666fac11f894a34cdcf68501ab923f",status:"PASS",vectors:passed,method:"Actual Production normalizeMarketQuantity, mocked read-only exchangeInfo; no credential/order/API methods",ordersSent:0,cancelsSent:0},null,2));
console.log("ACTUAL_PRODUCTION_QUANTITY_PARITY_PASS",passed);
}
main().catch(e=>{console.error(e);process.exit(1)});
