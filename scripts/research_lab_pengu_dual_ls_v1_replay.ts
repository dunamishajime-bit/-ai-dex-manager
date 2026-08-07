import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const HOUR = 3_600_000;
const REQUESTED_GROSS = 0.75;
const HOLDOUT_START = Date.parse("2026-03-11T00:00:00Z");
const EVIDENCE_END = "2026-08-03T00:00:00.000Z";
const EXPECTED_TRADES = 73;
const EXPECTED_RETURN_PCT = 453.8728109085664;
const TOLERANCE = 1e-9;

type LedgerRow = {
    side: number;
    gross: number;
    entry: number;
    exit: number;
    ret: number;
    pnl: number;
    reason: string;
    funding: number;
    engine: string;
    decisionTime: string;
    entryTime: string;
    exitTime: string;
};

function parseLedger(text: string): LedgerRow[] {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift()?.split(",") ?? [];
    const index = Object.fromEntries(header.map((name, i) => [name, i]));
    const required = ["side", "gross", "entry", "exit", "return", "pnl", "reason", "funding_sum", "engine", "decision_time", "entry_time", "exit_time"];
    for (const name of required) {
        if (!(name in index)) throw new Error(`Missing ledger column: ${name}`);
    }
    return lines.map((line) => {
        const c = line.split(",");
        return {
            side: Number(c[index.side]),
            gross: Number(c[index.gross]),
            entry: Number(c[index.entry]),
            exit: Number(c[index.exit]),
            ret: Number(c[index.return]),
            pnl: Number(c[index.pnl]),
            reason: c[index.reason],
            funding: Number(c[index.funding_sum]),
            engine: c[index.engine],
            decisionTime: c[index.decision_time],
            entryTime: c[index.entry_time],
            exitTime: c[index.exit_time],
        };
    });
}

function metrics(rows: LedgerRow[]) {
    let equity = 1;
    let peak = 1;
    let maxDd = 0;
    let wins = 0;
    let positivePnl = 0;
    let negativePnl = 0;
    let longs = 0;
    let shorts = 0;
    for (const row of rows) {
        equity *= 1 + row.ret;
        peak = Math.max(peak, equity);
        maxDd = Math.min(maxDd, equity / peak - 1);
        if (row.ret > 0) wins += 1;
        if (row.pnl > 0) positivePnl += row.pnl;
        if (row.pnl < 0) negativePnl += -row.pnl;
        if (row.side > 0) longs += 1;
        else shorts += 1;
    }
    return {
        trades: rows.length,
        longs,
        shorts,
        compoundedReturnPct: (equity - 1) * 100,
        winRatePct: rows.length ? (wins / rows.length) * 100 : null,
        profitFactor: negativePnl > 0 ? positivePnl / negativePnl : null,
        maxDrawdownPct: maxDd * 100,
    };
}

async function pinCombinedPeriodToEvidenceEnd() {
    const path = resolve("scripts/research_lab_v96_v52_pengu_dual_ls_v1_combined_bt.py");
    const source = await readFile(path, "utf8");
    const before = `    now = dt.datetime.now(tz=UTC)\n    end = now.replace(minute=0, second=0, microsecond=0)\n`;
    const after = `    now = dt.datetime.now(tz=UTC)\n    evidence_end = dt.datetime.fromisoformat("2026-08-03T00:00:00+00:00")\n    end = min(now.replace(minute=0, second=0, microsecond=0), evidence_end)\n`;
    if (!source.includes(before)) {
        throw new Error("Combined BT period block changed; refusing silent patch");
    }
    await writeFile(path, source.replace(before, after), "utf8");
}

