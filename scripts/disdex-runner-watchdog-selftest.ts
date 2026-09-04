import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    writeRunnerHeartbeat,
    type RunnerHeartbeat,
    type RunnerId,
} from "../lib/disdex-runner-health";
import {
    createProductionWatchdogSystem,
    runWatchdog,
    type RunnerWatchdogConfig,
    type RunnerWatchdogSystem,
} from "./disdex-runner-watchdog";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const RUNNERS: RunnerId[] = ["V12", "PENGU_V8", "V52", "QUALITY102_CAUSAL_V1"];
const UNITS: Record<RunnerId, string> = {
    V12: `disdex-v12-x1-all@${SHA}.service`,
    PENGU_V8: "disdex-v96-v52-live.service",
    V52: "disdex-v96-v52-live.service",
    QUALITY102_CAUSAL_V1: `disdex-quality102-causal-v1@${SHA}.service`,
};
const HEARTBEAT_FILES: Record<RunnerId, string> = {
    V12: "v12.json",
    PENGU_V8: "pengu-v8.json",
    V52: "v52.json",
    QUALITY102_CAUSAL_V1: "quality102-causal-v1.json",
};

class FakeWatchdogSystem implements RunnerWatchdogSystem {
    readonly calls: string[] = [];
    readonly restartCalls: string[] = [];
    readonly active = new Map<string, boolean>();
    readonly pids = new Map<string, number>();
    readonly cwds = new Map<number, string | undefined>();
    readonly commands = new Map<number, string | undefined>();

    async isActive(unit: string): Promise<boolean> {
        this.calls.push(`isActive:${unit}`);
        return this.active.get(unit) ?? false;
    }

    async mainPid(unit: string): Promise<number> {
        this.calls.push(`mainPid:${unit}`);
        return this.pids.get(unit) ?? 0;
    }

    async processCwd(pid: number): Promise<string | undefined> {
        this.calls.push(`processCwd:${pid}`);
        return this.cwds.get(pid);
    }

    async processCommand(pid: number): Promise<string | undefined> {
        this.calls.push(`processCommand:${pid}`);
        return this.commands.get(pid);
    }

    async restart(unit: string): Promise<void> {
        this.calls.push(`restart:${unit}`);
        this.restartCalls.push(unit);
    }
}

function makeConfig(root: string): RunnerWatchdogConfig {
    const runners = {} as Record<RunnerId, RunnerWatchdogConfig["runners"][RunnerId]>;
    for (const runnerId of RUNNERS) {
        runners[runnerId] = {
            runnerId,
            serviceUnit: UNITS[runnerId],
            heartbeatPath: join(root, HEARTBEAT_FILES[runnerId]),
            expectedCwd: root,
            expectedSha: SHA,
            intentionalStopMarkerPath: join(root, `${runnerId.toLowerCase()}.intentional-stop`),
        };
    }
    return {
        healthRoot: root,
        runners,
        heartbeatTimeoutMs: 300_000,
        attemptWindowMs: 1_800_000,
        maxAttempts: 3,
        backoffMs: [15_000, 60_000, 300_000],
        auditPath: join(root, "watchdog-audit.json"),
        statePath: join(root, "watchdog-state.json"),
    };
}

function makeHeartbeat(runnerId: RunnerId, now: number, overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    return {
        schema: "disdex-runner-heartbeat/v1",
        runnerId,
        serviceUnit: UNITS[runnerId],
        runtimeSha: SHA,
        expectedSha: SHA,
        workingDirectory: "",
        mode: "LIVE",
        liveEnabled: true,
        safetyState: "LIVE",
        heartbeatAt: now,
        lastTickAt: now,
        lastReconciliationAt: now,
        lastDecision: "NOOP",
        reason: "healthy",
        symbols: [],
        caps: runnerId === "QUALITY102_CAUSAL_V1"
            ? { strategy: 0.5, crypto: 2, total: 2.5 }
            : { strategy: 1.5, crypto: 2, total: 2.5 },
        restartAttempts: 0,
        updatedAt: now,
        ...(runnerId === "QUALITY102_CAUSAL_V1" ? {
            quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
        } : {}),
        ...overrides,
    };
}

