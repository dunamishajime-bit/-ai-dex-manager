import { NextResponse } from "next/server";
import { AsterV3Client } from "@/lib/aster-v3-client";
import { loadTradeHistoryEntries, type TradeHistoryEntry } from "@/lib/server/trade-history-db";
export const dynamic = "force-dynamic";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT", "AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT"] as const;
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
async function loadAsterEntries(): Promise<TradeHistoryEntry[]> {
 const c=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,userAgent:"DisDex-Trade-History/1.0"});
 if(!c.hasTradingCredentials()) return [];
 const rows=(await Promise.all(SYMBOLS.map(async s=>{try{return await c.getUserTrades(s,100)}catch{return []}}))).flat();
 return rows.map(r=>{const symbol=String(r.symbol||"").toUpperCase(),base=symbol.endsWith("USDT")?symbol.slice(0,-4):symbol,action=r.side==="SELL"||r.buyer===false?"SELL":"BUY",qty=n(r.qty),quote=n(r.quoteQty)||qty*n(r.price),at=new Date(n(r.time)||Date.now()).toISOString(); return {id:`aster-${symbol}-${r.id??r.orderId??`${r.time}-${action}-${qty}`}`,executedAt:at,walletId:"aster-perpetual",walletAddress:process.env.ASTER_USER_ADDRESS||"Aster account",chainId:0,txHash:`aster-order-${r.orderId??r.id??r.time}`,provider:"AsterDex",action,sourceSymbol:action==="BUY"?"USDT":base,destSymbol:action==="BUY"?base:"USDT",sourceAmount:action==="BUY"?quote:qty,destAmount:action==="BUY"?qty:quote,sourceUsdValue:quote,destUsdValue:quote,entryPriceUsd:action==="BUY"&&qty>0?quote/qty:undefined,exitPriceUsd:action==="SELL"&&qty>0?quote/qty:undefined,realizedPnlUsd:n(r.realizedPnl),reason:`Aster authenticated userTrades strategy=${String(r.clientOrderId||r.origClientOrderId||"").toLowerCase().includes("v50")?"V50":String(r.clientOrderId||r.origClientOrderId||"").toLowerCase().includes("v11")?"V11":"V96"} side=${r.positionSide||"LONG"} reduceOnly=${Boolean(r.reduceOnly)}`} satisfies TradeHistoryEntry}).filter(e=>e.sourceAmount>0||e.destAmount>0);
}
export async function GET(){const [ledger,aster]=await Promise.all([loadTradeHistoryEntries(),loadAsterEntries().catch(()=>[])]);const entries=[...aster,...ledger].filter((e,i,a)=>a.findIndex(x=>x.id===e.id)===i).sort((a,b)=>Date.parse(b.executedAt)-Date.parse(a.executedAt));return NextResponse.json({ok:true,entries,sources:{aster:aster.length,ledger:ledger.length}},{headers:{"Cache-Control":"no-store"}})}
