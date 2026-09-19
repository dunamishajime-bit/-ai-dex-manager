import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";

const execFileAsync = promisify(execFile);
const CURRENT_RELEASE = "/home/deploy/disdex-trading/current";
const HOUR_MS = 3_600_000;

export type Quality102SymbolDecision = {
  symbol: string;
  eligible: boolean;
  side: "LONG" | "SHORT" | "WAIT";
  family?: string;
  layer?: string;
  variant?: string;
  requestedGross: number;
  reason: string;
  selected: boolean;
  referenceTs: number;
};

export type Quality102SymbolSnapshot = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  productionSha: string;
  selectorMode: string;
  referenceTs: number;
  selectedSymbol?: string;
  selectedFamily?: string;
  selectedReason: string;
  items: Quality102SymbolDecision[];
};

let cache: { hourKey: number; snapshot: Quality102SymbolSnapshot } | null = null;

const childSource = String.raw`
import { readFile } from "node:fs/promises";
import { AsterV3Client } from "./lib/aster-v3-client.ts";
import { buildQuality102CausalV4Signal } from "./lib/disdex-quality102-causal-v4-signal.ts";
import { generateQuality102CausalV4S34Candidates, QUALITY102_CAUSAL_V4_S34_MODEL } from "./lib/disdex-quality102-causal-v4-s34.ts";
import { evaluateQuality102CausalV4ImprovementGate } from "./lib/disdex-quality102-causal-selector.ts";

const HOUR=3600000;
const now=Date.now();
const entryTs=Math.floor(now/HOUR)*HOUR;
const persisted=JSON.parse(await readFile("/var/lib/disdex/quality102-causal-v1/market-history.json","utf8"));
const candlesBySymbol=persisted.candlesBySymbol||{};
const symbols=(persisted.symbols||Object.keys(candlesBySymbol)).map(x=>String(x).toUpperCase()).filter(x=>x!=="BTCUSDT").sort();
const expectedLast=entryTs-HOUR;
for (const symbol of ["BTCUSDT",...symbols]) {
  const rows=candlesBySymbol[symbol];
  if (!Array.isArray(rows) || !rows.length || Number(rows.at(-1)?.timestampMs)!==expectedLast) {
    throw new Error("Q102_OBSERVER_HISTORY_STALE:"+symbol);
  }
}
const s34Symbols=new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>String(x.symbol).toUpperCase()));
const highVol=new Set(symbols.filter(symbol=>!s34Symbols.has(symbol)));
const client=new AsterV3Client({
  baseUrl: process.env.ASTER_FUTURES_BASE_URL,
  userAddress: process.env.ASTER_USER_ADDRESS,
  privateKey: process.env.ASTER_API_PRIVATE_KEY,
  requestTimeoutMs: 10000,
  recvWindowMs: 5000,
  userAgent: "DisDex-Q102-ReadOnly-Observer",
});
const entryOpenBySymbol={};
for (const symbol of symbols) {
  const rows=await client.getKlines(symbol,"1h",1,{startTime:entryTs,endTime:entryTs+HOUR-1});
  const row=Array.isArray(rows)?rows.find(r=>Number(r[0])===entryTs):undefined;
  if (!row) throw new Error("Q102_OBSERVER_ENTRY_OPEN_MISSING:"+symbol);
  entryOpenBySymbol[symbol]={timestampMs:entryTs,open:Number(row[1])};
  await new Promise(r=>setTimeout(r,220));
}
const fullHistory={candlesBySymbol,entryOpenBySymbol};
const full=buildQuality102CausalV4Signal({
  history:fullHistory,
  decisionTs:now,
  sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false},
},{highVolSymbols:[...highVol]});
const items=[];
for (const symbol of symbols) {
  const subset={candlesBySymbol:{BTCUSDT:candlesBySymbol.BTCUSDT,[symbol]:candlesBySymbol[symbol]},entryOpenBySymbol:{[symbol]:entryOpenBySymbol[symbol]}};
  let signal;
  if (highVol.has(symbol)) {
    signal=buildQuality102CausalV4Signal({
      history:subset,
      decisionTs:now,
      sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false},
    },{highVolSymbols:[symbol]});
  } else {
    const candidates=generateQuality102CausalV4S34Candidates({symbol,rows:candlesBySymbol[symbol],entryOpen:entryOpenBySymbol[symbol]});
    candidates.sort((a,b)=>({S3:1,S4:2}[a.layer]-({S3:1,S4:2}[b.layer])||({BRK:1,PB:2,MR:3,REV:4}[a.family]-({BRK:1,PB:2,MR:3,REV:4}[b.family]))||b.margin-a.margin||a.key.localeCompare(b.key));
    const c=candidates.find(x=>evaluateQuality102CausalV4ImprovementGate({family:x.family,side:x.side,ret14:x.ret14}).accepted);
    signal=c?{referenceTs:c.entryTs,side:c.side,symbol:c.symbol,family:c.family,variant:c.variant,layer:c.layer,requestedGross:1,reason:"QUALITY102_CAUSAL_V4_NATURAL_SIGNAL"}:{referenceTs:entryTs,side:0,requestedGross:0,reason:"QUALITY102_CAUSAL_V4_NO_SIGNAL"};
  }
  items.push({
    symbol,
    eligible:signal.side!==0 && Boolean(signal.symbol),
    side:signal.side>0?"LONG":signal.side<0?"SHORT":"WAIT",
    family:signal.family,
    layer:signal.layer,
    variant:signal.variant,
    requestedGross:Number(signal.requestedGross||0),
    reason:String(signal.reason||""),
    selected:full.symbol===symbol && full.side!==0,
    referenceTs:Number(signal.referenceTs||entryTs),
  });
}
console.log(JSON.stringify({referenceTs:entryTs,selectedSymbol:full.symbol,selectedFamily:full.family,selectedReason:full.reason,items}));
`;

export async function loadQuality102SymbolObservability(): Promise<Quality102SymbolSnapshot> {
  const runtime = await loadCurrentProductionRuntime();
  const hourKey = Math.floor(Date.now() / HOUR_MS);
  if (cache?.hourKey === hourKey && cache.snapshot.productionSha === runtime.releaseSha) return cache.snapshot;

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", childSource],
    { cwd: CURRENT_RELEASE, env: process.env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim()) as {
    referenceTs: number;
    selectedSymbol?: string;
    selectedFamily?: string;
    selectedReason: string;
    items: Quality102SymbolDecision[];
  };
  const snapshot: Quality102SymbolSnapshot = {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt: new Date().toISOString(),
    productionSha: runtime.releaseSha,
    selectorMode: runtime.quality102.selectorMode,
    referenceTs: parsed.referenceTs,
    selectedSymbol: parsed.selectedSymbol,
    selectedFamily: parsed.selectedFamily,
    selectedReason: parsed.selectedReason,
    items: parsed.items,
  };
  cache = { hourKey, snapshot };
  return snapshot;
}
