import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    decideRecovery,
    writeRunnerHeartbeat,
    type RecoveryObservation,
    type RunnerId,
    type RunnerHeartbeat,
} from "../lib/disdex-runner-health";
import {
    createProductionWatchdogSystem,
    runWatchdog,
    type RunnerWatchdogConfig,
    type RunnerWatchdogSystem,
} from "../scripts/disdex-runner-watchdog";

const NOW = 1_757_000_000_000;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "/home/deploy/disdex-trading/releases/" + SHA;

function makeHeartbeat(overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    return {
        schema: "disdex-runner-heartbeat/v1",
        runnerId: "QUALITY102_CAUSAL_V1",
        serviceUnit: "disdex-quality102-causal-v1",
        runtimeSha: SHA,
        expectedSha: SHA,
        workingDirectory: RELEASE,
        mode: "LIVE",
        liveEnabled: true,
        safetyState: "LIVE",
        heartbeatAt: NOW,
        lastTickAt: NOW,
        lastReconciliationAt: NOW,
        lastDecision: "NOOP",
        reason: "healthy",
        symbols: [],
        caps: { strategy: 0.5, crypto: 2, total: 2.5 },
        restartAttempts: 0,
        updatedAt: NOW,
        ...overrides,
    };
}

function assertDecisionContract(decision: ReturnType<typeof decideRecovery>): void {
    assert.equal(decision.restartAuthorized, decision.action === "RESTART");
    assert.deepEqual(decision.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
}

function observe(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
    return {
        now: NOW,
        heartbeat: makeHeartbeat(),
        serviceActive: true,
        mainPid: 123,
        processCwd: RELEASE,
        expectedCwd: RELEASE,
        restartAttempts: 0,
        ...overrides,
    };
}

test("fresh matching service/PID/cwd/SHA returns NOOP", () => {
    const decision = decideRecovery(observe());
    assert.equal(decision.action, "NOOP");
    assertDecisionContract(decision);
});

test("inactive service with no PID and no heartbeat returns RESTART", () => {
    const decision = decideRecovery(observe({ heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined }));
    assert.equal(decision.action, "RESTART");
    assertDecisionContract(decision);
});

test("stale heartbeat returns RESTART", () => {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ heartbeatAt: NOW - 10 * 60_000 }) }));
    assert.equal(decision.action, "RESTART");
    assertDecisionContract(decision);
});

test("safety latches remain HOLD_FAIL_CLOSED and never restart", () => {
    for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
        const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState }) }));
        assert.equal(decision.action, "HOLD_FAIL_CLOSED");
        assertDecisionContract(decision);
        assert.equal(decision.restartAuthorized, false);
    }
});

test("Q102 fail-closed decision is runner-local", () => {
    const decision = decideRecovery(observe({ heartbeat: makeHeartbeat({ safetyState: "KILL_SWITCH" }) }));
    assert.equal(decision.affectsOtherRunners, false);
    assertDecisionContract(decision);
});

test("shared reconciliation uncertainty affects every runner", () => {
    const decision = decideRecovery(observe({ sharedUncertainty: true }));
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assert.equal(decision.affectsOtherRunners, true);
    assertDecisionContract(decision);
});

test("exhausted retry budget never authorizes a fourth restart", () => {
    const decision = decideRecovery(observe({ restartAttempts: 3 }));
    assert.equal(decision.action, "RECOVERY_EXHAUSTED");
    assert.notEqual(decision.action, "RESTART");
    assertDecisionContract(decision);
    assert.equal(decision.restartAuthorized, false);
});

const WATCHDOG_RUNNERS: RunnerId[] = ["V12", "PENGU_V8", "V52", "QUALITY102_CAUSAL_V1"];
const WATCHDOG_UNITS: Record<RunnerId, string> = {
    V12: `disdex-v12-x1-all@${SHA}.service`,
    PENGU_V8: "disdex-v96-v52-live.service",
    V52: "disdex-v96-v52-live.service",
    QUALITY102_CAUSAL_V1: `disdex-quality102-causal-v1@${SHA}.service`,
};
const WATCHDOG_COMMANDS: Record<RunnerId, string> = {
    V12: "node_modules/.bin/tsx scripts/disdex-v12-x1-all-live-runner.ts --daemon",
    PENGU_V8: "/usr/bin/bash scripts/ops/disdex-v96-v52-live.sh",
    V52: "/usr/bin/bash scripts/ops/disdex-v96-v52-live.sh",
    QUALITY102_CAUSAL_V1: "node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-live-runner.ts --daemon",
};