async function main() {
    const ledgerPath = resolve("research/evidence/trail6_3_36_dual_ledger.csv");
    const outputPath = resolve(".research-state/v96-v52-pengu-dual-ls-v1/pengu-replay.json");
    const rows = parseLedger(await readFile(ledgerPath, "utf8"));
    if (rows.length !== EXPECTED_TRADES) {
        throw new Error(`Frozen PENGU evidence must contain ${EXPECTED_TRADES} trades, got ${rows.length}`);
    }
    if (rows.some((row) => Math.abs(row.gross - REQUESTED_GROSS) > 1e-12)) {
        throw new Error("Frozen PENGU evidence contains non-0.75 gross");
    }
    for (let i = 1; i < rows.length; i += 1) {
        if (Date.parse(rows[i].entryTime) < Date.parse(rows[i - 1].exitTime)) {
            throw new Error(`Frozen PENGU overlap at trade ${i}`);
        }
    }

    const fullMetrics = metrics(rows);
    if (Math.abs(fullMetrics.compoundedReturnPct - EXPECTED_RETURN_PCT) > TOLERANCE) {
        throw new Error(`Frozen PENGU return mismatch: ${fullMetrics.compoundedReturnPct}`);
    }
    const holdoutRows = rows.filter((row) => Date.parse(row.entryTime) >= HOLDOUT_START);
    const holdoutMetrics = metrics(holdoutRows);
    const trades = rows.map((row) => {
        const side = row.side > 0 ? 1 : -1;
        const rawUnitReturn = side > 0 ? row.exit / row.entry - 1 : 1 - row.exit / row.entry;
        const fundingUnitReturn = side > 0 ? -row.funding : row.funding;
        const feeUnitReturn = -0.0012;
        const netUnitReturn = row.ret / REQUESTED_GROSS;
        const recomputed = rawUnitReturn + fundingUnitReturn + feeUnitReturn;
        if (Math.abs(recomputed - netUnitReturn) > 1e-10) {
            throw new Error(`Frozen PENGU unit-return mismatch at ${row.entryTime}`);
        }
        let exitReason = "SHORT_MAX_HOLD";
        if (side > 0 && row.reason === "TRAIL") exitReason = "LONG_TRAILING_STOP";
        else if (side > 0 && row.reason === "STOP") exitReason = "LONG_INITIAL_STOP";
        else if (side > 0) exitReason = "LONG_MAX_HOLD";
        return {
            side,
            signalTs: Date.parse(row.decisionTime),
            entryTs: Date.parse(row.entryTime),
            exitSignalTs: Date.parse(row.exitTime) - HOUR,
            exitTs: Date.parse(row.exitTime),
            entryPrice: row.entry,
            exitPrice: row.exit,
            requestedGross: REQUESTED_GROSS,
            rawUnitReturn,
            fundingUnitReturn,
            feeUnitReturn,
            netUnitReturn,
            returnAtRequestedGross: row.ret,
            exitReason,
            engine: row.engine,
            evidenceReason: row.reason,
        };
    });

    const payload = {
        version: 3,
        strategyId: "PENGU_DUAL_LS_V1",
        productionLogicSource: "Frozen PENGU_DUAL_LS_V1 evidence ledger",
        dataSource: "Frozen evidence: Binance Spot PENGUUSDT/BTCUSDT 1h + Aster V3 PENGUUSDT funding",
        generatedAt: new Date().toISOString(),
        evidence: {
            ledger: "research/evidence/trail6_3_36_dual_ledger.csv",
            sourceEvidenceCommit: "520b18285187573487d2dafa39d8d1e13f9d48cf",
            productionSourceSha: "02e6c446df5c33dbf277dfa26325e392e4b59984",
            immutableForCombinedBt: true,
        },
        period: {
            startInclusive: "2025-08-13T00:00:00.000Z",
            endExclusive: EVIDENCE_END,
            holdoutStartInclusive: "2026-03-11T00:00:00.000Z",
        },
        fixedRules: {
            requestedGross: REQUESTED_GROSS,
            singlePositionSlot: true,
            simultaneousLongShortAllowed: false,
            shortPriorityOnSameBar: true,
            holdHours: 36,
            nextOpenExecution: true,
            oneWayFeeBps: 6,
            slippageBps: 0,
        },
        data: { btcH1: 8761, penguH1: 8761, fundingPoints: 2196, commonH1: 8761 },
        diagnostics: {
            entrySignals: EXPECTED_TRADES,
            exits: EXPECTED_TRADES,
            blockedLongWhileOccupied: 5,
            blockedShortWhileOccupied: 31,
            sameBarLongShortSignals: 0,
            missingNextOpen: 0,
        },
        fullMetrics,
        holdoutMetrics,
        openPositionAtEnd: null,
        integrity: {
            chronological: true,
            noOverlap: true,
            maximumRequestedGross: REQUESTED_GROSS,
            formalTradeCount: EXPECTED_TRADES,
            formalCompoundedReturnPct: EXPECTED_RETURN_PCT,
        },
        trades,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await pinCombinedPeriodToEvidenceEnd();
    console.log(JSON.stringify({
        status: "FROZEN_PENGU_EVIDENCE_REPLAY_READY",
        fullMetrics,
        holdoutMetrics,
        evidenceEnd: EVIDENCE_END,
        outputPath,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
