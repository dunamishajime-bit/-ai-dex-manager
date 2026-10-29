import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import { loadRunnerPinManifestFromFile } from "../scripts/ops/root/disdex-runner-pin-manifest.mjs";
import type { AsterV3Client, AsterPositionRiskRow } from "./aster-v3-client";

export const V4_PRIMARY_OWNER_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79";
export const Q102_PRIMARY_OWNER_SHA = "ef1ab178e26a7bf5bddb6473467765edba242e1d";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;

// Keep the shared STOP environment namespace explicit for the root wiring and
// source-boundary audits.  It is a compatibility namespace only: owner
// authority still comes exclusively from the validated root-owned pin manifest
// passed to resolveResidentStopOwnerPins(), never from process.env.
export const SHARED_STOP_OWNER_ENV_PREFIX = "DISDEX_SHARED_STOP_";

export type ResidentStopOwnerPins = Readonly<Record<
  "V12" | "Q102" | "PENGU" | "V52" | "FET" | "HYPE" | "IDLE" | "RESIDUAL",
  string
>>;

const OWNER_PIN_PROJECTION = [
  { strategy: "V12", runner: "V12_V4", stopOwner: "V4_PRIMARY", servicePrefix: "disdex-v12-v4" },
  { strategy: "Q102", runner: "QUALITY102_CAUSAL_V1", stopOwner: "Q102_PRIMARY", servicePrefix: "disdex-quality102-causal-v1" },
  { strategy: "PENGU", runner: "PENGU_V8", stopOwner: "PENGU_V8", servicePrefix: "disdex-pengu-dual-ls-v2" },
  { strategy: "V52", runner: "V52", stopOwner: "V52", servicePrefix: "disdex-v52-aster-only" },
  { strategy: "FET", runner: "FET_BRK48_RESIDUAL", stopOwner: "FET_BRK48_RESIDUAL", servicePrefix: "disdex-fet-brk48" },
  { strategy: "HYPE", runner: "HYPE_TREND_LONG", stopOwner: "HYPE_TREND_LONG", servicePrefix: "disdex-hype-long" },
  { strategy: "IDLE", runner: "IDLE_PRIORITY_SHORT", stopOwner: "IDLE_PRIORITY_SHORT", servicePrefix: "disdex-idle-priority-short" },
  { strategy: "RESIDUAL", runner: "IDLE_PRIORITY_SHORT", stopOwner: "IDLE_PRIORITY_SHORT", servicePrefix: "disdex-idle-priority-short" },
] as const;

function exactSha(value: unknown): string | undefined {
  const sha = String(value ?? "").trim().toLowerCase();
  return SHA_PATTERN.test(sha) ? sha : undefined;
}

/** Projects STOP owners only from the root-owned, schema-validated pin map. */
export function resolveResidentStopOwnerPins(manifest: unknown): ResidentStopOwnerPins {
  if (!manifest || typeof manifest !== "object" || (manifest as any).schema !== "disdex-runner-pin-manifest/v1") {
    throw new Error("STOP_OWNER_PIN_MANIFEST_INVALID");
  }
  const runners = (manifest as any).runners;
  if (!runners || typeof runners !== "object" || Array.isArray(runners)) {
    throw new Error("STOP_OWNER_PIN_MANIFEST_INVALID");
  }
  const output: Record<string, string> = {};
  for (const pin of OWNER_PIN_PROJECTION) {
    const row = runners[pin.runner];
    const sha = exactSha(row?.sha);
    if (
      !sha
      || row?.stopOwner !== pin.stopOwner
      || row?.serviceUnit !== `${pin.servicePrefix}@${sha}.service`
      || !["legacy", "tick-v1"].includes(row?.evidenceMode)
    ) {
      throw new Error(`STOP_OWNER_PIN_INVALID:${pin.strategy}`);
    }
    output[pin.strategy] = sha;
  }
  return output as ResidentStopOwnerPins;
}

export type V4OwnerProof = {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  price: number;
  stopClientOrderId: string;
};

