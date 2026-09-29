import {createHash} from "node:crypto";import {readFileSync} from "node:fs";
type Row=Record<string,string>;
function csv(p:string){const b=readFileSync(p),s=b.toString("utf8").replace(/\r/g,""),ls=s.split("\n").filter(Boolean),h=ls[0].split(",");return {bytes:b,rows:ls.slice(1).map(l=>Object.fromEntries(l.split(",").map((v,i)=>[h[i],v])) as Row)}}
const [filteredPath,ledgerPath]=process.argv.slice(2);if(!filteredPath||!ledgerPath)throw new Error("USAGE filtered.csv integrated-ledger.csv");
const f=csv(filteredPath),l=csv(ledgerPath);const sha=createHash("sha256").update(f.bytes).digest("hex");
if(sha!=="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48"||f.rows.length!==63)throw new Error("FILTERED_EVIDENCE_IDENTITY_FAIL");
const idle=l.rows.filter(r=>(r.strategy||r.family)==="IDLE_PRIORITY_SHORT");
if(idle.length!==61)throw new Error("IDLE_INTEGRATED_COUNT_MISMATCH:"+idle.length);
const counts:Record<string,number>={},wins:Record<string,number>={};for(const r of idle){const s=(r.symbol||"").replace("USDT","");counts[s]=(counts[s]||0)+1;const pnl=Number(r.net_return??r.netReturn??r.pnl_return??r.pnlReturn);if(!Number.isFinite(pnl))throw new Error("IDLE_LEDGER_RETURN_MISSING");if(pnl>0)wins[s]=(wins[s]||0)+1}
const expected:any={TAO:[9,8],DOT:[14,11],JUP:[14,11],TIA:[9,7],RENDER:[15,11]};for(const [s,[n,w]] of Object.entries(expected) as any){if(counts[s]!==n||wins[s]!==w)throw new Error(`IDLE_SYMBOL_PARITY_FAIL ${s} ${counts[s]||0}/${wins[s]||0}`)}
const baseline=l.rows.filter(r=>["V12","PENGU","Q102","FET","V52"].includes(r.strategy||r.family));if(baseline.length+idle.length!==l.rows.length)throw new Error("UNEXPECTED_STRATEGY_IN_LEDGER");
console.log(JSON.stringify({status:"PASS",integratedRows:l.rows.length,baselineRows:baseline.length,idleRows:idle.length,wins:Object.values(wins).reduce((a,b)=>a+b,0),losses:61-Object.values(wins).reduce((a,b)=>a+b,0),counts,wins}));
