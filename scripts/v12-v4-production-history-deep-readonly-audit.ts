import {createHash} from "node:crypto";
import {realpathSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const sha=(x:unknown)=>createHash("sha256").update(String(x)).digest("hex");
const short=(x:unknown)=>sha(x).slice(0,20);
const num=(x:unknown)=>Number.isFinite(Number(x))?Number(x):0;

async function main(){
 const releaseRoot=realpathSync(String(process.env.DISDEX_V4_AUDIT_RELEASE_ROOT||""));
 if(!releaseRoot.endsWith("/6723948608ce9c8ab3aba077cba7e5a0d7f6f708"))throw Error("DEEP_AUDIT_EXACT_RELEASE_REQUIRED");
 const {AsterV3Client}=await import(pathToFileURL(join(releaseRoot,"lib/aster-v3-client.ts")).href) as any;
 const baseUrl=String(process.env.ASTER_FUTURES_BASE_URL||"https://fapi.asterdex.com").trim().replace(/\/+$/,"");
 if(baseUrl!=="https://fapi.asterdex.com")throw Error("DEEP_AUDIT_PRODUCTION_HOST_REQUIRED");
 const client=new AsterV3Client({
  baseUrl,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY,
  requestTimeoutMs:10000,readOnlyRateLimitMaxRetries:0,userAgent:"DisDex-V12-V4-Deep-History-GET-Only/1",
 });
 if(!client.hasTradingCredentials())throw Error("DEEP_AUDIT_SIGNED_CREDENTIALS_REQUIRED");
 const [mode,positions,openOrders,balances,exchange,income]=await Promise.all([
  client.getPositionMode(),client.getPositions(),client.getOpenOrders(),client.getBalances(),
  client.getExchangeInfo(),client.getIncomeHistory({limit:1000}),
 ]);
 const supported=new Set((exchange.symbols||[]).filter((x:any)=>x?.status==="TRADING").map((x:any)=>String(x.symbol).toUpperCase()));
 const priority=[
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","LINKUSDT","AVAXUSDT","DOGEUSDT","XRPUSDT",
  "ADAUSDT","LTCUSDT","INJUSDT","ATOMUSDT","DOTUSDT","TIAUSDT","AAVEUSDT",
  "PENGUUSDT","FETUSDT","HYPEUSDT","RENDERUSDT","ARBUSDT","ENAUSDT","FILUSDT","ONDOUSDT",
  "OPUSDT","SEIUSDT","SUIUSDT","TRXUSDT","APTUSDT","TSLAUSDT","METAUSDT","MSFTUSDT","NVDAUSDT"
 ];
 const selected:string[]=[]; const seen=new Set<string>();
 const add=(s:unknown)=>{const x=String(s||"").toUpperCase();if(supported.has(x)&&!seen.has(x)){seen.add(x);selected.push(x);}};
 priority.forEach(add);
 for(const x of positions||[])add(x.symbol);
 for(const x of openOrders||[])add(x.symbol);
 for(const x of income||[])add(x.symbol);
 // Add remaining known exchange symbols only after every strategy/income symbol.
 for(const x of supported){if(selected.length>=100)break;add(x);}
 const symbols=selected.slice(0,100);

 const orderRows:any[]=[]; const symbolRows:any[]=[];
 let totalTrades=0,totalOrders=0,multiFillOrders=0,maxFills=0,stopOrders=0,filledReduceOnlyStops=0;
 let partialFillEvidence=0,reduceOnlyOrders=0;
 const getOrderById=async(symbol:string,orderId:string)=>{
  return (client as any).request({method:"GET",path:"/fapi/v3/order",
   params:{symbol,orderId},signed:true,ratePriority:"RECONCILIATION"});
 };
 for(const symbol of symbols){
  let trades:any[]=[];
  try{trades=await client.getUserTrades(symbol,{limit:1000});}
  catch(error:any){symbolRows.push({symbol,status:"READ_ERROR",errorClass:String(error?.message||error).slice(0,120)});continue;}
  totalTrades+=trades.length;
  const groups=new Map<string,any[]>();
  for(const t of trades){if(t.orderId===undefined||t.orderId===null)continue;const id=String(t.orderId);(groups.get(id)??(groups.set(id,[]),groups.get(id)!)).push(t);}
  totalOrders+=groups.size;
  let symbolMulti=0,symbolStops=0;
  for(const [orderId,fills] of groups){
   let order:any;
   try{order=await getOrderById(symbol,orderId);}catch(error:any){
    orderRows.push({symbol,orderHash:short(symbol+":"+orderId),status:"ORDER_READ_ERROR",errorClass:String(error?.message||error).slice(0,120),fills:fills.length});
    continue;
   }
   const fillQty=fills.reduce((n,r)=>n+num(r.qty),0);
   const fillCount=fills.length; maxFills=Math.max(maxFills,fillCount);
   if(fillCount>1){multiFillOrders++;symbolMulti++;}
   const type=String(order?.type||""); const reduceOnly=order?.reduceOnly===true;
   const status=String(order?.status||""); const origQty=num(order?.origQty),executedQty=num(order?.executedQty);
   const isStop=["STOP","STOP_MARKET","TAKE_PROFIT","TAKE_PROFIT_MARKET"].includes(type);
   if(isStop){stopOrders++;symbolStops++;}
   if(reduceOnly)reduceOnlyOrders++;
   if(isStop&&reduceOnly&&status==="FILLED")filledReduceOnlyStops++;
   const partial = fillCount>1 || status==="PARTIALLY_FILLED" ||
     (executedQty>0&&origQty>0&&executedQty<origQty-1e-12);
   if(partial)partialFillEvidence++;
   orderRows.push({
    symbol,orderHash:short(symbol+":"+orderId),clientOrderHash:order?.clientOrderId?short(symbol+":"+order.clientOrderId):null,
    type,status,side:String(order?.side||""),positionSide:String(order?.positionSide||""),
    reduceOnly,closePosition:order?.closePosition===true,origQty,executedQty,fillQty,fillCount,
    avgPrice:num(order?.avgPrice),stopPrice:num(order?.stopPrice),updateTime:num(order?.updateTime),
    firstFillTs:fills.length?Math.min(...fills.map(r=>num(r.time)).filter(Boolean)):null,
    lastFillTs:fills.length?Math.max(...fills.map(r=>num(r.time)).filter(Boolean)):null,
    commissionAssets:[...new Set(fills.map(r=>String(r.commissionAsset||"")).filter(Boolean))],
    partialFillEvidence:partial,
   });
  }
  symbolRows.push({symbol,status:"OK",tradeCount:trades.length,distinctOrderCount:groups.size,
   multiFillOrderCount:symbolMulti,stopOrderCount:symbolStops,
   observedFrom:trades.length?Math.min(...trades.map(t=>num(t.time)).filter(Boolean)):null,
   observedTo:trades.length?Math.max(...trades.map(t=>num(t.time)).filter(Boolean)):null});
 }
 const usdt=(balances||[]).find((b:any)=>String(b.asset)==="USDT");
 const nonzero=(positions||[]).filter((p:any)=>Math.abs(num(p.positionAmt))>1e-12)
   .map((p:any)=>({symbol:String(p.symbol),positionSide:String(p.positionSide||"BOTH"),positionAmt:num(p.positionAmt),
     entryPrice:num(p.entryPrice),markPrice:num(p.markPrice)}));
 const active=(openOrders||[]).map((o:any)=>({symbol:String(o.symbol),orderHash:short(String(o.symbol)+":"+String(o.orderId??o.clientOrderId??"")),
   type:String(o.type||""),status:String(o.status||""),side:String(o.side||""),positionSide:String(o.positionSide||""),
   reduceOnly:o.reduceOnly===true,origQty:num(o.origQty),executedQty:num(o.executedQty),stopPrice:num(o.stopPrice)}));
 const evidenceCore={
  schema:"disdex-v12-v4-production-history-deep-readonly/v1",status:"PASS_SIGNED_GET_ONLY",
  observedAt:new Date().toISOString(),candidateSha:"6723948608ce9c8ab3aba077cba7e5a0d7f6f708",
  productionHost:true,positionMode:{dualSidePosition:mode?.dualSidePosition===true},
  account:{usdtBalance:num(usdt?.balance),usdtAvailable:num(usdt?.availableBalance),
    nonzeroPositionCount:nonzero.length,openOrderCount:active.length,nonzeroPositions:nonzero,openOrders:active},
  history:{queriedSymbols:symbols,totalTrades,totalDistinctOrders:totalOrders,multiFillOrders,maxFills,
    stopOrders,filledReduceOnlyStops,reduceOnlyOrders,partialFillEvidence,symbols:symbolRows,orders:orderRows},
  mutationCalls:0,secretDisclosed:false,
 };
 console.log(JSON.stringify({...evidenceCore,evidenceSha256:sha(JSON.stringify(evidenceCore))},null,2));
}
main().catch(e=>{console.error(JSON.stringify({status:"DEEP_AUDIT_FAILED",error:e instanceof Error?e.message:String(e),mutationCalls:0,secretDisclosed:false}));process.exitCode=2;});
