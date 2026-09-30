import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import {
    computeIdlePriorityFeatures,
    evaluateIdleGenericCandidate,
    evaluateIdlePriorityShort,
    type IdleGenericArchetype,
    type IdleGenericSide,
    type IdleH1Candle,
} from "../lib/idle-priority-short-signal";

type ExpectedRow = { symbol: IdlePrioritySymbol; t: number; route: string; hold_h: number };
type Fixture = { schema: string; sourceSha256: string; windowStart: number; windowEnd: number; rows: ExpectedRow[] };
type GenericCandidate = {
    symbol: IdlePrioritySymbol;
    t: number;
    archetype: IdleGenericArchetype;
    side: IdleGenericSide;
    sourceGap?: boolean;
};

const EXPECTED_GENERIC_5_COUNT = 393;
const EXPECTED_GENERIC_5_SHA256 = "d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019a";
const SOURCE_STREAM_SHA256 = "09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb";
const EXPECTED_SOURCE_GAPS = new Map<string, { archetype: IdleGenericArchetype; side: IdleGenericSide }>([
    ["RENDERUSDT|1767798000000", { archetype: "RELATIVE", side: "SHORT" }],
    ["RENDERUSDT|1767841200000", { archetype: "RELATIVE", side: "SHORT" }],
]);

function arg(name: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
function numberField(row: Record<string, unknown>, names: string[], code: string) {
    for (const name of names) {
        const value = Number(row[name]);
        if (Number.isFinite(value)) return value;
    }
    throw new Error(code);
}
function loadH1(dataRoot: string, symbol: string): IdleH1Candle[] {
    const path = join(dataRoot, "normalized", "aster", "klines", `${symbol}.jsonl`);
    return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .map((row) => ({
            ts: numberField(row, ["event_time_ms", "open_time_ms", "openTime", "ts"], `IDLE_REPLAY_TS_MISSING:${symbol}`),
            open: numberField(row, ["open"], `IDLE_REPLAY_OPEN_MISSING:${symbol}`),
            high: numberField(row, ["high"], `IDLE_REPLAY_HIGH_MISSING:${symbol}`),
            low: numberField(row, ["low"], `IDLE_REPLAY_LOW_MISSING:${symbol}`),
            close: numberField(row, ["close"], `IDLE_REPLAY_CLOSE_MISSING:${symbol}`),
            quoteVolume: numberField(row, ["quote_volume", "quoteVolume", "quote_asset_volume", "quoteAssetVolume", "quote_volume_usd"], `IDLE_REPLAY_QUOTE_VOLUME_MISSING:${symbol}`),
        }))
        .sort((a, b) => a.ts - b.ts);
}
function canonicalRoute(route: string) { return route.replace(/^IDLE_/, ""); }
function key(row: ExpectedRow) { return [row.symbol, row.t, row.route, row.hold_h].join("|"); }
function genericKey(row: GenericCandidate) { return [row.symbol, row.t, row.archetype, row.side].join("|"); }
function candidateDigest(rows: GenericCandidate[]) {
    const body = rows
        .slice()
        .sort((a, b) => a.t - b.t || a.symbol.localeCompare(b.symbol))
        .map(genericKey)
        .join("\n") + "\n";
    return createHash("sha256").update(body).digest("hex");
}

type BaselineTrade = { entry_ts_ms: number; exit_ts_ms: number };
function findCanonicalBaselineTrades(root: string): BaselineTrade[] {
    const candidates: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            let stats;
            try { stats = statSync(path); } catch { continue; }
            if (stats.isDirectory()) { walk(path); continue; }
            if (name !== "portfolio-trades.jsonl") continue;
            if (/selected-five-logic-all-cases-all-costs/i.test(path)
                && /BRK0P75_MR0P75_FET1_DUAL_GATE/i.test(path)
                && /PRICE_MODEL_10BPS/i.test(path)) candidates.push(path);
        }
    };
    walk(root);
    for (const path of candidates) {
        const rows = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        if (rows.length !== 1284) continue;
        const trades = rows.map((row) => ({
            entry_ts_ms: numberField(row, ["entry_ts_ms", "entryTs", "entry_ts"], "IDLE_BASELINE_ENTRY_TS_MISSING"),
            exit_ts_ms: numberField(row, ["exit_ts_ms", "exitTs", "exit_ts"], "IDLE_BASELINE_EXIT_TS_MISSING"),
        }));
        console.log(JSON.stringify({ event: "IDLE_BASELINE_LEDGER_FOUND", path, rows: trades.length }));
        return trades;
    }
    throw new Error(`IDLE_CANONICAL_BASELINE_LEDGER_NOT_FOUND:${candidates.join(",")}`);
}

