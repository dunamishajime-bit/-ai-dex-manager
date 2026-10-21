import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
    BaselineSummary,
    CandidateSummary,
    ComparisonReport,
    JsonValue,
    StageResult,
} from "../../lib/backtest/dd-reduction/types";

function finiteMetric(result: StageResult, key: string, fallback = 0): number {
    const value = result.metrics[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function baselineSummary(result: StageResult): BaselineSummary {
    return {
        sourceHash: result.sourceHash,
        configHash: result.configHash,
        resultHash: result.resultHash,
        strategy: result.strategy,
        direction: result.direction,
        policyHash: result.policyHash,
        reason: result.reason,
        fee: result.fee,
        funding: result.funding,
        slippage: result.slippage,
        metrics: result.metrics,
    };
}

function candidateSummary(result: StageResult): CandidateSummary {
    return {
        sourceHash: result.sourceHash,
        configHash: result.configHash,
        resultHash: result.resultHash,
        candidateId: result.runId ?? result.stageId,
        stageId: result.stageId as CandidateSummary["stageId"],
        strategy: result.strategy,
        direction: result.direction,
        policyHash: result.policyHash,
        accepted: result.accepted,
        status: result.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "AVAILABLE",
        candidatePolicy: null,
        reason: result.reason,
        fee: result.fee,
        funding: result.funding,
        slippage: result.slippage,
        metrics: result.metrics,
    };
}

export function compareStage(baseline: StageResult, candidate: StageResult): ComparisonReport {
    if (baseline.sourceHash !== candidate.sourceHash) throw new Error("COMPARISON_SOURCE_MISMATCH");
    if (baseline.configHash !== candidate.configHash) throw new Error("COMPARISON_CONFIG_MISMATCH");
    if (baseline.stageId !== candidate.stageId) throw new Error("COMPARISON_STAGE_MISMATCH");
    const firstDivergenceValue = finiteMetric(candidate, "firstDivergenceTs", -1);
    const ddDecomposition: Readonly<Record<string, number>> = {
        baselineMaxDrawdown: finiteMetric(baseline, "maxDrawdown"),
        candidateMaxDrawdown: finiteMetric(candidate, "maxDrawdown"),
        normalDdImprovementBps: finiteMetric(candidate, "normalDdImprovementBps"),
        severeDdImprovementBps: finiteMetric(candidate, "severeDdImprovementBps"),
        oosDdImprovementBps: finiteMetric(candidate, "oosDdImprovementBps"),
        walkForwardImprovementBps: finiteMetric(candidate, "walkForwardImprovementBps"),
    };
    return {
        sourceHash: baseline.sourceHash,
        configHash: baseline.configHash,
        resultHash: candidate.resultHash,
        policyHash: candidate.policyHash,
        baseline: baselineSummary(baseline),
        candidate: candidateSummary(candidate),
        firstDivergenceTs: firstDivergenceValue >= 0 ? firstDivergenceValue : null,
        reason: candidate.reason,
        fee: candidate.fee,
        funding: candidate.funding,
        slippage: candidate.slippage,
        directPnl: finiteMetric(candidate, "directPnl", finiteMetric(candidate, "netPnl")),
        lostPriorLogicPnl: finiteMetric(candidate, "lostPriorLogicPnl"),
        feeDelta: candidate.fee - baseline.fee,
        fundingDelta: candidate.funding - baseline.funding,
        slippageDelta: candidate.slippage - baseline.slippage,
        grossConflicts: finiteMetric(candidate, "grossConflicts"),
        ddDecomposition,
    };
}

async function readStageResult(path: string): Promise<StageResult> {
    const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as JsonValue;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("STAGE_RESULT_INVALID");
    return parsed as unknown as StageResult;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const baselinePath = process.argv[2];
    const candidatePath = process.argv[3];
    if (baselinePath === undefined || candidatePath === undefined) {
        process.stderr.write("usage: compare-stage.ts <baseline-result.json> <candidate-result.json>\n");
        process.exitCode = 1;
    } else {
        Promise.all([readStageResult(baselinePath), readStageResult(candidatePath)]).then(([baseline, candidate]) => {
            process.stdout.write(`${JSON.stringify(compareStage(baseline, candidate), null, 2)}\n`);
        }).catch((error: unknown) => {
            process.stderr.write(`${error instanceof Error ? error.message : "comparison failed"}\n`);
            process.exitCode = 1;
        });
    }
}
