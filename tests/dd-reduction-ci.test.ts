import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

async function readRepositoryFile(relativePath: string): Promise<string> {
    return readFile(join(repositoryRoot, relativePath), "utf8");
}

test("discovers every DD reduction fixture test and fails closed on silent outcomes", async () => {
    const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
        scripts?: Record<string, string>;
    };
    const testScript = packageJson.scripts?.["dd:reduction:test"] ?? "";
    const runner = await readRepositoryFile("scripts/dd-reduction/run-tests.mjs");
    const testFiles = (await readdir(join(repositoryRoot, "tests")))
        .filter((name) => /^dd-reduction-.*\.test\.ts$/.test(name))
        .sort();

    assert.match(testScript, /run-tests\.mjs/);
    assert.match(testScript, /tsx scripts\/dd-reduction\/run-tests\.mjs/);
    assert.doesNotMatch(testScript, /dd-reduction-(?:source|emulator|metrics|policy|runner)\.test\.ts/);
    assert.match(runner, /dd-reduction-.*\\\.test\\\.ts/);
    assert.match(runner, /\.sort\(/);
    assert.match(runner, /testFiles\.length\s*===\s*0/);
    assert.match(runner, /TEST_SKIPPED_OR_TODO/);
    assert.match(runner, /requiredTestFiles/);
    assert.match(runner, /run\(\{/);
    assert.match(runner, /concurrency:\s*1/);
    assert.match(runner, /TEST_ACCOUNTING_MISMATCH/);
    assert.ok(testFiles.length >= 5, `expected the existing DD reduction fixture suite, found ${testFiles.length}`);
});

test("keeps the DD reduction workflow deterministic, read-only, and offline", async () => {
    const workflow = await readRepositoryFile(".github/workflows/dd-reduction-sequential.yml");

    assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
    assert.match(workflow, /cancel-in-progress:\s*true/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run dd:reduction:test/);
    assert.match(workflow, /npx tsc --noEmit/);
    assert.doesNotMatch(workflow, /Aster|live|private|secrets\.|curl|wget|baseline|run-stage|verify-source/i);
    assert.doesNotMatch(workflow, /npm publish|vercel|ssh|scp|systemctl|ordersEnabled/i);
});