export function v4ProofsFromIndependentEvidence(
  orders: any[], ledger: any, heartbeat: any, marker: string, now: number,
  expectedOwnerSha = V4_PRIMARY_OWNER_SHA,
): V4OwnerProof[] {
  const sha = exactSha(expectedOwnerSha);
  if (!sha) return [];
  if (
    marker.trim() !== sha || ledger?.releaseSha !== sha || heartbeat?.runtimeSha !== sha
    || heartbeat?.expectedSha !== sha || heartbeat?.serviceUnit !== `disdex-v12-v4@${sha}.service`
    || heartbeat?.mode !== "LIVE" || heartbeat?.safetyState !== "HEALTHY"
    || !Number.isFinite(Number(heartbeat?.lastTickAt)) || Number(heartbeat.lastTickAt) > now + 5000
    || now - Number(heartbeat.lastTickAt) > 180000
  ) return [];
  const legs = ledger?.state?.legs;
  const protections = ledger?.protections;
  if (!legs || !protections || typeof legs !== "object" || typeof protections !== "object") return [];
  const proofs: V4OwnerProof[] = [];
  const used = new Set<string>();
  for (const [key, leg] of Object.entries(legs as Record<string, any>)) {
    if (leg?.status !== "OPEN") continue;
    const match = /^([A-Z0-9]+USDT):[^:]+:(LONG|SHORT):(\d+)$/.exec(key);
    if (!match) continue;
    const [, symbol, side] = match;
    const protection = protections[key];
    const quantity = Number(leg.qty);
    const entryNotional = Number(leg.entryNotional);
    const stopId = String(protection?.stopClientOrderId || "");
    if (
      !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(entryNotional) || entryNotional <= 0
      || protection?.phase !== "STOP_CONFIRMED" || !Number.isFinite(Number(protection.protectedQty))
      || Math.abs(Number(protection.protectedQty) - quantity) > Math.max(1e-8, quantity * 1e-9)
      || !/^v12-v4-[0-9a-f]+$/.test(stopId) || used.has(stopId)
    ) continue;
    used.add(stopId);
    const matched = orders.filter((order) => order.clientOrderId === stopId && order.symbol === symbol && order.type === "STOP_MARKET");
    if (matched.length !== 1) continue;
    const order = matched[0];
    const remainingQuantity = Number(order.origQty) - Number(order.executedQty);
    const price = Number(order.stopPrice);
    if (
      order.side !== (side === "SHORT" ? "BUY" : "SELL") || order.reduceOnly !== true
      || !["NEW", "PARTIALLY_FILLED"].includes(order.status) || !Number.isFinite(remainingQuantity)
      || Math.abs(remainingQuantity - quantity) > Math.max(1e-8, quantity * 1e-9)
      || !Number.isFinite(price) || price <= 0
    ) continue;
    const averageEntry = entryNotional / quantity;
    const tolerance = Math.max(1e-8, averageEntry * 0.0002);
    if (side === "SHORT" && price > averageEntry * 1.08 + tolerance) continue;
    if (side === "LONG" && price < averageEntry * 0.92 - tolerance) continue;
    proofs.push({ symbol, side: side as "LONG" | "SHORT", quantity, price, stopClientOrderId: stopId });
  }
  return proofs;
}

export async function readV4OwnerProofs(orders: any[], now: number, expectedOwnerSha = V4_PRIMARY_OWNER_SHA): Promise<V4OwnerProof[]> {
  const sha = exactSha(expectedOwnerSha);
  if (!sha) return [];
  const root = `/home/deploy/disdex-trading/releases/${sha}`;
  try {
    const [ledger, heartbeat, marker] = await Promise.all([
      readFile("/var/lib/disdex/v12-v4/orders.json", "utf8"),
      readFile("/var/lib/disdex/runner-health/heartbeats/v12-v4.json", "utf8"),
      readFile(`${root}/.disdex-release-sha`, "utf8"),
    ]);
    return v4ProofsFromIndependentEvidence(orders, JSON.parse(ledger), JSON.parse(heartbeat), marker, now, sha);
  } catch {
    return [];
  }
}

