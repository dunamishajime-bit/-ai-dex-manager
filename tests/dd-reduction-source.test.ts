import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    assertSourceManifest,
    buildSourceManifest,
    canonicalDirectorySha,
    loadCanonicalSource,
} from "../lib/backtest/dd-reduction/source";
import type { CanonicalSourceInput } from "../lib/backtest/dd-reduction/types";

interface FixtureFile {
    name: string;
    content: string;
}

interface Fixture {
    root: string;
    sourceRoot: string;
    dataRoot: string;
    input: CanonicalSourceInput;
}

const START_TS = 1_700_000_000_000;
const HOUR = 3_600_000;
const HASH = "a".repeat(64);

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function candle(ts: number, close = 101): Record<string, number> {
    return { ts, open: 100, high: 102, low: 99, close, volume: 10 };
}

function candleFile(name: string, rows: readonly Record<string, number>[], symbol = "BTCUSDT", timeframe = "1h"): FixtureFile {
    return { name, content: JSON.stringify({ symbol, timeframe, bars: rows }) };
}

function lifecycleFields(overrides: Record<string, string | number | boolean | null> = {}): string {
    return JSON.stringify({
        sourceHash: HASH,
        ts: START_TS,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        fill: null,
        exit: null,
        reason: "fixture",
        fee: 1,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        ...overrides,
    });
}

function baselineRow(overrides: Record<string, string | number | boolean | null> = {}): string {
    return JSON.stringify({ ...JSON.parse(lifecycleFields()), tradeId: "trade-1", entry: null, finalExit: null, ...overrides });
}

function candidateRow(overrides: Record<string, string | number | boolean | null> = {}): string {
    return JSON.stringify({ ...JSON.parse(lifecycleFields()), candidateId: "candidate-1", accepted: true, rejectionReason: null, ...overrides });
}

async function makeFixture(options: {
    candleRows?: readonly Record<string, number>[];
    candleFiles?: readonly FixtureFile[];
    sourceFiles?: readonly FixtureFile[];
    addSecretFile?: boolean;
    endTs?: number;
} = {}): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-source-"));
    const sourceRoot = join(root, "source");
    const dataRoot = join(root, "data");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });

    const production = { name: "production.json", content: JSON.stringify({ strategy: "V12_V4", config: { risk: "sanitized" } }) };
    const sourceFiles = [production, ...(options.sourceFiles ?? [])];
    for (const file of sourceFiles) await writeFile(join(sourceRoot, file.name), file.content, "utf8");
    if (options.addSecretFile) await writeFile(join(sourceRoot, ".env"), "PRIVATE_KEY=must-not-be-read", "utf8");

    const dataFiles = options.candleFiles ?? [candleFile("BTCUSDT-1h.json", options.candleRows ?? [candle(START_TS), candle(START_TS + HOUR, 102)])];
    for (const file of dataFiles) await writeFile(join(dataRoot, file.name), file.content, "utf8");

    return {
        root,
        sourceRoot,
        dataRoot,
        input: {
            sourceRoot,
            dataRoot,
            productionSha: canonicalDirectorySha(sourceFiles.map((file) => ({ path: file.name, content: file.content }))),
            startTs: START_TS,
            endTs: options.endTs ?? START_TS + HOUR,
            initialEquity: 10_000,
            deposits: [],
            feeBps: 4,
            slippageBps: 2,
            fundingSource: "fixture-funding",
        },
    };
}

async function cleanup(fixture: Fixture): Promise<void> {
    await rm(fixture.root, { recursive: true, force: true });
}

test("rejects a missing source root", async () => {
    const fixture = await makeFixture();
    await cleanup(fixture);
    await assert.rejects(() => loadCanonicalSource(fixture.input), /SOURCE_ROOT_MISSING|source root/i);
});

