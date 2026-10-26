import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Idle status page exposes separate RENDER routes and fail-closed detail state", async () => {
  const source = await readFile("app/decision-status/idle-priority/page.tsx", "utf8");
  assert.match(source, /RENDER SHORT Dual Route/);
  assert.match(source, /既存 RENDER SHORT/);
  assert.match(source, /独立 RENDER SHORT/);
  assert.match(source, /未取得 \/ 古い \/ SHA不一致/);
  assert.match(source, /Order permission/);
  assert.match(source, /Same-symbol owner/);
});