function makeWatchdogConfig(healthRoot: string): RunnerWatchdogConfig {
    const runners = Object.fromEntries(WATCHDOG_RUNNERS.map((runnerId) => [runnerId, {
        runnerId,
        serviceUnit: WATCHDOG_UNITS[runnerId],
        heartbeatPath: join(healthRoot, {
            V12: "v12.json",
            PENGU_V8: "pengu-v8.json",
            V52: "v52.json",
            QUALITY102_CAUSAL_V1: "quality102-causal-v1.json",
        }[runnerId]),
        expectedCwd: RELEASE,
        expectedSha: SHA,
        intentionalStopMarkerPath: join(healthRoot, `${runnerId.toLowerCase()}.intentional-stop`),
    }])) as RunnerWatchdogConfig["runners"];
    return {
        healthRoot,
        runners,
        heartbeatTimeoutMs: 5 * 60_000,
        attemptWindowMs: 30 * 60_000,
        maxAttempts: 3,
        backoffMs: [15_000, 60_000, 300_000],
        auditPath: join(healthRoot, "watchdog-audit.json"),
        statePath: join(healthRoot, "watchdog-state.json"),
    };
}

function makeWatchdogHeartbeat(runnerId: RunnerId, overrides: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat {
    const heartbeat: RunnerHeartbeat = {
        schema: "disdex-runner-heartbeat/v1",
        runnerId,
        serviceUnit: WATCHDOG_UNITS[runnerId],
        runtimeSha: SHA,
        expectedSha: SHA,
        workingDirectory: RELEASE,
        mode: "LIVE",
        liveEnabled: true,
        safetyState: "LIVE",
        heartbeatAt: NOW,
        lastTickAt: NOW,
        lastReconciliationAt: NOW,
        lastDecision: "NOOP",
        reason: "healthy",
        symbols: [],
        caps: runnerId === "QUALITY102_CAUSAL_V1"
            ? { strategy: 0.5, crypto: 2, total: 2.5 }
            : { strategy: 1.5, crypto: 2, total: 2.5 },
        restartAttempts: 0,
        updatedAt: NOW,
        ...(runnerId === "QUALITY102_CAUSAL_V1" ? {
            quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
        } : {}),
        ...overrides,
    };
    return heartbeat;
}

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

function healthyFakeSystem(): FakeWatchdogSystem {
    const system = new FakeWatchdogSystem();
    const pidsByUnit = new Map<string, number>();
    let nextPid = 100;
    for (const runnerId of WATCHDOG_RUNNERS) {
        const unit = WATCHDOG_UNITS[runnerId];
        if (!pidsByUnit.has(unit)) pidsByUnit.set(unit, nextPid++);
        system.active.set(unit, true);
        system.pids.set(unit, pidsByUnit.get(unit)!);
        const pid = pidsByUnit.get(unit)!;
        system.cwds.set(pid, RELEASE);
        system.commands.set(pid, WATCHDOG_COMMANDS[runnerId]);
    }
    return system;
}

async function writeWatchdogFixtures(config: RunnerWatchdogConfig, overrides: Partial<Record<RunnerId, Partial<RunnerHeartbeat>>> = {}): Promise<void> {
    await Promise.all(WATCHDOG_RUNNERS.map((runnerId) => writeRunnerHeartbeat(
        config.runners[runnerId].heartbeatPath,
        makeWatchdogHeartbeat(runnerId, overrides[runnerId]),
    )));
}

async function withWatchdogFixture(
    overrides: Partial<Record<RunnerId, Partial<RunnerHeartbeat>>>,
    callback: (config: RunnerWatchdogConfig, system: FakeWatchdogSystem) => Promise<void>,
): Promise<void> {
    const healthRoot = await mkdtemp(join(tmpdir(), "disdex-runner-watchdog-test-"));
    try {
        const config = makeWatchdogConfig(healthRoot);
        await writeWatchdogFixtures(config, overrides);
        await callback(config, healthyFakeSystem());
    } finally {
        await rm(healthRoot, { recursive: true, force: true });
    }
}

test("watchdog restarts an exited runner exactly once", async () => {
    await withWatchdogFixture({}, async (config, system) => {
        system.active.set(WATCHDOG_UNITS.V12, false);
        system.pids.set(WATCHDOG_UNITS.V12, 0);
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, [WATCHDOG_UNITS.V12]);
        assert.equal(result.decisions.V12.action, "RESTART");
        assert.equal(result.decisions.V12.restartAuthorized, true);
        assertDecisionContract(result.decisions.V12);
    });
});

test("watchdog restarts a stale heartbeat without changing its safety contract", async () => {
    await withWatchdogFixture({ V12: { heartbeatAt: NOW - 10 * 60_000 } }, async (config, system) => {
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, [WATCHDOG_UNITS.V12]);
        assert.equal(result.decisions.V12.action, "RESTART");
        assertDecisionContract(result.decisions.V12);
    });
});

test("watchdog does not restart a matching active service", async () => {
    await withWatchdogFixture({}, async (config, system) => {
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "NOOP");
        assert.equal(result.decisions.QUALITY102_CAUSAL_V1.action, "NOOP");
    });
});

