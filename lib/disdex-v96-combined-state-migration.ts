import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";

export const COMBINED_V96_MIGRATION_ACK = "I_ACKNOWLEDGE_V96_COMBINED_STATE_MIGRATION" as const;

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

async function optionalJson<T>(pathValue: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(resolve(pathValue), "utf8")) as T;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

export async function loadCombinedV96Migration(combinedRootValue?: string) {
    const paths = combinedV96MigrationPaths(combinedRootValue);
    const manifest = await optionalJson<CombinedV96MigrationManifest>(paths.manifestPath);
    if (!manifest) throw new Error(`Combined V96 migration manifest is missing: ${paths.manifestPath}`);
    if (manifest.version !== 1 || manifest.strategyId !== DISDEX_V96_STRATEGY_ID || manifest.status !== "READY") {
        throw new Error("Combined V96 migration manifest is invalid.");
    }
    const activation = await optionalJson<CombinedV96ActivationMarker>(paths.activationPath);
    if (activation && (activation.version !== 1 || activation.migrationId !== manifest.migrationId)) {
        throw new Error("Combined V96 activation marker does not match the migration manifest.");
    }
    return { paths, manifest, activation };
}

export async function assertCombinedV96MigrationReady(input: {
    combinedRoot?: string;
    managedPositions?: ManagedPositionSnapshot[];
}) {
    const loaded = await loadCombinedV96Migration(input.combinedRoot);
    const stateSha = await sha256File(loaded.paths.statePath);
    if (!loaded.activation && stateSha !== loaded.manifest.destinationStateSha256) {
        throw new Error("Combined V96 state changed after migration and before first activation.");
    }
    if (!loaded.activation && input.managedPositions) {
        const actual = JSON.stringify([...input.managedPositions].sort((a, b) => a.symbol.localeCompare(b.symbol)));
        const expected = JSON.stringify(loaded.manifest.managedPositions);
        if (actual !== expected) throw new Error("Aster managed positions changed after V96 migration and before combined preflight.");
    }
    return { ...loaded, stateSha };
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
