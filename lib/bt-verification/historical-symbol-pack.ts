import type {BtcCandle,Replay} from "./replay";
export type HistoricalSourceCoverage={
 start_utc:string;end_close_utc:string;bars:number;missing_hour_count:number;
 gap_hour_count:number;front_missing_hours:number;end_missing_hours:number;
 complete_h1_period:boolean;source_gzip_sha256:string;
};
export type HistoricalPackManifest={
 schema:"disdex-historical-symbol-pack-manifest/v1";
 period_start_inclusive:string;period_end_exclusive:string;source_venue:string;
 production_parity_verified:false;actual_venue_execution_verified:false;
 requested_symbols:string[];found_symbols:string[];
 source_coverage:Record<string,HistoricalSourceCoverage>;
 packs:{file:string;sha256:string;symbols:string[];bytes:number}[];
};
function object(value:unknown):value is Record<string,unknown>{
 return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
const sha=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const symbol=(s:unknown)=>typeof s==="string"&&/^[A-Z0-9]{3,24}USDT$/.test(s);
function validCoverage(x:unknown):x is HistoricalSourceCoverage{
 if(!object(x))return false;
 return typeof x.start_utc==="string"&&typeof x.end_close_utc==="string"&&
  typeof x.bars==="number"&&Number.isInteger(x.bars)&&x.bars>=0&&x.bars<=10000&&
  typeof x.missing_hour_count==="number"&&Number.isInteger(x.missing_hour_count)&&x.missing_hour_count>=0&&
  typeof x.gap_hour_count==="number"&&Number.isInteger(x.gap_hour_count)&&x.gap_hour_count>=0&&
  typeof x.front_missing_hours==="number"&&Number.isInteger(x.front_missing_hours)&&x.front_missing_hours>=0&&
  typeof x.end_missing_hours==="number"&&Number.isInteger(x.end_missing_hours)&&x.end_missing_hours>=0&&
  typeof x.complete_h1_period==="boolean"&&sha(x.source_gzip_sha256)&&
  x.missing_hour_count===x.gap_hour_count+x.front_missing_hours+x.end_missing_hours&&
  x.complete_h1_period===(x.missing_hour_count===0);
}
export function parseHistoricalPackManifest(value:unknown):HistoricalPackManifest{
 if(!object(value)||value.schema!=="disdex-historical-symbol-pack-manifest/v1"||
    value.period_start_inclusive!=="2025-10-01T00:00:00Z"||
    value.period_end_exclusive!=="2026-10-01T00:00:00Z"||
    value.source_venue!=="Aster Public Futures H1"||
    value.production_parity_verified!==false||
    value.actual_venue_execution_verified!==false||
    !Array.isArray(value.packs)||value.packs.length<1||value.packs.length>8||
    !Array.isArray(value.found_symbols)||value.found_symbols.length>48||
    !Array.isArray(value.requested_symbols)||value.requested_symbols.length>48||
    !object(value.source_coverage))throw new Error("INVALID_HISTORICAL_MARKET_MANIFEST");
 const seen=new Set<string>();
 for(const item of value.packs){
  if(!object(item)||typeof item.file!=="string"||
     !/^aster-h1-source-pack-\d{2}\.json$/.test(item.file)||!sha(item.sha256)||
     !Array.isArray(item.symbols)||item.symbols.length<1||item.symbols.length>8||
     typeof item.bytes!=="number"||item.bytes<100||item.bytes>24*1024*1024)
    throw new Error("INVALID_H1_PACK_REFERENCE");
  for(const s of item.symbols){
   if(!symbol(s)||seen.has(s)||!validCoverage(value.source_coverage[s]))
    throw new Error("DUPLICATE_OR_UNVERIFIED_H1_SYMBOL");
   seen.add(s);
  }
 }
 if(!seen.has("BTCUSDT")||seen.size!==value.found_symbols.length||
    !value.found_symbols.every((s:unknown)=>seen.has(String(s)))||
    !value.requested_symbols.every((s:unknown)=>symbol(s)))
  throw new Error("H1_MANIFEST_SYMBOL_SET_MISMATCH");
 return value as HistoricalPackManifest;
}
function candle(value:unknown):value is BtcCandle{
 if(!object(value)||typeof value.time!=="string"||typeof value.closedAt!=="string"||
    !/^20\d\d-\d\d-\d\dT\d\d:00:00Z$/.test(value.time)||
    !/^20\d\d-\d\d-\d\dT\d\d:00:00Z$/.test(value.closedAt)||
    !Number.isFinite(value.open)||!Number.isFinite(value.close)||
    !Number.isFinite(value.low)||!Number.isFinite(value.high)||
    !(Number(value.low)>0&&Number(value.low)<=Math.min(Number(value.open),Number(value.close))&&
      Number(value.high)>=Math.max(Number(value.open),Number(value.close))))return false;
 return Date.parse(value.closedAt)-Date.parse(value.time)===3600000;
}
export function parseHistoricalPack(value:unknown,manifest:HistoricalPackManifest,symbols:string[]):Record<string,BtcCandle[]>{
 if(!object(value)||value.schema!=="disdex-historical-symbol-candle-pack/v1"||
    value.period_start_inclusive!==manifest.period_start_inclusive||
    value.period_end_exclusive!==manifest.period_end_exclusive||
    value.venue!==manifest.source_venue||
    value.mode!=="READ_ONLY_RESEARCH_DATA_NOT_TRADE_CERTIFIED"||
    !object(value.symbolCandles)||!object(value.coverage))
  throw new Error("INVALID_H1_PACK");
 if(Object.keys(value.symbolCandles).length!==symbols.length||
    Object.keys(value.coverage).length!==symbols.length)
  throw new Error("H1_PACK_SYMBOL_COUNT_MISMATCH");
 const parsed:Record<string,BtcCandle[]>={};
 for(const s of symbols){
  const bars=value.symbolCandles[s];
  if(!Array.isArray(bars)||bars.length!==manifest.source_coverage[s].bars||
     bars.length>10000||JSON.stringify(value.coverage[s])!==JSON.stringify(manifest.source_coverage[s]))
   throw new Error("H1_PACK_SOURCE_COVERAGE_MISMATCH: "+s);
  let prev="";
  for(const bar of bars){
   if(!candle(bar)||bar.time<=prev||
     bar.time<manifest.period_start_inclusive||
     bar.closedAt>manifest.period_end_exclusive)
    throw new Error("H1_PACK_CANDLE_INVALID: "+s);
   prev=bar.time;
  }
  parsed[s]=bars as BtcCandle[];
 }
 return parsed;
}
export function attachHistoricalCandles(replay:Replay,manifest:HistoricalPackManifest,candles:Record<string,BtcCandle[]>):Replay{
 if(replay.mode!=="EXTERNAL"||
    !["HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION","HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED"].includes(replay.source?.kind??"")||
    replay.source?.btcCandlesSha256!==manifest.source_coverage.BTCUSDT.source_gzip_sha256||
    !candles.BTCUSDT)
   throw new Error("REPLAY_MARKET_SHA_OR_MODE_MISMATCH");
 return {...replay,symbolCandles:candles};
}