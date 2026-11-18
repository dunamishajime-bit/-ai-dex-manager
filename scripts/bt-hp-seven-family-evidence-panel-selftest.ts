import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {verifySavedSevenFamilySourceEvidence,SOURCE_FAMILIES}
 from "../lib/bt-verification/source-observation-evidence";
import {SevenFamilyObservationEvidencePanel}
 from "../components/bt-verification/SevenFamilyObservationEvidencePanel";

const e=verifySavedSevenFamilySourceEvidence();
assert.equal(e.total,8260);
assert.equal(e.candidates,54);
assert.equal(e.featureOnly,8206);
assert.equal(e.entryVerified,0);
assert.equal(e.orders,0);
assert.equal(e.fills,0);
assert.equal(e.version,"v4");
assert.equal(e.seed,20261115);
assert.equal(e.scenario,"rotation");
assert.equal(e.from,"2025-10-01T00:00:00Z");
assert.equal(e.endExclusive,"2025-10-23T00:00:00Z");
assert.equal(e.familyCounts.length,7);
assert.deepEqual(e.familyCounts.map(x=>x.family),[...SOURCE_FAMILIES]);
assert.equal(e.familyCounts.reduce((sum,x)=>sum+x.observations,0),e.total);
assert.ok(/^[a-f0-9]{64}$/.test(e.sourceLedgerSha256));
assert.ok(/^[a-f0-9]{64}$/.test(e.archiveSha256));
assert.ok(e.archiveRelativePath.endsWith(".json.gz"));

const rendered=renderToStaticMarkup(createElement(SevenFamilyObservationEvidencePanel));
assert.ok(rendered.includes('data-testid="bt481-seven-family-source-evidence"'));
assert.ok(rendered.includes("7系統の共通判定観測台帳"));
assert.ok(rendered.includes("8,260"));
assert.ok(rendered.includes("54"));
assert.ok(rendered.includes("未約定"));
assert.ok(rendered.includes("人工市場"));
assert.ok(rendered.includes(e.sourceLedgerSha256));
for(const f of SOURCE_FAMILIES)assert.ok(rendered.includes(f),f);
assert.ok(rendered.includes('data-testid="bt481-seven-family-detail"'));
assert.ok(!rendered.includes("LIVE稼働確認済"));
assert.ok(!rendered.includes("実約定あり"));

const page=readFileSync("app/bt-verification/page.tsx","utf8");
assert.ok(page.includes('import {SevenFamilyObservationEvidencePanel}'));
assert.equal(page.split("<SevenFamilyObservationEvidencePanel />").length,2);
assert.ok(page.includes('syntheticStrategy==="h48multi"'));
assert.ok(page.includes('syntheticFeedVersion==="v4"'));
console.log("PASS BT-481-H3 static source-evidence panel: 8260 read-only observations, 54 unfilled candidates, 0 orders, clear fixed artificial provenance");
