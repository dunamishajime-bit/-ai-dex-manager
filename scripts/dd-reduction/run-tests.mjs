import { readFileSync, readdirSync } from "node:fs";
import { run } from "node:test";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(import.meta.url), "..");
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const testsDirectory = join(repositoryRoot, "tests");
const testFilePattern = /^dd-reduction-.*\.test\.ts$/;
const requiredTestFiles = [
    "dd-reduction-ci.test.ts",
    "dd-reduction-emulator.test.ts",
    "dd-reduction-metrics.test.ts",
    "dd-reduction-policy.test.ts",
    "dd-reduction-runner.test.ts",
    "dd-reduction-source.test.ts",
];

export function assertTestDiscovery(testFiles) {
    if (testFiles.length === 0) throw new Error("TEST_DISCOVERY_EMPTY: tests/dd-reduction-*.test.ts matched no files");
    const missing = requiredTestFiles.filter((name) => !testFiles.includes(name));
    if (missing.length > 0) throw new Error(`TEST_DISCOVERY_MISSING: ${missing.join(", ")}`);
    for (const name of testFiles) {
        const source = readFileSync(join(testsDirectory, name), "utf8");
        if (/\b(?:test|it|describe)\s*\.\s*(?:skip|todo)\b/.test(source) || /\b(?:skip|todo)\s*:\s*true\b/.test(source)) {
            throw new Error(`TEST_SKIPPED_OR_TODO: ${name}`);
        }
    }
}

const testFiles = readdirSync(testsDirectory)
    .filter((name) => testFilePattern.test(name))
    .sort()
;

assertTestDiscovery(testFiles);
process.stdout.write(`DD_REDUCTION_TEST_DISCOVERY files=${testFiles.length}\n`);

const testRun = run({
    files: testFiles.map((name) => join(testsDirectory, name)),
    concurrency: 1,
});

let completed = 0;
let failed = 0;
let skipped = 0;
let todo = 0;
const expectedTopLevelNames = new Set(testFiles.map((name) => join(testsDirectory, name).replaceAll("\\", "/")));

for await (const event of testRun) {
    if (event.type !== "test:complete") continue;
    const result = event.data;
    if (result.details?.skipped === true) skipped += 1;
    if (result.details?.todo === true) todo += 1;
    if (!expectedTopLevelNames.has(String(result.name).replaceAll("\\", "/"))) continue;
    completed += 1;
    if (result.details?.passed !== true) failed += 1;
}

if (completed !== testFiles.length) throw new Error(`TEST_ACCOUNTING_MISMATCH: completed=${completed} discovered=${testFiles.length}`);
if (failed > 0) throw new Error(`TEST_FAILURES: ${failed} DD reduction test files failed`);
if (skipped > 0) throw new Error(`TEST_SKIPPED: ${skipped} DD reduction test files were skipped`);
if (todo > 0) throw new Error(`TEST_TODO: ${todo} DD reduction test files remain todo`);
process.stdout.write(`DD_REDUCTION_TEST_SUMMARY files=${completed} passed=${completed} failed=${failed} skipped=${skipped} todo=${todo}\n`);
