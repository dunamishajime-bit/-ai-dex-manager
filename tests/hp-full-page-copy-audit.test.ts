import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

test("current HP pages contain no obsolete Q102 0.50x copy", () => {
  const files = [...filesUnder("app"), ...filesUnder("components")];
  const offenders = files.filter((path) => /Q102[^\r\n]{0,80}0\.50x|Quality102[^\r\n]{0,80}0\.50x/i.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

test("key HP surfaces advertise Top2, V20+Recovery V8 and Q102 1-slot", () => {
  const home = readFileSync("app/page.tsx", "utf8");
  const positions = readFileSync("app/positions/page.tsx", "utf8");
  const banner = readFileSync("components/layout/LiveProductionBanner.tsx", "utf8");
  for (const source of [home, positions, banner]) {
    assert.match(source, /Top2/);
    assert.match(source, /Recovery V8/);
  }
  assert.match(banner, /1-slot/);
});