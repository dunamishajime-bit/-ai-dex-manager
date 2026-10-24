import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("documented navigation regression path retains realtime and overflow safeguards", async () => {
  const bottom = await readFile("components/layout/BottomNav.tsx", "utf8");
  assert.match(bottom, /\/realtime/);
  assert.match(bottom, /BOTTOM_NAV_LAYOUT\.overflowClass/);
  assert.match(bottom, /BOTTOM_NAV_LAYOUT\.itemMinWidthClass/);
  const contract = await readFile("components/layout/bottom-nav-contract.ts", "utf8");
  assert.match(contract, /overflowClass: "overflow-x-auto"/);
  assert.match(contract, /itemMinWidthClass: "min-w-\[58px\]"/);
});
