import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const STREAM_SHA="09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb";
const FILTERED_SHA="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48";
const ROUTES:Record<string,{symbol:string;archetype:string;count:number;hold:number}> = {
 DOT_MOMENTUM_SHORT_BTCREL:{symbol:"DOTUSDT",archetype:"MOMENTUM",count:15,hold:24},
 JUP_RELATIVE_SHORT:{symbol:"JUPUSDT",archetype:"RELATIVE",count:14,hold:12},
 RENDER_RELATIVE_SHORT:{symbol:"RENDERUSDT",archetype:"RELATIVE",count:15,hold:12},
 TAO_BREAKDOWN_SHORT_RELWEAK2:{symbol:"TAOUSDT",archetype:"BREAKOUT",count:9,hold:12},
 TIA_BREAKDOWN_SHORT_VOLCAP100:{symbol:"TIAUSDT",archetype:"BREAKOUT",count:10,hold:24},
};
function csv(path:string){const b=readFileSync(path);const lines=b.toString("utf8").replace(/\r/g,"").trim().split("\n");const h=lines[0].split(",");return {b,rows:lines.slice(1).map(l=>Object.fromEntries(l.split(",").map((v,i)=>[h[i],v])))};}
function routeFromRaw(r:Record<string,string>){
 const symbol=r.symbol; const archetype=r.archetype; const side=r.side;
 const rel24=Number(r.rel24); const ret24=Number(r.ret24); const vol=Number(r.vol_ratio);
 const btc24=ret24-rel24;
 if(side!=="SHORT") return undefined;
 if(symbol==="TAOUSDT"&&archetype==="BREAKOUT"&&rel24<=-0.02) return "TAO_BREAKDOWN_SHORT_RELWEAK2";
 if(symbol==="TIAUSDT"&&archetype==="BREAKOUT"&&vol<=100) return "TIA_BREAKDOWN_SHORT_VOLCAP100";
 if(symbol==="DOTUSDT"&&archetype==="MOMENTUM"&&btc24<=0&&rel24<=0) return "DOT_MOMENTUM_SHORT_BTCREL";
 if(symbol==="JUPUSDT"&&archetype==="RELATIVE") return "JUP_RELATIVE_SHORT";
 if(symbol==="RENDERUSDT"&&archetype==="RELATIVE") return "RENDER_RELATIVE_SHORT";
 return undefined;
}
const [streamPath,filteredPath]=process.argv.slice(2); if(!streamPath||!filteredPath) throw new Error("USAGE: tsx scripts/idle-priority-short-495-63-parity.ts <idle_candidate_events.csv> <idle_candidate_filtered.csv>");
const s=csv(streamPath),f=csv(filteredPath);
const sh=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
if(sh(s.b)!==STREAM_SHA||s.rows.length!==495) throw new Error("IDLE_495_STREAM_EVIDENCE_MISMATCH");
if(sh(f.b)!==FILTERED_SHA||f.rows.length!==63) throw new Error("IDLE_63_FILTERED_EVIDENCE_MISMATCH");
const key=(r:Record<string,string>)=>[r.symbol,r.t,r.archetype].join("|");
const source=new Set(s.rows.map(key)); const seen=new Set<string>(); const counts:Record<string,number>={};
const causalSelected=s.rows.map(r=>({row:r,route:routeFromRaw(r)})).filter(x=>x.route);
if(causalSelected.length!==63) throw new Error("IDLE_CAUSAL_ROUTE_FILTER_COUNT_MISMATCH:"+causalSelected.length);
const filteredKeys=new Set(f.rows.map(key));
for(const selected of causalSelected){
 if(!filteredKeys.has(key(selected.row))) throw new Error("IDLE_CAUSAL_ROUTE_FILTER_EXTRA:"+key(selected.row));
 const expectedRoute=selected.route;
 const filtered=f.rows.find(r=>key(r)===key(selected.row));
 if(!filtered||filtered.route!==expectedRoute) throw new Error("IDLE_CAUSAL_ROUTE_FILTER_ROUTE_MISMATCH:"+key(selected.row));
}
for(const row of f.rows) if(!causalSelected.some(x=>key(x.row)===key(row))) throw new Error("IDLE_CAUSAL_ROUTE_FILTER_MISSING:"+key(row));
let wins=0,losses=0;
for(const r of f.rows){
 if(!source.has(key(r))) throw new Error("IDLE_FILTERED_ROW_NOT_IN_495:"+key(r));
 if(seen.has(key(r))) throw new Error("IDLE_FILTERED_DUPLICATE:"+key(r)); seen.add(key(r));
 if(r.side!=="SHORT") throw new Error("IDLE_FILTERED_NON_SHORT:"+key(r));
 const c=ROUTES[r.route]; if(!c||r.symbol!==c.symbol||r.archetype!==c.archetype||Number(r.hold_h)!==c.hold) throw new Error("IDLE_ROUTE_CONTRACT_MISMATCH:"+key(r));
 counts[r.route]=(counts[r.route]||0)+1; if(Number(r.target_net)>0)wins++;else losses++;
}
for(const [route,c] of Object.entries(ROUTES)) if(counts[route]!==c.count) throw new Error("IDLE_ROUTE_COUNT_MISMATCH:"+route);
if(wins!==50||losses!==13) throw new Error("IDLE_RAW_OUTCOME_COUNT_MISMATCH");
console.log(JSON.stringify({status:"PASS",candidateRows:s.rows.length,filteredRows:f.rows.length,causalRouteRows:causalSelected.length,rawWins:wins,rawLosses:losses,routeCounts:counts,streamSha256:STREAM_SHA,filteredSha256:FILTERED_SHA}));