test("rejects a production source SHA mismatch", async () => {
    const fixture = await makeFixture();
    try {
        await assert.rejects(() => loadCanonicalSource({ ...fixture.input, productionSha: "0".repeat(64) }), /PRODUCTION_SHA_MISMATCH|production.*sha/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects duplicate bars in one symbol/timeframe series", async () => {
    const fixture = await makeFixture({ candleRows: [candle(START_TS), candle(START_TS)] });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /DUPLICATE_BAR|duplicate.*bar/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects duplicate bars split across files for one symbol/timeframe", async () => {
    const fixture = await makeFixture({
        candleFiles: [candleFile("part-a.json", [candle(START_TS)]), candleFile("part-b.json", [candle(START_TS)])],
    });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /DUPLICATE_BAR|duplicate.*bar/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects a gap split across files for one symbol/timeframe", async () => {
    const fixture = await makeFixture({
        candleFiles: [candleFile("part-a.json", [candle(START_TS)]), candleFile("part-b.json", [candle(START_TS + 2 * HOUR)])],
        endTs: START_TS + 2 * HOUR,
    });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /GAP_DETECTED|gap/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects an out-of-range candle", async () => {
    const fixture = await makeFixture({ candleRows: [candle(START_TS), candle(START_TS + 2 * HOUR)] });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /RANGE_VIOLATION|range/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects malformed candle rows instead of dropping the file", async () => {
    const fixture = await makeFixture({
        candleFiles: [candleFile("valid.json", [candle(START_TS)]), { name: "malformed.json", content: JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", bars: [{ ts: START_TS + HOUR, open: 100 }] }) }],
    });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /INVALID_CANDLE_ROW|candle.*row/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects malformed funding rows", async () => {
    const fixture = await makeFixture({ sourceFiles: [{ name: "funding.json", content: JSON.stringify([{ ts: START_TS, symbol: "BTCUSDT" }]) }] });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /INVALID_FUNDING_ROW|funding.*row/i);
    } finally {
        await cleanup(fixture);
    }
});

test("rejects malformed lifecycle rows and unknown enums", async () => {
    const malformed = await makeFixture({ sourceFiles: [{ name: "candidate-events.jsonl", content: `${lifecycleFields({ ts: null })}\n` }] });
    try {
        await assert.rejects(() => loadCanonicalSource(malformed.input), /INVALID_CANDIDATE_ROW|candidate.*row/i);
    } finally {
        await cleanup(malformed);
    }
    const unknownStrategy = await makeFixture({ sourceFiles: [{ name: "candidate-events.jsonl", content: `${candidateRow({ strategy: "UNKNOWN" })}\n` }] });
    try {
        await assert.rejects(() => loadCanonicalSource(unknownStrategy.input), /INVALID_CANDIDATE_ROW|strategy/i);
    } finally {
        await cleanup(unknownStrategy);
    }
    const unknownDirection = await makeFixture({ sourceFiles: [{ name: "candidate-events.jsonl", content: `${candidateRow({ direction: "SIDEWAYS" })}\n` }] });
    try {
        await assert.rejects(() => loadCanonicalSource(unknownDirection.input), /INVALID_CANDIDATE_ROW|direction/i);
    } finally {
        await cleanup(unknownDirection);
    }
});

test("accepts the advertised JSON, JSONL, NDJSON, and CSV source formats", async () => {
    const fixture = await makeFixture({
        sourceFiles: [
            { name: "funding.jsonl", content: `${JSON.stringify({ ts: START_TS, symbol: "BTCUSDT", rate: 0.0001, source: "fixture" })}\n` },
            { name: "baseline-ledger.ndjson", content: `${baselineRow()}\n` },
            { name: "candidate-events.csv", content: "sourceHash,ts,strategy,direction,symbol,requestedGross,acceptedGross,reservation,fill,exit,reason,fee,funding,slippage,policyHash,configHash,resultHash,candidateId,accepted,rejectionReason\n" + `${HASH},${START_TS},V12_V4,LONG,BTCUSDT,100,100,null,null,null,fixture,1,0,0,${HASH},${HASH},${HASH},candidate-1,true,null\n` },
        ],
    });
    try {
        const source = await loadCanonicalSource(fixture.input);
        assert.equal(source.funding.length, 1);
        assert.equal(source.baselineLedger.length, 1);
        assert.equal(source.candidateEvents.length, 1);
    } finally {
        await cleanup(fixture);
    }
});

test("public manifest building rejects a mutated production SHA", async () => {
    const fixture = await makeFixture();
    try {
        const source = await loadCanonicalSource(fixture.input);
        await assert.rejects(
            () => buildSourceManifest({ ...source, input: { ...source.input, productionSha: "0".repeat(64) } }),
            /PRODUCTION_SHA_MISMATCH|production.*sha/i,
        );
    } finally {
        await cleanup(fixture);
    }
});

test("rejects secret-looking files without loading them", async () => {
    const fixture = await makeFixture({ addSecretFile: true });
    try {
        await assert.rejects(() => loadCanonicalSource(fixture.input), /SECRET_LOOKING_FILE|secret|credential|private/i);
    } finally {
        await cleanup(fixture);
    }
});

test("builds a stable manifest and asserts its immutable fields", async () => {
    const fixture = await makeFixture();
    try {
        const first = await loadCanonicalSource(fixture.input);
        const second = await loadCanonicalSource(fixture.input);
        const firstManifest = await buildSourceManifest(first);
        const secondManifest = await buildSourceManifest(second);
        assert.deepEqual(firstManifest, secondManifest);
        assertSourceManifest(firstManifest, {
            sourceSha: firstManifest.sourceSha,
            productionSha: fixture.input.productionSha,
            series: [{ symbol: "BTCUSDT", timeframe: "1h", firstTs: START_TS, lastTs: START_TS + HOUR, rowCount: 2, missing: [], duplicates: [], sha256: firstManifest.series[0]?.sha256 ?? "" }],
        });
    } finally {
        await cleanup(fixture);
    }
});
