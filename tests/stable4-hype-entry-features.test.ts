import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";
import {stable4HypeEntryFeatures} from "../lib/stable4-hype-entry-features";
const H=3600000,T=1800000000000;
test("causal HYPE feature window excludes future bars and rejects duplicate/missing candles",()=>{
 const rows=Array.from({length:73},(_,i)=>({ts:T-(73-i)*H,open:100+i,high:101+i,low:99+i,close:100+i})),btc=rows.slice(-25);
 const f=stable4HypeEntryFeatures(rows,btc,T);assert.equal(f.h72,172/100-1);assert.equal(f.er24,1);
 assert.deepEqual(stable4HypeEntryFeatures([...rows,{...rows[0],ts:T,close:999}],btc,T),f);
 assert.throws(()=>stable4HypeEntryFeatures(rows.slice(1),btc,T),/COVERAGE/);
 assert.throws(()=>stable4HypeEntryFeatures([...rows,rows[0]],btc,T),/COVERAGE/);
});
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001",reference=join(root,"DIRECTION_RESEARCH_20261109/hype_causal_nextopen_fromscratch_v1_20261113.json");
test("every selected H48 research feature vector matches original public bars",{skip:!existsSync(reference)},()=>{
 const parse=(symbol:string)=>gunzipSync(readFileSync(join(root,`aster-public-v3-h1/${symbol}-1h-20250924-20261001.jsonl.gz`))).toString().trim().split(/\r?\n/).map(l=>{const x=JSON.parse(l);return{ts:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4]};});
 const hype=parse("HYPEUSDT"),btc=parse("BTCUSDT"),d=JSON.parse(readFileSync(reference,"utf8")),rows=d.results.find((x:any)=>x.horizon===48).topPretargetSelected[3].targetRows;
 assert.equal(rows.length,62);
 for(const row of rows){const got=stable4HypeEntryFeatures(hype,btc,row.entryTs);for(const [k,v]of Object.entries(row.features))assert.ok(Math.abs(got[k as keyof typeof got]-(v as number))<1e-12,`${row.entryTs}:${k}`);}
});
