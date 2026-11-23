import {createHash} from "node:crypto";import {readFileSync} from "node:fs";
const EXPECTED_SHA="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48";
type R=Record<string,string>;
function csv(p:string){const b=readFileSync(p),ls=b.toString("utf8").replace(/\r/g,"").trim().split("\n"),h=ls[0].split(",");return {b,rows:ls.slice(1).map(l=>Object.fromEntries(l.split(",").map((v,i)=>[h[i],v])) as R)}}
const p=process.argv[2];if(!p)throw new Error("USAGE filtered.csv");const x=csv(p);
if(createHash("sha256").update(x.b).digest("hex")!==EXPECTED_SHA||x.rows.length!==63)throw new Error("FILTERED_EVIDENCE_MISMATCH");
const rows=[...x.rows].sort((a,b)=>Number(a.t)-Number(b.t)||a.symbol.localeCompare(b.symbol));
const active=new Map<string,{entry:number;exit:number}>();const admitted:R[]=[];const rejected:any[]=[];
for(const r of rows){const t=Number(r.t),hold=Number(r.hold_h);for(const [s,p] of [...active])if(p.exit<=t)active.delete(s);
 const prior=active.get(r.symbol);if(prior){rejected.push({symbol:r.symbol,t,reason:"IDLE_SAME_SYMBOL_ACTIVE",blocking_entry_t:prior.entry,blocking_exit_t:prior.exit,target_net:Number(r.target_net)});continue;}
 admitted.push(r);active.set(r.symbol,{entry:t,exit:t+hold*3600000});}
const expectedRejects=[
 {symbol:"DOTUSDT",t:1780318800000,blocking_entry_t:1780246800000,blocking_exit_t:1780333200000},
 {symbol:"TIAUSDT",t:1784250000000,blocking_entry_t:1784206800000,blocking_exit_t:1784293200000},
];
if(admitted.length!==61||rejected.length!==2)throw new Error(`IDLE_63_61_COUNT_FAIL ${admitted.length}/${rejected.length}`);
for(let i=0;i<2;i++)for(const k of ["symbol","t","blocking_entry_t","blocking_exit_t"] as const)if(rejected[i][k]!==expectedRejects[i][k])throw new Error("IDLE_63_61_REJECT_IDENTITY_FAIL:"+JSON.stringify(rejected));
const wins=admitted.filter(r=>Number(r.target_net)>0).length,losses=admitted.length-wins;
if(wins!==48||losses!==13)throw new Error(`IDLE_63_61_OUTCOME_COUNT_FAIL ${wins}/${losses}`);
const counts:Record<string,number>={};for(const r of admitted)counts[r.symbol]=(counts[r.symbol]||0)+1;
const exp:Record<string,number>={DOTUSDT:14,JUPUSDT:14,RENDERUSDT:15,TAOUSDT:9,TIAUSDT:9};
for(const [s,n] of Object.entries(exp))if(counts[s]!==n)throw new Error("IDLE_63_61_SYMBOL_COUNT_FAIL:"+s);
console.log(JSON.stringify({status:"PASS",input:63,admitted:61,rejected,wins,losses,symbolCounts:counts}));