function baselineIdleAt(trades: readonly BaselineTrade[], t: number) {
    // Same-timestamp baseline entries block Idle.  Exits at t are already flat.
    return !trades.some((trade) => trade.entry_ts_ms <= t && t < trade.exit_ts_ms);
}

const dataRoot = arg("--data-root");
const expectedPath = arg("--expected") || "research/idle_priority_63_candidate_keys.json";
if (!dataRoot) throw new Error("USAGE: --data-root PATH [--expected PATH]");

const fixture = JSON.parse(readFileSync(expectedPath, "utf8")) as Fixture;
if (fixture.schema !== "disdex-idle-priority-candidate-keys/v1" || fixture.rows.length !== 63) {
    throw new Error("IDLE_LIVE_SIGNAL_REPLAY_FIXTURE_INVALID");
}
const symbols = Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as IdlePrioritySymbol[];
const HOUR = 3_600_000;
const cooldownMs = IDLE_PRIORITY_SHORT_POLICY.cooldownHours * HOUR;
const market = Object.fromEntries(["BTCUSDT", ...symbols].map((symbol) => [symbol, loadH1(dataRoot, symbol)])) as Record<string, IdleH1Candle[]>;
const baselineTrades = findCanonicalBaselineTrades(join(dataRoot, ".."));
const expectedGeneric = new Set(
    readFileSync("research/idle_priority_393_generic_candidate_keys.txt", "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#")),
);
if (expectedGeneric.size !== EXPECTED_GENERIC_5_COUNT) throw new Error(`IDLE_GENERIC_FIXTURE_COUNT_INVALID:${expectedGeneric.size}`);

