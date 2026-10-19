import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    assertSourceManifest,
    buildSourceManifest,
    loadCanonicalSource,
} from "../lib/backtest/dd-reduction/source";
import type { CanonicalSourceInput } from "../lib/backtest/dd-reduction/types";

interface Fixture {
    root: string;
    sourceRoot: string;
    dataRoot: string;
    input: CanonicalSourceInput;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

async function makeFixture(options: {
    candleRows?: readonly Record<string, number>[];
    addSecretFile?: boolean;
} = {}): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-source-"));
    const sourceRoot = join(root, "source");
    const dataRoot = join(root, "data");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });

    await writeFile(
        join(sourceRoot, "production.json"),
        JSON.stringify({ strategy: "V12_V4", config: { risk: "sanitized" } }),
        "utf8",
    );
    if (options.addSecretFile) {
        await writeFile(join(sourceRoot, ".env"), "PRIVATE_KEY=must-not-be-read", "utf8");
    }

    const rows = options.candleRows ?? [
        { ts: 1_700_000_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
        { ts: 1_700_003_600_000, open: 101, high: 103, low: 100, close: 102, volume: 11 },
    ];
    await writeFile(
        join(dataRoot, "BTCUSDT-1h.json"),
        JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", bars: rows }),
        "utf8",
    );

    const productionContent = JSON.stringify({ strategy: "V12_V4", config: { risk: "sanitized" } });
    return {
        root,
        sourceRoot,
        dataRoot,
        input: {
            sourceRoot,
            dataRoot,
            productionSha: sha256(`production.json\n${productionContent}`),
            startTs: 1_700_000_000_000,
            endTs: 1_700_003_600_000,
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

    await assert.rejects(
        () => loadCanonicalSource(fixture.input),
        /SOURCE_ROOT_MISSING|source root/i,
    );
});

test("rejects a production source SHA mismatch", async () => {
    const fixture = await makeFixture();
    try {
        await assert.rejects(
            () => loadCanonicalSource({ ...fixture.input, productionSha: "0".repeat(64) }),
            /PRODUCTION_SHA_MISMATCH|production.*sha/i,
        );
    } finally {
        await cleanup(fixture);
    }
});

test("rejects duplicate bars in a symbol/timeframe series", async () => {
    const fixture = await makeFixture({
        candleRows: [
            { ts: 1_700_000_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
            { ts: 1_700_000_000_000, open: 101, high: 103, low: 100, close: 102, volume: 11 },
        ],
    });
    try {
        await assert.rejects(
            () => loadCanonicalSource(fixture.input),
            /DUPLICATE_BAR|duplicate.*bar/i,
        );
    } finally {
        await cleanup(fixture);
    }
});

test("rejects a gap in a symbol/timeframe series", async () => {
    const fixture = await makeFixture({
        candleRows: [
            { ts: 1_700_000_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
            { ts: 1_700_007_200_000, open: 101, high: 103, low: 100, close: 102, volume: 11 },
        ],
    });
    try {
        await assert.rejects(
            () => loadCanonicalSource(fixture.input),
            /GAP_DETECTED|gap/i,
        );
    } finally {
        await cleanup(fixture);
    }
});

test("rejects secret-looking files without loading them", async () => {
    const fixture = await makeFixture({ addSecretFile: true });
    try {
        await assert.rejects(
            () => loadCanonicalSource(fixture.input),
            /SECRET_LOOKING_FILE|secret|credential|private/i,
        );
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
            series: [
                {
                    symbol: "BTCUSDT",
                    timeframe: "1h",
                    firstTs: 1_700_000_000_000,
                    lastTs: 1_700_003_600_000,
                    rowCount: 2,
                    missing: [],
                    duplicates: [],
                    sha256: firstManifest.series[0]?.sha256 ?? "",
                },
            ],
        });
    } finally {
        await cleanup(fixture);
    }
});
