import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();

test("PENGU HP liveness uses a fresh healthy heartbeat instead of stale no-mutation state age", async () => {
  const route = await readFile(resolve(root, "app/api/system/decision-status/route.ts"), "utf8");

  assert.match(route, /penguHeartbeat\.status === "LIVE"/);
  assert.match(route, /penguRuntime\.killSwitchActive === true/);
  assert.match(route, /penguRuntime\.sharedRisk\?\.tripped === true/);
  assert.match(route, /penguRuntime\.mode[\s\S]*toLowerCase\(\)[\s\S]*!== "live"/);
  assert.match(route, /penguHeartbeatLive[\s\S]*!penguSafetyBlocked[\s\S]*\? "LIVE" : penguRuntime\.status/);
  assert.match(route, /penguRuntime:\s*penguRuntimeDisplay/);
});
