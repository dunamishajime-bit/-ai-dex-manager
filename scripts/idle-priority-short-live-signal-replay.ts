import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import { computeIdlePriorityFeatures, evaluateIdlePriorityShort, type IdleH1Candle } from "../lib/idle-priority-short-signal";

// CI contract: exact 63 candidate keys, zero extras.
type ExpectedRow = { symbol: IdlePrioritySymbol; t: number; route: string; hold_h: number };
type Fixture = { schema: string; sourceSha256: string; windowStart: number; windowEnd: number; rows: ExpectedRow[] };

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

function canonicalRoute(route: string) {
    return route.replace(/^IDLE_/, "");
}

function key(row: ExpectedRow) {
    return [row.symbol, row.t, row.route, row.hold_h].join("|");
}

const dataRoot = arg("--data-root");
const expectedPath = arg("--expected") || "research/idle_priority_63_candidate_keys.json";
if (!dataRoot) throw new Error("USAGE: --data-root PATH [--expected PATH]");

const fixture = JSON.parse(readFileSync(expectedPath, "utf8")) as Fixture;
if (fixture.schema !== "disdex-idle-priority-candidate-keys/v1" || fixture.rows.length !== 63) {
    throw new Error("IDLE_LIVE_SIGNAL_REPLAY_FIXTURE_INVALID");
}

const symbols = Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as IdlePrioritySymbol[];
const market = Object.fromEntries(["BTCUSDT", ...symbols].map((symbol) => [symbol, loadH1(dataRoot, symbol)])) as Record<string, IdleH1Candle[]>;
const accepted: ExpectedRow[] = [];
const diagnostics = new Map<string, unknown>();
const lastBySymbol = new Map<IdlePrioritySymbol, number>();
const HOUR = 3_600_000;
const cooldownMs = IDLE_PRIORITY_SHORT_POLICY.cooldownHours * HOUR;

for (let decisionTs = fixture.windowStart; decisionTs <= fixture.windowEnd; decisionTs += HOUR) {
    for (const symbol of symbols) {
        let evaluated;
        try {
            const features = computeIdlePriorityFeatures(decisionTs, market[symbol], market.BTCUSDT);
            evaluated = evaluateIdlePriorityShort(symbol, features);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/IDLE_(INSUFFICIENT|H1_HISTORY_GAP|ATR_PREVCLOSE_GAP)/.test(message)) continue;
            throw error;
        }
        const rawKey = [symbol, decisionTs].join("|");
        diagnostics.set(rawKey, { accepted: evaluated.accepted, reason: evaluated.reason, features: evaluated.features, route: canonicalRoute(evaluated.route) });
        if (!evaluated.accepted) continue;
        const last = lastBySymbol.get(symbol) || 0;
        if (last > 0 && evaluated.features.signalTs - last < cooldownMs) {
            diagnostics.set(rawKey, { accepted: true, cooldownBlocked: true, previousAcceptedSignalTs: last, reason: evaluated.reason, features: evaluated.features, route: canonicalRoute(evaluated.route) });
            continue;
        }
        lastBySymbol.set(symbol, evaluated.features.signalTs);
        accepted.push({
            symbol,
            t: decisionTs,
            route: canonicalRoute(evaluated.route),
            hold_h: evaluated.holdHours,
        });
    }
}

const expectedKeys = new Set(fixture.rows.map(key));
const actualKeys = new Set(accepted.map(key));
const missing = fixture.rows.filter((row) => !actualKeys.has(key(row)));
const extras = accepted.filter((row) => !expectedKeys.has(key(row)));
if (missing.length || extras.length || accepted.length !== 63) {
    console.error(JSON.stringify({
        status: "IDLE_LIVE_SIGNAL_REPLAY_MISMATCH",
        expected: fixture.rows.length,
        actual: accepted.length,
        missing,
        extras: extras.slice(0, 80),
        missingDiagnostics: missing.slice(0, 20).map((row) => ({ row, diagnostic: diagnostics.get([row.symbol, row.t].join("|")) })),
        extraDiagnostics: extras.slice(0, 20).map((row) => ({ row, diagnostic: diagnostics.get([row.symbol, row.t].join("|")) })),
    }, null, 2));
    process.exit(1);
}

console.log(JSON.stringify({
    status: "PASS",
    expected: fixture.rows.length,
    actual: accepted.length,
    sourceSha256: fixture.sourceSha256,
    counts: Object.fromEntries(symbols.map((symbol) => [symbol, accepted.filter((row) => row.symbol === symbol).length])),
}));
