"use strict";

// scripts/disdex-quality102-ranking-observer.ts
var import_config = require("dotenv/config");
var import_promises3 = require("node:fs/promises");
var import_node_path3 = require("node:path");

// lib/aster-v3-client.ts
var import_accounts = require("viem/accounts");

// lib/disdex-aster-global-rate-budget.ts
var import_promises = require("node:fs/promises");
var import_node_crypto = require("node:crypto");
var import_node_path = require("node:path");
var ASTER_GLOBAL_RATE_BUDGET_SCHEMA = "disdex-aster-rate-budget/v1";
var sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
var errorCode = (error) => error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
var transientLockRace = (error) => ["ENOENT", "ENOTEMPTY", "EPERM", "EBUSY"].includes(errorCode(error));
var LOCK_OWNER_SCHEMA = "disdex-aster-rate-budget-lock/v1";
var LOCK_RECOVERY_GRACE_MS = 5e3;
function validLockOwner(value) {
  if (!value || typeof value !== "object") return false;
  const owner = value;
  const pid = owner.pid;
  const createdAt = owner.createdAt;
  return owner.schema === LOCK_OWNER_SCHEMA && typeof pid === "number" && Number.isInteger(pid) && pid > 0 && typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0 && typeof owner.token === "string" && owner.token.length > 0 && (owner.processStartTicks === void 0 || typeof owner.processStartTicks === "string" && /^\d+$/.test(owner.processStartTicks));
}
async function readLockOwner(lockPath) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(lockPath, "owner.json"), "utf8"));
    return validLockOwner(parsed) ? parsed : void 0;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return void 0;
    return void 0;
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}
async function processStartTicks(pid) {
  if (process.platform !== "linux") return void 0;
  try {
    const raw = await (0, import_promises.readFile)(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return void 0;
    const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
    const value = fields[19];
    return value && /^\d+$/.test(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
async function newLockOwner() {
  const startTicks = await processStartTicks(process.pid);
  return {
    schema: LOCK_OWNER_SCHEMA,
    pid: process.pid,
    createdAt: Date.now(),
    token: (0, import_node_crypto.randomUUID)(),
    ...startTicks ? { processStartTicks: startTicks } : {}
  };
}
async function lockIsStale(lockPath, trustFreshGeneration = false) {
  if (trustFreshGeneration) {
    try {
      const metadata = await (0, import_promises.stat)(lockPath);
      if (Date.now() - metadata.mtimeMs <= LOCK_RECOVERY_GRACE_MS) return false;
    } catch (error) {
      return errorCode(error) === "ENOENT";
    }
  }
  const owner = await readLockOwner(lockPath);
  if (owner) {
    if (!processAlive(owner.pid)) return true;
    if (owner.processStartTicks) {
      const currentStartTicks = await processStartTicks(owner.pid);
      if (currentStartTicks && currentStartTicks !== owner.processStartTicks) return true;
    }
    return false;
  }
  try {
    const metadata = await (0, import_promises.stat)(lockPath);
    return Date.now() - metadata.mtimeMs > LOCK_RECOVERY_GRACE_MS;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}
async function acquireLockGenerationMutex(lockPath, deadline) {
  const recoveryPath = `${lockPath}.recovery`;
  const owner = await newLockOwner();
  while (true) {
    try {
      await (0, import_promises.mkdir)(recoveryPath, { mode: 448 });
      try {
        await writeLockOwner(recoveryPath, owner);
        return { path: recoveryPath, owner };
      } catch (error) {
        await (0, import_promises.rm)(recoveryPath, { recursive: true, force: true }).catch(() => void 0);
        if (!transientLockRace(error)) throw error;
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST" && !transientLockRace(error)) throw error;
      if (errorCode(error) === "EEXIST" && await lockIsStale(recoveryPath, true)) {
        try {
          await (0, import_promises.rm)(recoveryPath, { recursive: true, force: true });
          continue;
        } catch (recoveryError) {
          if (!transientLockRace(recoveryError)) throw recoveryError;
        }
      }
    }
    if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
    await sleep(5);
  }
}
async function releaseLockGenerationMutex(recovery) {
  const current = await readLockOwner(recovery.path);
  if (!current || current.token !== recovery.owner.token) return;
  const releasedPath = `${recovery.path}.released.${recovery.owner.token}`;
  const releaseDeadline = Date.now() + 5e3;
  while (true) {
    try {
      await (0, import_promises.rename)(recovery.path, releasedPath);
      break;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (!transientLockRace(error) || Date.now() >= releaseDeadline) {
        throw new Error("ASTER_GLOBAL_RATE_BUDGET_RECOVERY_LOCK_RELEASE_FAILED");
      }
      await sleep(5);
    }
  }
  await (0, import_promises.rm)(releasedPath, { recursive: true, force: true });
}
async function writeLockOwner(lockPath, owner) {
  await (0, import_promises.writeFile)((0, import_node_path.join)(lockPath, "owner.json"), `${JSON.stringify(owner)}
`, { encoding: "utf8", mode: 384 });
}
async function readBudget(path) {
  try {
    return JSON.parse(await (0, import_promises.readFile)(path, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}
async function atomicWriteBudget(path, state) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await (0, import_promises.writeFile)(temporary, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 432 });
    if (process.platform !== "win32" && typeof process.geteuid === "function" && process.geteuid() === 0) {
      const parent = await (0, import_promises.stat)((0, import_node_path.dirname)(path));
      await (0, import_promises.chown)(temporary, parent.uid, parent.gid);
    }
    await (0, import_promises.rename)(temporary, path);
    await (0, import_promises.chmod)(path, 432);
  } finally {
    await (0, import_promises.rm)(temporary, { force: true }).catch(() => void 0);
  }
}
async function acquireBudgetLock(lockPath, maxQueueMs) {
  const deadline = Date.now() + maxQueueMs;
  const owner = await newLockOwner();
  while (true) {
    try {
      await (0, import_promises.mkdir)(lockPath, { mode: 448 });
      while (true) {
        try {
          await writeLockOwner(lockPath, owner);
          return owner;
        } catch (error) {
          if (!transientLockRace(error)) {
            await (0, import_promises.rm)(lockPath, { recursive: true, force: true }).catch(() => void 0);
            throw error;
          }
          if (errorCode(error) === "ENOENT") break;
          if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
          await sleep(5);
        }
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST" && !transientLockRace(error)) throw error;
      const trustFreshBudgetLock = process.platform === "win32";
      if (errorCode(error) === "EEXIST" && await lockIsStale(lockPath, trustFreshBudgetLock)) {
        const recovery = await acquireLockGenerationMutex(lockPath, deadline);
        try {
          if (await lockIsStale(lockPath, trustFreshBudgetLock)) {
            const stalePath = `${lockPath}.stale.${(0, import_node_crypto.randomUUID)()}`;
            try {
              await (0, import_promises.rename)(lockPath, stalePath);
              await (0, import_promises.rm)(stalePath, { recursive: true, force: true });
            } catch (recoveryError) {
              if (errorCode(recoveryError) !== "ENOENT" && !transientLockRace(recoveryError)) throw recoveryError;
            }
          }
        } finally {
          await releaseLockGenerationMutex(recovery);
        }
        continue;
      }
    }
    if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
    await sleep(5);
  }
}
async function releaseBudgetLock(lockPath, owner) {
  const current = await readLockOwner(lockPath);
  if (!current || current.token !== owner.token) return;
  const releasedPath = `${lockPath}.released.${owner.token}`;
  const deadline = Date.now() + 5e3;
  while (true) {
    try {
      await (0, import_promises.rename)(lockPath, releasedPath);
      break;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (!transientLockRace(error) || Date.now() >= deadline) {
        throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_RELEASE_FAILED");
      }
      await sleep(5);
    }
  }
  await (0, import_promises.rm)(releasedPath, { recursive: true, force: true });
}
async function reserveAsterGlobalRateSlot(options) {
  const path = (0, import_node_path.resolve)(options.path);
  const lockPath = `${path}.lock`;
  if (!Number.isFinite(options.minIntervalMs) || !Number.isFinite(options.maxQueueMs) || options.weight !== void 0 && !Number.isFinite(options.weight) || options.nowMs !== void 0 && !Number.isFinite(options.nowMs)) {
    throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  }
  const minIntervalMs = Math.max(1, Math.min(1e3, Math.floor(options.minIntervalMs)));
  const maxQueueMs = Math.max(minIntervalMs, Math.min(3e4, Math.floor(options.maxQueueMs)));
  const weight = Math.max(1, Math.min(100, Math.floor(options.weight ?? 1)));
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  const owner = await acquireBudgetLock(lockPath, maxQueueMs);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) {
      throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    }
    const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const nextAllowedAt = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(nextAllowedAt) || nextAllowedAt < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const permitAt = Math.max(now, nextAllowedAt);
    const waitMs = permitAt - now;
    if (waitMs > maxQueueMs) throw new Error(`ASTER_GLOBAL_RATE_BUDGET_SATURATED:${waitMs}`);
    const state = {
      schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA,
      nextAllowedAt: permitAt + minIntervalMs * weight,
      updatedAt: now,
      pid: process.pid
    };
    await atomicWriteBudget(path, state);
    return { permitAt, waitMs, nextAllowedAt: state.nextAllowedAt };
  } finally {
    await releaseBudgetLock(lockPath, owner);
  }
}
async function deferAsterGlobalRateBudget(options) {
  if (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 0 || options.nowMs !== void 0 && !Number.isFinite(options.nowMs)) throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  const path = (0, import_node_path.resolve)(options.path);
  const lockPath = `${path}.lock`;
  const now = options.nowMs ?? Date.now();
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  const owner = await acquireBudgetLock(lockPath, 2e3);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const existing = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(existing) || existing < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const cooldownUntil = Math.max(existing, now + Math.floor(options.cooldownMs));
    await atomicWriteBudget(path, { schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA, nextAllowedAt: cooldownUntil, updatedAt: now, pid: process.pid, cooldownUntil, lastRateLimitStatus: options.status });
    return { cooldownUntil };
  } finally {
    await releaseBudgetLock(lockPath, owner);
  }
}
async function waitForAsterGlobalRateSlot(weight = 1) {
  const path = String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim();
  if (!path) return;
  const minIntervalMs = Number(process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS || 50);
  const maxQueueMs = Number(process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS || 5e3);
  const slot = await reserveAsterGlobalRateSlot({ path, minIntervalMs, maxQueueMs, weight });
  if (slot.waitMs > 0) await sleep(slot.waitMs);
}

// lib/aster-v3-client.ts
var AsterApiError = class extends Error {
  constructor(input) {
    super(input.message);
    this.name = "AsterApiError";
    this.path = input.path;
    this.status = input.status;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
    this.executionUnknown = input.executionUnknown === true;
    this.responseBody = input.responseBody;
  }
};
function normalizeBaseUrl(value) {
  return String(value || "https://fapi.asterdex.com").replace(/\/+$/, "");
}
function normalizePrivateKey(value) {
  if (!value) return void 0;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("ASTER_API_PRIVATE_KEY must be a 32-byte hex private key.");
  return normalized;
}
function valueToString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
function encodeParams(params) {
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null || value === "") continue;
    encoded.append(key, valueToString(value));
  }
  return encoded.toString();
}
function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function parseErrorCode(payload) {
  if (!payload || typeof payload !== "object") return void 0;
  const value = Number(payload.code);
  return Number.isFinite(value) ? value : void 0;
}
function parseErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload.msg ?? payload.message;
  return typeof value === "string" && value ? value : fallback;
}
function asterFuturesRequestWeight(method, path, params = {}) {
  const symbol = typeof params.symbol === "string" && params.symbol.length > 0;
  if (path === "/fapi/v3/balance" || path === "/fapi/v3/positionRisk" || path === "/fapi/v3/account" || path === "/fapi/v3/accountWithJoinMargin") return 5;
  if (path === "/fapi/v3/openOrders") return symbol ? 1 : 40;
  if (path === "/fapi/v3/income") return 30;
  if (path === "/fapi/v3/userTrades") return 5;
  if (path === "/fapi/v3/fundingRate") return 1;
  if (path === "/fapi/v3/ticker/24hr") return symbol ? 1 : 40;
  if (path === "/fapi/v3/ticker/price" || path === "/fapi/v3/ticker/bookTicker") return symbol ? 1 : 2;
  if (path === "/fapi/v3/klines") {
    const limit = Number(params.limit ?? 500);
    if (!Number.isFinite(limit) || limit <= 0) return 10;
    if (limit < 100) return 1;
    if (limit < 500) return 2;
    if (limit <= 1e3) return 5;
    return 10;
  }
  if (["/fapi/v3/ping", "/fapi/v3/time", "/fapi/v3/exchangeInfo", "/fapi/v3/order", "/fapi/v3/allOpenOrders", "/fapi/v3/leverage", "/fapi/v3/marginType"].includes(path)) return 1;
  return 100;
}
function retryAfterFromHeaders(headers) {
  const raw = headers.get("retry-after");
  if (!raw) return void 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : void 0;
}
function isReadOnlyRateLimitError(error) {
  if (error.status === 418) return false;
  if (error.status === 429) return true;
  if (error.code === -1003) return true;
  return /too many requests|rate[ -]?limit|request weight/i.test(error.message);
}
function sleep2(ms) {
  return new Promise((resolve4) => setTimeout(resolve4, ms));
}
var MonotonicMicrosecondNonce = class {
  constructor() {
    this.last = 0n;
  }
  next() {
    const now = BigInt(Date.now()) * 1000n;
    this.last = now > this.last ? now : this.last + 1n;
    return this.last.toString();
  }
};
var AsterV3Client = class {
  constructor(options = {}) {
    this.nonce = new MonotonicMicrosecondNonce();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.userAddress = options.userAddress?.trim();
    const privateKey = normalizePrivateKey(options.privateKey);
    this.account = privateKey ? (0, import_accounts.privateKeyToAccount)(privateKey) : void 0;
    this.signerAddress = this.account?.address;
    this.timeoutMs = Math.max(1e3, options.requestTimeoutMs ?? 1e4);
    this.recvWindowMs = Math.min(5e3, Math.max(1e3, options.recvWindowMs ?? 5e3));
    this.readOnlyRateLimitMaxRetries = Math.max(0, Math.min(5, Math.floor(options.readOnlyRateLimitMaxRetries ?? 3)));
    this.readOnlyRateLimitBackoffBaseMs = Math.max(1, Math.min(6e4, Math.floor(options.readOnlyRateLimitBackoffBaseMs ?? 1e3)));
    this.readOnlyRateLimitBackoffMaxMs = Math.max(this.readOnlyRateLimitBackoffBaseMs, Math.min(12e4, Math.floor(options.readOnlyRateLimitBackoffMaxMs ?? 12e4)));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent || "DisDex-Win80-LiveRunner/1.0";
  }
  hasTradingCredentials() {
    return Boolean(this.account && this.signerAddress && this.userAddress);
  }
  async signParams(params) {
    if (!this.account || !this.signerAddress || !this.userAddress) throw new Error("Aster V3 signed request requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    const signedParams = { ...params, recvWindow: params.recvWindow ?? this.recvWindowMs, nonce: this.nonce.next(), user: this.userAddress, signer: this.signerAddress };
    const message = encodeParams(signedParams);
    const signature = await this.account.signTypedData({
      domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Message: [{ name: "msg", type: "string" }] },
      primaryType: "Message",
      message: { msg: message }
    });
    return { signedParams, signature };
  }
  async request(input) {
    const method = input.method;
    const params = input.params || {};
    let retries = 0;
    while (true) {
      try {
        await waitForAsterGlobalRateSlot(asterFuturesRequestWeight(method, input.path, params));
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), this.timeoutMs);
        try {
          let query = "";
          let body;
          if (input.signed) {
            const signed = await this.signParams(params);
            const payload2 = encodeParams({ ...signed.signedParams, signature: signed.signature });
            if (method === "GET") query = payload2;
            else body = payload2;
          } else {
            const payload2 = encodeParams(params);
            if (method === "GET") query = payload2;
            else body = payload2;
          }
          const url = `${this.baseUrl}${input.path}${query ? `?${query}` : ""}`;
          const response = await this.fetchImpl(url, { method, body, signal: abort.signal, headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": this.userAgent }, cache: "no-store" });
          const text = await response.text();
          const payload = parseJsonSafe(text);
          if (!response.ok) {
            const executionUnknown = response.status === 503 && input.orderMutation === true;
            const retryAfterMs = retryAfterFromHeaders(response.headers);
            const budgetPath = String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim();
            if (budgetPath && (response.status === 429 || response.status === 418)) {
              const minimumCooldownMs = response.status === 418 ? 12e4 : 6e4;
              await deferAsterGlobalRateBudget({ path: budgetPath, cooldownMs: Math.max(minimumCooldownMs, retryAfterMs ?? 0), status: response.status });
            }
            throw new AsterApiError({ path: input.path, message: parseErrorMessage(payload, `Aster HTTP ${response.status}`), status: response.status, code: parseErrorCode(payload), retryAfterMs, executionUnknown, responseBody: payload });
          }
          return payload;
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        const canRetry = input.orderMutation !== true && !String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim() && retries < this.readOnlyRateLimitMaxRetries && error instanceof AsterApiError && isReadOnlyRateLimitError(error);
        if (canRetry) {
          const exponential = this.readOnlyRateLimitBackoffBaseMs * 2 ** retries;
          const waitMs = Math.min(this.readOnlyRateLimitBackoffMaxMs, Math.max(exponential, error.retryAfterMs ?? 0));
          retries += 1;
          await sleep2(waitMs);
          continue;
        }
        if (error instanceof AsterApiError) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new AsterApiError({ message: `Aster request timeout after ${this.timeoutMs}ms`, status: 0, executionUnknown: input.orderMutation === true });
        throw error;
      }
    }
  }
  ping() {
    return this.request({ method: "GET", path: "/fapi/v3/ping" });
  }
  getServerTime() {
    return this.request({ method: "GET", path: "/fapi/v3/time" });
  }
  getExchangeInfo() {
    return this.request({ method: "GET", path: "/fapi/v3/exchangeInfo" });
  }
  getPriceTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/price", params: symbol ? { symbol } : void 0 });
  }
  getBookTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/bookTicker", params: symbol ? { symbol } : void 0 });
  }
  get24hTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/24hr", params: symbol ? { symbol } : void 0 });
  }
  getKlines(symbol, interval, limit = 200, range = {}) {
    return this.request({
      method: "GET",
      path: "/fapi/v3/klines",
      params: { symbol, interval, limit, startTime: range.startTime, endTime: range.endTime }
    });
  }
  getBalances() {
    return this.request({ method: "GET", path: "/fapi/v3/balance", signed: true });
  }
  getPositions(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/positionRisk", params: symbol ? { symbol } : void 0, signed: true });
  }
  getOpenOrders(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/openOrders", params: symbol ? { symbol } : void 0, signed: true });
  }
  setMarginType(symbol, marginType) {
    return this.request({ method: "POST", path: "/fapi/v3/marginType", params: { symbol, marginType }, signed: true, orderMutation: true });
  }
  setLeverage(symbol, leverage) {
    return this.request({ method: "POST", path: "/fapi/v3/leverage", params: { symbol, leverage }, signed: true, orderMutation: true });
  }
  getOrder(symbol, clientOrderId) {
    return this.request({ method: "GET", path: "/fapi/v3/order", params: { symbol, origClientOrderId: clientOrderId }, signed: true });
  }
  getIncomeHistory(input = {}) {
    return this.request({ method: "GET", path: "/fapi/v3/income", params: { ...input, limit: Math.min(1e3, Math.max(1, input.limit ?? 1e3)) }, signed: true });
  }
  getUserTrades(symbol, input = {}) {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    if (!normalizedSymbol) throw new Error("ASTER_USER_TRADES_SYMBOL_REQUIRED");
    return this.request({
      method: "GET",
      path: "/fapi/v3/userTrades",
      params: { symbol: normalizedSymbol, ...input, limit: Math.min(1e3, Math.max(1, input.limit ?? 1e3)) },
      signed: true
    });
  }
  placeMarketOrder(order) {
    return this.request({ method: "POST", path: "/fapi/v3/order", params: { symbol: order.symbol, side: order.side, type: "MARKET", quantity: order.quantity, positionSide: order.positionSide || "BOTH", reduceOnly: order.reduceOnly === true ? "true" : "false", newClientOrderId: order.newClientOrderId, newOrderRespType: order.newOrderRespType || "RESULT" }, signed: true, orderMutation: true });
  }
  placeConditionalOrder(order) {
    return this.request({ method: "POST", path: "/fapi/v3/order", params: { symbol: order.symbol, side: order.side, type: order.type, quantity: order.quantity, stopPrice: order.stopPrice, positionSide: order.positionSide || "BOTH", reduceOnly: "true", newClientOrderId: order.newClientOrderId, workingType: order.workingType || "MARK_PRICE", priceProtect: order.priceProtect === true ? "TRUE" : "FALSE", newOrderRespType: order.newOrderRespType || "ACK" }, signed: true, orderMutation: true });
  }
  cancelOrder(symbol, clientOrderId) {
    return this.request({ method: "DELETE", path: "/fapi/v3/order", params: { symbol, origClientOrderId: clientOrderId }, signed: true, orderMutation: true });
  }
  placeStopMarketOrder(order) {
    return this.request({
      method: "POST",
      path: "/fapi/v3/order",
      params: {
        symbol: order.symbol,
        side: order.side,
        type: "STOP_MARKET",
        quantity: order.quantity,
        stopPrice: order.stopPrice,
        positionSide: order.positionSide || "BOTH",
        reduceOnly: "true",
        workingType: "MARK_PRICE",
        priceProtect: "TRUE",
        newClientOrderId: order.newClientOrderId,
        newOrderRespType: order.newOrderRespType || "RESULT"
      },
      signed: true,
      orderMutation: true
    });
  }
};

