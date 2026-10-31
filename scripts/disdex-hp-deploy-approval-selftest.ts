import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { spawnSync } from "child_process";
import {
  DEPLOY_APPROVAL_OPERATOR_TARGET,
  DEPLOY_APPROVAL_REPOSITORY,
  DEPLOY_APPROVAL_ROUTE,
  DEPLOY_APPROVAL_SCOPE,
  DEPLOY_APPROVAL_TARGET,
  issueDeploymentApprovalToken,
} from "../lib/deploy-approval-token";

const targetSha = "1".repeat(40);
const planSha256 = "2".repeat(64);
const operator = "dunamishajime-bit";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disdex-hp-approval-"));
const publicPath = path.join(dir, "public.pem");

try {
  fs.writeFileSync(
    publicPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o600 },
  );

  const { token, payload } = issueDeploymentApprovalToken({
    targetSha,
    planSha256,
    operator,
    privateKey,
    ttlSeconds: 300,
  });

  if (payload.sourceSha !== targetSha || payload.planSha256 !== planSha256) {
    throw new Error("issued token identity mismatch");
  }
  if (payload.ordersEnabled !== true || payload.scope !== DEPLOY_APPROVAL_SCOPE) {
    throw new Error("issued token permission mismatch");
  }

  const args = [
    "scripts/ops/deploy/disdex_owner_approval.py",
    "verify",
    "--public-key", publicPath,
    "--repository", DEPLOY_APPROVAL_REPOSITORY,
    "--sha", targetSha,
    "--scope", DEPLOY_APPROVAL_SCOPE,
    "--operator", operator,
    "--plan-sha256", planSha256,
    "--deployment-target", DEPLOY_APPROVAL_TARGET,
    "--operator-target", DEPLOY_APPROVAL_OPERATOR_TARGET,
    "--route", DEPLOY_APPROVAL_ROUTE,
    "--orders-enabled", "true",
  ];

  const ok = spawnSync("python3", args, {
    input: token,
    encoding: "utf8",
  });
  if (ok.status !== 0 || !ok.stdout.includes("DISDEX_OWNER_APPROVAL_VALID")) {
    throw new Error(
      "Python verifier rejected HP-issued token: " + (ok.stderr || ok.stdout),
    );
  }

  const badArgs = args.slice();
  const planIndex = badArgs.indexOf("--plan-sha256") + 1;
  badArgs[planIndex] = "3".repeat(64);
  const bad = spawnSync("python3", badArgs, {
    input: token,
    encoding: "utf8",
  });
  if (bad.status === 0) {
    throw new Error("Python verifier accepted mismatched plan hash");
  }

  console.log("DISDEX_HP_DEPLOY_APPROVAL_SELFTEST_OK");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
