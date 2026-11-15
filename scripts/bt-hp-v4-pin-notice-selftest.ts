import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
 observedV4MismatchInResearchSource,
 V4_PIN_OBSERVED_2026_11_15,
 V4_MISMATCHED_RESEARCH_CASES,
} from "../lib/bt-verification/source-pin-observation";

const page=readFileSync(join(process.cwd(),"app/bt-verification/page.tsx"),"utf8");
const oldResearch='verifiedResearch?.sourceCase==="STABLE4_OPPORTUNITY_PROD_CAPS_20261114_GROSS_CAPTURE_V1"';
const guard="observedV4MismatchInResearchSource(verifiedResearch?.sourceCase)";
assert.equal(page.split(oldResearch).length-1,1,"Must be one legacy H48 mismatch warning");
assert.equal(page.split(guard).length-1,1,"V4 drift warning is an independent conditional");
const hypeStart=page.indexOf(oldResearch);
const v4Start=page.indexOf(guard,hypeStart);
assert.ok(hypeStart>=0 && v4Start>hypeStart);
const hypeBlock=page.slice(hypeStart,v4Start);
const v4Block=page.slice(v4Start,page.indexOf("</div>}",v4Start));
assert.ok(hypeBlock.includes("HYPE実装差分（確認済み）"));
assert.ok(hypeBlock.includes("H48R4研究5件"));
assert.ok(!hypeBlock.includes("V4登録SHA差分"),"V4 warning must cover more than H48 case");
assert.ok(v4Block.includes("V4登録SHA差分"));
assert.ok(v4Block.includes("2026-11-15"));
assert.ok(v4Block.includes("新V4の実装による統合BT再計算が必要"));
assert.ok(v4Block.includes("LIVE稼働")&&v4Block.includes("実約定")&&v4Block.includes("STOP"));
assert.ok(v4Block.includes("{V4_PIN_OBSERVED_2026_11_15}"));
assert.equal(V4_PIN_OBSERVED_2026_11_15,"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513");
assert.equal(V4_MISMATCHED_RESEARCH_CASES.length,3);
for(const sourceCase of V4_MISMATCHED_RESEARCH_CASES){
 assert.equal(observedV4MismatchInResearchSource(sourceCase),true);
}
for(const sourceCase of [undefined,"UNKNOWN","STABLE4_UNRELATED_RESEARCH",""]){
 assert.equal(observedV4MismatchInResearchSource(sourceCase),false);
}
console.log("BT V4 runtime pin drift alert across 3 research cases PASS (no LIVE certification)");
