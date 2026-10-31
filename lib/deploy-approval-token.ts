import crypto from "crypto";
import fs from "fs";

export const DEPLOY_APPROVAL_SCHEMA = "disdex-owner-deployment-approval/v2";
export const DEPLOY_APPROVAL_REPOSITORY = "dunamishajime-bit/-ai-dex-manager";
export const DEPLOY_APPROVAL_TARGET = "professional-dismanager.net";
export const DEPLOY_APPROVAL_OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS";
export const DEPLOY_APPROVAL_ROUTE = "GITHUB_ACTIONS";

export const DEPLOY_APPROVAL_SCOPES = [
  "V12_V4", "IDLE_PRIORITY_SHORT", "FULL_PROJECT", "V52",
  "HYPE_TREND_LONG", "QUALITY102_CAUSAL_V1", "PENGU_V8",
  "FET_BRK48_RESIDUAL", "SHARED_CRYPTO_RISK_ONLY",
] as const;
export type DeploymentApprovalScope = (typeof DEPLOY_APPROVAL_SCOPES)[number];

export const DEPLOY_APPROVAL_OPERATIONS = [
  "V12_V4_LIVE",
  "IDLE_FLAT_STALE_REPAIR",
  "ALL_RUNNERS_LIVE_RESTORE",
] as const;
export type DeploymentApprovalOperation = (typeof DEPLOY_APPROVAL_OPERATIONS)[number];

export const DEPLOY_APPROVAL_SCOPE: DeploymentApprovalScope = "V12_V4";

export const DEPLOY_APPROVAL_OPERATION_POLICY: Record<
  DeploymentApprovalOperation,
  { scope: DeploymentApprovalScope; ordersEnabled: boolean; label: string }
> = {
  V12_V4_LIVE: {
    scope: "V12_V4",
    ordersEnabled: true,
    label: "V12 V4 Production LIVE",
  },
  IDLE_FLAT_STALE_REPAIR: {
    scope: "IDLE_PRIORITY_SHORT",
    ordersEnabled: false,
    label: "IDLE flat stale state repair",
  },
  ALL_RUNNERS_LIVE_RESTORE: {
    scope: "FULL_PROJECT",
    ordersEnabled: true,
    label: "全Runner LIVE復旧（一回の本人承認で同一依頼を完了まで）",
  },
};

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
  scope: DeploymentApprovalScope;
  operator: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  planSha256: string;
  ordersEnabled: boolean;
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

function assertScope(scope: string): asserts scope is DeploymentApprovalScope {
  if (!(DEPLOY_APPROVAL_SCOPES as readonly string[]).includes(scope)) {
    throw new Error("unsupported approval scope");
  }
}

export function issueDeploymentApprovalToken(input: {
  targetSha: string;
  planSha256: string;
  operator: string;
  privateKey: crypto.KeyObject | string | Buffer;
  scope?: DeploymentApprovalScope;
  ordersEnabled?: boolean;
  ttlSeconds?: number;
  nowSeconds?: number;
}) {
  const ttlSeconds = input.ttlSeconds ?? 300;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const scope = input.scope ?? DEPLOY_APPROVAL_SCOPE;
  const ordersEnabled = input.ordersEnabled ?? true;

  if (!SHA_RE.test(input.targetSha)) throw new Error("invalid target SHA");
  if (!PLAN_RE.test(input.planSha256)) throw new Error("invalid plan SHA-256");
  if (!LOGIN_RE.test(input.operator)) throw new Error("invalid operator");
  assertScope(scope);
  if (typeof ordersEnabled !== "boolean") throw new Error("invalid order permission");
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
    scope,
    operator: input.operator,
    nonce: crypto.randomBytes(16).toString("hex"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    planSha256: input.planSha256,
    ordersEnabled,
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
  input: {
    targetSha: string;
    planSha256: string;
    operator: string;
    scope?: DeploymentApprovalScope;
    ordersEnabled?: boolean;
  },
) {
  const scope = input.scope ?? DEPLOY_APPROVAL_SCOPE;
  const ordersEnabled = input.ordersEnabled ?? true;
  return (
    payload.repository === DEPLOY_APPROVAL_REPOSITORY &&
    payload.deploymentTarget === DEPLOY_APPROVAL_TARGET &&
    payload.operatorTarget === DEPLOY_APPROVAL_OPERATOR_TARGET &&
    payload.route === DEPLOY_APPROVAL_ROUTE &&
    payload.scope === scope &&
    payload.sourceSha === input.targetSha &&
    payload.planSha256 === input.planSha256 &&
    payload.operator === input.operator &&
    payload.ordersEnabled === ordersEnabled
  );
}
