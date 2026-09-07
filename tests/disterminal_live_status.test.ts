import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.cwd();

async function source(path: string) {
  return readFile(resolve(root, path), "utf8");
}

test("HP live API no longer evaluates legacy RETQ22/Reclaim Hybrid", async () => {
  const route = await source("app/api/system/auto-trade/live-decision/route.ts");
  assert.doesNotMatch(route, /evaluateLiveHybridDecisionState|live-hybrid-autotrade|RETQ22/);
  assert.match(route, /readDisTerminalLiveStatus/);
});

test("LiveDecisionPanel polls actual LIVE status every 3 minutes", async () => {
  const panel = await source("components/features/autotrade/LiveDecisionPanel.tsx");
  assert.match(panel, /\/api\/system\/auto-trade\/live-decision/);
  assert.match(panel, /180_000|180000/);
  assert.doesNotMatch(panel, /60000/);
});
test("read-only LIVE status summarizes V12/PENGU/V52/Q102 daemon state", async () => {
  const modulePath = resolve(root, "lib/disterminal-live-status.ts");
  assert.equal(existsSync(modulePath), true, "LIVE status reader must exist");
  const { readDisTerminalLiveStatus } = await import(pathToFileURL(modulePath).href);
  const dir = await mkdtemp(join(tmpdir(), "disterminal-live-"));
  const now = 1_800_000_000_000;
  const paths = {
    v12: join(dir, "v12.json"), pengu: join(dir, "pengu.json"),
    v52: join(dir, "v52.json"), q102: join(dir, "q102.json"),
    kill: join(dir, "kill.json"), risk: join(dir, "risk.json"), lock: join(dir, "lock.json"),
  };
  await writeFile(paths.v12, JSON.stringify({ mode: "LIVE", updatedAt: now, active: { symbol: "ETHUSDT", side: "LONG", gross: 1 } }));
  await writeFile(paths.pengu, JSON.stringify({ mode: "LIVE", updatedAt: now, latestSignal: { action: "WAIT", side: -1, reason: "setup" } }));
  await writeFile(paths.v52, JSON.stringify({ updatedAt: now, positions: {}, pendingOrder: null }));
  await writeFile(paths.q102, JSON.stringify({ mode: "LIVE", updatedAt: now, runtimeCommitSha: "a".repeat(40), position: { symbol: "FETUSDT", side: -1 } }));
  await writeFile(paths.kill, JSON.stringify({ active: false }));
  await writeFile(paths.risk, JSON.stringify({ schema: "disdex-shared-crypto-daily-risk/v1", accountScope: "ASTER_FUTURES", utcDay: "2027-01-15", strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"], lossPct: 0, maximumLossPct: 7.5, tripped: false, updatedAt: now }));  const env = {
    DISDEX_HP_V12_STATE_PATH: paths.v12,
    DISDEX_HP_PENGU_STATE_PATH: paths.pengu,
    DISDEX_HP_V52_STATE_PATH: paths.v52,
    DISDEX_HP_Q102_STATE_PATH: paths.q102,
    DISDEX_HP_KILL_SWITCH_PATH: paths.kill,
    DISDEX_HP_DAILY_RISK_PATH: paths.risk,
    DISDEX_HP_ACCOUNT_LOCK_PATH: paths.lock,
    DISDEX_RELEASE_SHA: "f".repeat(40),
    V12_X1_ALL_MODE: "LIVE", V12_X1_ALL_ENABLED: "true",
    PENGU_DUAL_LS_V2_MODE: "LIVE", PENGU_DUAL_LS_V2_ENABLED: "true",
    QUALITY102_CAUSAL_V1_MODE: "LIVE", QUALITY102_CAUSAL_V1_ENABLED: "true",
    QUALITY102_CAUSAL_V1_SELECTOR_MODE: "CAUSAL_V4",
  } as unknown as NodeJS.ProcessEnv;
  const status = await readDisTerminalLiveStatus(env, now);
  assert.equal(status.source, "DAEMON_STATE_READ_ONLY");
  assert.equal(status.refreshIntervalMs, 180_000);
  assert.equal(status.deployedSha, "f".repeat(40));
  assert.equal(status.strategies.find((row: any) => row.id === "V12")?.decision, "LONG");
  assert.equal(status.strategies.find((row: any) => row.id === "Q102")?.decision, "SHORT");
  assert.equal(status.strategies.find((row: any) => row.id === "Q102")?.selectorMode, "CAUSAL_V4");  assert.equal(status.risk.killSwitchActive, false);
  assert.equal(status.risk.accountLockStatus, "CLEAR");
  assert.equal(status.risk.cryptoGrossCap, 2);
  assert.equal(status.risk.totalGrossCap, 2.5);
  await rm(dir, { recursive: true, force: true });
});