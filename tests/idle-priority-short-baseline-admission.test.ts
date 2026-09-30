import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildBaselineAdmissionEvidence } from "../lib/idle-priority-short-baseline-admission";
import { IDLE_BASELINE_ADMISSION_SCHEMA } from "../lib/idle-priority-short-live";

const SHA = "a".repeat(40);

async function fixture(overrides: Record<string, unknown> = {}) {
    const root = await mkdtemp(join(tmpdir(), "disdex-idle-baseline-"));
    const paths = {
        decisionPath: join(root, "decision.json"),
        v12Path: join(root, "v12.json"),
        q102Path: join(root, "q102.json"),
        penguPath: join(root, "pengu.json"),
        fetPath: join(root, "fet.json"),
        v52Path: join(root, "v52.json"),
    };
    const decisionTs = 1_700_000_000_000;
    await writeFile(paths.v12Path, JSON.stringify({
        schema: "v12-decision-observation/v1",
        strategyId: "V12_X1.00_ALL",
        referenceTs: decisionTs,
        entryTs: decisionTs,
        reason: "NO_COMPLETED_BAR_SIGNAL",
    }));
    await writeFile(paths.q102Path, JSON.stringify({
        schemaVersion: "quality102-causal-v1-decision/v1",
        strategyId: "QUALITY102_CAUSAL_V1",
        selectorMode: "CAUSAL_V4",
        referenceTs: decisionTs,
        selectedReason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
        items: [{ selected: false, eligible: false, side: "WAIT" }],
    }));
    await writeFile(paths.penguPath, JSON.stringify({
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        updatedAt: decisionTs,
        latestSignal: { referenceTs: decisionTs, side: 0, targetGross: 0 },
    }));
    await writeFile(paths.fetPath, JSON.stringify({ schema: "fet-brk48-residual-state/v1", updatedAt: decisionTs, failures: [] }));
    await writeFile(paths.v52Path, JSON.stringify({ strategyId: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", updatedAt: decisionTs }));
    return {
        root,
        paths,
        input: {
            runtimeSha: SHA,
            decisionTs,
            now: decisionTs + 1_000,
            baselineOpenPositions: 0,
            baselinePendingExposure: 0,
            ...paths,
            ...overrides,
        },
    };
}

test("baseline admission evidence is produced from current decision snapshots and is atomic", async () => {
    const f = await fixture();
    try {
        const result = await buildBaselineAdmissionEvidence(f.input);
        assert.equal(result.schema, IDLE_BASELINE_ADMISSION_SCHEMA);
        assert.equal(result.runtimeSha, SHA);
        assert.equal(result.decisionTs, f.input.decisionTs);
        assert.equal(result.sourceComplete, true);
        assert.equal(result.baselineAcceptedThisTimestamp, 0);
        assert.deepEqual(JSON.parse(await readFile(f.paths.decisionPath, "utf8")), result);
    } finally {
        await rm(f.root, { recursive: true, force: true });
    }
});

test("same-timestamp baseline acceptance blocks Idle admission", async () => {
    const f = await fixture();
    try {
        await writeFile(f.paths.v12Path, JSON.stringify({
            schema: "v12-decision-observation/v1",
            strategyId: "V12_X1.00_ALL",
            referenceTs: f.input.decisionTs,
            entryTs: f.input.decisionTs,
            reason: "SIGNAL_AVAILABLE",
        }));
        const result = await buildBaselineAdmissionEvidence(f.input);
        assert.equal(result.baselineAcceptedThisTimestamp, 1);
    } finally {
        await rm(f.root, { recursive: true, force: true });
    }
});

test("retained older PENGU signal and an unselected Q102 item are not current acceptance", async () => {
    const f = await fixture();
    try {
        await writeFile(f.paths.penguPath, JSON.stringify({
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            updatedAt: f.input.decisionTs,
            latestSignal: { referenceTs: f.input.decisionTs - 3_600_000, side: 1, targetGross: 1 },
        }));
        await writeFile(f.paths.q102Path, JSON.stringify({
            schemaVersion: "quality102-causal-v1-decision/v1",
            strategyId: "QUALITY102_CAUSAL_V1",
            selectorMode: "CAUSAL_V4",
            referenceTs: f.input.decisionTs,
            selectedReason: "CURRENT_CANDIDATE_REJECTED",
            items: [{ selected: false, eligible: true, side: "LONG" }],
        }));
        const result = await buildBaselineAdmissionEvidence(f.input);
        assert.equal(result.baselineAcceptedThisTimestamp, 0);
    } finally {
        await rm(f.root, { recursive: true, force: true });
    }
});

test("missing or mismatched baseline source fails closed", async () => {
    const f = await fixture();
    try {
        await assert.rejects(
            () => buildBaselineAdmissionEvidence({ ...f.input, q102Path: join(f.root, "missing.json") }),
            /BASELINE_ADMISSION_SOURCE_INCOMPLETE/,
        );
        await writeFile(f.paths.v12Path, JSON.stringify({
            schema: "v12-decision-observation/v1",
            strategyId: "V12_X1.00_ALL",
            referenceTs: f.input.decisionTs - 3_600_000,
            entryTs: f.input.decisionTs - 3_600_000,
            reason: "NO_COMPLETED_BAR_SIGNAL",
        }));
        await assert.rejects(() => buildBaselineAdmissionEvidence(f.input), /BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH/);
    } finally {
        await rm(f.root, { recursive: true, force: true });
    }
});

