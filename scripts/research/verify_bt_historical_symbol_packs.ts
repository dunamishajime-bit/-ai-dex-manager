/** Offline source coverage audit for owner-local Aster H1 packs. No network, no LIVE. */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {parseHistoricalPackManifest,parseHistoricalPack} from "../../lib/bt-verification/historical-symbol-pack";
const folder=process.argv[2];
if(!folder)throw new Error("USAGE: tsx scripts/research/verify_bt_historical_symbol_packs.ts <private-h1-dir>");
const raw=JSON.parse(readFileSync(join(folder,"ASTER_H1_MANIFEST_UNCERTIFIED.json"),"utf8"));
const manifest=parseHistoricalPackManifest(raw);
const all=new Set<string>();
let bars=0;
for(const entry of manifest.packs){
 const data=readFileSync(join(folder,entry.file));
 if(data.length!==entry.bytes)throw new Error("H1_FILE_SIZE_MISMATCH");
 const hash=createHash("sha256").update(data).digest("hex");
 if(hash!==entry.sha256)throw new Error("H1_SHA256_MISMATCH");
 const candles=parseHistoricalPack(JSON.parse(data.toString("utf8")),manifest,entry.symbols);
 for(const [symbol,source] of Object.entries(candles)){
  if(all.has(symbol))throw new Error("DUPLICATE_SYMBOL");
  all.add(symbol);bars+=source.length;
 }
}
if(all.size!==manifest.found_symbols.length||all.size!==31)
 throw new Error("H1_SOURCE_SYMBOL_MISMATCH");
const incomplete=Object.entries(manifest.source_coverage)
 .filter(([,coverage])=>!coverage.complete_h1_period).map(([symbol,value])=>
  ({symbol,missingHourCount:value.missing_hour_count}));
console.log(JSON.stringify({status:"PASS_H1_PACK_INTEGRITY_NOT_LIVE_CERTIFIED",
 symbols:all.size,bars,files:manifest.packs.length,
 completeSymbols:all.size-incomplete.length,incomplete},null,2));