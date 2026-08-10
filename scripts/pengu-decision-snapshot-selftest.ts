import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPenguDualLsV1DecisionSnapshot } from "@/lib/server/pengu-dual-ls-v1-decision-snapshot";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "disdex-pengu-snapshot-selftest-"));
  const snapshotPath = join(directory, "runner-live.json");
  const previousPath = process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_PATH;
  const previousMaxAge = process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_MAX_AGE_MS;
  try {
    process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_PATH = snapshotPath;
    process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_MAX_AGE_MS = "3600000";
    await writeFile(snapshotPath, JSON.stringify({
      strategyId: "PENGU_DUAL_LS_V1",
      mode: "LIVE",
      updatedAt: Date.now(),
      latestSignal: {
        referenceTs: Date.now() - 3_600_000,
        side: 0,
        targetGross: 0,
        reason: "条件不足",
        diagnostics: {
          edgeTriggered: false,
          longEligible: false,
          shortEligible: false,
          shortRecentlyActive: false,
          fundingCoverage: true,
        },
      },
    }), "utf8");
    const valid = await loadPenguDualLsV1DecisionSnapshot();
    assert(valid.ok, "valid PENGU snapshot was rejected");
    assert(valid.snapshot.strategyId === "PENGU_DUAL_LS_V1", "strategy identity was not preserved");

    await writeFile(snapshotPath, JSON.stringify({ strategyId: "wrong", mode: "LIVE", updatedAt: Date.now() }), "utf8");
    const invalid = await loadPenguDualLsV1DecisionSnapshot();
    assert(!invalid.ok, "foreign snapshot was accepted");
    console.log("PENGU_DECISION_SNAPSHOT_SELFTEST_PASS");
  } finally {
    if (previousPath === undefined) delete process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_PATH;
    else process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_PATH = previousPath;
    if (previousMaxAge === undefined) delete process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_MAX_AGE_MS;
    else process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_MAX_AGE_MS = previousMaxAge;
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
