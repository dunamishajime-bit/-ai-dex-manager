import type { DynamicBaselineRun, DynamicBaselineResultSummary } from "./run-dynamic";

export interface BaselineAnchor {
    readonly costBps: 10 | 30;
    readonly final_equity_jpy: number;
    readonly jpy_profit_factor: number;
    readonly trades: number;
    readonly mtm_drawdown_pct: number;
}

export const DEFAULT_BASELINE_ANCHORS: Readonly<Record<10 | 30, BaselineAnchor>> = {
    10: {
        costBps: 10,
        final_equity_jpy: 222818966.8780,
        jpy_profit_factor: 3.4624474,
        trades: 1310,
        mtm_drawdown_pct: -15.6206368,
    },
    30: {
        costBps: 30,
        final_equity_jpy: 124289206.8183,
        jpy_profit_factor: 3.0820985,
        trades: 1307,
        mtm_drawdown_pct: -16.7877688,
    },
};

export interface FirstDivergence {
    readonly comparison_basis: "EVENT" | "ANCHOR_METRIC" | "ANCHOR_EVENT_LEDGER_MISSING";
    readonly metric: string | null;
    readonly baseline_value: number | string | null;
    readonly dynamic_value: number | string | null;
    readonly event_id: string | null;
    readonly timestamp_ms: number | null;
    readonly candidate_id: string | null;
    readonly strategy_id: string | null;
    readonly symbol: string | null;
    readonly allocator_state_before: unknown;
    readonly allocator_state_after: unknown;
    readonly wallet_before_jpy: number | null;
    readonly wallet_after_jpy: number | null;
    readonly gross: number | null;
    readonly rejection_reason: string | null;
    readonly preemption_reason: string | null;
    readonly reason: string;
}

export interface DynamicBaselineComparison {
    readonly anchor: BaselineAnchor;
    readonly parityClassification: "FORMAL_PARITY" | "REBUILT_BASELINE" | "BLOCKED_SOURCE_MISSING" | "BLOCKED_SOURCE_CLASSIFICATION" | "BLOCKED_INCOMPLETE_SOURCE_COVERAGE" | "BLOCKED_REPLAY";
    readonly metricsMatch: boolean;
    readonly comparedMetrics: Readonly<Record<string, { readonly baseline: number; readonly dynamic: number | null; readonly match: boolean }>>;
    readonly firstDivergence: FirstDivergence | null;
    readonly limitations: readonly string[];
}

type ComparableRun = Pick<DynamicBaselineRun, "manifest" | "result"> | {
    readonly manifest: Pick<DynamicBaselineRun["manifest"], "costBps" | "parityClassification">;
    readonly result: DynamicBaselineResultSummary;
};

