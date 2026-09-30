import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

function diagnoseReleaseCandidateSources(root: string) {
    const hits: Array<{ path: string; snippets: string[] }> = [];
    const wanted = /idle_candidate_events|gross12|net12|candidate_events/i;
    const allowed = /\.(py|ts|js|mjs|cjs|md|txt|json)$/i;
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (hits.length >= 20) return;
            const path = join(dir, name);
            let stats;
            try { stats = statSync(path); } catch { continue; }
            if (stats.isDirectory()) { walk(path); continue; }
            if (!allowed.test(name) || stats.size > 2_000_000) continue;
            let text = "";
            try { text = readFileSync(path, "utf8"); } catch { continue; }
            if (!wanted.test(text)) continue;
            const lines = text.split(/\r?\n/);
            const indexes = lines.map((line, index) => wanted.test(line) ? index : -1).filter((index) => index >= 0).slice(0, 4);
            hits.push({
                path,
                snippets: indexes.map((index) => lines.slice(Math.max(0, index - 8), Math.min(lines.length, index + 16)).join("\n")),
            });
        }
    };
    try { walk(root); } catch {}
    console.log(JSON.stringify({ event: "IDLE_RELEASE_CANDIDATE_SOURCE_DIAGNOSTIC", root, hits }));
}

diagnoseReleaseCandidateSources(join(dataRoot, ".."));
const fixture = JSON.parse(readFileSync(expectedPath, "utf8")) as Fixture;
if (fixture.schema !== "disdex-idle-priority-candidate-keys/v1" || fixture.rows.length !== 63) {
    throw new Error("IDLE_LIVE_SIGNAL_REPLAY_FIXTURE_INVALID");
}

const symbols = Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as IdlePrioritySymbol[];
const HOUR = 3_600_000;
const cooldownMs = IDLE_PRIORITY_SHORT_POLICY.cooldownHours * HOUR;
const market = Object.fromEntries(["BTCUSDT", ...symbols].map((symbol) => [symbol, loadH1(dataRoot, symbol)])) as Record<string, IdleH1Candle[]>;

type GenericArchetype = "BREAKOUT" | "MOMENTUM" | "RELATIVE";
type GenericSide = "LONG" | "SHORT";
type GenericCandidate = { symbol: IdlePrioritySymbol; t: number; archetype: GenericArchetype; side: GenericSide };

const EXPECTED_GENERIC_5_COUNT = 393;
const EXPECTED_GENERIC_5_SHA256 = "d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019";

function genericGateStates(symbol: IdlePrioritySymbol, decisionTs: number) {
    const features = computeIdlePriorityFeatures(decisionTs, market[symbol], market.BTCUSDT);
    const rows = market[symbol];
    const signalTs = decisionTs - HOUR;
    const signal = rows.find((row) => row.ts === signalTs);
    const prior24 = Array.from({ length: 24 }, (_, i) => rows.find((row) => row.ts === decisionTs - (i + 2) * HOUR));
    if (!signal || prior24.some((row) => !row)) throw new Error(`IDLE_GENERIC_HISTORY_MISSING:${symbol}:${decisionTs}`);
    const priorHigh = Math.max(...prior24.map((row) => row!.close));
    const priorLow = Math.min(...prior24.map((row) => row!.close));
    const p = IDLE_PRIORITY_SHORT_POLICY.generic;
    return {
        features,
        gates: {
            "BREAKOUT:LONG": signal.close > priorHigh && features.volumeRatio >= p.breakout.volumeRatioMin && features.atrRatio >= p.breakout.atrRatioMin,
            "BREAKOUT:SHORT": signal.close < priorLow && features.volumeRatio >= p.breakout.volumeRatioMin && features.atrRatio >= p.breakout.atrRatioMin,
            "MOMENTUM:LONG": features.ret12 >= -p.momentum.ret12Max && features.volumeRatio >= p.momentum.volumeRatioMin && features.atrRatio >= p.momentum.atrRatioMin,
            "MOMENTUM:SHORT": features.ret12 <= p.momentum.ret12Max && features.volumeRatio >= p.momentum.volumeRatioMin && features.atrRatio >= p.momentum.atrRatioMin,
            "RELATIVE:LONG": features.rel24 >= -p.relative.rel24Max && features.volumeRatio >= p.relative.volumeRatioMin && features.atrRatio >= p.relative.atrRatioMin,
            "RELATIVE:SHORT": features.rel24 <= p.relative.rel24Max && features.volumeRatio >= p.relative.volumeRatioMin && features.atrRatio >= p.relative.atrRatioMin,
        } as Record<string, boolean>,
    };
}

