import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import type {
    CandidateDecision,
    Direction,
    IntegratedReplay,
    PositionLifecycle,
    StageArtifactIndex,
    StageResult,
} from "./types";

export type AttributionRoute = "CORE" | "OVERLAY";

export interface AttributionBucket {
    readonly key: string;
    readonly route: AttributionRoute;
    readonly acceptedCandidates: number;
    readonly acceptedTrades: number;
    readonly rejectedCandidates: number;
    readonly unfilledCandidates: number;
    readonly realizedPnl: number;
    readonly netPnl: number;
    readonly fee: number;
    readonly funding: number;
    readonly slippage: number;
}

export interface PreemptionAttribution {
    readonly supported: boolean;
    readonly count: number | null;
    readonly reason: string;
}

export interface AttributionReport {
    readonly sourceHash: string;
    readonly configHash: string;
    readonly resultHash: string;
    readonly policyHash: string;
    readonly acceptedCandidates: number;
    readonly acceptedTrades: number;
    readonly rejectedCandidates: number;
    readonly unfilledCandidates: number;
    readonly realizedPnl: number;
    readonly grossRealizedPnl: number;
    readonly netPnl: number;
    readonly fee: number;
    readonly funding: number;
    readonly slippage: number;
    readonly corePnl: number;
    readonly overlayPnl: number;
    readonly lostCorePnl: number;
    readonly preemption: PreemptionAttribution;
    readonly byLogic: readonly AttributionBucket[];
    readonly byStrategy: readonly AttributionBucket[];
    readonly byDirection: readonly AttributionBucket[];
    readonly bySymbol: readonly AttributionBucket[];
    readonly byReason: readonly AttributionBucket[];
}

interface ReplayEvidence extends IntegratedReplay {
    readonly decisionLedger?: readonly CandidateDecision[];
    readonly tradeLedger?: readonly PositionLifecycle[];
    readonly rejectionCount?: number;
    readonly preemption?: PreemptionAttribution;
}

function routeFor(strategy: string, reason: string): AttributionRoute {
    return strategy === "IDLE" || /overlay|sidecar|addon|extra/i.test(reason) ? "OVERLAY" : "CORE";
}

function positionNetPnl(position: PositionLifecycle): { readonly realizedPnl: number; readonly netPnl: number } {
    const realizedPnl = position.events.reduce((total, event) => total + (event.exit?.realizedPnl ?? 0), 0);
    return { realizedPnl, netPnl: realizedPnl - position.fee - position.funding - position.slippage };
}

function emptyBucket(key: string, route: AttributionRoute): AttributionBucket {
    return { key, route, acceptedCandidates: 0, acceptedTrades: 0, rejectedCandidates: 0, unfilledCandidates: 0, realizedPnl: 0, netPnl: 0, fee: 0, funding: 0, slippage: 0 };
}

function bucketMapAdd(
    map: Map<string, AttributionBucket>,
    key: string,
    route: AttributionRoute,
    candidate: Partial<AttributionBucket>,
): void {
    const prior = map.get(key) ?? emptyBucket(key, route);
    map.set(key, {
        ...prior,
        acceptedCandidates: prior.acceptedCandidates + (candidate.acceptedCandidates ?? 0),
        acceptedTrades: prior.acceptedTrades + (candidate.acceptedTrades ?? 0),
        rejectedCandidates: prior.rejectedCandidates + (candidate.rejectedCandidates ?? 0),
        unfilledCandidates: prior.unfilledCandidates + (candidate.unfilledCandidates ?? 0),
        realizedPnl: prior.realizedPnl + (candidate.realizedPnl ?? 0),
        netPnl: prior.netPnl + (candidate.netPnl ?? 0),
        fee: prior.fee + (candidate.fee ?? 0),
        funding: prior.funding + (candidate.funding ?? 0),
        slippage: prior.slippage + (candidate.slippage ?? 0),
    });
}

function sortedBuckets(map: ReadonlyMap<string, AttributionBucket>): readonly AttributionBucket[] {
    return [...map.values()].sort((left, right) => right.netPnl - left.netPnl || left.key.localeCompare(right.key));
}