// config/v52V50Runtime.json
var v52V50Runtime_default = {
  policyId: "V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20",
  strategy: "V50_POST_OPEN_BASIS",
  windowPolicy: "POST_EARLY3",
  windowsNy: ["11:30", "12:30", "13:30"],
  direction: "BOTH",
  minimumEntryBasisBps: 60,
  convergenceBps: 20,
  basisStopMultiple: 1.75,
  minimumNetEdgeBps: 7.5,
  maximumRoundTripCostBps: 60,
  maximumSpreadBps: 20,
  maximumHoldingHours: 3,
  stockAggregateGross: 4,
  slotGross: 2
};

// config/integratedProductionRiskPolicy.ts
var Q102_CAUSAL_V4_FAMILY_GROSS = Object.freeze({
  HIGH_VOL: 1,
  MR: 0.75,
  BRK: 0.75,
  REV: 1.5,
  PB: 2
});
var INTEGRATED_PRODUCTION_RISK_POLICY = Object.freeze({
  v12BaseAggregateGross: 2,
  v12DynamicAggregateGrossCap: 2,
  v12PerPositionGrossCap: 1,
  v12MaximumPositions: 3,
  fetResidualMaximumGross: 1,
  fetResidualMinimumGross: 0.05,
  penguMaximumGross: 1,
  // HYPE/ZEC are lower-priority, long-only sidecars. These values are risk
  // and per-sleeve ceilings; they never multiply the strategy notional.
  hypeLongRiskPct: 5,
  // The approved HYPE trend overlay has its own 1.50x sleeve ceiling.  ZEC
  // remains a separate, disabled research sidecar at the legacy 1.00x cap.
  hypeLongMaximumGross: 1.5,
  zecLongRiskPct: 4.5,
  hypeZecMaximumGross: 1,
  hypeZecMaximumReductionFraction: 0.5,
  q102FamilyGross: Q102_CAUSAL_V4_FAMILY_GROSS,
  q102CausalV4MaximumGross: 3,
  q102MaximumPositions: 1,
  // Normal operating caps proven by the 2026-09-22 DD<20% integrated replay.
  cryptoGrossCap: 3,
  stockGrossCap: Number(v52V50Runtime_default.stockAggregateGross),
  stockSlotGrossCap: Number(v52V50Runtime_default.slotGross),
  totalGrossCap: 4.25,
  // Absolute ceilings. Entry exposure may only expand above the normal caps
  // through the integrated profit/DD/margin governor.
  cryptoGrossHardCap: 5,
  totalGrossHardCap: 8,
  grossGovernorBaseAvailableBalanceReservePct: 15,
  cryptoDailyLossPct: 7.5,
  stockDailyLossPct: 3.5,
  killSwitchRecoveryGraceMs: 10 * 6e4,
  requiredAsterLeverage: 5,
  requiredAsterMarginType: "cross",
  v50: Object.freeze(v52V50Runtime_default)
});