export function q102ProofsFromIndependentEvidence(
  orders: any[], state: any, heartbeat: any, marker: string, now: number,
  expectedOwnerSha = Q102_PRIMARY_OWNER_SHA,
): V4OwnerProof[] {
  const sha = exactSha(expectedOwnerSha);
  if (!sha) return [];
  if (
    marker.trim() !== sha || state?.runtimeCommitSha !== sha || state?.mode !== "LIVE"
    || state?.strategyId !== "QUALITY102_CAUSAL_V1" || heartbeat?.runtimeSha !== sha
    || heartbeat?.expectedSha !== sha || heartbeat?.serviceUnit !== `disdex-quality102-causal-v1@${sha}.service`
    || heartbeat?.mode !== "LIVE" || heartbeat?.safetyState !== "HEALTHY"
    || !Number.isFinite(Number(heartbeat?.lastTickAt)) || Number(heartbeat.lastTickAt) > now + 5000
    || now - Number(heartbeat.lastTickAt) > 180000 || !Number.isFinite(Number(state?.updatedAt))
    || Number(state.updatedAt) > now + 5000 || now - Number(state.updatedAt) > 300000 || state?.pending
  ) return [];
  const position = state.position;
  if (!position) return [];
  const side = position.side === 1 ? "LONG" : position.side === -1 ? "SHORT" : undefined;
  const symbol = String(position.symbol || "").trim();
  const quantity = Number(position.quantity);
  const entry = Number(position.entryPrice);
  const hard = Number(position.hardStop);
  const resident = position.residentStop;
  const id = String(resident?.clientOrderId || "");
  if (
    !side || !/^[A-Z0-9]+USDT$/.test(symbol) || !Number.isFinite(quantity) || quantity <= 0
    || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(hard) || hard <= 0 || hard > 0.15
    || resident?.protected !== true || resident?.readBackStatus !== "VERIFIED"
    || !/^q102-stop-[0-9a-f]{22}$/.test(id) || !position.stopLedger || !Array.isArray(position.stopLedger.plans)
    || !position.stopLedger.plans.some((plan: any) => plan.clientOrderId === id)
    || resident?.symbol !== symbol || resident?.side !== (side === "LONG" ? "SELL" : "BUY")
    || Math.abs(Number(resident?.quantity) - quantity) > Math.max(1e-8, quantity * 1e-9)
    || !Number.isFinite(Number(resident?.lastReconciledAt)) || now - Number(resident.lastReconciledAt) > 300000
  ) return [];
  const matches = orders.filter((order: any) => order.clientOrderId === id && order.symbol === symbol);
  if (matches.length !== 1) return [];
  const order = matches[0];
  const price = Number(order.stopPrice);
  const remainingQuantity = Number(order.origQty) - Number(order.executedQty);
  const tolerance = Math.max(1e-8, entry * 0.0002);
  if (
    order.type !== "STOP_MARKET" || order.side !== (side === "LONG" ? "SELL" : "BUY") || order.reduceOnly !== true
    || !["NEW", "PARTIALLY_FILLED"].includes(order.status) || !Number.isFinite(remainingQuantity)
    || Math.abs(remainingQuantity - quantity) > Math.max(1e-8, quantity * 1e-9)
    || !Number.isFinite(price) || price <= 0 || Math.abs(price - Number(resident.stopPrice)) > Math.max(1e-8, price * 1e-9)
    || (side === "LONG" && price < entry * (1 - hard) - tolerance)
    || (side === "SHORT" && price > entry * (1 + hard) + tolerance)
  ) return [];
  return [{ symbol, side, quantity, price, stopClientOrderId: id }];
}

export async function readQ102OwnerProofs(orders: any[], now: number, expectedOwnerSha = Q102_PRIMARY_OWNER_SHA): Promise<V4OwnerProof[]> {
  const sha = exactSha(expectedOwnerSha);
  if (!sha) return [];
  try {
    const [state, heartbeat, marker] = await Promise.all([
      readFile("/var/lib/disdex/quality102-causal-v1/state.json", "utf8"),
      readFile("/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json", "utf8"),
      readFile(`/home/deploy/disdex-trading/releases/${sha}/.disdex-release-sha`, "utf8"),
    ]);
    return q102ProofsFromIndependentEvidence(orders, JSON.parse(state), JSON.parse(heartbeat), marker, now, sha);
  } catch {
    return [];
  }
}

