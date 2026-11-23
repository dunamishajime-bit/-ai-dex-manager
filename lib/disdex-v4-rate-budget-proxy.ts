import { createConnection } from "node:net";

export const V4_BUDGET_PROXY_SCHEMA = "disdex-v4-budget-proxy/v1" as const;
export type V4ReadPriority = "MARKET_DATA" | "RECONCILIATION" | "RISK_READ";
export type V4BudgetRequest =
  | {schema: typeof V4_BUDGET_PROXY_SCHEMA; operation: "reserve"; weight: number; priority: V4ReadPriority}
  | {schema: typeof V4_BUDGET_PROXY_SCHEMA; operation: "defer"; status: 418 | 429; cooldownMs: number};

export function validateV4BudgetSocketPath(sha: string, path: string): true {
  if (!/^[a-f0-9]{40}$/.test(sha) || path !== `/run/disdex-v4-budget-${sha}/budget.sock`) {
    throw new Error("V4_BUDGET_PROXY_SOCKET_PATH_INVALID");
  }
  return true;
}

export function validateV4BudgetProxyRequest(value: unknown): V4BudgetRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("V4_BUDGET_PROXY_REQUEST_INVALID");
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(",");
  if (row.schema !== V4_BUDGET_PROXY_SCHEMA) throw new Error("V4_BUDGET_PROXY_REQUEST_INVALID");
  if (row.operation === "reserve" && keys === "operation,priority,schema,weight"
      && typeof row.weight === "number" && Number.isSafeInteger(row.weight) && row.weight >= 1 && row.weight <= 100
      && ["MARKET_DATA", "RECONCILIATION", "RISK_READ"].includes(String(row.priority))) {
    return row as V4BudgetRequest;
  }
  if (row.operation === "defer" && keys === "cooldownMs,operation,schema,status"
      && (row.status === 418 || row.status === 429)
      && typeof row.cooldownMs === "number" && Number.isSafeInteger(row.cooldownMs)
      && row.cooldownMs >= 0 && row.cooldownMs <= Number.MAX_SAFE_INTEGER - Date.now()) {
    return row as V4BudgetRequest;
  }
  throw new Error("V4_BUDGET_PROXY_REQUEST_INVALID");
}

export type V4BudgetBackend = {
  reserve: (weight: number, priority: V4ReadPriority) => Promise<{waitMs: number}>;
  defer: (status: 418 | 429, cooldownMs: number) => Promise<{cooldownUntil: number}>;
};

export async function executeV4BudgetProxyRequest(value: unknown, backend: V4BudgetBackend) {
  const request = validateV4BudgetProxyRequest(value);
  if (request.operation === "reserve") {
    const slot = await backend.reserve(request.weight, request.priority);
    if (!Number.isSafeInteger(slot.waitMs) || slot.waitMs < 0 || slot.waitMs > 30_000) throw new Error("V4_BUDGET_PROXY_RESPONSE_INVALID");
    return {ok:true as const, waitMs:slot.waitMs};
  }
  const minimum = request.status === 418 ? 120_000 : 60_000;
  const result = await backend.defer(request.status, Math.max(minimum, request.cooldownMs));
  if (!Number.isSafeInteger(result.cooldownUntil) || result.cooldownUntil <= 0) throw new Error("V4_BUDGET_PROXY_RESPONSE_INVALID");
  return {ok:true as const, cooldownUntil:result.cooldownUntil};
}

export function validateV4BudgetProxyResponse(request: V4BudgetRequest, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("V4_BUDGET_PROXY_RESPONSE_INVALID");
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(",");
  if (row.ok !== true) throw new Error("V4_BUDGET_PROXY_RESPONSE_INVALID");
  if (request.operation === "reserve" && keys === "ok,waitMs" && typeof row.waitMs === "number"
      && Number.isSafeInteger(row.waitMs) && row.waitMs >= 0 && row.waitMs <= 30_000) return row;
  if (request.operation === "defer" && keys === "cooldownUntil,ok" && typeof row.cooldownUntil === "number"
      && Number.isSafeInteger(row.cooldownUntil) && row.cooldownUntil > 0) return row;
  throw new Error("V4_BUDGET_PROXY_RESPONSE_INVALID");
}

export async function requestV4BudgetProxy(sha: string, path: string, request: V4BudgetRequest): Promise<Record<string, unknown>> {
  validateV4BudgetSocketPath(sha, path);
  validateV4BudgetProxyRequest(request);
  return await new Promise((resolve, reject) => {
    const socket = createConnection({path});
    let buffer = "";
    let done = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error); else resolve(value!);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => finish(new Error("V4_BUDGET_PROXY_TIMEOUT")));
    socket.on("error", () => finish(new Error("V4_BUDGET_PROXY_UNAVAILABLE")));
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > 4096) return finish(new Error("V4_BUDGET_PROXY_RESPONSE_INVALID"));
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        if (buffer.slice(newline + 1).trim()) return finish(new Error("V4_BUDGET_PROXY_RESPONSE_INVALID"));
        const response = validateV4BudgetProxyResponse(request, JSON.parse(buffer.slice(0, newline)));
        finish(undefined, response);
      } catch { finish(new Error("V4_BUDGET_PROXY_RESPONSE_INVALID")); }
    });
    socket.on("end", () => { if (!done) finish(new Error("V4_BUDGET_PROXY_RESPONSE_INVALID")); });
  });
}
