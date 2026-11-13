import { saveDeploymentApproval } from "../../lib/server/deploy-approval-store";

async function main() {
  const prefix = process.argv[2];
  for (let i = 0; i < 5; i += 1) {
    const now = Date.now();
    await saveDeploymentApproval({
      id: `${prefix}-${i}`,
      scope: "V12_V4",
      targetSha: "a".repeat(40),
      planSha256: "b".repeat(64),
      requestActor: "synthetic-test",
      createdAt: now,
      requestExpiresAt: now + 60_000,
      updatedAt: now,
      status: "PENDING",
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