export function observeResidentProtection(
  positions: any[], orders: any[], states: Record<string, any>, runtimeSha: string, now: number,
  v4Proofs: readonly V4OwnerProof[] = [], q102Proofs: readonly V4OwnerProof[] = [],
  ownerShaOverrides: Partial<ResidentStopOwnerPins> = {},
) {
  const owners = new Map<string, { strategy: string; symbol: string; side: string; quantity: number; price?: number }[]>();
  function add(strategy: string, position: any) {
    if (!position) return;
    const ids = [position.stopClientOrderId, position.protection?.stopClientOrderId, position.residentStop?.clientOrderId, position.recoveryV8?.fullHardStopClientId, position.recoveryV8?.fullHardStopClientOrderId, position.recoveryV8?.partialStopClientOrderId, position.recoveryV8?.remainingHardStopClientOrderId].filter(Boolean);
    for (const id of ids) {
      const rows = owners.get(id) || [];
      rows.push({
        strategy,
        symbol: String(position.symbol || (strategy === "PENGU" ? "PENGUUSDT" : "")).toUpperCase(),
        side: position.side === 1 || position.side === "LONG" ? "SELL" : position.side === -1 || position.side === "SHORT" ? "BUY" : "UNKNOWN",
        quantity: Number(position.quantity),
        price: position.residentStop?.stopPrice ?? position.hardStop ?? position.stopPrice ?? position.protection?.lastAckStop ?? position.lastAckStop ?? (position.recoveryV8 ? (position.recoveryV8.logicalEntryPrice ?? position.entryPrice) * (1 - (id === position.recoveryV8.partialStopClientOrderId ? PENGU_RECOVERY_V8.partial.stopPct : PENGU_RECOVERY_V8.exit.hardStopPct)) : undefined),
      });
      owners.set(id, rows);
    }
  }
  for (const proof of v4Proofs) add("V12_V4", { symbol: proof.symbol, side: proof.side, quantity: proof.quantity, stopClientOrderId: proof.stopClientOrderId, stopPrice: proof.price });
  for (const proof of q102Proofs) add("Q102", { symbol: proof.symbol, side: proof.side, quantity: proof.quantity, stopClientOrderId: proof.stopClientOrderId, stopPrice: proof.price });

  const scopedLiveSha: Record<string, string> = { V12: "7f10f3f3001563af8b32dbd403452733d23a0185", PENGU: "7688ed7c93a1918d8b44837339b7da5584a868f5", FET: "7688ed7c93a1918d8b44837339b7da5584a868f5", HYPE: "7688ed7c93a1918d8b44837339b7da5584a868f5", IDLE: "7688ed7c93a1918d8b44837339b7da5584a868f5", RESIDUAL: "7688ed7c93a1918d8b44837339b7da5584a868f5" };
  for (const [strategy, state] of Object.entries(states)) {
    const override = ownerShaOverrides[strategy as keyof ResidentStopOwnerPins];
    const expected = override === undefined && process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH ? undefined : override === undefined ? scopedLiveSha[strategy] : override;
    if (!expected || !SHA_PATTERN.test(expected) || !(Number(state.updatedAt) > 0) || now - Number(state.updatedAt) > 300000 || Number(state.updatedAt) > now + 5000) continue;
    const ownerSha = String(state.runtimeCommitSha || state.runtimeSha || "");
    if (ownerSha !== expected || (state.runtimeSha && state.runtimeSha !== expected) || (state.runtimeCommitSha && state.runtimeCommitSha !== expected)) continue;
    add(strategy, state.position);
    for (const position of state.positions || state.activePositions || []) add(strategy, position);
  }

  const active = positions.filter((position) => Math.abs(Number(position.positionAmt)) > 1e-12);
  const rows = active.map((position) => {
    const quantity = Math.abs(Number(position.positionAmt));
    const side = Number(position.positionAmt) > 0 ? "SELL" : "BUY";
    const stops = orders.filter((order) => order.symbol === position.symbol && order.type === "STOP_MARKET");
    const known = stops.filter((order) => { const own = owners.get(order.clientOrderId); return own?.length === 1 && own[0].symbol === position.symbol && own[0].side === side && Math.abs(own[0].quantity - quantity) <= Math.max(1e-8, quantity * 1e-9) && Number(own[0].price) > 0; });
    const strategies = [...new Set(known.flatMap((order) => (owners.get(order.clientOrderId) || []).map((owner) => owner.strategy)))];
    const good = stops.length > 0 && known.length === stops.length && strategies.length === 1 && new Set(stops.map((order) => order.clientOrderId)).size === stops.length && stops.every((order) => order.side === side && order.reduceOnly === true && ["NEW", "PARTIALLY_FILLED"].includes(order.status) && Number(order.stopPrice) > 0 && Number(order.executedQty) >= 0 && Number(order.origQty) > Number(order.executedQty) && (!owners.get(order.clientOrderId)?.[0].price || Math.abs(Number(order.stopPrice) - owners.get(order.clientOrderId)![0].price!) <= Math.max(1e-8, Number(order.stopPrice) * 1e-9))) && Math.abs(stops.reduce((sum, order) => sum + Number(order.origQty) - Number(order.executedQty), 0) - quantity) <= Math.max(1e-8, quantity * 1e-9);
    const stock = /^(AMZN|META|MSFT|NVDA|TSLA)USDT$/.test(position.symbol);
    return { symbol: position.symbol, positionSide: side === "SELL" ? "LONG" : "SHORT", quantity, strategy: strategies[0] ?? (stock ? "V52" : "UNKNOWN"), protected: stock ? null : good, readBackStatus: stock ? "DYNAMIC_BASIS_ONLY" : good ? "VERIFIED" : "UNVERIFIED", lastReconciledAt: now, orders: stops.map((order) => ({ orderId: order.orderId, clientOrderId: order.clientOrderId, side: order.side, reduceOnly: order.reduceOnly, quantity: Number(order.origQty) - Number(order.executedQty), stopPrice: Number(order.stopPrice), status: order.status })) };
  });
  return { schema: "resident-stop-observation/v1", runtimeSha, ownerShaByStrategy: { ...ownerShaOverrides }, checkedAt: now, ok: true, readOnly: true, ordersSent: 0, cancelsSent: 0, positions: rows, orphanStops: orders.filter((order) => order.type === "STOP_MARKET" && !active.some((position) => position.symbol === order.symbol)).map((order) => ({ symbol: order.symbol, clientOrderId: order.clientOrderId })), unprotectedCount: rows.filter((position) => position.protected === false).length };
}

