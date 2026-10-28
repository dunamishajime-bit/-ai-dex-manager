import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("decision-status cards expose runner-scoped Q102 and V52 release SHAs", async () => {
  const source = await readFile("app/api/system/decision-status/route.ts", "utf8");

  assert.match(source, /QUALITY102_CAUSAL_V1.*releaseSha: quality102Runtime\.runtimeSha/s);
  assert.match(source, /!snapshot\.v52\.marketOpen.*releaseSha: v52Top2Observability\.runtimeSha/s);
  assert.match(source, /v52Top2Observability\.runtimeSha.*status: v52Top2Observability\.status/s);
});

test("V52 read-only observability derives its runtime SHA from the scoped state", async () => {
  const source = await readFile("lib/server/v52-top2-observability.ts", "utf8");

  assert.match(source, /runtimeSha\?: string/);
  assert.match(source, /const runtimeSha = text\(state\.runtimeSha \?\? state\.runtimeCommitSha\)/);
});
