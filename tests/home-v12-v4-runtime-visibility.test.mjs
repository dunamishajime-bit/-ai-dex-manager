import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

test("ホームページはV12 runtime専用のLIVE状態表示を持たない", async () => {
  const home = await readFile(join(process.cwd(), "app/page.tsx"), "utf8");

  assert.doesNotMatch(home, /useLiveStatus/);
  assert.doesNotMatch(home, /liveStatus/);
});

test("共通runtimeバッジはホームではV12項目を隠し、他ページでは維持する", async () => {
  const badge = await readFile(join(process.cwd(), "components/layout/LiveRuntimeBadge.tsx"), "utf8");

  assert.match(badge, /usePathname/);
  assert.match(badge, /hideV12/);
  assert.match(badge, /PENGU/);
  assert.match(badge, /QUALITY102_CAUSAL_V1/);
});