let lastObservationAt = 0;
let lastObservationSha = "";

export async function refreshResidentProtectionObservation(client: AsterV3Client, positions: AsterPositionRiskRow[], path: string, runtimeSha: string) {
  if (Date.now() - lastObservationAt < 60_000 && lastObservationSha === runtimeSha) return;
  const paths: Record<string, string> = { V12: "/var/lib/disdex/v12-x1-all/runner.json", PENGU: "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json", Q102: "/var/lib/disdex/quality102-causal-v1/state.json", FET: "/var/lib/disdex/fet-brk48-residual/state.json", HYPE: "/var/lib/disdex/hype-zec-long/runner.json", IDLE: "/var/lib/disdex/idle-priority/state.json", RESIDUAL: "/var/lib/disdex/idle-priority/residual-long-state.json" };
  let snapshot: any;
  try {
    const manifestPath = String(process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH || "").trim();
    if (!manifestPath) throw new Error("STOP_OWNER_PIN_MANIFEST_REQUIRED");
    const ownerPins = resolveResidentStopOwnerPins(await loadRunnerPinManifestFromFile(manifestPath));
    const entries = await Promise.all(Object.entries(paths).map(async ([strategy, statePath]) => [strategy, JSON.parse(await readFile(statePath, "utf8").catch(() => '{"unavailable":true}'))]));
    const openOrders = await client.getOpenOrders();
    const now = Date.now();
    const [v4Proofs, q102Proofs] = await Promise.all([readV4OwnerProofs(openOrders, now, ownerPins.V12), readQ102OwnerProofs(openOrders, now, ownerPins.Q102)]);
    snapshot = observeResidentProtection(positions, openOrders, Object.fromEntries(entries), runtimeSha, now, v4Proofs, q102Proofs, ownerPins);
  } catch (error) {
    snapshot = { schema: "resident-stop-observation/v1", runtimeSha, checkedAt: Date.now(), ok: false, readOnly: true, error: error instanceof Error ? error.message : String(error), positions: [] };
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o644, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  lastObservationAt = Date.now();
  lastObservationSha = runtimeSha;
}
