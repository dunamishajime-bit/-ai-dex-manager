import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  LOGIC_ROLES, buildLiveLogicSnapshot, parseSystemdShow, validateManifestRole,
} from "../lib/server/current-live-logic-catalog";

const ids = Object.keys(LOGIC_ROLES) as Array<keyof typeof LOGIC_ROLES>;
const pins = Object.fromEntries(ids.map((id, index) => {
  const sha = (index + 1).toString(16).repeat(40);
  return [id, {
    sha,
    serviceUnit: "disdex-test-" + id.toLowerCase().replaceAll("_", "-") + "@" + sha + ".service",
    releaseRoot: "/home/deploy/disdex-trading/releases/" + sha,
  }];
})) as Record<string, { sha: string; serviceUnit: string; releaseRoot: string }>;

function fixture(opts: { stopped?: string[]; missingCert?: boolean; brokenHeartbeat?: string[] } = {}) {
  const now = 1794958000000;
  return {
    now: () => now,
    readText: async (path: string) => {
      if (path === "/etc/disdex/runner-pins.json") {
        return JSON.stringify({
          schema: "disdex-runner-pin-manifest/v1", target: "professional-dismanager.net", runners: pins,
        });
      }
      if (path === "/var/lib/disdex/shared/kill-switch.json") {
        return JSON.stringify({ active: true, action: "HOLD_PROTECTED", scope: "GLOBAL", reason: "STABLE4_RESEARCH_ROLLOUT" });
      }
      const hypeSha = pins.HYPE_TREND_LONG.sha;
      if (path === "/etc/disdex/stable4/h48-time-only/" + hypeSha + ".json" && !opts.missingCert) {
        return JSON.stringify({ approvedSha: hypeSha, policy: "H48_TIME_ONLY", operatorAcknowledgement: "H48_TIME_ONLY" });
      }
      for (const [id, cfg] of Object.entries(LOGIC_ROLES)) {
        if (cfg.heartbeat === path) {
          if (opts.brokenHeartbeat?.includes(id)) throw new Error("unreadable");
          return JSON.stringify({
            runtimeSha: id === "HYPE_TREND_LONG" ? "f".repeat(40) : pins[id].sha,
            heartbeatAt: now - 12000,
            safetyState: id === "QUALITY102_CAUSAL_V1" ? "BLOCKED" : "PASS",
            healthReason: "STABLE4_RESEARCH_ROLLOUT",
            lastEvaluationReason: id === "FET_BRK48_RESIDUAL" ? "FET_NO_BRK48_SIGNAL" : undefined,
          });
        }
      }
      throw new Error("unexpected path: " + path);
    },
    showService: async (unit: string) => {
      const [id, row] = Object.entries(pins).find(([, value]) => value.serviceUnit === unit) || [];
      if (!id || !row) throw new Error("unexpected service");
      const running = !opts.stopped?.includes(id);
      const pid = ids.indexOf(id as keyof typeof LOGIC_ROLES) + 101;
      return {
        stdout: "ActiveState=" + (running ? "active" : "inactive") + "\nMainPID=" + (running ? pid : 0) +
          "\nWorkingDirectory=" + row.releaseRoot + "\n",
        stderr: "",
      };
    },
    readProcessCwd: async (pid: number) => pins[ids[pid - 101]].releaseRoot,
  };
}

test("systemd inspection parses service lifecycle without treating a name as proof", () => {
  assert.deepEqual(parseSystemdShow("ActiveState=active\nMainPID=123\nWorkingDirectory=/x\n"), {
    active: true, pid: 123, workingDirectory: "/x",
  });
  assert.equal(parseSystemdShow("ActiveState=inactive\nMainPID=0\n").pid, 0);
});

test("the pin is exact and rejects an injected/mismatched unit", () => {
  const row = pins.V12_V4;
  assert.equal(validateManifestRole("V12_V4", row).sha, row.sha);
  assert.throws(() => validateManifestRole("V12_V4", { ...row, serviceUnit: "sh -c evil" }));
  assert.throws(() => validateManifestRole("V12_V4", { ...row, releaseRoot: "/tmp/other" }));
  assert.throws(() => validateManifestRole("V12_V4", { ...row, sha: "0" }));
});

test("all pin roles are displayed with process, signal, and global HOLD separately", async () => {
  const result = await buildLiveLogicSnapshot(fixture({ stopped: ["PENGU_V8"] }));
  assert.equal(result.rows.length, ids.length);
  assert.equal(result.safety.holdActive, true);
  assert.equal(result.rows.find((x) => x.id === "PENGU_V8")?.serviceState, "STOPPED");
  assert.equal(result.rows.find((x) => x.id === "QUALITY102_CAUSAL_V1")?.safetyState, "BLOCKED");
  assert.equal(result.rows.find((x) => x.id === "FET_BRK48_RESIDUAL")?.decisionDetail, "FET_NO_BRK48_SIGNAL");
  assert.equal(result.tradingMutation, 0);
});

test("HYPE uses exact Root H48 cert but stale heartbeat SHA is shown as mismatch", async () => {
  const result = await buildLiveLogicSnapshot(fixture());
  const hype = result.rows.find((x) => x.id === "HYPE_TREND_LONG");
  assert.equal(hype?.serviceState, "RUNNING");
  assert.match(hype?.policy || "", /H48_TIME_ONLY/);
  assert.match(hype?.mismatchReason || "", /heartbeat SHA不一致/);
  assert.equal(hype?.heartbeatFresh, true);
});

test("a missing H48 certificate never creates a guessed policy", async () => {
  const result = await buildLiveLogicSnapshot(fixture({ missingCert: true }));
  assert.equal(result.rows.find((x) => x.id === "HYPE_TREND_LONG")?.policy, undefined);
});

test("missing heartbeat stays visible, and corrupted manifest fails closed", async () => {
  const result = await buildLiveLogicSnapshot(fixture({ brokenHeartbeat: ["IDLE_PRIORITY_SHORT"] }));
  assert.equal(result.rows.find((x) => x.id === "IDLE_PRIORITY_SHORT")?.heartbeatFresh, false);
  const invalid = fixture();
  await assert.rejects(
    buildLiveLogicSnapshot({ ...invalid, readText: async (path) => path === "/etc/disdex/runner-pins.json" ? "{}" : invalid.readText(path) }),
    /MANIFEST_UNVERIFIED/,
  );
});

test("current logic API is authenticated, no-store and read-only", () => {
  const api = readFileSync("app/api/system/current-logic/route.ts", "utf8");
  assert.match(api, /req\.cookies\.get\("disdex_auth"\)/);
  assert.match(api, /buildLiveLogicSnapshot/);
  assert.match(api, /private, no-store/);
  assert.doesNotMatch(api, /export async function POST/);
});