test("watchdog treats cwd, command, and SHA drift as a restart of only the exact allowlisted unit", async () => {
    const otherSha = "fedcba9876543210fedcba9876543210fedcba98";
    await withWatchdogFixture({ V12: { runtimeSha: otherSha } }, async (config, system) => {
        const pid = system.pids.get(WATCHDOG_UNITS.V12)!;
        system.cwds.set(pid, "/unexpected/release");
        system.commands.set(pid, "node unexpected-runner.js");
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, [WATCHDOG_UNITS.V12]);
        assert.equal(result.decisions.V12.action, "RESTART");
        assert.ok(system.restartCalls.every((unit) => /^(disdex-v12-x1-all@|disdex-v96-v52-live|disdex-quality102-causal-v1@)/.test(unit)));
    });
});

test("watchdog holds intentional stops and every safety latch without restarting", async () => {
    await withWatchdogFixture({ V12: { safetyState: "KILL_SWITCH" } }, async (config, system) => {
        await writeFile(config.runners.V12.intentionalStopMarkerPath, "operator requested stop\n", "utf8");
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "HOLD_FAIL_CLOSED");
        assert.equal(result.decisions.V12.restartAuthorized, false);
        assertDecisionContract(result.decisions.V12);
        for (const safetyState of ["DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
            await writeRunnerHeartbeat(config.runners.V12.heartbeatPath, makeWatchdogHeartbeat("V12", { safetyState }));
            const held = await runWatchdog({ config, system, now: NOW });
            assert.equal(held.decisions.V12.action, "HOLD_FAIL_CLOSED");
            assert.equal(held.decisions.V12.restartAuthorized, false);
            assertDecisionContract(held.decisions.V12);
        }
        assert.deepEqual(system.restartCalls, []);
    });
});

test("malformed heartbeat is shared uncertainty and blocks all system actions", async () => {
    await withWatchdogFixture({}, async (config, system) => {
        await writeFile(config.runners.V12.heartbeatPath, "{\"schema\":\"broken\"}\n", "utf8");
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.calls, []);
        assert.deepEqual(system.restartCalls, []);
        for (const runnerId of WATCHDOG_RUNNERS) {
            assert.equal(result.decisions[runnerId].action, "HOLD_FAIL_CLOSED");
            assert.equal(result.decisions[runnerId].affectsOtherRunners, true);
            assertDecisionContract(result.decisions[runnerId]);
        }
        assert.equal(result.exitCode, 1);
    });
});

test("three prior attempts exhaust recovery without a fourth restart", async () => {
    await withWatchdogFixture({ V12: { restartAttempts: 3 } }, async (config, system) => {
        system.active.set(WATCHDOG_UNITS.V12, false);
        system.pids.set(WATCHDOG_UNITS.V12, 0);
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.V12.action, "RECOVERY_EXHAUSTED");
        assert.equal(result.decisions.V12.restartAuthorized, false);
        assertDecisionContract(result.decisions.V12);
        assert.equal(result.exitCode, 1);
    });
});

test("Q102-local failure does not restart or alter the other runner decisions", async () => {
    await withWatchdogFixture({ QUALITY102_CAUSAL_V1: { safetyState: "MANUAL_REVIEW" } }, async (config, system) => {
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.decisions.QUALITY102_CAUSAL_V1.action, "HOLD_FAIL_CLOSED");
        assert.equal(result.decisions.QUALITY102_CAUSAL_V1.affectsOtherRunners, false);
        assert.equal(result.decisions.V12.action, "NOOP");
        assert.equal(result.decisions.PENGU_V8.action, "NOOP");
        assert.equal(result.decisions.V52.action, "NOOP");
    });
});

test("PENGU and V52 sharing one unit produces at most one restart call", async () => {
    await withWatchdogFixture({
        PENGU_V8: { heartbeatAt: NOW - 10 * 60_000 },
        V52: { heartbeatAt: NOW - 10 * 60_000 },
    }, async (config, system) => {
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.restartCalls, [WATCHDOG_UNITS.PENGU_V8]);
        assert.equal(result.decisions.PENGU_V8.action, "RESTART");
        assert.equal(result.decisions.V52.action, "RESTART");
        assertDecisionContract(result.decisions.PENGU_V8);
        assertDecisionContract(result.decisions.V52);
    });
});

test("heartbeat unit identity outside the static allowlist blocks restart before observation", async () => {
    await withWatchdogFixture({ V12: { serviceUnit: "disdex-v12-x1-all.service" } }, async (config, system) => {
        const result = await runWatchdog({ config, system, now: NOW });
        assert.deepEqual(system.calls, []);
        assert.deepEqual(system.restartCalls, []);
        assert.equal(result.exitCode, 1);
        assert.equal(result.decisions.V12.affectsOtherRunners, true);
    });
});

test("production adapter rejects an arbitrary unit before invoking systemctl", async () => {
    const system = createProductionWatchdogSystem();
    await assert.rejects(() => system.isActive("disdex-arbitrary.service"), /static allowlist/);
    await assert.rejects(() => system.mainPid("disdex-arbitrary.service"), /static allowlist/);
    await assert.rejects(() => system.restart("disdex-arbitrary.service"), /static allowlist/);
});
