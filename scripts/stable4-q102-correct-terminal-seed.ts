/** Correct one independently proven terminal H1 timestamp and funding label. */
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {modelStable4Q102Outcome} from "../lib/stable4-q102-shadow-outcome";
const dataRoot=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
const index=process.argv.indexOf("--funding-path"),fundingPath=index<0?undefined:process.argv[index+1];if(!fundingPath)throw Error("PUBLIC_FUNDING_EVIDENCE_REQUIRED");
const fundingRaw=readFileSync(fundingPath),funding=JSON.parse(fundingRaw.toString("utf8")),entryTs=1790654400000,exitTs=1790913600000;
if(funding.symbol!=="SUIUSDT"||funding.from!==entryTs||funding.through!==exitTs||funding.source!=="GET /fapi/v3/fundingRate; shared Aster budget"||funding.rows.length!==9)throw Error("TERMINAL_FUNDING_EVIDENCE_CHANGED");
const seedPath="config/stable4/q102-online-recovery-seed-20261114.json",seedRaw=readFileSync(seedPath),seed=JSON.parse(seedRaw.toString("utf8"));
const row=seed.rows.find((x:any)=>x.id==="Q102P_00224");
const alreadyCorrected=row?.exitTs===exitTs&&row.net30===.05809469343850867;
if(!row||row.symbol!=="SUIUSDT"||row.entryTs!==entryTs||!alreadyCorrected&&(row.exitTs!==1790910000000||row.net30!==.05851068483327382))throw Error("FROZEN_TERMINAL_SEED_CHANGED");
const cache=new Map<number,any>();
const add=(z:any)=>cache.set(+z[0],{timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],quoteVolume:+z[7]});
const h1=join(dataRoot,"aster-public-v3-h1-q102-warmup/SUIUSDT-1h-20250301-20261001.jsonl.gz"),supplement=join(dataRoot,"Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110/SUIUSDT-1h-20261001-20261003-supplement.json");
for(const line of gunzipSync(readFileSync(h1)).toString("utf8").trim().split(/\r?\n/))add(JSON.parse(line));for(const z of JSON.parse(readFileSync(supplement,"utf8")))add(z);
const out=modelStable4Q102Outcome({entryTs,entryPrice:1.1156,side:"LONG",family:"HIGH_VOL",hardStop:.1,maxHoldHours:72,exitPolicy:"HIGH_VOL_TRAIL72",now:Math.max(Date.now(),funding.capturedAt),dataThrough:exitTs,fiveMinute:[],hourly:[...cache.values()].filter(b=>b.timestampMs>=entryTs&&b.timestampMs+3600000<=exitTs).sort((a,b)=>a.timestampMs-b.timestampMs),funding:{from:funding.from,through:funding.through,capturedAt:funding.capturedAt,rows:funding.rows.map((x:any)=>({fundingTime:+x.fundingTime,fundingRate:+x.fundingRate}))}});
if(!out||out.exitTs!==exitTs||Math.abs(out.exitPrice-1.1848)>1e-12)throw Error("TERMINAL_CAUSAL_PRICE_PROOF_MISMATCH");
if(alreadyCorrected){
 const recorded=seed.causalCorrections?.find((x:any)=>x.id===row.id);
 if(row.net30!==out.net30||recorded?.publicFundingSha256!==createHash("sha256").update(fundingRaw).digest("hex"))throw Error("CORRECTED_SEED_EVIDENCE_MISMATCH");
 console.log(JSON.stringify({status:"CAUSAL_SEED_CORRECTION_ALREADY_VERIFIED",correction:recorded,outcome:out},null,2));
 process.exit(0);
}
const correction={id:row.id,reason:"Terminal H1 close availability corrected from open timestamp to close timestamp; complete public funding through actual exit",prior:{exitTs:row.exitTs,net30:row.net30},corrected:{exitTs:out.exitTs,net30:out.net30},publicFundingSha256:createHash("sha256").update(fundingRaw).digest("hex"),seedBeforeSha256:createHash("sha256").update(seedRaw).digest("hex"),h1SupplementSha256:createHash("sha256").update(readFileSync(supplement)).digest("hex"),fundingRows:funding.rows.length};
console.log(JSON.stringify({status:process.argv.includes("--apply")?"CAUSAL_SEED_CORRECTION_APPLIED":"CAUSAL_SEED_CORRECTION_DRY_RUN",correction,outcome:out},null,2));
if(process.argv.includes("--apply")){row.exitTs=out.exitTs;row.net30=out.net30;seed.causalCorrections=[...(seed.causalCorrections??[]),correction];writeFileSync(seedPath,JSON.stringify(seed)+"\n");}