export function attributeReplay(replay: IntegratedReplay): AttributionReport {
    const evidence = replay as ReplayEvidence;
    const decisions = evidence.decisionLedger ?? [];
    const positions = evidence.tradeLedger ?? replay.positions;
    const byLogic = new Map<string, AttributionBucket>();
    const byStrategy = new Map<string, AttributionBucket>();
    const byDirection = new Map<string, AttributionBucket>();
    const bySymbol = new Map<string, AttributionBucket>();
    const byReason = new Map<string, AttributionBucket>();
    let acceptedCandidates = 0;
    let rejectedCandidates = 0;
    let unfilledCandidates = 0;

    for (const decision of decisions) {
        const route = routeFor(decision.strategy, decision.reason);
        const candidate: Partial<AttributionBucket> = decision.accepted
            ? { acceptedCandidates: 1, unfilledCandidates: decision.fill === null ? 1 : 0 }
            : { rejectedCandidates: 1 };
        if (decision.accepted) acceptedCandidates += 1;
        else rejectedCandidates += 1;
        if (decision.accepted && decision.fill === null) unfilledCandidates += 1;
        for (const [map, key] of [[byLogic, route], [byStrategy, decision.strategy], [byDirection, decision.direction], [bySymbol, decision.symbol], [byReason, decision.reason]] as const) {
            bucketMapAdd(map, key, route, candidate);
        }
    }

    let realizedPnl = 0;
    let grossRealizedPnl = 0;
    let netPnl = 0;
    let corePnl = 0;
    let overlayPnl = 0;
    for (const position of positions) {
        if (position.entryFill === null) continue;
        const route = routeFor(position.strategy, position.reason);
        const pnl = positionNetPnl(position);
        realizedPnl += pnl.netPnl;
        grossRealizedPnl += pnl.realizedPnl;
        netPnl += pnl.netPnl;
        if (route === "CORE") corePnl += pnl.netPnl;
        else overlayPnl += pnl.netPnl;
        const values: Partial<AttributionBucket> = {
            acceptedTrades: 1,
            realizedPnl: pnl.realizedPnl,
            netPnl: pnl.netPnl,
            fee: position.fee,
            funding: position.funding,
            slippage: position.slippage,
        };
        for (const [map, key] of [[byLogic, route], [byStrategy, position.strategy], [byDirection, position.direction], [bySymbol, position.symbol], [byReason, position.reason]] as const) {
            bucketMapAdd(map, key, route, values);
        }
    }

    const preemption = evidence.preemption ?? { supported: false, count: null, reason: "PREEMPTION_DATA_UNAVAILABLE" };
    return {
        sourceHash: replay.sourceHash,
        configHash: replay.configHash,
        resultHash: replay.resultHash,
        policyHash: replay.policyHash,
        acceptedCandidates,
        acceptedTrades: positions.filter((position) => position.entryFill !== null).length,
        rejectedCandidates,
        unfilledCandidates,
        realizedPnl,
        grossRealizedPnl,
        netPnl,
        fee: replay.fee,
        funding: replay.funding,
        slippage: replay.slippage,
        corePnl,
        overlayPnl,
        lostCorePnl: 0,
        preemption,
        byLogic: sortedBuckets(byLogic),
        byStrategy: sortedBuckets(byStrategy),
        byDirection: sortedBuckets(byDirection),
        bySymbol: sortedBuckets(bySymbol),
        byReason: sortedBuckets(byReason),
    };
}

function csvCell(value: string | number | boolean): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function assertSafeOutputDirectory(outDir: string): string {
    const resolved = resolve(outDir);
    if (basename(resolved).toLowerCase() === "desktop") throw new Error("RESEARCH_OUTPUT_MUST_NOT_BE_DESKTOP_ROOT");
    const repository = resolve(process.cwd());
    const fromRepository = relative(repository, resolved);
    if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) throw new Error("RESEARCH_OUTPUT_MUST_NOT_BE_INSIDE_REPOSITORY");
    return resolved;
}

export async function writeStageArtifacts(result: StageResult, outDir: string): Promise<StageArtifactIndex> {
    const resolvedOutDir = assertSafeOutputDirectory(outDir);
    await mkdir(resolvedOutDir, { recursive: true });
    const json = JSON.stringify(result, null, 2);
    const jsonl = `${JSON.stringify(result)}\n`;
    const csv = [
        "sourceHash,configHash,resultHash,stageId,strategy,direction,accepted,reason,fee,funding,slippage,policyHash,metrics",
        [result.sourceHash, result.configHash, result.resultHash, result.stageId, result.strategy, result.direction, result.accepted, result.reason, result.fee, result.funding, result.slippage, result.policyHash, JSON.stringify(result.metrics)].map(csvCell).join(","),
        "",
    ].join("\n");
    const artifactNames = ["stage-result.csv", "stage-result.jsonl", "stage-result.json"] as const;
    const contents = [csv, jsonl, json] as const;
    const files: { readonly path: string; readonly sha256: string; readonly bytes: number }[] = [];
    for (let index = 0; index < artifactNames.length; index += 1) {
        const path = resolve(resolvedOutDir, artifactNames[index]);
        await writeFile(path, contents[index], "utf8");
        const bytes = (await readFile(path)).byteLength;
        files.push({ path: artifactNames[index], sha256: createHash("sha256").update(contents[index], "utf8").digest("hex"), bytes });
    }
    const indexPath = resolve(resolvedOutDir, "sha256-index.json");
    await writeFile(indexPath, JSON.stringify({ stage: result, files }, null, 2), "utf8");
    return {
        sourceHash: result.sourceHash,
        configHash: result.configHash,
        resultHash: result.resultHash,
        stageId: result.stageId,
        artifactPaths: [...files.map((file) => resolve(resolvedOutDir, file.path)), indexPath],
        reason: result.reason,
        policyHash: result.policyHash,
    };
}