function numeric(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function close(left: number | null, right: number): boolean {
    return left !== null && Math.abs(left - right) <= Math.max(1e-7, Math.abs(right) * 1e-9);
}

function firstEventDivergence(run: ComparableRun, anchor: BaselineAnchor): FirstDivergence | null {
    const ledger = run.result.execution_ledger;
    if (ledger.length === 0) return null;
    const first = ledger[0];
    return {
        comparison_basis: "ANCHOR_EVENT_LEDGER_MISSING",
        metric: null,
        baseline_value: null,
        dynamic_value: null,
        event_id: first.event_id,
        timestamp_ms: first.timestamp_ms,
        candidate_id: first.candidate_id,
        strategy_id: first.strategy_id,
        symbol: first.symbol,
        allocator_state_before: first.allocator_state_before,
        allocator_state_after: first.allocator_state_after,
        wallet_before_jpy: first.wallet_before_jpy,
        wallet_after_jpy: first.wallet_after_jpy,
        gross: first.gross,
        rejection_reason: first.rejection_reason,
        preemption_reason: first.preemption_reason,
        reason: `historical ${anchor.costBps}bps anchor has scalar metrics only; event-level parity cannot be proven`,
    };
}

function metricDivergence(run: ComparableRun, anchor: BaselineAnchor, metric: string, baseline: number, dynamic: number | null): FirstDivergence {
    return {
        comparison_basis: "ANCHOR_METRIC",
        metric,
        baseline_value: baseline,
        dynamic_value: dynamic,
        event_id: null,
        timestamp_ms: null,
        candidate_id: null,
        strategy_id: null,
        symbol: null,
        allocator_state_before: null,
        allocator_state_after: null,
        wallet_before_jpy: null,
        wallet_after_jpy: null,
        gross: null,
        rejection_reason: run.result.replay_rejection,
        preemption_reason: null,
        reason: `first comparable divergence is ${metric}; the anchor has no event ledger`,
    };
}

export function compareDynamicBaseline(run: ComparableRun, anchor: BaselineAnchor): DynamicBaselineComparison {
    if (run.manifest.costBps !== anchor.costBps) throw new Error(`ANCHOR_COST_MISMATCH: run=${run.manifest.costBps} anchor=${anchor.costBps}`);
    const comparedMetrics = {
        final_equity_jpy: { baseline: anchor.final_equity_jpy, dynamic: numeric(run.result.final_equity_jpy), match: close(numeric(run.result.final_equity_jpy), anchor.final_equity_jpy) },
        jpy_profit_factor: { baseline: anchor.jpy_profit_factor, dynamic: numeric(run.result.jpy_profit_factor), match: close(numeric(run.result.jpy_profit_factor), anchor.jpy_profit_factor) },
        trades: { baseline: anchor.trades, dynamic: numeric(run.result.trades), match: run.result.trades === anchor.trades },
        mtm_drawdown_pct: { baseline: anchor.mtm_drawdown_pct, dynamic: numeric(run.result.mtm_drawdown_pct), match: close(numeric(run.result.mtm_drawdown_pct), anchor.mtm_drawdown_pct) },
    };
    const metricsMatch = Object.values(comparedMetrics).every((metric) => metric.match);
    let firstDivergence: FirstDivergence | null = null;
    for (const [metric, values] of Object.entries(comparedMetrics)) {
        if (!values.match) {
            firstDivergence = firstEventDivergence(run, anchor) ?? metricDivergence(run, anchor, metric, values.baseline, values.dynamic);
            if (firstDivergence.comparison_basis !== "ANCHOR_EVENT_LEDGER_MISSING") firstDivergence = metricDivergence(run, anchor, metric, values.baseline, values.dynamic);
            break;
        }
    }
    const existing = run.manifest.parityClassification ?? "REBUILT_BASELINE";
    const parityClassification = existing.startsWith("BLOCKED_")
        ? existing
        : metricsMatch && run.result.execution_ledger.length > 0
            ? "REBUILT_BASELINE"
            : "REBUILT_BASELINE";
    return {
        anchor,
        parityClassification,
        metricsMatch,
        comparedMetrics,
        firstDivergence,
        limitations: [
            "Scalar historical anchors do not contain event-level allocator state, candidate rejection, or preemption ledgers.",
            "FORMAL_PARITY is not asserted unless source coverage, lifecycle evidence, and event-level anchor evidence are all available.",
        ],
    };
}

export interface CompareCliOptions {
    readonly runPath: string;
    readonly costBps: 10 | 30;
}

export async function compareDynamicBaselineFiles(options: CompareCliOptions): Promise<DynamicBaselineComparison> {
    const { readFile, stat } = await import("node:fs/promises");
    const { basename, dirname, resolve } = await import("node:path");
    const requestedPath = resolve(options.runPath);
    const metadata = await stat(requestedPath);
    let run: ComparableRun;
    if (metadata.isDirectory()) {
        const manifest = JSON.parse(await readFile(resolve(requestedPath, "manifest.json"), "utf8")) as ComparableRun["manifest"];
        const result = JSON.parse(await readFile(resolve(requestedPath, "result-summary.json"), "utf8")) as ComparableRun["result"];
        run = { manifest, result };
    } else if (basename(requestedPath) === "manifest.json") {
        const manifest = JSON.parse(await readFile(requestedPath, "utf8")) as ComparableRun["manifest"];
        const result = JSON.parse(await readFile(resolve(dirname(requestedPath), "result-summary.json"), "utf8")) as ComparableRun["result"];
        run = { manifest, result };
    } else {
        run = JSON.parse(await readFile(requestedPath, "utf8")) as ComparableRun;
    }
    return compareDynamicBaseline(run, DEFAULT_BASELINE_ANCHORS[options.costBps]);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("compare-dynamic-baseline.ts")) {
    const runPathIndex = process.argv.indexOf("--run");
    const costIndex = process.argv.indexOf("--cost-bps");
    const runPath = runPathIndex >= 0 ? process.argv[runPathIndex + 1] : undefined;
    const cost = costIndex >= 0 ? Number(process.argv[costIndex + 1]) : NaN;
    if (runPath === undefined || (cost !== 10 && cost !== 30)) {
        process.stderr.write("usage: compare-dynamic-baseline.ts --run <result-summary.json> --cost-bps 10|30\n");
        process.exitCode = 1;
    } else {
        compareDynamicBaselineFiles({ runPath, costBps: cost as 10 | 30 }).then((report) => {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        }).catch((error: unknown) => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
    }
}
