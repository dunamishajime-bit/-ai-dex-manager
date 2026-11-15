import assert from "node:assert/strict";
import {createH48ResearchReplay} from "../lib/bt-verification/h48-research-sandbox";
import {buildPrintableBtReport} from "../lib/bt-verification/print-report";

const data=createH48ResearchReplay(123456,"trend",10);
const title='Demo"><script>alert(1)</script>&';
const html=buildPrintableBtReport(data,title,"人工市場 <H48>",null);
assert.ok(html.startsWith("<!doctype html>"));
assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
assert.ok(!html.includes("<script>alert(1)</script>"),"Escaped names must never inject HTML");
assert.ok(html.includes("H48R4_RESEARCH_ENTRY_SYNTHETIC_SINGLE_SLEEVE"));
assert.ok(html.includes("人工市場のモデル結果"));
assert.ok(html.includes("Gross"));
assert.ok(html.includes("PDF"));
assert.ok(html.includes("Crypto"));
const bad=structuredClone(data) as unknown as typeof data;
bad.frames[0].equity=Number.NaN;
assert.throws(()=>buildPrintableBtReport(bad,"bad","bad"),/Invalid BT replay/);
const research=buildPrintableBtReport(data,"research","研究データ",{
 sourceCase:"STABLE4 & <test>",bps:10,sha256:"a".repeat(64),sourceStatus:"RESEARCH_ONLY"
});
assert.ok(research.includes("STABLE4 &amp; &lt;test&gt;"));
assert.ok(research.includes("a".repeat(64)));
assert.ok(research.includes("研究モデル純損益"));
console.log("PASS PDF-print report HTML escape, model/account data, provenance and fail-closed input");