function makeSystem(root: string): FakeWatchdogSystem {
    const system = new FakeWatchdogSystem();
    const sharedPid = 501;
    const pids: Record<RunnerId, number> = { V12: 502, PENGU_V8: sharedPid, V52: sharedPid, QUALITY102_CAUSAL_V1: 503 };
    const commands: Record<RunnerId, string> = {
        V12: "node_modules/.bin/tsx scripts/disdex-v12-x1-all-live-runner.ts --daemon",
        PENGU_V8: "/usr/bin/bash scripts/ops/disdex-v96-v52-live.sh",
        V52: "/usr/bin/bash scripts/ops/disdex-v96-v52-live.sh",
        QUALITY102_CAUSAL_V1: "node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-live-runner.ts --daemon",
    };
    for (const runnerId of RUNNERS) {
        const unit = UNITS[runnerId];
        const pid = pids[runnerId];
        system.active.set(unit, true);
        system.pids.set(unit, pid);
        system.cwds.set(pid, root);
        system.commands.set(pid, commands[runnerId]);
    }
    return system;
}

async function writeFixtures(config: RunnerWatchdogConfig, now: number, overrides: Partial<Record<RunnerId, Partial<RunnerHeartbeat>>> = {}): Promise<void> {
    await Promise.all(RUNNERS.map((runnerId) => writeRunnerHeartbeat(
        config.runners[runnerId].heartbeatPath,
        makeHeartbeat(runnerId, now, { workingDirectory: config.runners[runnerId].expectedCwd, ...overrides[runnerId] }),
    )));
}

