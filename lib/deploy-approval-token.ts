import crypto from "crypto";
import fs from "fs";

export const DEPLOY_APPROVAL_SCHEMA = "disdex-owner-deployment-approval/v2";
export const DEPLOY_APPROVAL_REPOSITORY = "dunamishajime-bit/-ai-dex-manager";
export const DEPLOY_APPROVAL_TARGET = "professional-dismanager.net";
export const DEPLOY_APPROVAL_OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS";
export const DEPLOY_APPROVAL_ROUTE = "GITHUB_ACTIONS";
export const DEPLOY_APPROVAL_SCOPE = "V12_V4";

const SHA_RE = /^[0-9a-f]{40}$/;
const PLAN_RE = /^[0-9a-f]{64}$/;
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

export type DeploymentApprovalPayload = {
  schema: typeof DEPLOY_APPROVAL_SCHEMA;
  repository: typeof DEPLOY_APPROVAL_REPOSITORY;
  deploymentTarget: typeof DEPLOY_APPROVAL_TARGET;
  operatorTarget: typeof DEPLOY_APPROVAL_OPERATOR_TARGET;
  route: typeof DEPLOY_APPROVAL_ROUTE;
  sourceSha: string;
  scope: typeof DEPLOY_APPROVAL_SCOPE;
  operator: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  planSha256: string;
  ordersEnabled: true;
};

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortDeep(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortDeep(value));
}

function normalizePem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function loadDeploymentApprovalPrivateKey() {
  const pemFromEnv = process.env.DISDEX_HP_APPROVER_PRIVATE_KEY_PEM?.trim();
  const keyPath = process.env.DISDEX_HP_APPROVER_PRIVATE_KEY_PATH?.trim();
  const passphrase = process.env.DISDEX_HP_APPROVER_KEY_PASSPHRASE;

  let keyMaterial = "";
  if (keyPath) {
    keyMaterial = fs.readFileSync(keyPath, "utf8");
  } else if (pemFromEnv) {
    keyMaterial = normalizePem(pemFromEnv);
  } else {
    throw new Error("HP deployment approval signing key is not configured");
  }

  const key = crypto.createPrivateKey({
    key: keyMaterial,
    format: "pem",
    ...(passphrase ? { passphrase } : {}),
  });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("HP deployment approval signing key must be Ed25519");
  }
  return key;
}

export function issueDeploymentApprovalToken(input: {
  targetSha: string;
  planSha256: string;
  operator: string;
  privateKey: crypto.KeyObject | string | Buffer;
  ttlSeconds?: number;
  nowSeconds?: number;
}) {
  const ttlSeconds = input.ttlSeconds ?? 300;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!SHA_RE.test(input.targetSha)) throw new Error("invalid target SHA");
  if (!PLAN_RE.test(input.planSha256)) throw new Error("invalid plan SHA-256");
  if (!LOGIN_RE.test(input.operator)) throw new Error("invalid operator");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
    throw new Error("invalid approval TTL");
  }

  const payload: DeploymentApprovalPayload = {
    schema: DEPLOY_APPROVAL_SCHEMA,
    repository: DEPLOY_APPROVAL_REPOSITORY,
    deploymentTarget: DEPLOY_APPROVAL_TARGET,
    operatorTarget: DEPLOY_APPROVAL_OPERATOR_TARGET,
    route: DEPLOY_APPROVAL_ROUTE,
    sourceSha: input.targetSha,
    scope: DEPLOY_APPROVAL_SCOPE,
    operator: input.operator,
    nonce: crypto.randomBytes(16).toString("hex"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    planSha256: input.planSha256,
    ordersEnabled: true,
  };

  const message = Buffer.from(canonicalJson(payload), "ascii");
  const signature = crypto.sign(null, message, input.privateKey);
  if (signature.length !== 64) throw new Error("unexpected Ed25519 signature length");

  const tokenObject = {
    payload,
    signature: signature.toString("base64"),
  };
  const token = Buffer.from(canonicalJson(tokenObject), "ascii").toString("base64");
  return { token, payload };
}

export function deploymentApprovalIdentityMatches(
  payload: DeploymentApprovalPayload,
  input: { targetSha: string; planSha256: string; operator: string },
) {
  return (
    payload.repository === DEPLOY_APPROVAL_REPOSITORY &&
    payload.deploymentTarget === DEPLOY_APPROVAL_TARGET &&
    payload.operatorTarget === DEPLOY_APPROVAL_OPERATOR_TARGET &&
    payload.route === DEPLOY_APPROVAL_ROUTE &&
    payload.scope === DEPLOY_APPROVAL_SCOPE &&
    payload.sourceSha === input.targetSha &&
    payload.planSha256 === input.planSha256 &&
    payload.operator === input.operator &&
    payload.ordersEnabled === true
  );
}
