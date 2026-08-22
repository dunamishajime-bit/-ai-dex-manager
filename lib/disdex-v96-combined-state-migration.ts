import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";

export const COMBINED_V96_MIGRATION_ACK = "I_ACKNOWLEDGE_V96_COMBINED_STATE_MIGRATION" as const;
export const COMBINED_V96_POSITION_RECONCILIATION_ACK = "I_ACKNOWLEDGE_V96_POSITION_RECONCILIATION_NO_ORDERS" as const;

export interface ManagedPositionSnapshot {
    symbol: string;
    positionAmt: string;
    positionSide: string;
}

export interface CombinedV96MigrationManifest {
    version: 1;
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    status: "READY";
    migrationId: string;
    createdAt: string;
    sourceStatePath: string;
    sourceStateSha256: string;
    sourceStateUpdatedAt: number;
    destinationStatePath: string;
    destinationStateSha256: string;
    backupPath: string;
    pendingResolution: "NONE" | "PLANNED_DROPPED" | "TERMINAL_RECONCILED";
    asterAccountAddress: string;
    managedPositions: ManagedPositionSnapshot[];
    openOrderCount: 0;
    ordersSent: false;
}

export interface CombinedV96PositionReconciliation {
    version: 1;
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    status: "MATCHED" | "RESOLVED_FLAT";
    reconciliationId: string;
    migrationId: string;
    createdAt: string;
    reason: string;
    asterAccountAddress: string;
    statePath: string;
    stateShaBefore: string;
    stateShaAfter: string;
    stateBackupPath: string;
    legacyRecordedPositions: ManagedPositionSnapshot[];
    actualPositionsBefore: ManagedPositionSnapshot[];
    actualPositionsAfter: ManagedPositionSnapshot[];
    openOrderCountBefore: number;
    openOrderCountAfter: number;
    managedGrossBefore: number;
    managedGrossAfter: number;
    closeUnmanagedPositions: false;
    ordersSent: false;
}

export interface CombinedV96ActivationMarker {
    version: 1;
    migrationId: string;
    activatedAt: string;
    runtimeCommitSha: string;
    stateShaAtActivation: string;
}

export function combinedV96MigrationPaths(combinedRootValue?: string) {
    const combinedRoot = resolve(combinedRootValue || process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || ".runtime-state/disdex-v13d-v11eq-v96");
    const cryptoRoot = resolve(combinedRoot, "crypto-v96");
    return {
        combinedRoot,
        cryptoRoot,
        statePath: resolve(cryptoRoot, "runner-live.json"),
        manifestPath: resolve(combinedRoot, "v96-state-migration.json"),
        reconciliationPath: resolve(combinedRoot, "v96-position-reconciliation.json"),
        activationPath: resolve(combinedRoot, "v96-combined-activation.json"),
    };
}

export async function sha256File(pathValue: string) {
    return createHash("sha256").update(await readFile(resolve(pathValue))).digest("hex");
}

