/**
 * Task 9 native unified 8-strategy modeled economics.
 * Independently recomputes PF, drawdown and wallet from the SAME full8 ledger.
 * The old independent TypeScript allocator remains research diagnostic only.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import policy from "../../config/research/task9-unified-v12-short-20261021.json";

type Row = Record<string, unknown>;
const REPO = resolve(fileURLToPath(import.meta.url), "../..");
const ID = "V12_SHORT_PCT2P5_12H_MFE1P0_R12";
const HOUR = 3600000;
const STRATEGIES = new Set(["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"]);

function required(value: unknown, label: string): asserts value {
    if (!value) throw new Error("TASK9_NATIVE_PARITY_FAIL_CLOSED: " + label);
}
function object(value: unknown, label: string): Row {
    required(value !== null && typeof value === "object" && !Array.isArray(value), label);
    return value as Row;
}
function numeric(value: unknown, label: string): number {
    required(typeof value === "number" && Number.isFinite(value), label);
    return value as number;
}
function string(value: unknown, label: string): string {
    required(typeof value === "string" && value.length > 0, label);
    return value as string;
}
function match(actual: number, expected: number, label: string): void {
    required(Math.abs(actual - expected) <= Math.max(1e-6, Math.max(Math.abs(actual), Math.abs(expected)) * 2e-10),
        label + " diff: " + actual + " / " + expected);
}
function fromJson(path: string): Row {
    return object(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
}
function rows(path: string): Row[] {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => object(JSON.parse(line) as unknown, path));
}
function hash(path: string): string {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function sourceDir(root: string, cost: number, isBaseline: boolean): string {
    const stage = isBaseline ? "BASELINE" : "V12_SHORT";
    const exp = isBaseline ? "BASELINE" : "RERUN_" + ID + "_" + cost;
    return resolve(root, "engine", stage, exp, cost + "bps", "cases",
        "V2_M150_D05_CORE_NATIVE", "runs", "PRICE_MODEL_" + cost + "BPS");
}

function audit(root: string, cost: number, isBaseline: boolean, pythonAudit: Row): Row {
    const dir = sourceDir(root, cost, isBaseline);
    const listed = object(pythonAudit.sha256, "source SHA ledger");
    const fileList = ["candidate-decisions.jsonl", "portfolio-trades.jsonl",
        "portfolio-events.jsonl", "task9-mtm.jsonl", "metrics.json"];
    for (const file of fileList) {
        required(hash(resolve(dir, file)) === string(listed[file], file), "source hash drift " + file);
    }
    const metrics = fromJson(resolve(dir, "metrics.json"));
    const decisions = rows(resolve(dir, "candidate-decisions.jsonl"));
    const trades = rows(resolve(dir, "portfolio-trades.jsonl"));
    const events = rows(resolve(dir, "portfolio-events.jsonl"));
    const mtm = rows(resolve(dir, "task9-mtm.jsonl"));
    required(decisions.length === 3185 && mtm.length === 8761, "full-year source coverage");
    const strategies = new Set(decisions.map((row) => row.strategy_id));
    required(strategies.size === 8 && [...strategies].every((name) => STRATEGIES.has(String(name))),
        "eight-strategy coverage");
    const accepted = decisions.filter((row) => row.decision === "ACCEPTED_MODELED_ENTRY");
    const excluded = decisions.filter((row) => row.decision === "EXCLUDED_PREALLOCATION");
    required(excluded.length === 16 && accepted.length === trades.length, "trades/decisions count");
    const aIds = new Set(accepted.map((row) => string(row.candidate_id, "candidate id")));
    const tIds = new Set(trades.map((row) => string(row.candidate_id, "trade id")));
    required(aIds.size === tIds.size && [...aIds].every((id) => tIds.has(id)), "accepted-trades linkage");
    const gained = trades.reduce((sum, row) => sum + Math.max(0, numeric(row.total_pnl_jpy, "trade pnl")), 0);
    const lost = trades.reduce((sum, row) => sum + Math.max(0, -numeric(row.total_pnl_jpy, "trade pnl")), 0);
    required(lost > 0, "profit factor denominator");
    const pf = gained / lost;
    const dd = Math.min(...mtm.map((row) => numeric(row.drawdown_pct, "H1 drawdown")));
    const equity = numeric(mtm[mtm.length - 1]?.equity_jpy, "last H1 equity");
    match(pf, numeric(metrics.profit_factor, "source PF"), "PF");
    match(dd / 100, numeric(metrics.maximum_mtm_drawdown, "source DD"), "maxDD");
    match(equity, numeric(metrics.final_equity_jpy, "source equity"), "last equity");
    match(pf, numeric(pythonAudit.profitFactor, "Python PF"), "Python/TS PF");
    match(dd, numeric(pythonAudit.maxDrawdownPct, "Python DD"), "Python/TS DD");
    match(equity, numeric(pythonAudit.finalEquityJpy, "Python equity"), "Python/TS equity");
    required(trades.length === numeric(pythonAudit.tradeCount, "Python trade count"), "Python/TS count");
    const stopTrades = trades.filter((row) =>
        String(row.exit_reason_actual).startsWith("RESEARCH_INITIAL_ADVERSE_STOP_" + ID));
    const stops = events.filter((row) => row.event_type === "TASK9_MODELED_STOP_COOLDOWN");
    const rejections = decisions.filter((row) => row.reason === "V12:TASK9_ADVERSE_SIDE_COOLDOWN");
    required(stopTrades.length === stops.length, "STOP/cooldown event count");
    if (isBaseline) {
        required(stopTrades.length === 0 && rejections.length === 0, "baseline contaminated");
    } else {
        required(stopTrades.length > 0 && rejections.length > 0, "STOP not causal");
    }
    for (const item of stops) {
        required(numeric(item.until_ts_ms, "expiry") - numeric(item.ts_ms, "STOP timestamp")
            === policy.reentryHours * HOUR, "STOP expiry mismatch");
        required(item.source_venue_signed === false, "modeled stop claimed signed");
    }
    for (let index = 1; index < mtm.length; index += 1) {
        required(numeric(mtm[index]?.timestamp_ms, "mark time") -
            numeric(mtm[index - 1]?.timestamp_ms, "prior mark") === HOUR, "H1 mark gap");
    }
    required(numeric(pythonAudit.modeledStopExits, "Python STOPs") === stopTrades.length,
        "Python/TS STOP count");
    required(numeric(pythonAudit.stopCooldownRejected, "Python rejected") === rejections.length,
        "Python/TS cooldown rejection count");
    required(object(metrics.accounting_reconciliation, "reconciliation").status === "PASS",
        "failed source accounting");
    return {
        finalEquityJpy: equity, profitFactor: pf, maxDrawdownPct: dd,
        tradeCount: trades.length, actionCandidates: decisions.length - excluded.length,
        confirmedModeledStops: stopTrades.length, modeledCooldownRejections: rejections.length,
        h1MtmPoints: mtm.length, allSourcesShaVerified: true,
    };
}

export function verifyTask9NativeUnified(modelRoot: string, proofPath: string): Row {
    const proof = fromJson(proofPath);
    required(proof.status === "PASS_NATIVE_SINGLE_CORE_FULL8_ECONOMIC_AND_STOP_CAUSAL_PARITY",
        "Python native proof not passed");
    required(proof.productionChanges === 0 && proof.liveChanges === 0, "LIVE source mutation");
    required(proof.standaloneTsReducerEconomicParityProven === false, "separate allocator unproved");
    required(policy.policyId === ID && policy.coordinatorOnly, "shared policy mismatch");
    const scenarios = object(proof.scenarios, "Python scenarios");
    const matrix: Row = {};
    for (const cost of [10, 30]) {
        const item = object(scenarios[String(cost)], "Python cost scenario");
        const baseline = audit(modelRoot, cost, true, object(item.baseline, "Python baseline"));
        const stop = audit(modelRoot, cost, false, object(item.stopWithConfirmedCooldown, "Python stop"));
        const anchor = policy.standaloneBaselineAnchors[(cost === 10 ? "10bps" : "30bps")];
        match(numeric(baseline.finalEquityJpy, "baseline equity"), anchor.finalEquityJpy, "frozen baseline equity");
        match(numeric(baseline.profitFactor, "baseline PF"), anchor.profitFactor, "frozen baseline PF");
        match(numeric(baseline.maxDrawdownPct, "baseline DD"), anchor.maxDrawdownPct, "frozen baseline DD");
        required(baseline.tradeCount === anchor.closedTrades, "frozen trade count");
        const ddImprovementPp = numeric(stop.maxDrawdownPct, "stop DD") -
            numeric(baseline.maxDrawdownPct, "base DD");
        required(ddImprovementPp > 0, "STOP DD did not improve");
        const equityRetention = numeric(stop.finalEquityJpy, "stop equity") /
            numeric(baseline.finalEquityJpy, "base equity");
        matrix[String(cost)] = { baseline, stopWithConfirmedCooldown: stop,
            equityRetention, ddImprovementPp };
    }
    const cost30 = object(matrix["30"], "30bps result");
    return {
        schemaVersion: 1,
        status: "PASS_NATIVE_SINGLE_ECONOMIC_CORE_CROSS_LANGUAGE_PARITY",
        policyId: ID,
        sameNativeAllocationFillFundingExitMtmSource: true,
        separateTypeScriptReducerParityProven: false,
        venueFillParityProven: false,
        productionChanges: 0, liveChanges: 0,
        costResults: matrix,
        researchGate: numeric(cost30.equityRetention, "30bps retention") >= 0.75
            ? "RESEARCH_ONLY_NOT_VENUE_CERTIFIED"
            : "FAIL_BELOW_75PCT_30BPS_EQUITY_RETENTION",
    };
}
function main(): void {
    function flag(key: string): string {
        const i = process.argv.indexOf(key);
        required(i >= 0 && i + 1 < process.argv.length, "missing CLI " + key);
        return process.argv[i + 1] as string;
    }
    const root = resolve(flag("--model-root"));
    const proof = resolve(flag("--native-audit"));
    const output = resolve(flag("--output"));
    const rel = relative(REPO, output);
    required(rel !== "" && (rel.startsWith("..") || isAbsolute(rel)), "raw outputs inside repository");
    const report = verifyTask9NativeUnified(root, proof);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write(JSON.stringify({
        status: report.status, researchGate: report.researchGate,
        output, productionChanges: 0,
    }) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error) {
        process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
        process.exitCode = 1;
    }
}
