import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { spawnSync } from "child_process";
import {
  DEPLOY_APPROVAL_OPERATOR_TARGET,
  DEPLOY_APPROVAL_REPOSITORY,
  DEPLOY_APPROVAL_ROUTE,
  DEPLOY_APPROVAL_TARGET,
  issueDeploymentApprovalToken,
  type DeploymentApprovalScope,
} from "../lib/deploy-approval-token";

const targetSha = "1".repeat(40);
const operator = "dunamishajime-bit";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disdex-hp-approval-"));
const publicPath = path.join(dir, "public.pem");

function verifyCase(input: {
  scope: DeploymentApprovalScope;
  ordersEnabled: boolean;
  planSha256: string;
}) {
  const { token, payload } = issueDeploymentApprovalToken({
    targetSha,
    planSha256: input.planSha256,
    operator,
    privateKey,
    scope: input.scope,
    ordersEnabled: input.ordersEnabled,
    ttlSeconds: 300,
  });

  if (
    payload.sourceSha !== targetSha ||
    payload.planSha256 !== input.planSha256 ||
    payload.ordersEnabled !== input.ordersEnabled ||
    payload.scope !== input.scope
  ) {
    throw new Error("issued token identity mismatch");
  }

  const args = [
    "scripts/ops/deploy/disdex_owner_approval.py",
    "verify",
    "--public-key", publicPath,
    "--repository", DEPLOY_APPROVAL_REPOSITORY,
    "--sha", targetSha,
    "--scope", input.scope,
    "--operator", operator,
    "--plan-sha256", input.planSha256,
    "--deployment-target", DEPLOY_APPROVAL_TARGET,
    "--operator-target", DEPLOY_APPROVAL_OPERATOR_TARGET,
    "--route", DEPLOY_APPROVAL_ROUTE,
    "--orders-enabled", String(input.ordersEnabled),
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
  badArgs[planIndex] = "f".repeat(64);
  const bad = spawnSync("python3", badArgs, {
    input: token,
    encoding: "utf8",
  });
  if (bad.status === 0) {
    throw new Error("Python verifier accepted mismatched plan/context hash");
  }
}

try {
  fs.writeFileSync(
    publicPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o600 },
  );

  verifyCase({
    scope: "V12_V4",
    ordersEnabled: true,
    planSha256: "2".repeat(64),
  });
  verifyCase({
    scope: "IDLE_PRIORITY_SHORT",
    ordersEnabled: false,
    planSha256: "3".repeat(64),
  });

  const workflow = fs.readFileSync(
    ".github/workflows/disdex-hp-approval-ui-production-deploy.yml",
    "utf8",
  );
  for (const required of [
    "test -f .next/standalone/server.js",
    "cp -a .next/standalone/. \"$runtime/\"",
    "test -f \"$runtime/server.js\"",
    "tar -C \"$runtime\" -czf /tmp/disdex-hp-approval-ui-runtime.tgz .",
    "[[ -f \"$stage/server.js\" && -f \"$stage/.next/BUILD_ID\" ]]",
    "runuser -u deploy -- node --check \"$stage/server.js\"",
  ]) {
    if (!workflow.includes(required)) {
      throw new Error("HP deploy standalone runtime contract missing: " + required);
    }
  }
  if (workflow.includes("tar -czf /tmp/disdex-hp-approval-ui-runtime.tgz             .next node_modules")) {
    throw new Error("legacy non-standalone HP runtime packaging returned");
  }

  console.log("DISDEX_HP_DEPLOY_APPROVAL_SELFTEST_OK");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