// config/disdexStrictBt33404708902Runtime.ts
var STRICT_BT33404708902 = Object.freeze({
  sourceRun: "33404708902",
  sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
  grossPolicy: "BASE_PRIORITY_CRYPTO_AND_TOTAL_RESIDUAL_GROSS_SHRINK",
  resizePnlAccounting: "MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN",
  sourceValidation: "ALL_102_FROZEN_RESEARCH_1H_OPEN_CROSSCHECK_FAIL_CLOSED",
  quality102PositionCap: 1.5,
  quality102CausalV1PositionCap: 1.5,
  cryptoGrossCap: 3,
  totalGrossCap: 3.5,
  stockGrossCap: 1.5,
  v12MaximumGross: 1.5,
  v12PerPositionGrossCap: 1,
  v12MaximumPositions: 1,
  v12LiveMaximumPositions: 2,
  penguMaximumGross: 0.85,
  quality102LiveSelectorParity: false,
  quality102LiveBlockedFailClosed: true,
  liveActivated: false,
  researchOnly: true
});

// lib/disdex-quality102-causal-selector.ts
var QUALITY102_CAUSAL_CAPABILITIES = Object.freeze({
  s1s2RawGeneratorProven: false,
  s34RawGeneratorProven: false,
  selectorImplemented: false
});
var QUALITY102_RECOVERY_CAPABILITIES = Object.freeze({
  highVolRawGeneratorImplemented: true,
  highVolHistoricalParity: Object.freeze({
    oldUniverseExact: Object.freeze({ expected: 137, matched: 137 }),
    expandedUniverseExact: Object.freeze({ expected: 388, matched: 388 }),
    combinedRawExpected: 525
  }),
  highVol525To30SelectorProven: false,
  recoveredHighVolSelectedShape: Object.freeze({ stage1: 8, stage2: 22, total: 30 }),
  pbMrRevPostGenerationRecovered: true,
  brkStrengthFormulaProven: false,
  quality124TransformRecovered: true,
  oneSlotRouterRecovered: true,
  selectorImplemented: false
});
var QUALITY102_RECOVERED_POST_GENERATION_SOURCE = Object.freeze({
  commit: "450f8fae800d3f509ef868ab035f0cd731216279",
  script: "scripts/research_quality102_selector_recovered.py",
  scope: "POST_GENERATION_TRANSFORMS_QUALITY_GATE_AND_ONE_SLOT_ONLY"
});
var QUALITY102_DEFAULT_MAX_DATA_AGE_MS = 65 * 6e4;
function evaluateS34QualityGate(input) {
  if (input.side !== -1 && input.side !== 1) return { accepted: false, reason: "INVALID_S34_SIDE" };
  if (!Number.isFinite(input.strength) || !Number.isFinite(input.ret14)) {
    return { accepted: false, reason: "INVALID_S34_NUMERIC_INPUT" };
  }
  if (typeof input.variant !== "string" || input.variant.trim().length === 0) {
    return { accepted: false, reason: "INVALID_S34_VARIANT" };
  }
  switch (input.family) {
    case "PB":
      return {
        accepted: input.variant !== "PB168_0.1_P24_0.04_H12",
        reason: "PB_WEAK_VARIANT_REMOVED"
      };
    case "MR":
      return {
        accepted: input.side === -1 || input.ret14 >= -0.025,
        reason: "MR_REGIME_GATE"
      };
    case "BRK":
      return {
        accepted: input.strength >= 0.03 && input.side * input.ret14 >= -0.05,
        reason: "BRK_QUALITY_GATE"
      };
    case "REV":
      return { accepted: true, reason: "UNCHANGED" };
    default:
      return { accepted: false, reason: "UNKNOWN_S34_FAMILY" };
  }
}
function v4FiniteDevelopment(input) {
  return Number.isFinite(input.margin) && Number.isFinite(input.developmentN) && Number.isFinite(input.developmentSpf) && Number.isFinite(input.developmentAvg);
}
function evaluateQuality102CausalV4FeatureGate(input) {
  if (input.side !== -1 && input.side !== 1) return { accepted: false, reason: "INVALID_V4_FEATURE_SIDE" };
  if (!Number.isFinite(input.ret14) || !input.symbol.trim() || !input.variant.trim()) {
    return { accepted: false, reason: "INVALID_V4_FEATURE_INPUT" };
  }
  const alignedRet14 = input.side * input.ret14;
  if (input.family === "BRK") {
    const key = `${input.symbol.toUpperCase()}|${input.variant}`;
    const accepted = key === "FET|BRK24_H48_V1.2" && alignedRet14 >= 0.15 && alignedRet14 < 0.3 || key === "NEAR|BRK48_H48_V1.2" && alignedRet14 >= -0.05 && alignedRet14 < 0.02 || key === "RENDER|BRK168_H12_V1.2" && alignedRet14 >= 0.15 && alignedRet14 < 0.3;
    return { accepted, reason: accepted ? "V4_FEATURE_GATE_PASS" : "V4_BRK_VARIANT_WINDOW_REJECT" };
  }
  if (!v4FiniteDevelopment(input)) return { accepted: false, reason: "INVALID_V4_FEATURE_INPUT" };
  if (input.family === "MR") {
    if (!(alignedRet14 >= -0.15 && alignedRet14 < -0.08)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 20 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1.05 && input.margin < 1.7)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  if (input.family === "PB") {
    if (!(alignedRet14 >= -0.5 && alignedRet14 < 0.2)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 0 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1 && input.margin < 1.7)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  if (input.family === "REV") {
    if (!(alignedRet14 >= 0.1 && alignedRet14 < 0.3)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 0 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1 && input.margin < 3)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  return { accepted: false, reason: "UNKNOWN_V4_S34_FAMILY" };
}
var QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN = 0.24;
function evaluateQuality102CausalV4ImprovementGate(input) {
  if (input.side !== -1 && input.side !== 1) {
    return { accepted: false, reason: "INVALID_V4_IMPROVEMENT_SIDE" };
  }
  if (!Number.isFinite(input.ret14)) {
    return { accepted: false, reason: "INVALID_V4_IMPROVEMENT_RET14" };
  }
  if (input.family === "REV" && input.side === 1 && input.ret14 < QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN) {
    return { accepted: false, reason: "REV_LONG_RET14_BELOW_24PCT" };
  }
  return { accepted: true, reason: "V4_IMPROVEMENT_GATE_PASS" };
}
var LAYER_PRIORITY = Object.freeze({
  S1: 0,
  S2: 1,
  S3: 2,
  S4: 3
});

// config/disdexQuality102CausalV1Runtime.ts
var QUALITY102_CAUSAL_V1 = Object.freeze({
  strategyId: "QUALITY102_CAUSAL_V1",
  maximumGross: INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross,
  cryptoGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
  totalGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
  maximumPositions: INTEGRATED_PRODUCTION_RISK_POLICY.q102MaximumPositions,
  historicalSelectorParity: false,
  brkEnabled: false
});

// lib/disdex-quality102-causal-pipeline.ts
var QUALITY102_HOUR_MS = 36e5;
var QUALITY102_DAY_MS = 24 * QUALITY102_HOUR_MS;
var QUALITY102_HIGH_VOL_GRID = Object.freeze({
  longDrops: Object.freeze([0.08, 0.1, 0.12, 0.15]),
  longRsis: Object.freeze([30, 35, 40]),
  shortRallies: Object.freeze([0.05, 0.08, 0.1, 0.12]),
  shortRsis: Object.freeze([55, 60, 65]),
  hardStops: Object.freeze([0.1, 0.15])
});
var QUALITY102_EXPECTED_COUNTS = Object.freeze({
  raw: 151,
  highVolRaw: 30,
  s34Raw: 121,
  s34Rejected: 27,
  quality124: 124,
  oneSlotBlocked: 22,
  quality102: 102,
  layers: Object.freeze({ S1: 8, S2: 10, S3: 69, S4: 15 }),
  families: Object.freeze({ HIGH_VOL: 18, PB: 10, MR: 22, BRK: 28, REV: 24 }),
  exitReasons: Object.freeze({ time: 77, "72h_time": 13, stop: 7, trail_5pct_after_12pct: 5 })
});
var QUALITY102_RESEARCH_COSTS = Object.freeze({
  normal: Object.freeze({ perSide: 6e-4, fundingPerDay: 2e-4 }),
  stress: Object.freeze({ perSide: 1e-3, fundingPerDay: 5e-4 })
});
function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`QUALITY102_NONFINITE:${label}`);
  return value;
}
function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new Error(`QUALITY102_NONPOSITIVE:${label}`);
  return value;
}
function assertCandle(bar, index) {
  finite(bar.timestampMs, `candle[${index}].timestampMs`);
  positive(bar.open, `candle[${index}].open`);
  positive(bar.high, `candle[${index}].high`);
  positive(bar.low, `candle[${index}].low`);
  positive(bar.close, `candle[${index}].close`);
  finite(bar.quoteVolume, `candle[${index}].quoteVolume`);
  if (bar.quoteVolume < 0) throw new Error(`QUALITY102_NEGATIVE_VOLUME:${index}`);
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
    throw new Error(`QUALITY102_INVALID_OHLC:${index}`);
  }
}
function assertContiguousHourly(bars, start, end) {
  for (let index = start; index <= end; index += 1) {
    const bar = bars[index];
    if (!bar) throw new Error(`QUALITY102_MISSING_CANDLE:${index}`);
    assertCandle(bar, index);
    if (index > start && bar.timestampMs - bars[index - 1].timestampMs !== QUALITY102_HOUR_MS) {
      throw new Error(`QUALITY102_NONCONTIGUOUS_1H:${index}`);
    }
  }
}
function wilderRma(values, period) {
  if (values.length < period) throw new Error("QUALITY102_INSUFFICIENT_RMA_INPUT");
  let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) average = (average * (period - 1) + value) / period;
  return average;
}
function wilderRsi(closes, period = 14) {
  if (closes.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_RSI_INPUT");
  const gains = [];
  const losses = [];
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const averageGain = wilderRma(gains, period);
  const averageLoss = wilderRma(losses, period);
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
function wilderAtr(bars, period = 14) {
  if (bars.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_ATR_INPUT");
  const trueRanges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return wilderRma(trueRanges, period);
}
function median(values) {
  if (!values.length) throw new Error("QUALITY102_EMPTY_MEDIAN");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function monthStartUtc(timestampMs) {
  finite(timestampMs, "month.timestampMs");
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) throw new Error("QUALITY102_INVALID_TIMESTAMP");
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
function computeQuality102HighVolFeatures(bars, signalIndex) {
  if (!Number.isInteger(signalIndex) || signalIndex < 336 || signalIndex >= bars.length) {
    throw new Error("QUALITY102_SIGNAL_INDEX_REQUIRES_337_COMPLETED_BARS");
  }
  const start = signalIndex - 336;
  assertContiguousHourly(bars, start, signalIndex);
  const current = bars[signalIndex];
  const ret24 = current.close / bars[signalIndex - 24].close - 1;
  const ret14d = current.close / bars[signalIndex - 336].close - 1;
  const causalBars = bars.slice(start, signalIndex + 1);
  const atr14 = wilderAtr(causalBars, 14);
  const volumeRatioDenominator = median(bars.slice(signalIndex - 23, signalIndex + 1).map((bar) => bar.quoteVolume));
  const volumeRatio = volumeRatioDenominator > 0 ? current.quoteVolume / volumeRatioDenominator : current.quoteVolume > 0 ? Number.POSITIVE_INFINITY : 1;
  return {
    signalTs: current.timestampMs,
    ret24,
    ret14d,
    rsi14: wilderRsi(causalBars.map((bar) => bar.close), 14),
    atr14,
    atrPct: atr14 / current.close,
    volumeRatio,
    barUp: current.close > current.open,
    barDown: current.close < current.open
  };
}
function quality102HighVolMarketValid(features) {
  return Number.isFinite(features.ret14d) && features.atrPct >= 0.01 && features.volumeRatio >= 0.5;
}
function matchQuality102HighVolGrid(features) {
  if (!quality102HighVolMarketValid(features)) return [];
  const matches = [];
  if (features.ret14d >= 0 && features.barUp) {
    for (const threshold of QUALITY102_HIGH_VOL_GRID.longDrops) {
      for (const rsi of QUALITY102_HIGH_VOL_GRID.longRsis) {
        if (features.ret24 <= -threshold && features.rsi14 <= rsi) {
          for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: 1, threshold, rsi, hardStop });
        }
      }
    }
  } else if (features.ret14d < 0 && features.barDown) {
    for (const threshold of QUALITY102_HIGH_VOL_GRID.shortRallies) {
      for (const rsi of QUALITY102_HIGH_VOL_GRID.shortRsis) {
        if (features.ret24 >= threshold && features.rsi14 >= rsi) {
          for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: -1, threshold, rsi, hardStop });
        }
      }
    }
  }
  return matches;
}
function isGridValue(values, value) {
  return values.some((allowed) => allowed === value);
}
function assertHighVolRule(rule) {
  finite(rule.longDrop, "rule.longDrop");
  finite(rule.longRsi, "rule.longRsi");
  finite(rule.shortRally, "rule.shortRally");
  finite(rule.shortRsi, "rule.shortRsi");
  finite(rule.hardStop, "rule.hardStop");
  if (!isGridValue(QUALITY102_HIGH_VOL_GRID.longDrops, rule.longDrop) || !isGridValue(QUALITY102_HIGH_VOL_GRID.longRsis, rule.longRsi) || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRallies, rule.shortRally) || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRsis, rule.shortRsi) || !isGridValue(QUALITY102_HIGH_VOL_GRID.hardStops, rule.hardStop)) {
    throw new Error("QUALITY102_HIGH_VOL_RULE_OUTSIDE_GRID");
  }
}
function quality102HighVolRuleKey(rule) {
  assertHighVolRule(rule);
  return JSON.stringify({
    long_drop: rule.longDrop,
    long_rsi: rule.longRsi,
    short_rally: rule.shortRally,
    short_rsi: rule.shortRsi,
    hard_stop: rule.hardStop
  });
}
function selectQuality102HighVolMonthlyRule(input) {
  const monthStartTs = finite(input.monthStartTs, "monthStartTs");
  const monthStartDate = new Date(monthStartTs);
  if (monthStartTs <= 0 || monthStartTs % QUALITY102_HOUR_MS !== 0 || monthStartDate.getUTCDate() !== 1 || monthStartDate.getUTCHours() !== 0 || monthStartDate.getUTCMinutes() !== 0 || monthStartDate.getUTCSeconds() !== 0 || monthStartDate.getUTCMilliseconds() !== 0) {
    throw new Error("QUALITY102_INVALID_MONTH_START");
  }
  const expectedTrainingStart = monthStartTs - 180 * QUALITY102_DAY_MS;
  const expectedTrainingEnd = monthStartTs - QUALITY102_HOUR_MS;
  const eligible = [];
  const ineligible = [];
  for (const evaluation of input.evaluations) {
    let valid = true;
    try {
      assertHighVolRule(evaluation.rule);
      valid = Number.isInteger(evaluation.trades) && evaluation.trades >= 5 && Number.isInteger(evaluation.wins) && evaluation.wins >= 0 && evaluation.wins <= evaluation.trades && Number.isFinite(evaluation.totalReturn) && evaluation.totalReturn > 0 && !Number.isNaN(evaluation.profitFactor) && evaluation.profitFactor >= 1.15 && Number.isFinite(evaluation.expectancy) && evaluation.expectancy > 0 && Number.isFinite(evaluation.maxDrawdown) && evaluation.trainingStartTs === expectedTrainingStart && evaluation.trainingEndTs === expectedTrainingEnd && Number.isFinite(evaluation.availableAtTs) && evaluation.availableAtTs > 0 && evaluation.availableAtTs <= monthStartTs && evaluation.availableAtTs <= expectedTrainingEnd;
      if (!valid) throw new Error("ineligible");
    } catch {
      ineligible.push(evaluation);
      continue;
    }
    const winRate = evaluation.wins / evaluation.trades;
    if (winRate < 0.52) {
      ineligible.push(evaluation);
      continue;
    }
    const score = wilsonLowerBound(evaluation.wins, evaluation.trades, 1) + Math.min(evaluation.profitFactor, 3) * 0.03 + evaluation.expectancy * 2 - Math.max(0, -evaluation.maxDrawdown - 0.25);
    eligible.push({ ...evaluation, winRate, score, ruleKey: quality102HighVolRuleKey(evaluation.rule) });
  }
  eligible.sort((left, right) => right.score - left.score || left.ruleKey.localeCompare(right.ruleKey));
  return { selected: eligible[0], eligible, ineligible };
}
function wilsonLowerBound(wins, trades, z = 1) {
  if (!Number.isInteger(wins) || !Number.isInteger(trades) || trades <= 0 || wins < 0 || wins > trades || !(z > 0 && Number.isFinite(z))) {
    throw new Error("QUALITY102_INVALID_WILSON_INPUT");
  }
  const p = wins / trades;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trades;
  const center = p + zSquared / (2 * trades);
  const adjustment = z * Math.sqrt(p * (1 - p) / trades + zSquared / (4 * trades * trades));
  return (center - adjustment) / denominator;
}