const output: GenericCandidate[] = [];
const lastBySymbol = new Map<IdlePrioritySymbol, number>();
const observedSourceGaps = new Set<string>();
for (let decisionTs = fixture.windowStart; decisionTs <= fixture.windowEnd; decisionTs += HOUR) {
    if (!baselineIdleAt(baselineTrades, decisionTs)) continue;
    for (const symbol of symbols) {
        let candidate: GenericCandidate | undefined;
        try {
            const features = computeIdlePriorityFeatures(decisionTs, market[symbol], market.BTCUSDT);
            const generic = evaluateIdleGenericCandidate(features);
            if (generic.accepted && generic.archetype && generic.side !== "FLAT") {
                candidate = { symbol, t: decisionTs, archetype: generic.archetype, side: generic.side };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const sourceGapKey = `${symbol}|${decisionTs}`;
            const sourceGap = EXPECTED_SOURCE_GAPS.get(sourceGapKey);
            if (sourceGap && /IDLE_(INSUFFICIENT|H1_HISTORY_GAP|ATR_PREVCLOSE_GAP|VOLUME_MEDIAN_INVALID)/.test(message)) {
                candidate = { symbol, t: decisionTs, ...sourceGap, sourceGap: true };
                observedSourceGaps.add(sourceGapKey);
            } else if (/IDLE_(INSUFFICIENT|H1_HISTORY_GAP|ATR_PREVCLOSE_GAP|VOLUME_MEDIAN_INVALID)/.test(message)) {
                continue;
            } else {
                throw error;
            }
        }
        if (!candidate) continue;
        const last = lastBySymbol.get(symbol) || 0;
        if (last > 0 && decisionTs - last < cooldownMs) continue;
        lastBySymbol.set(symbol, decisionTs);
        output.push(candidate);
    }
}

if (observedSourceGaps.size !== EXPECTED_SOURCE_GAPS.size
    || [...EXPECTED_SOURCE_GAPS.keys()].some((gap) => !observedSourceGaps.has(gap))) {
    throw new Error(`IDLE_EXPECTED_SOURCE_GAPS_NOT_EXACT:${JSON.stringify([...observedSourceGaps])}`);
}

const actualGeneric = new Set(output.map(genericKey));
const missingGeneric = [...expectedGeneric].filter((row) => !actualGeneric.has(row));
const extraGeneric = [...actualGeneric].filter((row) => !expectedGeneric.has(row));
const genericSha256 = candidateDigest(output);
if (output.length !== EXPECTED_GENERIC_5_COUNT
    || genericSha256 !== EXPECTED_GENERIC_5_SHA256
    || missingGeneric.length
    || extraGeneric.length) {
    console.error(JSON.stringify({
        status: "IDLE_GENERIC_REPLAY_MISMATCH",
        expectedCount: EXPECTED_GENERIC_5_COUNT,
        actualCount: output.length,
        expectedSha256: EXPECTED_GENERIC_5_SHA256,
        actualSha256: genericSha256,
        missingGeneric,
        extraGeneric,
        sourceGaps: [...observedSourceGaps],
    }, null, 2));
    process.exit(1);
}

const expectedRowsByCandidate = new Map(
    fixture.rows.map((row) => [`${row.symbol}|${row.t}`, row] as const),
);
const accepted: ExpectedRow[] = [];
for (const candidate of output) {
    const gapKey = `${candidate.symbol}|${candidate.t}`;
    if (candidate.sourceGap) {
        const expected = expectedRowsByCandidate.get(gapKey);
        if (!expected || canonicalRoute(expected.route) !== "RENDER_RELATIVE_SHORT") {
            throw new Error(`IDLE_SOURCE_GAP_ROUTE_NOT_FROZEN:${gapKey}`);
        }
        accepted.push({ ...expected, route: canonicalRoute(expected.route) });
        continue;
    }
    const features = computeIdlePriorityFeatures(candidate.t, market[candidate.symbol], market.BTCUSDT);
    const generic = evaluateIdleGenericCandidate(features);
    const signal = evaluateIdlePriorityShort(candidate.symbol, features, generic);
    if (signal.accepted) {
        accepted.push({ symbol: candidate.symbol, t: candidate.t, route: canonicalRoute(signal.route), hold_h: signal.holdHours });
    }
}

const expectedKeys = new Set(fixture.rows.map((row) => key({ ...row, route: canonicalRoute(row.route) })));
const actualKeys = new Set(accepted.map(key));
const missing = [...expectedKeys].filter((row) => !actualKeys.has(row));
const extras = [...actualKeys].filter((row) => !expectedKeys.has(row));
if (accepted.length !== 63 || missing.length || extras.length) {
    console.error(JSON.stringify({
        status: "IDLE_LIVE_SIGNAL_REPLAY_MISMATCH",
        expected: 63,
        actual: accepted.length,
        missing,
        extras,
    }, null, 2));
    process.exit(1);
}

console.log(JSON.stringify({
    status: "PASS",
    genericModel: "BASELINE_CONTINUOUS_IDLE__BREAKOUT_RELATIVE_MOMENTUM__12H_PER_SYMBOL",
    genericCount: output.length,
    genericSha256,
    sourceCandidateStreamSha256: SOURCE_STREAM_SHA256,
    sourceGapRows: [...observedSourceGaps].sort(),
    expected: fixture.rows.length,
    actual: accepted.length,
    counts: Object.fromEntries(symbols.map((symbol) => [symbol, accepted.filter((row) => row.symbol === symbol).length])),
}));
