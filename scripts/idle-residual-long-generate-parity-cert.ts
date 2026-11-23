import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IDLE_RESIDUAL_LONG_CERT_SCHEMA, assertIdleResidualLongParityCert } from "../lib/idle-residual-long-parity-cert";

async function main() {
  const contractPath = resolve(process.argv[2] || "docs/research/results/trail020-idle-doge-avax-controlling-20261002/controlling-contract.json");
  const runtimeSha = String(process.argv[3] || "").trim().toLowerCase();
  const output = resolve(process.argv[4] || "idle-residual-long-parity-cert.json");
  if (!/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("RUNTIME_SHA_REQUIRED");
  const bytes = await readFile(contractPath);
  const contract = JSON.parse(bytes.toString("utf8"));
  const ten = contract?.costs?.["10"];
  if (contract?.schema !== "disdex-trail020-idle-doge-avax-controlling/v1") throw new Error("CONTROLLING_CONTRACT_SCHEMA_MISMATCH");
  const cert = {
    schema: IDLE_RESIDUAL_LONG_CERT_SCHEMA,
    runtimeSha,
    generatedAt: new Date().toISOString(),
    priority: contract.priority,
    trailAtr: contract.v12.trailingAtr,
    stopAtr: contract.v12.stopAtr,
    takeProfitAtr: contract.v12.takeProfitAtr,
    roundtripBps: 10,
    finalJpy: ten.finalJpy,
    integratedTradeCount: ten.trades,
    idleTrades: ten.strategyCounts.IDLE_PRIORITY_SHORT,
    dogeTrades: ten.strategyCounts.RESCUE_TOP3,
    avaxTrades: ten.strategyCounts.RESCUE_NEW,
    profitFactor: ten.pf,
    maxMtmDrawdown: ten.dd,
    contractSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  assertIdleResidualLongParityCert(cert, runtimeSha);
  await writeFile(output, JSON.stringify(cert, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ status: "PASS", output, contractSha256: cert.contractSha256, runtimeSha }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
