import "dotenv/config";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { disDexV96ConfigFingerprint } from "../lib/disdex-v96-live-gates";
import type { DisDexV96RunnerState } from "../lib/disdex-v96-runner-state";

const ACKNOWLEDGEMENT = "I_ACKNOWLEDGE_V96_CONFIG_STATE_MIGRATION";

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

async function main() {
    if (process.env.DISDEX_V96_CONFIG_MIGRATION_ACKNOWLEDGEMENT !== ACKNOWLEDGEMENT) {
        throw new Error("Explicit V96 config-state migration acknowledgement is missing.");
    }
    const statePath = resolve(required("DISDEX_V96_STATE_FILE"));
    const expectedOldFingerprint = required("DISDEX_V96_EXPECTED_OLD_CONFIG_FINGERPRINT");
    const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<DisDexV96RunnerState>;
    if (raw.strategyId !== DISDEX_V96_STRATEGY_ID) {
        throw new Error(`State strategyId mismatch: ${String(raw.strategyId)}`);
    }
    if (raw.version !== 2) throw new Error(`Only V96 state schema 2 can be migrated; found ${String(raw.version)}.`);
    if (raw.configFingerprint !== expectedOldFingerprint) {
        throw new Error("State fingerprint does not match DISDEX_V96_EXPECTED_OLD_CONFIG_FINGERPRINT.");
    }
    if (raw.pending) throw new Error("V96 state has a pending order; reconcile it before migration.");
    if (raw.manualReviewReason) throw new Error(`V96 state requires manual review: ${raw.manualReviewReason}`);
    if (raw.bootstrapRequired !== false) throw new Error("V96 state is not an established runner state; config migration is not allowed.");

    const nextFingerprint = disDexV96ConfigFingerprint();
    if (nextFingerprint === expectedOldFingerprint) throw new Error("Old and new V96 fingerprints are identical; migration is unnecessary.");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${statePath}.before-volume50-turnover075-${timestamp}.json`;
    await mkdir(dirname(statePath), { recursive: true });
    await copyFile(statePath, backupPath);

    const now = Date.now();
    const migrated: DisDexV96RunnerState = {
        ...(raw as DisDexV96RunnerState),
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: nextFingerprint,
        updatedAt: now,
        lastRunAt: undefined,
        lastSignalReferenceTs: undefined,
        operatorOverride: undefined,
        forwardEvidence: {
            completedDecisionBars: 0,
            closedLongTrades: 0,
            closedShortTrades: 0,
            grossCapBreaches: 0,
            unknownOrderEvents: 0,
            stateRecoveryFailures: 0,
            minimumObservedPenguClip: 1,
            startedAt: now,
            lastUpdatedAt: now,
        },
        bootstrapRequired: false,
        manualReviewReason: undefined,
    };
    const temporaryPath = `${statePath}.migrating-${process.pid}`;
    await writeFile(temporaryPath, JSON.stringify(migrated, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, statePath);
    console.log(JSON.stringify({
        status: "DISDEX_V96_CONFIG_STATE_MIGRATION_PASS_NO_ORDERS_SENT",
        strategyId: DISDEX_V96_STRATEGY_ID,
        oldConfigFingerprint: expectedOldFingerprint,
        newConfigFingerprint: nextFingerprint,
        statePath,
        backupPath,
        pendingOrderPreserved: false,
        completedExecutionsPreserved: migrated.completedExecutions.length,
        dailyRiskPreserved: Boolean(migrated.dailyRisk),
        killSwitchAuditPreserved: Boolean(migrated.killSwitch),
        operatorOverrideCleared: true,
        forwardEvidenceReset: true,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_CONFIG_STATE_MIGRATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
    }));
    process.exitCode = 1;
});