function candidateDigest(rows: GenericCandidate[]) {
    const body = rows
        .slice()
        .sort((a, b) => a.t - b.t || a.symbol.localeCompare(b.symbol))
        .map((row) => [row.symbol, row.t, row.archetype, row.side].join("|"))
        .join("\n") + "\n";
    return createHash("sha256").update(body).digest("hex");
}

function modelGenericCandidates(mode: "LEVEL" | "EDGE", priority: GenericArchetype[]) {
    const output: GenericCandidate[] = [];
    const lastBySymbol = new Map<IdlePrioritySymbol, number>();
    const previous = new Map<string, boolean>();
    for (let decisionTs = fixture.windowStart; decisionTs <= fixture.windowEnd; decisionTs += HOUR) {
        for (const symbol of symbols) {
            let states;
            try { states = genericGateStates(symbol, decisionTs); }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/IDLE_(INSUFFICIENT|H1_HISTORY_GAP|ATR_PREVCLOSE_GAP|GENERIC_HISTORY_MISSING)/.test(message)) continue;
                throw error;
            }
            const eligible: Array<{ archetype: GenericArchetype; side: GenericSide }> = [];
            for (const archetype of priority) {
                for (const side of ["LONG", "SHORT"] as const) {
                    const gateKey = `${archetype}:${side}`;
                    const active = states.gates[gateKey] === true;
                    const stateKey = `${symbol}|${gateKey}`;
                    const was = previous.get(stateKey) === true;
                    previous.set(stateKey, active);
                    if (active && (mode === "LEVEL" || !was)) eligible.push({ archetype, side });
                }
            }
            if (!eligible.length) continue;
            const last = lastBySymbol.get(symbol) || 0;
            if (last > 0 && decisionTs - last < cooldownMs) continue;
            const chosen = eligible[0];
            lastBySymbol.set(symbol, decisionTs);
            output.push({ symbol, t: decisionTs, archetype: chosen.archetype, side: chosen.side });
        }
    }
    return output;
}

const candidateModelDiagnostics: Record<string, unknown> = {};
const priorities: GenericArchetype[][] = [
    ["BREAKOUT", "MOMENTUM", "RELATIVE"],
    ["BREAKOUT", "RELATIVE", "MOMENTUM"],
    ["MOMENTUM", "BREAKOUT", "RELATIVE"],
    ["MOMENTUM", "RELATIVE", "BREAKOUT"],
    ["RELATIVE", "BREAKOUT", "MOMENTUM"],
    ["RELATIVE", "MOMENTUM", "BREAKOUT"],
];
for (const mode of ["LEVEL", "EDGE"] as const) {
    for (const priority of priorities) {
        const rows = modelGenericCandidates(mode, priority);
        const name = `${mode}:${priority.join(">")}`;
        candidateModelDiagnostics[name] = {
            count: rows.length,
            sha256: candidateDigest(rows),
            matchesExpected: rows.length === EXPECTED_GENERIC_5_COUNT && candidateDigest(rows) === EXPECTED_GENERIC_5_SHA256,
            first10: rows.slice(0, 10),
        };
    }
}
console.log(JSON.stringify({ event: "IDLE_GENERIC_CANDIDATE_LIFECYCLE_DIAGNOSTIC", expectedCount: EXPECTED_GENERIC_5_COUNT, expectedSha256: EXPECTED_GENERIC_5_SHA256, models: candidateModelDiagnostics }));

const accepted: ExpectedRow[] = [];
const diagnostics = new Map<string, unknown>();
const lastBySymbol = new Map<IdlePrioritySymbol, number>();

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
