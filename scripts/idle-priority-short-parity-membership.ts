import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EXPECTED={
 stream:{sha256:"09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb",bytes:149207,rows:495},
 filtered:{sha256:"5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48",bytes:22234,rows:63},
 routes:{DOT_MOMENTUM_SHORT_BTCREL:15,JUP_RELATIVE_SHORT:14,RENDER_RELATIVE_SHORT:15,TAO_BREAKDOWN_SHORT_RELWEAK2:9,TIA_BREAKDOWN_SHORT_VOLCAP100:10},
 archetypes:{BREAKOUT:165,MOMENTUM:118,RELATIVE:212},
} as const;
function csv(path:string){const b=readFileSync(path);const lines=b.toString("utf8").replace(/\r/g,"").trimEnd().split("\n");const h=lines[0].split(",");return {b,h,rows:lines.slice(1).map(x=>{const c=x.split(",");return Object.fromEntries(h.map((k,i)=>[k,c[i]]));})};}
function assertFile(name:string,x:ReturnType<typeof csv>,e:{sha256:string;bytes:number;rows:number}){const sha=createHash("sha256").update(x.b).digest("hex");if(sha!==e.sha256||x.b.length!==e.bytes||x.rows.length!==e.rows)throw new Error(`${name}_IDENTITY_MISMATCH sha=${sha} bytes=${x.b.length} rows=${x.rows.length}`);}
const [streamPath,filteredPath]=process.argv.slice(2);if(!streamPath||!filteredPath)throw new Error("USAGE: tsx scripts/idle-priority-short-parity-membership.ts <events.csv> <filtered.csv>");
const s=csv(streamPath),f=csv(filteredPath);assertFile("STREAM",s,EXPECTED.stream);assertFile("FILTERED",f,EXPECTED.filtered);
const ac:Record<string,number>={},rc:Record<string,number>={};for(const r of s.rows)ac[r.archetype]=(ac[r.archetype]||0)+1;for(const r of f.rows)rc[r.route]=(rc[r.route]||0)+1;
for(const [k,v] of Object.entries(EXPECTED.archetypes))if(ac[k]!==v)throw new Error(`ARCHETYPE_COUNT_MISMATCH ${k}`);
for(const [k,v] of Object.entries(EXPECTED.routes))if(rc[k]!==v)throw new Error(`ROUTE_COUNT_MISMATCH ${k}`);
const keys=new Set(s.rows.map(r=>[r.symbol,r.t,r.archetype].join("|")));const missing=f.rows.filter(r=>!keys.has([r.symbol,r.t,r.archetype].join("|")));if(missing.length)throw new Error(`FILTERED_NOT_SUBSET missing=${missing.length}`);
console.log(JSON.stringify({status:"PASS",streamRows:s.rows.length,filteredRows:f.rows.length,missing:0,archetypes:ac,routes:rc}));
