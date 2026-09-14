import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Aster account maintenance metrics expose exchange maintenance margin and ratio", async () => {
  const metrics = await import("../lib/server/aster-account-metrics");
  const derive = (metrics as unknown as { deriveAsterMaintenanceMetrics?: Function }).deriveAsterMaintenanceMetrics;
  assert.equal(typeof derive, "function");
  assert.deepEqual(derive?.({ totalMarginBalance: "100", totalMaintMargin: "12.5" }), {
    maintenanceMarginUsd: 12.5,
    marginRatioPct: 12.5,
  });
});

test("position maintenance data uses Aster account position values without guessing", async () => {
  const metrics = await import("../lib/server/aster-account-metrics");
  const derive = (metrics as unknown as { deriveAsterPositionMaintenance?: Function }).deriveAsterPositionMaintenance;
  assert.equal(typeof derive, "function");
  assert.deepEqual(derive?.({ symbol: "DOGEUSDT", positionSide: "BOTH", maintMargin: "0.42", leverage: "5", isolated: false }), {
    maintenanceMarginUsd: 0.42,
    leverage: 5,
    marginType: "cross",
  });
});

test("HP surfaces show maintenance risk and keep it on the account refresh cadence", () => {
  const home = read("app/page.tsx");
  const positions = read("app/positions/page.tsx");
  const hook = read("hooks/useLivePortfolio.ts");
  const route = read("app/api/system/live-portfolio/route.ts");
  const combined = `${home}\n${positions}`;

  assert.match(route, /totalMaintMargin/);
  assert.match(route, /maintMargin/);
  assert.match(route, /leverage/);
  assert.match(route, /marginType/);
  assert.match(combined, /口座維持率/);
  assert.match(combined, /維持証拠金/);
  assert.match(combined, /Cross|cross/);
  assert.match(hook, /setInterval\(\(\) => void refresh\(\), 30_000\)/);
});
