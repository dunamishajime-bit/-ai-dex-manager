import { readFileSync, readdirSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);

const scriptDirectory = resolve(fileURLToPath(import.meta.url), "..");
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const testsDirectory = join(repositoryRoot, "tests");
const testFilePattern = /^(?:dd-reduction-.*|legacy-adapter)\.test\.ts$/;
const requiredTestFiles = [
    "dd-reduction-ci.test.ts",
    "dd-reduction-emulator.test.ts",
    "dd-reduction-metrics.test.ts",
    "dd-reduction-policy.test.ts",
    "dd-reduction-runner.test.ts",
    "dd-reduction-source.test.ts",
    "legacy-adapter.test.ts",
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

let completed = 0;
let failed = 0;
let skipped = 0;
let todo = 0;

const tsxExecutable = process.execPath;
const tsxCli = join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
for (const name of testFiles) {
    const file = join(testsDirectory, name);
    let stdout = "";
    let stderr = "";
    try {
        const result = await execFile(tsxExecutable, [tsxCli, "--test", file], {
            cwd: repositoryRoot,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            shell: false,
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
        stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
        const message = error instanceof Error ? error.message : String(error);
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
        throw new Error(`TEST_FAILURES: ${name} exited non-zero code=${code} ${message}\n${stdout}\n${stderr}`);
    }

    const summary = (label) => {
        const match = stdout.match(new RegExp(`ℹ ${label}\\s+(\\d+)`));
        if (match === null) throw new Error(`TEST_ACCOUNTING_MISMATCH: ${name} missing '${label}' summary`);
        return Number(match[1]);
    };
    const tests = summary("tests");
    const passed = summary("pass");
    const failedInFile = summary("fail");
    const skippedInFile = summary("skipped");
    const todoInFile = summary("todo");
    if (tests <= 0 || passed + failedInFile + skippedInFile + todoInFile !== tests) {
        throw new Error(`TEST_ACCOUNTING_MISMATCH: ${name} tests=${tests} pass=${passed} fail=${failedInFile} skipped=${skippedInFile} todo=${todoInFile}`);
    }
    completed += 1;
    failed += failedInFile;
    skipped += skippedInFile;
    todo += todoInFile;
}

if (completed !== testFiles.length) throw new Error(`TEST_ACCOUNTING_MISMATCH: completed=${completed} discovered=${testFiles.length}`);
if (failed > 0) throw new Error(`TEST_FAILURES: ${failed} DD reduction test files failed`);
if (skipped > 0) throw new Error(`TEST_SKIPPED: ${skipped} DD reduction test files were skipped`);
if (todo > 0) throw new Error(`TEST_TODO: ${todo} DD reduction test files remain todo`);
process.stdout.write(`DD_REDUCTION_TEST_SUMMARY files=${completed} passed=${completed} failed=${failed} skipped=${skipped} todo=${todo}\n`);