// lib/disdex-quality102-causal-v1-signal.ts
var MINIMUM_HISTORY_HOURS = 181 * 24;
var FEATURE_WARMUP_HOURS = 336;
var MAXIMUM_HOLD_HOURS = 72;
var CORRELATION_HOURS = 30 * 24;
var MINIMUM_CORRELATION_HOURS = 10 * 24;
function ruleGrid(symbol) {
  const pengu = symbol === "PENGUUSDT";
  const longDrops = pengu ? QUALITY102_HIGH_VOL_GRID.longDrops : [0.08, 0.1, 0.12];
  const longRsis = pengu ? QUALITY102_HIGH_VOL_GRID.longRsis : [35, 40];
  const shortRallies = pengu ? QUALITY102_HIGH_VOL_GRID.shortRallies : [0.05, 0.08, 0.1];
  const shortRsis = pengu ? QUALITY102_HIGH_VOL_GRID.shortRsis : [60, 65];
  const rules = [];
  for (const longDrop of longDrops) for (const longRsi of longRsis) {
    for (const shortRally of shortRallies) for (const shortRsi of shortRsis) {
      for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) rules.push({ longDrop, longRsi, shortRally, shortRsi, hardStop });
    }
  }
  return rules;
}
function matchedSide(features, rule) {
  const match = matchQuality102HighVolGrid(features).find((candidate) => candidate.hardStop === rule.hardStop && (candidate.side === 1 ? candidate.threshold === rule.longDrop && candidate.rsi === rule.longRsi : candidate.threshold === rule.shortRally && candidate.rsi === rule.shortRsi));
  return match?.side;
}
function summarizeReturns(returns) {
  if (!returns.length) return { trades: 0, wins: 0, totalReturn: 0, winRate: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0 };
  let equity = 1;
  let peak;
  let maxDrawdown = 0;
  let gains = 0;
  let losses = 0;
  let wins = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = peak === void 0 ? equity : Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (value > 0) {
      wins += 1;
      gains += value;
    } else {
      losses += value;
    }
  }
  return {
    trades: returns.length,
    wins,
    totalReturn: equity - 1,
    winRate: wins / returns.length,
    profitFactor: losses < 0 ? gains / -losses : 999,
    expectancy: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    maxDrawdown
  };
}
function trainRule(rows, features, rule, firstSignalIndex, trainingEndIndex) {
  const returns = [];
  let signalIndex = firstSignalIndex;
  while (signalIndex < trainingEndIndex - MAXIMUM_HOLD_HOURS) {
    const side = matchedSide(features.get(signalIndex), rule);
    if (side === void 0) {
      signalIndex += 1;
      continue;
    }
    const entryIndex = signalIndex + 1;
    const entryPrice = rows[entryIndex].open;
    const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
    let exitIndex = signalIndex + MAXIMUM_HOLD_HOURS;
    let exitPrice = rows[exitIndex].close;
    for (let index = entryIndex; index <= exitIndex; index += 1) {
      if (side === 1 && rows[index].low <= stopPrice || side === -1 && rows[index].high >= stopPrice) {
        exitIndex = index;
        exitPrice = stopPrice;
        break;
      }
    }
    const holdHours = exitIndex - entryIndex + 1;
    const grossReturn = side * (exitPrice / entryPrice - 1);
    const costs = QUALITY102_RESEARCH_COSTS.normal;
    returns.push(grossReturn - 2 * costs.perSide - costs.fundingPerDay * holdHours / 24);
    signalIndex = exitIndex + 1;
  }
  return summarizeReturns(returns);
}
function monthlySelection(symbol, rows, dataCutoffTs) {
  const monthStartTs = monthStartUtc(dataCutoffTs);
  const trainingStartTs = monthStartTs - 180 * QUALITY102_DAY_MS;
  const trainingEndTs = monthStartTs - QUALITY102_HOUR_MS;
  const firstTs = rows[0].timestampMs;
  if (firstTs > trainingStartTs - FEATURE_WARMUP_HOURS * QUALITY102_HOUR_MS || rows.at(-1).timestampMs < trainingEndTs) return void 0;
  const firstSignalIndex = (trainingStartTs - firstTs) / QUALITY102_HOUR_MS;
  const trainingEndIndex = (trainingEndTs - firstTs) / QUALITY102_HOUR_MS;
  if (!Number.isInteger(firstSignalIndex) || !Number.isInteger(trainingEndIndex)) return void 0;
  const features = /* @__PURE__ */ new Map();
  for (let index = firstSignalIndex; index < trainingEndIndex - MAXIMUM_HOLD_HOURS; index += 1) {
    features.set(index, computeQuality102HighVolFeatures(rows, index));
  }
  const evaluations = ruleGrid(symbol).map((rule) => {
    const metrics = trainRule(rows, features, rule, firstSignalIndex, trainingEndIndex);
    return { rule, ...metrics, trainingStartTs, trainingEndTs, availableAtTs: trainingEndTs };
  });
  const selected = selectQuality102HighVolMonthlyRule({ monthStartTs, evaluations }).selected;
  if (!selected) return void 0;
  return {
    rule: selected.rule,
    metrics: {
      trades: selected.trades,
      wins: selected.wins,
      totalReturn: selected.totalReturn,
      winRate: selected.winRate,
      profitFactor: selected.profitFactor,
      expectancy: selected.expectancy,
      maxDrawdown: selected.maxDrawdown
    }
  };
}
function scannerHealthPass(metrics) {
  return metrics.winRate >= 0.58 && metrics.profitFactor >= 1.3 && metrics.expectancy > 0 && metrics.maxDrawdown >= -0.3 && metrics.trades >= 5;
}
function candidateFor(symbol, rows, dataCutoffTs) {
  const selection = monthlySelection(symbol, rows, dataCutoffTs);
  if (!selection || symbol !== "PENGUUSDT" && !scannerHealthPass(selection.metrics)) return { selection };
  const features = computeQuality102HighVolFeatures(rows, rows.length - 1);
  const side = matchedSide(features, selection.rule);
  if (side === void 0) return { selection };
  const metrics = selection.metrics;
  const score = 30 * metrics.winRate + 10 * Math.min(metrics.profitFactor, 3) + 200 * Math.max(-0.05, Math.min(0.1, metrics.expectancy)) + 60 * Math.min(Math.abs(features.ret24), 0.25) + 30 * Math.min(features.atrPct, 0.08) + 2 * Math.min(features.volumeRatio, 3) + (symbol === "PENGUUSDT" ? 3 : 0);
  return { selection, candidate: { id: `HIGH_VOL:${symbol}:${features.signalTs}`, symbol, side, score } };
}
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
function highVolProximity(features, rule, side) {
  const long = side === 1;
  const progress = {
    regime: long ? features.ret14d >= 0 ? 1 : 0 : features.ret14d < 0 ? 1 : 0,
    barDirection: long ? features.barUp ? 1 : 0 : features.barDown ? 1 : 0,
    ret24: long ? clamp01(-features.ret24 / rule.longDrop) : clamp01(features.ret24 / rule.shortRally),
    rsi14: long ? features.rsi14 <= rule.longRsi ? 1 : clamp01(rule.longRsi / Math.max(features.rsi14, 1e-9)) : features.rsi14 >= rule.shortRsi ? 1 : clamp01(features.rsi14 / rule.shortRsi),
    atrPct: clamp01(features.atrPct / 0.01),
    volumeRatio: clamp01(features.volumeRatio / 0.5)
  };
  const score = 100 * (progress.regime + progress.barDirection + progress.ret24 + progress.rsi14 + progress.atrPct + progress.volumeRatio) / 6;
  return { score, progress };
}
function diagnoseQuality102HighVolSymbol(symbolInput, rows, dataCutoffTs) {
  const symbol = symbolInput.trim().toUpperCase();
  const { selection, candidate } = candidateFor(symbol, rows, dataCutoffTs);
  if (!selection) {
    return {
      symbol,
      selectionAvailable: false,
      scannerHealthPass: false,
      marketValid: false,
      rawMatched: false,
      proximityScore: 0,
      rankingScore: 0,
      reason: "HIGH_VOL_MONTHLY_RULE_UNAVAILABLE"
    };
  }
  const features = computeQuality102HighVolFeatures(rows, rows.length - 1);
  const healthPass = symbol === "PENGUUSDT" || scannerHealthPass(selection.metrics);
  const marketValid = quality102HighVolMarketValid(features);
  const matched = matchedSide(features, selection.rule);
  const long = highVolProximity(features, selection.rule, 1);
  const short = highVolProximity(features, selection.rule, -1);
  const best = long.score >= short.score ? { side: 1, ...long } : { side: -1, ...short };
  const proximityScore = Math.round(best.score * 100) / 100;
  const rankingScore2 = matched !== void 0 && healthPass ? 100 : healthPass ? Math.round((40 + 0.4 * proximityScore) * 100) / 100 : Math.round((20 + 0.2 * proximityScore) * 100) / 100;
  return {
    symbol,
    selectionAvailable: true,
    scannerHealthPass: healthPass,
    marketValid,
    rawMatched: matched !== void 0,
    ...matched !== void 0 ? { matchedSide: matched } : {},
    proximitySide: best.side,
    proximityScore,
    rankingScore: rankingScore2,
    ...candidate ? { legacySelectorScore: candidate.score } : {},
    rule: selection.rule,
    metrics: selection.metrics,
    features,
    gateProgress: best.progress,
    reason: matched !== void 0 && healthPass ? "HIGH_VOL_RAW_SIGNAL_READY" : !healthPass ? "HIGH_VOL_SCANNER_HEALTH_BLOCKED" : !marketValid ? "HIGH_VOL_MARKET_VALIDITY_BLOCKED" : "HIGH_VOL_THRESHOLD_NOT_REACHED"
  };
}

