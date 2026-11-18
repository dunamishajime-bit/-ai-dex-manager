import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {listResearchReplays} from "../lib/server/bt-research-library";
import {
 buildNativeHypeSensitivityComparison,
 NATIVE_HYPE_SENSITIVITY_SOURCE_CASES,
} from "../lib/bt-verification/native-hype-sensitivity-comparison";

async function main(){
 assert.ok(process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR,
   "Only owner-private, source-hashed research index is supported");
 const items=await listResearchReplays();
 const comparison=buildNativeHypeSensitivityComparison(items);
 assert.ok(comparison,"Requires complete 4-way source-index evidence");
 assert.equal(comparison.rows.length,2);
 assert.equal(comparison.bothPathsMaxDdOver20,true);
 assert.equal(comparison.currentV4SourceReplayed,false);
 assert.equal(comparison.status,"INDEX_ONLY_SENSITIVITY_NOT_VENUE_OR_CAUSAL_PARITY");
 assert.ok(comparison.rows[0].ddDifferencePctPoints>3.5);
 assert.ok(comparison.rows[1].ddDifferencePctPoints>3.6);
 assert.ok(comparison.rows.every(r=>r.native.bps===r.noHype.bps));
 assert.equal(buildNativeHypeSensitivityComparison(items.slice(0,3)),null,
   "Missing one cost case must not show a misleading comparison");
 assert.equal(buildNativeHypeSensitivityComparison([...items,items[0]]),null,
   "Ambiguous duplicate metadata must fail closed");
 const tampered=items.map(x=>({...x,sourceStatus:x.sourceStatus,
   grossCaps:{...x.grossCaps}}));
 tampered[0].grossCaps.crypto=30;
 assert.equal(buildNativeHypeSensitivityComparison(tampered),null,
   "Tampered model Gross caps must suppress comparison");
 const falsified=items.map(x=>({...x}));
 falsified[0].sourceStatus="LIVE_CERTIFIED";
 assert.equal(buildNativeHypeSensitivityComparison(falsified),null,
   "Index must not claim LIVE provenance");
 const other=items.map(x=>({...x}));
 other[0].sourceCase="UNRELATED_SOURCE_CASE";
 assert.equal(buildNativeHypeSensitivityComparison(other),null,
   "No sensitivity comparison if required case missing");
 assert.ok(Object.values(NATIVE_HYPE_SENSITIVITY_SOURCE_CASES).every(
   s=>items.filter(x=>x.sourceCase===s).length===2));
 const page=readFileSync(join(process.cwd(),"app/bt-verification/page.tsx"),"utf8");
 assert.ok(page.includes("<NativeHypeSensitivityPanel comparison={nativeHypeSensitivity}/>"));
 const panel=readFileSync(join(process.cwd(),"components/bt-verification/NativeHypeSensitivityPanel.tsx"),"utf8");
 assert.ok(panel.includes("HYPE停止を推奨するものではありません"));
 assert.ok(panel.includes("再生」選択時に照合"));
 console.log("HYPE native vs no-HYPE owner-private 4-case sensitivity comparison PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1});
