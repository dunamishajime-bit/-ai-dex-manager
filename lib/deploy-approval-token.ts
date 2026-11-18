import crypto from "crypto";
import fs from "fs";

export const DEPLOY_APPROVAL_SCHEMA = "disdex-owner-deployment-approval/v2";
export const DEPLOY_APPROVAL_REPOSITORY = "dunamishajime-bit/-ai-dex-manager";
export const DEPLOY_APPROVAL_TARGET = "professional-dismanager.net";
export const DEPLOY_APPROVAL_OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS";
export const DEPLOY_APPROVAL_ROUTE = "GITHUB_ACTIONS";

/** Exact-scope STABLE4 H48 production policy; not a generic SHA restoration. */
export const STABLE4_H48_TIME_ONLY_APPROVAL = Object.freeze({
  targetSha: "e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
  planSha256: "82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce",
  researchSha: "9e1142f5ec6d4bc285deef023572623bb1c37a34",
  policy: "H48_TIME_ONLY",
  scope: "HYPE_TREND_LONG",
  residentStopRequired: false,
  residentTakeProfitRequired: false,
  approvedGross: { crypto: 3, stock: 4, total: 4.25, hype: 1 },
} as const);

export function isExactStable4H48OwnerApprovalRequest(input: {
  targetSha: unknown;
  planSha256: unknown;
  h48Policy: unknown;
  actor: unknown;
}): boolean {
  return input.targetSha === STABLE4_H48_TIME_ONLY_APPROVAL.targetSha &&
    input.planSha256 === STABLE4_H48_TIME_ONLY_APPROVAL.planSha256 &&
    input.h48Policy === STABLE4_H48_TIME_ONLY_APPROVAL.policy &&
    input.actor === "dunamishajime-bit";
}

export const DEPLOY_APPROVAL_SCOPES = [
  "V12_V4", "IDLE_PRIORITY_SHORT", "FULL_PROJECT", "V52",
  "HYPE_TREND_LONG", "QUALITY102_CAUSAL_V1", "PENGU_V8",
  "FET_BRK48_RESIDUAL", "SHARED_CRYPTO_RISK_ONLY",
] as const;
export type DeploymentApprovalScope = (typeof DEPLOY_APPROVAL_SCOPES)[number];

export const DEPLOY_APPROVAL_OPERATIONS = [
  "ALL_RUNNERS_MONITOR_REFRESH",
  "V12_V4_LIVE",
  "PENGU_V8_LIVE",
  "V12_V4_SCOPED_ORDER_ENABLE",
  "PENGU_V8_SCOPED_ORDER_ENABLE",
  "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
  "V52_SCOPED_ORDER_ENABLE",
  "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
  "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
  "SHARED_CRYPTO_RISK_WRITER",
  "V4_DOGE_MISSED_TIME_EXIT",
  "IDLE_FLAT_STALE_REPAIR",
  "HYPE_TREND_LONG_SHA_RESTORE",
  "HYPE_STABLE4_H48_TIME_ONLY_LIVE",
  "V4_HYPE_PEER_PIN_CONTINUITY",
  "ALL_RUNNERS_LIVE_RESTORE",
  "ALL_RUNNERS_ORDER_ENABLE_PREP",
  "ALL_RUNNERS_ORDER_ENABLE",
] as const;
export type DeploymentApprovalOperation = (typeof DEPLOY_APPROVAL_OPERATIONS)[number];

export const DEPLOY_APPROVAL_SCOPE: DeploymentApprovalScope = "V12_V4";

export const DEPLOY_APPROVAL_OPERATION_POLICY: Record<
  DeploymentApprovalOperation,
  { scope: DeploymentApprovalScope; ordersEnabled: boolean; label: string }
> = {
  ALL_RUNNERS_MONITOR_REFRESH: {
    scope: "FULL_PROJECT",
    ordersEnabled: false,
    label: "全Runner 監視・refreshのみ（注文無効）",
  },
  V12_V4_LIVE: {
    scope: "V12_V4",
    ordersEnabled: true,
    label: "V12 V4 Production LIVE",
  },
  PENGU_V8_LIVE: {
    scope: "PENGU_V8",
    ordersEnabled: true,
    label: "PENGU V8 単独 LIVE / 注文有効化",
  },
  V12_V4_SCOPED_ORDER_ENABLE: {
    scope: "V12_V4",
    ordersEnabled: true,
    label: "V12 V4 Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  PENGU_V8_SCOPED_ORDER_ENABLE: {
    scope: "PENGU_V8",
    ordersEnabled: true,
    label: "PENGU V8 Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE: {
    scope: "QUALITY102_CAUSAL_V1",
    ordersEnabled: true,
    label: "Q102 Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  V52_SCOPED_ORDER_ENABLE: {
    scope: "V52",
    ordersEnabled: true,
    label: "V52 Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE: {
    scope: "FET_BRK48_RESIDUAL",
    ordersEnabled: true,
    label: "FET BRK48 Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE: {
    scope: "IDLE_PRIORITY_SHORT",
    ordersEnabled: true,
    label: "IDLE Runner固有 permit 注文有効化（GLOBAL HOLD下）",
  },
  SHARED_CRYPTO_RISK_WRITER: {
    scope: "SHARED_CRYPTO_RISK_ONLY",
    ordersEnabled: false,
    label: "Shared Crypto Risk writer 単独有効化（注文権限なし）",
  },
  V4_DOGE_MISSED_TIME_EXIT: {
    scope: "V12_V4",
    ordersEnabled: true,
    label: "DOGEUSDT SHORT 226 / TIME決済（指定建玉1件のみ）",
  },
  IDLE_FLAT_STALE_REPAIR: {
    scope: "IDLE_PRIORITY_SHORT",
    ordersEnabled: false,
    label: "IDLE flat stale state repair",
  },
  HYPE_TREND_LONG_SHA_RESTORE: {
    scope: "HYPE_TREND_LONG",
    ordersEnabled: true,
    label: "HYPE専用SHA復旧（current-flat signed evidence）",
  },
  HYPE_STABLE4_H48_TIME_ONLY_LIVE: {
    scope: "HYPE_TREND_LONG",
    ordersEnabled: true,
    label: "STABLE4 HYPE H48時間決済（常駐STOP・TPなし／Crypto3.0x・Stock4.0x・Total4.25x・HYPE1.0x）",
  },
  V4_HYPE_PEER_PIN_CONTINUITY: {
    scope: "V12_V4",
    ordersEnabled: true,
    label: "V4 peer pin continuity（HYPEのみ新SHAへ）",
  },
  ALL_RUNNERS_LIVE_RESTORE: {
    scope: "FULL_PROJECT",
    ordersEnabled: false,
    label: "全Runner LIVE復旧（monitor-only / 注文無効）",
  },
  ALL_RUNNERS_ORDER_ENABLE_PREP: {
    scope: "FULL_PROJECT",
    ordersEnabled: false,
    label: "全Runner 注文有効化準備（helper導入・activation配線のみ / 注文無効）",
  },
  ALL_RUNNERS_ORDER_ENABLE: {
    scope: "FULL_PROJECT",
    ordersEnabled: true,
    label: "全Runner 注文有効化（復旧完了後の別承認）",
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
