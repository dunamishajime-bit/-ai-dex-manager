import {createHash} from "node:crypto";
import {realpathSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

async function main(){

 const releaseRoot=realpathSync(String(process.env.DISDEX_V4_AUDIT_RELEASE_ROOT||""));
 const moduleUrl=pathToFileURL(join(releaseRoot,"lib/aster-v3-client.ts")).href;
 const {AsterV3Client}=await import(moduleUrl) as any;

 const baseUrl=String(process.env.ASTER_FUTURES_BASE_URL||"https://fapi.asterdex.com")
  .trim().replace(/\/+$/,"");
 if(baseUrl!=="https://fapi.asterdex.com")throw Error("V4_HISTORY_AUDIT_REQUIRES_PRODUCTION_HOST");
 const privateKey=process.env.ASTER_API_PRIVATE_KEY;
 const userAddress=process.env.ASTER_USER_ADDRESS;
 if(!privateKey||!userAddress)throw Error("V4_HISTORY_AUDIT_SIGNED_CREDENTIALS_REQUIRED");

 const client=new AsterV3Client({
  baseUrl,userAddress,privateKey,
  requestTimeoutMs:10000,userAgent:"DisDex-V12-V4-Production-History-Readonly-Audit/1",
 });
 if(!client.hasTradingCredentials())throw Error("V4_HISTORY_AUDIT_SIGNED_CREDENTIALS_REQUIRED");

 const hash=(value:unknown)=>createHash("sha256").update(String(value)).digest("hex").slice(0,20);
 const num=(x:unknown)=>Number.isFinite(Number(x))?Number(x):0;

 const [mode,positions,openOrders,balances,exchange,income]=await Promise.all([
  client.getPositionMode(),client.getPositions(),client.getOpenOrders(),client.getBalances(),
  client.getExchangeInfo(),client.getIncomeHistory({limit:1000}),
 ]);

 const supported=new Set((exchange.symbols||[]).filter((x:any)=>x?.status==="TRADING").map((x:any)=>String(x.symbol).toUpperCase()));
 const seed=[
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","DOGEUSDT","XRPUSDT","LINKUSDT","AVAXUSDT",
  "ADAUSDT","LTCUSDT","INJUSDT","ATOMUSDT","DOTUSDT","TIAUSDT","AAVEUSDT","PENGUUSDT",
  "RENDERUSDT","FETUSDT","HYPEUSDT","ARBUSDT","ENAUSDT","FILUSDT","ONDOUSDT","OPUSDT",
  "SEIUSDT","SUIUSDT","TRXUSDT","TSLAUSDT","METAUSDT","MSFTUSDT","NVDAUSDT",
 ];
 const symbolSet=new Set<string>();
 for(const s of seed)if(supported.has(s))symbolSet.add(s);
 for(const x of positions||[])if(supported.has(String(x.symbol).toUpperCase()))symbolSet.add(String(x.symbol).toUpperCase());
 for(const x of openOrders||[])if(supported.has(String(x.symbol).toUpperCase()))symbolSet.add(String(x.symbol).toUpperCase());
 for(const x of income||[]){
  const s=String(x.symbol||"").toUpperCase();
  if(supported.has(s))symbolSet.add(s);
 }
 const symbols=[...symbolSet].sort().slice(0,60);

 const bySymbol:any[]=[];
 let totalTrades=0,totalOrders=0,multiFillOrders=0,maxFillsPerOrder=0;
 for(const symbol of symbols){
  let trades:any[]=[];
  try{trades=await client.getUserTrades(symbol,{limit:1000});}
  catch(error:any){
   bySymbol.push({symbol,status:"READ_ERROR",errorClass:String(error?.message||error).replace(/0x[a-fA-F0-9]{16,}/g,"<redacted>").slice(0,160)});
   continue;
  }
  totalTrades+=trades.length;
  const groups=new Map<string,any[]>();
  for(const t of trades){
   if(t.orderId===undefined||t.orderId===null)continue;
   const id=String(t.orderId);
   if(!groups.has(id))groups.set(id,[]);
   groups.get(id)!.push(t);
  }
  totalOrders+=groups.size;
  const multiple=[...groups.entries()].filter(([,rows])=>rows.length>1)
   .map(([id,rows])=>{
    maxFillsPerOrder=Math.max(maxFillsPerOrder,rows.length);
    return {
     orderHash:hash(symbol+":"+id),fills:rows.length,
     totalQty:rows.reduce((n,r)=>n+num(r.qty),0),
     firstTs:Math.min(...rows.map(r=>num(r.time)).filter(Boolean)),
     lastTs:Math.max(...rows.map(r=>num(r.time)).filter(Boolean)),
     sides:[...new Set(rows.map(r=>String(r.side||"")))].filter(Boolean),
     positionSides:[...new Set(rows.map(r=>String(r.positionSide||"")))].filter(Boolean),
    };
   });
  multiFillOrders+=multiple.length;
  bySymbol.push({
   symbol,status:"OK",tradeCount:trades.length,distinctOrderCount:groups.size,
   multiFillOrderCount:multiple.length,maxFills:multiple.reduce((m,x)=>Math.max(m,x.fills),0),
   observedFrom:trades.length?Math.min(...trades.map(t=>num(t.time)).filter(Boolean)):null,
   observedTo:trades.length?Math.max(...trades.map(t=>num(t.time)).filter(Boolean)):null,
   multiFillExamples:multiple.slice(0,20),
  });
 }

 const nonzeroPositions=(positions||[]).filter((p:any)=>Math.abs(num(p.positionAmt))>1e-12)
  .map((p:any)=>({symbol:String(p.symbol),positionSide:String(p.positionSide||"BOTH"),
   positionAmt:num(p.positionAmt),entryPrice:num(p.entryPrice),markPrice:num(p.markPrice),
   unrealizedPnl:num(p.unRealizedProfit??p.unrealizedProfit)}));

 const activeOrders=(openOrders||[]).map((o:any)=>({
  symbol:String(o.symbol),orderHash:hash(String(o.symbol)+":"+String(o.orderId??o.clientOrderId??"")),
  clientOrderHash:hash(String(o.clientOrderId||"")),status:String(o.status||""),
  side:String(o.side||""),positionSide:String(o.positionSide||""),
  type:String(o.type||""),reduceOnly:o.reduceOnly===true,
  origQty:num(o.origQty),executedQty:num(o.executedQty),stopPrice:num(o.stopPrice),
 }));

 const usdt=(balances||[]).find((b:any)=>String(b.asset)==="USDT");
 const payload={
  schema:"disdex-v12-v4-production-history-readonly-audit/v1",
  status:"PASS_SIGNED_GET_ONLY",
  observedAt:new Date().toISOString(),
  deployedRelease:releaseRoot.split(/[\\/]/).at(-1),
  productionHost:true,
  positionMode:{dualSidePosition:mode?.dualSidePosition===true},
  accountSummary:{usdtBalance:num(usdt?.balance),usdtAvailable:num(usdt?.availableBalance),
   nonzeroPositionCount:nonzeroPositions.length,openOrderCount:activeOrders.length},
  nonzeroPositions,openOrders:activeOrders,
  tradeHistory:{queriedSymbols:symbols.length,totalTrades,totalDistinctOrders:totalOrders,
   multiFillOrderCount:multiFillOrders,maxFillsPerOrder,bySymbol},
  mutationCalls:0,secretDisclosed:false,
 };
 const canonical=JSON.stringify(payload);
 const evidenceSha256=createHash("sha256").update(canonical).digest("hex");
 console.log(JSON.stringify({...payload,evidenceSha256},null,2));
}
main().catch(error=>{
 console.error(JSON.stringify({status:"V4_PRODUCTION_HISTORY_READONLY_AUDIT_FAILED",error:error instanceof Error?error.message:String(error),mutationCalls:0,secretDisclosed:false}));
 process.exitCode=2;
});