// config/disdexQuality102CausalV4Model.ts
var QUALITY102_CAUSAL_V4_DEVELOPMENT_PERIOD = Object.freeze({
  startInclusive: "2025-03-01T00:00:00Z",
  endExclusive: "2025-08-01T00:00:00Z",
  source: "PRE_EVALUATION_DEVELOPMENT_ONLY"
});
var QUALITY102_CAUSAL_V4_S34_MODEL = Object.freeze([
  Object.freeze({ key: "AAVE|MR48_Z2.5_H24", symbol: "AAVEUSDT", variant: "MR48_Z2.5_H24", family: "MR", layer: "S3", developmentN: 10, developmentSpf: 1.52236777276818, developmentAvg: 0.0108654242977555 }),
  Object.freeze({ key: "APT|REV24_T0.05_H24", symbol: "APTUSDT", variant: "REV24_T0.05_H24", family: "REV", layer: "S3", developmentN: 44, developmentSpf: 1.27729468528803, developmentAvg: 0.00656674098033 }),
  Object.freeze({ key: "APT|REV6_T0.03_H24", symbol: "APTUSDT", variant: "REV6_T0.03_H24", family: "REV", layer: "S3", developmentN: 18, developmentSpf: 2.39382185041081, developmentAvg: 0.0215414819560662 }),
  Object.freeze({ key: "AVAX|MR24_Z1.5_H24", symbol: "AVAXUSDT", variant: "MR24_Z1.5_H24", family: "MR", layer: "S3", developmentN: 53, developmentSpf: 1.24626770590961, developmentAvg: 0.0057750426106673 }),
  Object.freeze({ key: "AVAX|PB168_0.1_P24_0.04_H24", symbol: "AVAXUSDT", variant: "PB168_0.1_P24_0.04_H24", family: "PB", layer: "S3", developmentN: 7, developmentSpf: 1.71016853501698, developmentAvg: 0.0110802317833757 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H12", symbol: "AVAXUSDT", variant: "REV12_T0.03_H12", family: "REV", layer: "S3", developmentN: 75, developmentSpf: 1.52026808715621, developmentAvg: 0.006927005619842 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H8", symbol: "AVAXUSDT", variant: "REV12_T0.03_H8", family: "REV", layer: "S3", developmentN: 78, developmentSpf: 1.40325068773588, developmentAvg: 0.0047583867652531 }),
  Object.freeze({ key: "AVAX|REV12_T0.08_H24", symbol: "AVAXUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 9, developmentSpf: 2.3806830797075, developmentAvg: 0.0219786966819735 }),
  Object.freeze({ key: "DOGE|BRK24_H48_V1.0", symbol: "DOGEUSDT", variant: "BRK24_H48_V1.0", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.28734054076723, developmentAvg: 0.0096629482231092 }),
  Object.freeze({ key: "DOGE|BRK72_H48_V0.8", symbol: "DOGEUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 29, developmentSpf: 1.35891257238384, developmentAvg: 0.0112041987595541 }),
  Object.freeze({ key: "DOGE|MR48_Z2.0_H12", symbol: "DOGEUSDT", variant: "MR48_Z2.0_H12", family: "MR", layer: "S4", developmentN: 35, developmentSpf: 1.47637548088035, developmentAvg: 0.0080984366274167 }),
  Object.freeze({ key: "DOGE|MR72_Z1.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z1.5_H12", family: "MR", layer: "S4", developmentN: 72, developmentSpf: 1.38502939392078, developmentAvg: 0.0061897682920218 }),
  Object.freeze({ key: "DOGE|MR72_Z2.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z2.5_H12", family: "MR", layer: "S4", developmentN: 11, developmentSpf: 1.43133377123862, developmentAvg: 0.0102975813022613 }),
  Object.freeze({ key: "DOT|BRK72_H48_V0.8", symbol: "DOTUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 33, developmentSpf: 1.24740411002169, developmentAvg: 0.0065267354063517 }),
  Object.freeze({ key: "FET|BRK24_H48_V1.2", symbol: "FETUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 39, developmentSpf: 1.32803399016521, developmentAvg: 0.0097905549346322 }),
  Object.freeze({ key: "FET|PB168_0.1_P24_0.02_H12", symbol: "FETUSDT", variant: "PB168_0.1_P24_0.02_H12", family: "PB", layer: "S3", developmentN: 26, developmentSpf: 2.00067621132769, developmentAvg: 0.0100534613762825 }),
  Object.freeze({ key: "FET|PB72_0.1_P12_0.04_H12", symbol: "FETUSDT", variant: "PB72_0.1_P12_0.04_H12", family: "PB", layer: "S3", developmentN: 13, developmentSpf: 1.81484714670338, developmentAvg: 0.0095011104136757 }),
  Object.freeze({ key: "FET|REV12_T0.05_H12", symbol: "FETUSDT", variant: "REV12_T0.05_H12", family: "REV", layer: "S3", developmentN: 50, developmentSpf: 1.58520129707493, developmentAvg: 0.0087653491849914 }),
  Object.freeze({ key: "FET|REV12_T0.08_H24", symbol: "FETUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 11, developmentSpf: 8.08070422039161, developmentAvg: 0.0413021804029054 }),
  Object.freeze({ key: "FET|REV24_T0.05_H8", symbol: "FETUSDT", variant: "REV24_T0.05_H8", family: "REV", layer: "S3", developmentN: 69, developmentSpf: 1.29882917503414, developmentAvg: 0.0043871257099106 }),
  Object.freeze({ key: "FET|REV24_T0.08_H8", symbol: "FETUSDT", variant: "REV24_T0.08_H8", family: "REV", layer: "S3", developmentN: 31, developmentSpf: 1.90794772499766, developmentAvg: 0.0096499259228725 }),
  Object.freeze({ key: "LDO|BRK24_H24_V1.0", symbol: "LDOUSDT", variant: "BRK24_H24_V1.0", family: "BRK", layer: "S3", developmentN: 57, developmentSpf: 1.31281148909032, developmentAvg: 0.0076779880422025 }),
  Object.freeze({ key: "LDO|BRK48_H24_V1.0", symbol: "LDOUSDT", variant: "BRK48_H24_V1.0", family: "BRK", layer: "S3", developmentN: 48, developmentSpf: 1.31622876544241, developmentAvg: 0.008453791923583 }),
  Object.freeze({ key: "NEAR|BRK168_H24_V1.2", symbol: "NEARUSDT", variant: "BRK168_H24_V1.2", family: "BRK", layer: "S3", developmentN: 27, developmentSpf: 1.48840221382932, developmentAvg: 0.0091330294375599 }),
  Object.freeze({ key: "NEAR|BRK48_H48_V1.2", symbol: "NEARUSDT", variant: "BRK48_H48_V1.2", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.31919794984148, developmentAvg: 0.0089832346064616 }),
  Object.freeze({ key: "RENDER|BRK168_H12_V1.2", symbol: "RENDERUSDT", variant: "BRK168_H12_V1.2", family: "BRK", layer: "S4", developmentN: 37, developmentSpf: 1.2461023118082, developmentAvg: 0.0043356885581458 }),
  Object.freeze({ key: "SOL|BRK24_H48_V1.2", symbol: "SOLUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 37, developmentSpf: 1.78857139913644, developmentAvg: 0.0179361486336277 }),
  Object.freeze({ key: "SOL|BRK72_H48_V1.2", symbol: "SOLUSDT", variant: "BRK72_H48_V1.2", family: "BRK", layer: "S3", developmentN: 25, developmentSpf: 1.75061992691195, developmentAvg: 0.0171229061115549 }),
  Object.freeze({ key: "UNI|MR24_Z2.0_H24", symbol: "UNIUSDT", variant: "MR24_Z2.0_H24", family: "MR", layer: "S4", developmentN: 19, developmentSpf: 1.82181594946119, developmentAvg: 0.0177824545392012 }),
  Object.freeze({ key: "UNI|MR48_Z1.5_H24", symbol: "UNIUSDT", variant: "MR48_Z1.5_H24", family: "MR", layer: "S4", developmentN: 63, developmentSpf: 1.46705889766814, developmentAvg: 0.0097478033268243 }),
  Object.freeze({ key: "UNI|MR72_Z1.5_H24", symbol: "UNIUSDT", variant: "MR72_Z1.5_H24", family: "MR", layer: "S4", developmentN: 56, developmentSpf: 1.26613814311217, developmentAvg: 0.006291723493164 })
]);
var QUALITY102_CAUSAL_V4_S34_KEYS = Object.freeze(QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.key));
var QUALITY102_CAUSAL_V4_CAPABILITIES = Object.freeze({
  selectorImplemented: true,
  derivedHighVolGeneratorImplemented: true,
  s34GeneratorImplemented: true,
  s34ModelKeyCount: QUALITY102_CAUSAL_V4_S34_MODEL.length,
  fixedHistoricalTradeTimestamps: false,
  noLookaheadByConstruction: true,
  historicalSelectorParity: false
});

// lib/disdex-quality102-causal-v4-s34.ts
var HOUR_MS = 36e5;
var RET14_HOURS = 336;
function finitePositive(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`QUALITY102_CAUSAL_V4_INVALID_${field}`);
  return value;
}
function sampleStdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
function median2(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function familyHardStop(family, holdHours) {
  if (family === "PB" || family === "MR") return holdHours === 12 ? 0.05 : 0.07;
  if (family === "REV") return holdHours === 8 || holdHours === 12 ? 0.045 : 0.06;
  return holdHours >= 48 ? 0.08 : 0.05;
}
function computeRet14(rows, entryOpen) {
  if (rows.length < RET14_HOURS) throw new Error("QUALITY102_CAUSAL_V4_RET14_HISTORY_REQUIRED");
  const prior = rows[rows.length - RET14_HOURS];
  return finitePositive(entryOpen.open, "ENTRY_OPEN") / finitePositive(prior.open, "RET14_PRIOR_OPEN") - 1;
}
function parsePb(variant) {
  const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])] : void 0;
}
function parseMr(variant) {
  const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function parseRev(variant) {
  const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function parseBrk(variant) {
  const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function detectPb(rows, variant) {
  const parsed = parsePb(variant);
  if (!parsed) return void 0;
  const [lookback, trendThreshold, pullback, pullThreshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t < Math.max(lookback, pullback)) return void 0;
  const longRet = rows[t].close / rows[t - lookback].close - 1;
  const pullRet = rows[t].close / rows[t - pullback].close - 1;
  const side = longRet >= trendThreshold && pullRet <= -pullThreshold ? 1 : longRet <= -trendThreshold && pullRet >= pullThreshold ? -1 : void 0;
  if (side === void 0) return void 0;
  return { side, strength: Math.abs(longRet) + Math.abs(pullRet), margin: Math.min(Math.abs(longRet) / trendThreshold, Math.abs(pullRet) / pullThreshold), holdHours };
}
function detectMr(rows, variant) {
  const parsed = parseMr(variant);
  if (!parsed) return void 0;
  const [lookback, zThreshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t - lookback + 1 < 0) return void 0;
  const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
  const stdev = sampleStdev(closes);
  if (!(stdev > 0)) return void 0;
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const z = (rows[t].close - mean) / stdev;
  const side = z >= zThreshold ? -1 : z <= -zThreshold ? 1 : void 0;
  return side === void 0 ? void 0 : { side, strength: Math.abs(z), margin: Math.abs(z) / zThreshold, holdHours };
}
function detectRev(rows, variant) {
  const parsed = parseRev(variant);
  if (!parsed) return void 0;
  const [lookback, threshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t < lookback) return void 0;
  const move = rows[t].close / rows[t - lookback].close - 1;
  const side = move >= threshold ? -1 : move <= -threshold ? 1 : void 0;
  return side === void 0 ? void 0 : { side, strength: Math.abs(move), margin: Math.abs(move) / threshold, holdHours };
}
function baseVolume(row) {
  const value = row.baseVolume;
  if (!Number.isFinite(value) || value < 0) throw new Error("QUALITY102_CAUSAL_V4_BRK_BASE_VOLUME_REQUIRED");
  return value;
}
function detectBrk(rows, variant) {
  const parsed = parseBrk(variant);
  if (!parsed) return void 0;
  const [lookback, holdHours, volumeThreshold] = parsed;
  const t = rows.length - 1;
  if (t < Math.max(lookback, 72)) return void 0;
  const close = rows[t].close;
  const prior = rows.slice(t - lookback, t);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const side = close > priorHigh ? 1 : close < priorLow ? -1 : void 0;
  if (side === void 0) return void 0;
  const medianVolume = median2(rows.slice(t - 72, t).map(baseVolume));
  const volumeRatio = medianVolume > 0 ? baseVolume(rows[t]) / medianVolume : 0;
  if (volumeRatio + 1e-12 < volumeThreshold) return void 0;
  const breakout = side === 1 ? close / priorHigh - 1 : priorLow / close - 1;
  const strength = Math.abs(close / rows[t - lookback].close - 1);
  const margin = Math.min(volumeRatio / volumeThreshold, 1 + Math.max(0, breakout) * 100);
  return { side, strength, margin, holdHours };
}
function detectFamily(rows, variant) {
  if (variant.startsWith("PB")) return detectPb(rows, variant);
  if (variant.startsWith("MR")) return detectMr(rows, variant);
  if (variant.startsWith("REV")) return detectRev(rows, variant);
  if (variant.startsWith("BRK")) return detectBrk(rows, variant);
  return void 0;
}
function detectQuality102CausalV4S34RawSignal(rows, entryOpen, variant) {
  if (!rows.length) throw new Error("QUALITY102_CAUSAL_V4_S34_HISTORY_REQUIRED");
  const expectedEntryTs = rows.at(-1).timestampMs + HOUR_MS;
  if (entryOpen.timestampMs !== expectedEntryTs) throw new Error("QUALITY102_CAUSAL_V4_ENTRY_OPEN_TIMESTAMP_MISMATCH");
  const signal = detectFamily(rows, variant);
  if (!signal) return void 0;
  const family = variant.startsWith("PB") ? "PB" : variant.startsWith("MR") ? "MR" : variant.startsWith("BRK") ? "BRK" : "REV";
  return {
    ...signal,
    hardStop: familyHardStop(family, signal.holdHours),
    ret14: computeRet14(rows, entryOpen)
  };
}

// lib/disdex-quality102-causal-v4-signal.ts
var LAYER_RANK = Object.freeze({ S3: 1, S4: 2 });
var FAMILY_RANK = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });

// lib/disdex-quality102-causal-v4-ranking.ts
function clamp012(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function sampleStdev2(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
function median3(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function ret14(rows, entryOpen) {
  if (rows.length < 336) return void 0;
  const prior = rows[rows.length - 336];
  return prior?.open > 0 && entryOpen.open > 0 ? entryOpen.open / prior.open - 1 : void 0;
}
function pbMetrics(rows, variant) {
  const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const trendThreshold = Number(match[2]);
  const pullback = Number(match[3]);
  const pullThreshold = Number(match[4]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, pullback)) return void 0;
  const longRet = rows[t].close / rows[t - lookback].close - 1;
  const pullRet = rows[t].close / rows[t - pullback].close - 1;
  const longProgress = Math.min(clamp012(longRet / trendThreshold), clamp012(-pullRet / pullThreshold));
  const shortProgress = Math.min(clamp012(-longRet / trendThreshold), clamp012(pullRet / pullThreshold));
  const side = longProgress >= shortProgress ? 1 : -1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      longRet: round(longRet),
      pullRet: round(pullRet),
      trendThreshold,
      pullThreshold,
      longProgress: round(longProgress, 4),
      shortProgress: round(shortProgress, 4)
    }
  };
}
function mrMetrics(rows, variant) {
  const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const zThreshold = Number(match[2]);
  const t = rows.length - 1;
  if (t - lookback + 1 < 0) return void 0;
  const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
  const stdev = sampleStdev2(closes);
  if (!(stdev > 0)) return void 0;
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const z = (rows[t].close - mean) / stdev;
  return {
    side: z >= 0 ? -1 : 1,
    proximity: clamp012(Math.abs(z) / zThreshold),
    metrics: { zScore: round(z, 4), zThreshold, mean: round(mean), stdev: round(stdev) }
  };
}
function revMetrics(rows, variant) {
  const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const threshold = Number(match[2]);
  const t = rows.length - 1;
  if (t < lookback) return void 0;
  const move = rows[t].close / rows[t - lookback].close - 1;
  return {
    side: move >= 0 ? -1 : 1,
    proximity: clamp012(Math.abs(move) / threshold),
    metrics: { move: round(move), threshold }
  };
}
function brkMetrics(rows, variant) {
  const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const volumeThreshold = Number(match[3]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, 72)) return void 0;
  const current = rows[t];
  const prior = rows.slice(t - lookback, t);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const volumes = rows.slice(t - 72, t).map((row) => Number(row.baseVolume ?? 0));
  const medianVolume = median3(volumes);
  const currentVolume = Number(current.baseVolume ?? 0);
  const volumeRatio = medianVolume > 0 ? currentVolume / medianVolume : 0;
  const longPriceProgress = clamp012(current.close / priorHigh);
  const shortPriceProgress = clamp012(priorLow / current.close);
  const volumeProgress = clamp012(volumeRatio / volumeThreshold);
  const longProgress = Math.min(longPriceProgress, volumeProgress);
  const shortProgress = Math.min(shortPriceProgress, volumeProgress);
  const side = longProgress >= shortProgress ? 1 : -1;
  const breakoutDistance = side === 1 ? current.close / priorHigh - 1 : priorLow / current.close - 1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      close: round(current.close),
      priorHigh: round(priorHigh),
      priorLow: round(priorLow),
      breakoutDistance: round(breakoutDistance),
      volumeRatio: round(volumeRatio, 4),
      volumeThreshold,
      volumeProgress: round(volumeProgress, 4),
      longPriceProgress: round(longPriceProgress, 4),
      shortPriceProgress: round(shortPriceProgress, 4)
    }
  };
}
function proximityFor(rows, variant) {
  if (variant.startsWith("PB")) return pbMetrics(rows, variant);
  if (variant.startsWith("MR")) return mrMetrics(rows, variant);
  if (variant.startsWith("REV")) return revMetrics(rows, variant);
  if (variant.startsWith("BRK")) return brkMetrics(rows, variant);
  return void 0;
}
function rankingScore(input) {
  const proximityPct = Math.max(0, Math.min(100, input.proximity * 100));
  let score = 0.6 * proximityPct;
  let stage = "NO_RAW";
  if (input.raw) {
    score = 60 + 0.1 * proximityPct;
    stage = "RAW_REJECTED";
  }
  if (input.raw && input.historical) {
    score = 70 + 0.1 * proximityPct;
    stage = "QUALITY_PASS";
  }
  if (input.raw && input.historical && input.feature) {
    score = 80 + 0.1 * proximityPct;
    stage = "FEATURE_PASS";
  }
  if (input.raw && input.historical && input.feature && input.improvement) {
    score = 90 + 0.1 * proximityPct;
    stage = "IMPROVEMENT_PASS";
  }
  if (input.gridOpen && input.raw && input.historical && input.feature && input.improvement) {
    score = 100;
    stage = "SIGNAL_READY";
  } else if (!input.gridOpen && score >= 90) {
    score = 89;
    stage = "GRID_WAIT";
  }
  return { score: Math.round(score * 100) / 100, stage };
}
function diagnoseQuality102CausalV4S34Symbol(input) {
  const symbol = input.symbol.trim().toUpperCase();
  const gridOpen = new Date(input.entryOpen.timestampMs).getUTCHours() % 4 === 1;
  const models = QUALITY102_CAUSAL_V4_S34_MODEL.filter((row) => row.symbol === symbol);
  const observedRet14 = ret14(input.rows, input.entryOpen);
  return models.map((model) => {
    const proximity = proximityFor(input.rows, model.variant);
    let raw;
    let rawError;
    try {
      raw = detectQuality102CausalV4S34RawSignal(input.rows, input.entryOpen, model.variant);
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }
    const historical = raw ? evaluateS34QualityGate({
      family: model.family,
      variant: model.variant,
      side: raw.side,
      strength: raw.strength,
      ret14: raw.ret14
    }) : void 0;
    const feature = raw && historical?.accepted ? evaluateQuality102CausalV4FeatureGate({
      family: model.family,
      symbol: model.symbol.replace(/USDT$/, ""),
      variant: model.variant,
      side: raw.side,
      ret14: raw.ret14,
      margin: raw.margin,
      developmentN: model.developmentN,
      developmentSpf: model.developmentSpf,
      developmentAvg: model.developmentAvg
    }) : void 0;
    const improvement = raw && historical?.accepted && feature?.accepted ? evaluateQuality102CausalV4ImprovementGate({
      family: model.family,
      side: raw.side,
      ret14: raw.ret14
    }) : void 0;
    const scored = rankingScore({
      gridOpen,
      proximity: proximity?.proximity ?? 0,
      raw: Boolean(raw),
      historical: historical?.accepted === true,
      feature: feature?.accepted === true,
      improvement: improvement?.accepted === true
    });
    const gates = [
      {
        name: "S34_4H_GRID",
        pass: gridOpen,
        reason: gridOpen ? "UTC_HOUR_MOD4_EQ1" : "UTC_HOUR_MOD4_NOT1",
        value: new Date(input.entryOpen.timestampMs).getUTCHours(),
        threshold: "hour % 4 == 1"
      },
      {
        name: "RAW_DETECTOR",
        pass: Boolean(raw),
        reason: raw ? "RAW_SIGNAL_DETECTED" : rawError || "RAW_THRESHOLD_NOT_REACHED"
      }
    ];
    if (historical) gates.push({ name: "HISTORICAL_QUALITY", pass: historical.accepted, reason: historical.reason });
    if (feature) gates.push({ name: "V4_FEATURE", pass: feature.accepted, reason: feature.reason });
    if (improvement) {
      gates.push({
        name: "V4_IMPROVEMENT",
        pass: improvement.accepted,
        reason: improvement.reason,
        ...model.family === "REV" && raw?.side === 1 ? { value: round(raw.ret14), threshold: QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN } : {}
      });
    }
    const reason = scored.stage === "SIGNAL_READY" ? "S34_SIGNAL_READY" : scored.stage === "GRID_WAIT" ? "S34_GRID_WAIT" : rawError ? rawError : improvement && !improvement.accepted ? improvement.reason : feature && !feature.accepted ? feature.reason : historical && !historical.accepted ? historical.reason : "RAW_THRESHOLD_NOT_REACHED";
    return {
      key: model.key,
      symbol,
      family: model.family,
      layer: model.layer,
      variant: model.variant,
      gridOpen,
      rawDetected: Boolean(raw),
      ...raw ? { candidateSide: raw.side } : proximity ? { candidateSide: proximity.side } : {},
      ...proximity ? { proximitySide: proximity.side } : {},
      proximityScore: Math.round((proximity?.proximity ?? 0) * 1e4) / 100,
      rankingScore: scored.score,
      rankingStage: scored.stage,
      reason,
      metrics: {
        ...proximity?.metrics ?? {},
        ...observedRet14 !== void 0 ? { ret14: round(observedRet14) } : {},
        ...raw ? {
          strength: round(raw.strength),
          margin: round(raw.margin),
          hardStop: round(raw.hardStop),
          holdHours: raw.holdHours
        } : {},
        developmentN: model.developmentN,
        developmentSpf: round(model.developmentSpf),
        developmentAvg: round(model.developmentAvg)
      },
      gates
    };
  }).sort((left, right) => right.rankingScore - left.rankingScore || left.key.localeCompare(right.key));
}

// lib/disdex-quality102-causal-v4-observability.ts
var LAYER_RANK2 = Object.freeze({ S3: 1, S4: 2 });
var FAMILY_RANK2 = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });
function highVolVariantLabel(diagnostic) {
  const rule = diagnostic?.rule;
  if (!rule) return void 0;
  return `HV_LD${rule.longDrop}_LRSI${rule.longRsi}_SR${rule.shortRally}_SRSI${rule.shortRsi}_STOP${rule.hardStop}`;
}
function augmentQuality102DecisionSnapshotWithRanking(input) {
  const highVol = new Set(input.highVolSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const rankedItems = input.snapshot.items.map((item) => {
    const symbol = item.symbol.toUpperCase();
    try {
      const rows = input.history.candlesBySymbol[symbol];
      if (!rows?.length) throw new Error(`QUALITY102_OBSERVER_HISTORY_MISSING:${symbol}`);
      const entryOpen = input.history.entryOpenBySymbol?.[symbol];
      const dataCutoffTs = rows.at(-1).timestampMs;
      const highVolDiagnostic = highVol.has(symbol) ? diagnoseQuality102HighVolSymbol(symbol, rows, dataCutoffTs) : void 0;
      const s34Diagnostics = entryOpen ? diagnoseQuality102CausalV4S34Symbol({ symbol, rows, entryOpen }) : [];
      const bestS34 = s34Diagnostics[0];
      const highVolScore = highVolDiagnostic?.rankingScore ?? -1;
      const s34Score = bestS34?.rankingScore ?? -1;
      const naturalEligible = item.eligible === true;
      const rankingFamily = naturalEligible && item.family ? item.family : highVolScore >= s34Score && highVolDiagnostic ? "HIGH_VOL" : bestS34?.family;
      const rankingLayer = naturalEligible && item.layer ? item.layer : rankingFamily === "HIGH_VOL" ? "S1" : bestS34?.layer;
      const rankingVariant = naturalEligible && item.variant ? item.variant : rankingFamily === "HIGH_VOL" ? highVolVariantLabel(highVolDiagnostic) : bestS34?.variant;
      const rankingScore2 = naturalEligible ? 100 : Math.max(0, highVolScore, s34Score);
      const rankingStage = naturalEligible ? "SIGNAL_READY" : rankingFamily === "HIGH_VOL" ? highVolDiagnostic?.rawMatched ? "HIGH_VOL_RAW_READY" : "HIGH_VOL_APPROACH" : bestS34?.rankingStage || "NO_MODEL";
      const rankingReason = item.reason.startsWith("Q102_BRK_FET_SHORT_") ? item.reason : naturalEligible ? item.reason : rankingFamily === "HIGH_VOL" ? highVolDiagnostic?.reason || item.reason : bestS34?.reason || item.reason;
      return {
        ...item,
        rankingScore: rankingScore2,
        ...rankingFamily ? { rankingFamily } : {},
        ...rankingLayer ? { rankingLayer } : {},
        ...rankingVariant ? { rankingVariant } : {},
        rankingStage,
        rankingReason,
        diagnostics: {
          ...highVolDiagnostic ? { highVol: highVolDiagnostic } : {},
          ...s34Diagnostics.length ? { s34: s34Diagnostics } : {}
        }
      };
    } catch (error) {
      return {
        ...item,
        rankingScore: 0,
        rankingStage: "OBSERVER_ERROR",
        rankingReason: error instanceof Error ? error.message : String(error)
      };
    }
  });
  const rankBySymbol = new Map(
    [...rankedItems].sort((left, right) => (right.rankingScore ?? 0) - (left.rankingScore ?? 0) || left.symbol.localeCompare(right.symbol)).map((item, index) => [item.symbol, index + 1])
  );
  return {
    ...input.snapshot,
    schemaVersion: 2,
    rankingModelVersion: "Q102_PROXIMITY_V1",
    rankingCapturedAt: input.rankingCapturedAt || (/* @__PURE__ */ new Date()).toISOString(),
    ...input.observerCommitSha ? { observerCommitSha: input.observerCommitSha } : {},
    items: rankedItems.map((item) => ({ ...item, rankingRank: rankBySymbol.get(item.symbol) }))
  };
}

// lib/disdex-quality102-ranking-history.ts
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var PREFIX = "decision-ranking-history-";
var SUFFIX = ".jsonl";
var DEFAULT_RETENTION_DAYS = 90;
var DAY_MS = 864e5;
function historyFileName(referenceTs) {
  const day = new Date(referenceTs).toISOString().slice(0, 10);
  return `${PREFIX}${day}${SUFFIX}`;
}
function lastReferenceTs(text) {
  const line = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return void 0;
  try {
    const parsed = JSON.parse(line);
    const value = Number(parsed.referenceTs);
    return Number.isFinite(value) && value > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
async function pruneOldRankingHistory(stateRoot, now, retentionDays) {
  const cutoff = now - retentionDays * DAY_MS;
  const names = await (0, import_promises2.readdir)(stateRoot);
  await Promise.all(names.map(async (name) => {
    const match = /^decision-ranking-history-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match) return;
    const fileDay = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isFinite(fileDay) && fileDay < cutoff) {
      await (0, import_promises2.unlink)((0, import_node_path2.resolve)(stateRoot, name)).catch(() => void 0);
    }
  }));
}
async function persistQuality102RankingHistory(input) {
  const referenceTs = Number(input.snapshot.referenceTs);
  if (!Number.isFinite(referenceTs) || referenceTs <= 0) throw new Error("Q102_RANKING_HISTORY_REFERENCE_TS_INVALID");
  if (input.snapshot.schemaVersion !== 2 || input.snapshot.rankingModelVersion !== "Q102_PROXIMITY_V1") {
    throw new Error("Q102_RANKING_HISTORY_SCHEMA_UNSUPPORTED");
  }
  const path = (0, import_node_path2.resolve)(input.stateRoot, historyFileName(referenceTs));
  let existing = "";
  try {
    existing = await (0, import_promises2.readFile)(path, "utf8");
  } catch (error) {
    const code = error.code;
    if (code !== "ENOENT") throw error;
  }
  if (lastReferenceTs(existing) === referenceTs) return { appended: false, path };
  await (0, import_promises2.appendFile)(path, JSON.stringify(input.snapshot) + "\n", { encoding: "utf8", mode: 384 });
  await pruneOldRankingHistory(input.stateRoot, Date.now(), input.retentionDays ?? DEFAULT_RETENTION_DAYS);
  return { appended: true, path };
}

// scripts/disdex-quality102-ranking-observer.ts
var DEFAULT_STATE_ROOT = "/var/lib/disdex/quality102-causal-v1";
var SHA_PATTERN = /^[0-9a-f]{40}$/i;
function requiredHighVolSymbols(value) {
  const values = String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(values)].sort();
  if (!unique.length) throw new Error("Q102_RANKING_OBSERVER_HIGH_VOL_SYMBOLS_REQUIRED");
  return unique;
}
function finitePositive2(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Q102_RANKING_OBSERVER_${field}_INVALID`);
  return number;
}
async function loadBaseSnapshot(path) {
  const parsed = JSON.parse(await (0, import_promises3.readFile)(path, "utf8"));
  if (parsed.strategyId !== "QUALITY102_CAUSAL_V1") throw new Error("Q102_RANKING_OBSERVER_STRATEGY_MISMATCH");
  if (parsed.selectorMode !== "CAUSAL_V4") throw new Error("Q102_RANKING_OBSERVER_SELECTOR_MISMATCH");
  if (!SHA_PATTERN.test(String(parsed.runtimeCommitSha || ""))) throw new Error("Q102_RANKING_OBSERVER_RUNTIME_SHA_INVALID");
  if (!Number.isFinite(Number(parsed.referenceTs)) || Number(parsed.referenceTs) <= 0) throw new Error("Q102_RANKING_OBSERVER_REFERENCE_TS_INVALID");
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error("Q102_RANKING_OBSERVER_ITEMS_MISSING");
  return parsed;
}
async function loadClosedHistory(path) {
  const parsed = JSON.parse(await (0, import_promises3.readFile)(path, "utf8"));
  if (!parsed.candlesBySymbol || typeof parsed.candlesBySymbol !== "object") {
    throw new Error("Q102_RANKING_OBSERVER_HISTORY_MISSING");
  }
  return { candlesBySymbol: parsed.candlesBySymbol };
}
async function loadEntryOpen(client, symbol, referenceTs) {
  const endTime = Math.max(referenceTs + 1, Date.now());
  const rows = await client.getKlines(symbol, "1h", 2, { startTime: referenceTs, endTime });
  const row = rows.find((candidate) => Number(candidate[0]) === referenceTs);
  if (!row) throw new Error(`Q102_RANKING_OBSERVER_ENTRY_OPEN_MISSING:${symbol}`);
  return { timestampMs: referenceTs, open: finitePositive2(row[1], `ENTRY_OPEN_${symbol}`) };
}
async function main() {
  const stateRoot = (0, import_node_path3.resolve)(process.env.QUALITY102_CAUSAL_V1_STATE_DIR || DEFAULT_STATE_ROOT);
  const baseSnapshotPath = (0, import_node_path3.resolve)(process.env.QUALITY102_DECISION_SNAPSHOT_PATH || (0, import_node_path3.resolve)(stateRoot, "decision-snapshot.json"));
  const historyPath = (0, import_node_path3.resolve)(process.env.QUALITY102_CAUSAL_V1_HISTORY_CACHE_PATH || (0, import_node_path3.resolve)(stateRoot, "market-history.json"));
  const outputPath = (0, import_node_path3.resolve)(process.env.QUALITY102_RANKING_SNAPSHOT_PATH || (0, import_node_path3.resolve)(stateRoot, "decision-ranking-snapshot.json"));
  const observerCommitSha = String(process.env.DISDEX_OBSERVER_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || "").trim();
  if (!SHA_PATTERN.test(observerCommitSha)) throw new Error("Q102_RANKING_OBSERVER_COMMIT_SHA_REQUIRED");
  const highVolSymbols = requiredHighVolSymbols(process.env.QUALITY102_CAUSAL_V1_SYMBOLS);
  const baseSnapshot = await loadBaseSnapshot(baseSnapshotPath);
  const history = await loadClosedHistory(historyPath);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_BASE_URL,
    requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS || 1e4),
    readOnlyRateLimitMaxRetries: Number(process.env.ASTER_READONLY_RATE_LIMIT_MAX_RETRIES || 3)
  });
  const symbols = [...new Set(baseSnapshot.items.map((item) => item.symbol.toUpperCase()))].sort();
  const entryOpenBySymbol = {};
  for (const symbol of symbols) {
    entryOpenBySymbol[symbol] = await loadEntryOpen(client, symbol, Number(baseSnapshot.referenceTs));
  }
  const ranked = augmentQuality102DecisionSnapshotWithRanking({
    snapshot: baseSnapshot,
    history: {
      candlesBySymbol: history.candlesBySymbol,
      entryOpenBySymbol
    },
    highVolSymbols,
    observerCommitSha,
    rankingCapturedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await (0, import_promises3.writeFile)(temporary, JSON.stringify(ranked, null, 2) + "\n", { encoding: "utf8", mode: 384 });
  await (0, import_promises3.rename)(temporary, outputPath);
  await persistQuality102RankingHistory({ stateRoot, snapshot: ranked });
  console.log(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_OK",
    readOnly: true,
    tradingMutation: 0,
    runtimeCommitSha: ranked.runtimeCommitSha,
    observerCommitSha: ranked.observerCommitSha,
    referenceTs: ranked.referenceTs,
    rankingCapturedAt: ranked.rankingCapturedAt,
    outputPath,
    items: ranked.items.length,
    top: [...ranked.items].sort((left, right) => (left.rankingRank ?? 999) - (right.rankingRank ?? 999)).slice(0, 5).map((item) => ({
      rank: item.rankingRank,
      symbol: item.symbol,
      score: item.rankingScore,
      family: item.rankingFamily,
      variant: item.rankingVariant,
      stage: item.rankingStage
    }))
  }));
}
main().catch((error) => {
  console.error(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_FAILED",
    readOnly: true,
    tradingMutation: 0,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});
