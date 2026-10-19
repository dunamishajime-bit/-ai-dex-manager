import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertFixtureIdentity, FIXTURE_HASH, FIXTURE_SCHEMAS } from "../lib/backtest/dd-reduction/fixture-identity";

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
    const fixtureTestSources = await Promise.all(testFiles
        .filter((name) => name !== "dd-reduction-ci.test.ts")
        .map((name) => readRepositoryFile(`tests/${name}`)));

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
    assert.ok(fixtureTestSources.every((source) => source.includes("assertFixtureIdentity")), "every DD reduction fixture module must validate its direct fixtures");
});

test("rejects missing, placeholder, and nested direct-fixture identity hashes", () => {
    const required = ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"] as const;
    const valid = {
        sourceHash: FIXTURE_HASH,
        productionSha: FIXTURE_HASH,
        configHash: FIXTURE_HASH,
        policyHash: FIXTURE_HASH,
        resultHash: FIXTURE_HASH,
    };

    assert.doesNotThrow(() => assertFixtureIdentity(valid, required, "valid-fixture"));
    for (const field of required) {
        assert.throws(
            () => assertFixtureIdentity({ ...valid, [field]: undefined }, required, `missing-${field}`),
            new RegExp(`FIXTURE_HASH_INVALID.*${field}`),
        );
        assert.throws(
            () => assertFixtureIdentity({ ...valid, [field]: "a".repeat(64) }, required, `placeholder-${field}`),
            new RegExp(`FIXTURE_HASH_INVALID.*${field}`),
        );
    }
    assert.throws(
        () => assertFixtureIdentity({ ...valid, nested: { policyHash: undefined } }, required, "nested-missing"),
        /FIXTURE_HASH_INVALID.*nested\.policyHash/,
    );

    const validEvent = { ...valid, reservation: null, fill: { sourceHash: FIXTURE_HASH }, exit: null };
    assert.doesNotThrow(() => assertFixtureIdentity(validEvent, FIXTURE_SCHEMAS.event, "valid-event"));
    assert.throws(
        () => assertFixtureIdentity({ ...validEvent, fill: {} }, FIXTURE_SCHEMAS.event, "nested-fill-missing"),
        /FIXTURE_HASH_INVALID.*fill\.sourceHash/,
    );
    const { fill: _fill, ...eventWithoutFill } = validEvent;
    assert.throws(
        () => assertFixtureIdentity(eventWithoutFill, FIXTURE_SCHEMAS.event, "nested-fill-absent"),
        /FIXTURE_NESTED_MISSING.*fill/,
    );

    const validPolicyBundle = { ...valid, policy: { sourceHash: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH } };
    assert.throws(
        () => assertFixtureIdentity({ ...validPolicyBundle, policy: { ...validPolicyBundle.policy, policyHash: "invalid" } }, FIXTURE_SCHEMAS.policyBundle, "nested-policy-override"),
        /FIXTURE_HASH_INVALID.*policy\.policyHash/,
    );
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