export function canonicalManagedPositions(rows: Array<{ symbol?: unknown; positionAmt?: unknown; positionSide?: unknown }>) {
    return rows
        .map((row) => ({
            symbol: String(row.symbol || "").toUpperCase(),
            positionAmt: Number(row.positionAmt || 0).toFixed(12),
            positionSide: String(row.positionSide || "BOTH").toUpperCase(),
        }))
        .filter((row) => row.symbol && Math.abs(Number(row.positionAmt)) > 1e-12)
        .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function normalizedSnapshots(rows: ManagedPositionSnapshot[]) {
    return canonicalManagedPositions(rows).sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function expectedManagedPositionsForMigration(
    manifest: CombinedV96MigrationManifest,
    reconciliation?: CombinedV96PositionReconciliation,
) {
    if (!reconciliation) return normalizedSnapshots(manifest.managedPositions);
    if (reconciliation.migrationId !== manifest.migrationId) {
        throw new Error("Combined V96 position reconciliation does not match the migration manifest.");
    }
    return normalizedSnapshots(reconciliation.actualPositionsAfter);
}

export function managedPositionSnapshotsMatch(left: ManagedPositionSnapshot[], right: ManagedPositionSnapshot[]) {
    return JSON.stringify(normalizedSnapshots(left)) === JSON.stringify(normalizedSnapshots(right));
}

async function optionalJson<T>(pathValue: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(resolve(pathValue), "utf8")) as T;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

export async function writeCombinedV96PositionReconciliation(
    reconciliation: CombinedV96PositionReconciliation,
    combinedRootValue?: string,
) {
    const paths = combinedV96MigrationPaths(combinedRootValue);
    await mkdir(dirname(paths.reconciliationPath), { recursive: true });
    const temporary = `${paths.reconciliationPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(reconciliation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, paths.reconciliationPath);
    return paths.reconciliationPath;
}

export async function loadCombinedV96Migration(combinedRootValue?: string) {
    const paths = combinedV96MigrationPaths(combinedRootValue);
    const manifest = await optionalJson<CombinedV96MigrationManifest>(paths.manifestPath);
    if (!manifest) throw new Error(`Combined V96 migration manifest is missing: ${paths.manifestPath}`);
    if (manifest.version !== 1 || manifest.strategyId !== DISDEX_V96_STRATEGY_ID || manifest.status !== "READY") {
        throw new Error("Combined V96 migration manifest is invalid.");
    }
    const reconciliation = await optionalJson<CombinedV96PositionReconciliation>(paths.reconciliationPath);
    if (reconciliation) {
        if (
            reconciliation.version !== 1
            || reconciliation.strategyId !== DISDEX_V96_STRATEGY_ID
            || reconciliation.migrationId !== manifest.migrationId
            || reconciliation.ordersSent !== false
            || reconciliation.closeUnmanagedPositions !== false
        ) {
            throw new Error("Combined V96 position reconciliation is invalid.");
        }
    }
    const activation = await optionalJson<CombinedV96ActivationMarker>(paths.activationPath);
    if (activation && (activation.version !== 1 || activation.migrationId !== manifest.migrationId)) {
        throw new Error("Combined V96 activation marker does not match the migration manifest.");
    }
    return { paths, manifest, reconciliation, activation };
}

export async function assertCombinedV96MigrationReady(input: {
    combinedRoot?: string;
    managedPositions?: ManagedPositionSnapshot[];
}) {
    const loaded = await loadCombinedV96Migration(input.combinedRoot);
    const stateSha = await sha256File(loaded.paths.statePath);
    const expectedPreActivationStateSha = loaded.reconciliation?.stateShaAfter || loaded.manifest.destinationStateSha256;
    if (!loaded.activation && stateSha !== expectedPreActivationStateSha) {
        throw new Error("Combined V96 state changed after migration/reconciliation and before first activation.");
    }
    const expectedManagedPositions = expectedManagedPositionsForMigration(loaded.manifest, loaded.reconciliation);
    if (input.managedPositions && !managedPositionSnapshotsMatch(input.managedPositions, expectedManagedPositions)) {
        throw new Error("Aster managed positions do not match the formally reconciled V96 state; manual review is required and automated trading must remain stopped.");
    }
    return { ...loaded, stateSha, expectedManagedPositions };
}

export async function markCombinedV96MigrationActivated(input: { combinedRoot?: string; runtimeCommitSha: string }) {
    const loaded = await assertCombinedV96MigrationReady({ combinedRoot: input.combinedRoot });
    if (loaded.activation) return loaded.activation;
    const marker: CombinedV96ActivationMarker = {
        version: 1,
        migrationId: loaded.manifest.migrationId,
        activatedAt: new Date().toISOString(),
        runtimeCommitSha: input.runtimeCommitSha,
        stateShaAtActivation: loaded.stateSha,
    };
    await mkdir(dirname(loaded.paths.activationPath), { recursive: true });
    const temporary = `${loaded.paths.activationPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, loaded.paths.activationPath);
    return marker;
}
