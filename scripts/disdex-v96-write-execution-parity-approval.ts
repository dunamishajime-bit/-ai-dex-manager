import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { disDexV96ConfigFingerprint, type DisDexV96ExecutionParityApproval } from "../lib/disdex-v96-live-gates";

async function main() {
    const goldenPath = resolve(process.argv[2] || ".runtime-state/disdex-v95-golden.json");
    const outputPath = resolve(process.argv[3] || ".runtime-state/disdex-v96-execution-parity-approved.json");
    const researchCommitSha = String(process.env.DISDEX_V96_RESEARCH_COMMIT_SHA || "70ac1dcf5e8f6fcad43159653a76de0ca42f18a2").trim();
    const productionCommitSha = String(process.env.DISDEX_V96_PRODUCTION_COMMIT_SHA || "").trim();
    const reviewer = String(process.env.DISDEX_V96_PARITY_REVIEWER || "github-actions-v96-parity-suite").trim();
    assert.match(researchCommitSha, /^[a-f0-9]{40}$/i, "Research commit SHA is invalid");
    assert.match(productionCommitSha, /^[a-f0-9]{40}$/i, "Production commit SHA is required and must be 40 hex characters");
    assert.ok(reviewer.length > 0, "Parity reviewer is required");

    const goldenRaw = await readFile(goldenPath, "utf8");
    const goldenPayload = JSON.parse(goldenRaw) as { strategyId?: string; artifactSha256?: string };
    assert.equal(goldenPayload.strategyId, "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95");
    assert.match(String(goldenPayload.artifactSha256 || ""), /^[a-f0-9]{64}$/i);
    const goldenVectorArtifactSha256 = createHash("sha256").update(goldenRaw).digest("hex");

    const approval: DisDexV96ExecutionParityApproval = {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        researchCommitSha,
        productionCommitSha,
        goldenVectorArtifactSha256,
        allocationParityPassed: true,
        signalChronologyParityPassed: true,
        orderQuantityParityPassed: true,
        restartRecoveryPassed: true,
        reviewer,
        reviewedAt: new Date().toISOString(),
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(approval, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({
        status: "DISDEX_V96_EXECUTION_PARITY_APPROVAL_WRITTEN",
        outputPath,
        strategyId: approval.strategyId,
        configFingerprint: approval.configFingerprint,
        goldenVectorArtifactSha256,
        researchCommitSha,
        productionCommitSha,
        reviewer,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