async function freshFixture(
    now: number,
    overrides: Partial<Record<RunnerId, Partial<RunnerHeartbeat>>>,
    callback: (root: string, config: RunnerWatchdogConfig, system: FakeWatchdogSystem) => Promise<void>,
): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "disdex-runner-watchdog-selftest-"));
    try {
        const config = makeConfig(root);
        await writeFixtures(config, now, overrides);
        await callback(root, config, makeSystem(root));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function main(): Promise<void> {
    const now = Date.now();

    const productionAdapter = createProductionWatchdogSystem();
    await assert.rejects(() => productionAdapter.isActive("disdex-arbitrary.service"), /static allowlist/);
    await assert.rejects(() => productionAdapter.mainPid("disdex-arbitrary.service"), /static allowlist/);
    await assert.rejects(() => productionAdapter.restart("disdex-arbitrary.service"), /static allowlist/);

    await freshFixture(now, {}, async (root, config, system) => {
        system.active.set(UNITS.V12, false);
        system.pids.set(UNITS.V12, 0);
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, [UNITS.V12]);
        assert.equal(result.decisions.V12.action, "RESTART");
    });

    await freshFixture(now, { V12: { heartbeatAt: now - 10 * 60_000 } }, async (_root, config, system) => {
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, [UNITS.V12]);
        assert.equal(result.decisions.V12.action, "RESTART");
    });

    await freshFixture(now, {}, async (_root, config, system) => {
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "NOOP");
    });

    await freshFixture(now, { V12: { runtimeSha: OTHER_SHA } }, async (_root, config, system) => {
        const pid = system.pids.get(UNITS.V12)!;
        system.cwds.set(pid, "/wrong/release");
        system.commands.set(pid, "node unexpected.js");
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, [UNITS.V12]);
        assert.equal(result.restartCalls[0], UNITS.V12);
        assert.equal(result.decisions.V12.tradingEffects.ordersSent, 0);
    });

    for (const safetyState of ["KILL_SWITCH", "MANUAL_REVIEW", "STALE_DATA", "RECONCILIATION_FAILED", "UNKNOWN"] as const) {
        await freshFixture(now, { V12: { safetyState } }, async (_root, config, system) => {
            system.active.set(UNITS.V12, false);
            system.pids.set(UNITS.V12, 0);
            const result = await runWatchdog({ config, system, now });
            assert.deepEqual(system.restartCalls, []);
            assert.equal(result.decisions.V12.action, "HOLD_FAIL_CLOSED");
            assert.equal(result.decisions.V12.restartAuthorized, false);
            assert.deepEqual(result.decisions.V12.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
        });
    }

    await freshFixture(now, { V12: { restartAttempts: 3 } }, async (_root, config, system) => {
        system.active.set(UNITS.V12, false);
        system.pids.set(UNITS.V12, 0);
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "RECOVERY_EXHAUSTED");
        assert.equal(result.exitCode, 1);
    });

    await freshFixture(now, { QUALITY102_CAUSAL_V1: { safetyState: "MANUAL_REVIEW" } }, async (_root, config, system) => {
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.QUALITY102_CAUSAL_V1.affectsOtherRunners, false);
        assert.equal(result.decisions.V12.action, "NOOP");
        assert.equal(result.decisions.PENGU_V8.action, "NOOP");
        assert.equal(result.decisions.V52.action, "NOOP");
    });

    await freshFixture(now, {
        PENGU_V8: { heartbeatAt: now - 10 * 60_000 },
        V52: { heartbeatAt: now - 10 * 60_000 },
    }, async (_root, config, system) => {
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, [UNITS.PENGU_V8]);
        assert.equal(result.decisions.PENGU_V8.action, "RESTART");
        assert.equal(result.decisions.V52.action, "RESTART");
    });

    await freshFixture(now, {}, async (_root, config, system) => {
        await writeFile(config.runners.V12.heartbeatPath, "{\"schema\":\"malformed\"}\n", "utf8");
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.calls, []);
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.sharedUncertainty, true);
        for (const runnerId of RUNNERS) {
            assert.equal(result.decisions[runnerId].action, "HOLD_FAIL_CLOSED");
            assert.equal(result.decisions[runnerId].affectsOtherRunners, true);
            assert.deepEqual(result.decisions[runnerId].tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
        }
    });

    await freshFixture(now, {}, async (_root, config, system) => {
        await writeFile(config.runners.V12.intentionalStopMarkerPath, "operator requested stop\n", "utf8");
        system.active.set(UNITS.V12, false);
        system.pids.set(UNITS.V12, 0);
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "HOLD_FAIL_CLOSED");
        assert.equal(result.decisions.V12.restartAuthorized, false);
    });

    await freshFixture(now, {}, async (_root, config, system) => {
        system.active.set(UNITS.V12, false);
        system.pids.set(UNITS.V12, 0);
        const first = await runWatchdog({ config, system, now });
        assert.deepEqual(first.restartCalls, [UNITS.V12]);
        const second = await runWatchdog({ config, system, now: now + 1_000 });
        assert.deepEqual(second.restartCalls, []);
        assert.equal(second.runnerResults.V12.backoffMs, 15_000);
        assert.equal(second.runnerResults.V12.nextAllowedAt, now + 15_000);
        const third = await runWatchdog({ config, system, now: now + 15_000 });
        assert.deepEqual(third.restartCalls, [UNITS.V12]);
        const fourth = await runWatchdog({ config, system, now: now + 16_000 });
        assert.deepEqual(fourth.restartCalls, []);
        assert.equal(fourth.runnerResults.V12.backoffMs, 60_000);
    });

    await freshFixture(now, {}, async (_root, config, system) => {
        await writeFile(config.runners.V12.heartbeatPath, JSON.stringify({
            ...makeHeartbeat("V12", now, { workingDirectory: config.runners.V12.expectedCwd }),
            serviceUnit: "disdex-v12-x1-all.service",
        }), "utf8");
        const result = await runWatchdog({ config, system, now });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.sharedUncertainty, true);
    });

    const auditRoot = await mkdtemp(join(tmpdir(), "disdex-runner-watchdog-audit-selftest-"));
    try {
        const config = makeConfig(auditRoot);
        await writeFixtures(config, now);
        const result = await runWatchdog({ config, system: makeSystem(auditRoot), now });
        assert.equal(result.auditWritten, true);
        const audit = JSON.parse(await readFile(config.auditPath, "utf8")) as { tradingEffects: Record<string, number> };
        assert.deepEqual(audit.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
    } finally {
        await rm(auditRoot, { recursive: true, force: true });
    }

    process.stdout.write("DISDEX_RUNNER_WATCHDOG_SELFTEST_PASS restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0\n");
}

void main();
