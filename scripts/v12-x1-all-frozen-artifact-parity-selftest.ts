import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

async function main() {
const artifact = JSON.parse(await readFile("docs/research-results/v12-v52-pengu-v2-combined-latest.json", "utf8")) as { status: string; sourceLineage: { v12Sha: string }; variantSummary: Array<Record<string, unknown>>; safety: { ordersSent: boolean; liveChanged: boolean; vpsChanged: boolean } };
assert.equal(artifact.status, "PASS_RESEARCH_ONLY");
assert.equal(artifact.sourceLineage.v12Sha, V12_X1_ALL.sourceSha);
const row = artifact.variantSummary.find((item) => item.variantId === "V12_X1.00_ALL");
assert.ok(row);
assert.equal(row.v12Multiplier, 1);
assert.equal(row.entryPolicy, "ALL");
assert.ok(Math.abs(Number(row.normalReturnPct) - 889.7947479) < 1e-7);
assert.ok(Math.abs(Number(row.normalPf) - 3.30648586) < 1e-7);
assert.ok(Math.abs(Number(row.severeReturnPct) - 189.4743864) < 1e-7);
assert.equal(artifact.safety.ordersSent, false);
assert.equal(artifact.safety.liveChanged, false);
assert.equal(artifact.safety.vpsChanged, false);
console.log("V12_X1_ALL_FROZEN_ARTIFACT_PARITY_SELFTEST_PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
