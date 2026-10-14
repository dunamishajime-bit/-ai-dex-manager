import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExactIntegratedBt, type IntegratedBtResult } from "./exact-current-sha-integrated-bt.ts";
import { validateExactBtManifest } from "./exact-current-sha-bt-contract.ts";

function sha256(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export async function writeExactBtReport(manifestPath: string, outputDir: string): Promise<{ resultHash: string; outputHashes: Record<string, string> }> {
  const expectedSha = JSON.parse(await readFile(manifestPath, "utf8")).runtimeSha as string;
  const manifest = validateExactBtManifest(manifestPath, expectedSha);
  const result: IntegratedBtResult = runExactIntegratedBt(manifest);
  if (result.reconciliation.status !== "PASS") {
    throw new Error(`EXACT_BT_MONTHLY_COVERAGE_INCOMPLETE:${result.reconciliation.missingMonthlyKeys.join(",")}`);
  }
  await mkdir(outputDir, { recursive: true });
  const files: Record<string, string> = {
    "portfolio-trades.jsonl": jsonl(result.trades),
    "candidate-decisions.jsonl": jsonl(result.decisions),
    "portfolio-events.jsonl": jsonl(result.events),
    "monthly-equity.json": JSON.stringify(result.monthlyEquityJpy, null, 2) + "\n",
    "strategy-attribution.json": JSON.stringify(result.strategyAttribution, null, 2) + "\n",
    "result.json": JSON.stringify(result, null, 2) + "\n",
  };
  const outputHashes: Record<string, string> = {};
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(outputDir, name), body, "utf8");
    outputHashes[name] = sha256(body);
  }
  const inputManifestBody = await readFile(manifestPath);
  const outputManifest = {
    schema: "disdex/exact-current-sha-monthly-bt-manifest/v1",
    runtimeSha: manifest.runtimeSha,
    engine: "scripts/research/exact-current-sha-integrated-bt.ts",
    inputManifestSha256: sha256(inputManifestBody),
    period: manifest.period,
    capital: manifest.capital,
    execution: manifest.execution,
    risk: manifest.risk,
    strategyIds: manifest.strategyIds,
    sourceFiles: manifest.sourceFiles,
    marketFiles: manifest.marketFiles,
    outputHashes,
    resultHash: result.resultHash,
    mutation: result.mutation,
  };
  await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(outputManifest, null, 2) + "\n", "utf8");
  return { resultHash: result.resultHash, outputHashes };
}

async function main() {
  const [manifestPath, outputDir] = process.argv.slice(2);
  if (!manifestPath || !outputDir) throw new Error("USAGE: node run-exact-current-sha-monthly-bt.ts <manifest> <outputDir>");
  const report = await writeExactBtReport(manifestPath, outputDir);
  console.log(JSON.stringify({ status: "EXACT_CURRENT_SHA_MONTHLY_BT_PASS", ...report }, null, 2));
}

if (process.argv[1]?.endsWith("run-exact-current-sha-monthly-bt.ts")) main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
