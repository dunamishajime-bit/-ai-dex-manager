import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { GitHubClient } from "./lib/github.mjs";
import { compareLineage, diagnoseCandidate, summarizeResearchStatus } from "./lib/diagnostics.mjs";
import { assertNoCredentialLikeText, guardrailSummary } from "./lib/policy.mjs";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_BODY_BYTES = 256 * 1024;

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "get_research_status",
    description: "Read the allowlisted research branch, research workflow activity, and research artifacts. Production and LIVE status are inaccessible.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_completed_bt",
    description: "List completed successful Research Commander backtests from the allowlisted workflow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_trade_ledger",
    description: "Read only research ledger metadata or one allowlisted research file. Production ledgers are inaccessible.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "diagnose_candidate",
    description: "Diagnose a candidate using Development or Validation evidence only. Confirmation and Holdout are structurally inaccessible.",
    inputSchema: { type: "object", required: ["stage"], properties: { stage: { type: "string", enum: ["Development", "Validation"] }, candidate: { type: "object" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "compare_lineage",
    description: "Compare research candidate lineage metadata without opening Confirmation or Holdout evidence.",
    inputSchema: { type: "object", required: ["items"], properties: { items: { type: "array", maxItems: 20 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "register_candidate",
    description: "Register one research candidate under the allowlisted research candidates path. Never writes production paths.",
    inputSchema: { type: "object", required: ["candidate"], properties: { candidate: { type: "object" } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "launch_bt_shards",
    description: "Validate or launch allowlisted research-only BT shards with a hard five-active-shard limit. Defaults to dry-run.",
    inputSchema: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 5 }, dryRun: { type: "boolean" }, requestId: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_guardrails",
    description: "Return the Research Commander security and overfit-firewall guardrails.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]);

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function asSafeError(error) {
  const message = String(error?.message ?? "RESEARCH_COMMAND_FAILED").replace(/[\r\n]/g, " ");
  if (/token|secret|password|credential|private/i.test(message)) return "RESEARCH_COMMAND_FAILED";
  return message.slice(0, 180);
}

function authorized(headers, expectedToken) {
  const value = headers.authorization ?? headers.Authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const received = Buffer.from(value.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function toolText(data) {
  const text = JSON.stringify(data);
  assertNoCredentialLikeText(text);
  return [{ type: "text", text }];
}

export function createApp({ token, github } = {}) {
  if (!token || typeof token !== "string") throw new Error("MCP_AUTH_TOKEN_MISSING");
  if (!github) throw new Error("GITHUB_RESEARCH_CLIENT_MISSING");

  async function callTool(name, args = {}) {
    switch (name) {
      case "get_guardrails":
        return guardrailSummary();
      case "get_research_status": {
        const status = await github.getResearchStatus();
        return summarizeResearchStatus({
          branch: status.branch.branch,
          headSha: status.branch.headSha,
          activeRuns: status.activeRuns.length,
          completedRuns: status.completedRuns.length,
          artifactCount: status.artifacts.length,
        });
      }
      case "get_completed_bt":
        return { runs: await github.getCompletedBt() };
      case "get_trade_ledger":
        if (args.path) return await github.readSafeFile(args.path);
        return { files: await github.getSafeTree("research/") };
      case "diagnose_candidate":
        return diagnoseCandidate(args.candidate ?? {}, args.stage);
      case "compare_lineage":
        return { items: compareLineage(args.items) };
      case "register_candidate":
        return await github.registerCandidate(args.candidate);
      case "launch_bt_shards":
        return await github.launchBtShards(args);
      default:
        throw new Error("TOOL_NOT_FOUND");
    }
  }

  async function handle({ method = "POST", path = "/mcp", headers = {}, body = null } = {}) {
    if (method === "OPTIONS") return { status: 204, headers: {}, body: null };
    if (path === "/health" && method === "GET") {
      if (!authorized(headers, token)) return { status: 401, headers: { "WWW-Authenticate": "Bearer" }, body: null };
      return { status: 200, headers: { "Content-Type": "application/json" }, body: { ok: true, mode: "research-only" } };
    }
    if (path !== "/mcp") return { status: 404, headers: {}, body: null };
    if (!authorized(headers, token)) return { status: 401, headers: { "WWW-Authenticate": "Bearer" }, body: null };
    if (method !== "POST") return { status: 405, headers: { Allow: "POST, OPTIONS" }, body: null };

    const request = body && typeof body === "object" ? body : null;
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return { status: 400, headers: { "Content-Type": "application/json" }, body: jsonRpcError(null, -32600, "INVALID_JSON_RPC_REQUEST") };
    }
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") {
      return { status: 202, headers: {}, body: null };
    }
    if (request.method === "initialize") {
      return {
        status: 200,
        headers: { "Content-Type": "application/json", "MCP-Session-Id": randomUUID() },
        body: jsonRpcResult(request.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "disdex-research-commander", version: "1.0.0" },
          instructions: "Research-only. Production/LIVE code, credentials, orders, positions, accounts and wallets are inaccessible.",
        }),
      };
    }
    if (request.method === "tools/list") {
      return { status: 200, headers: { "Content-Type": "application/json" }, body: jsonRpcResult(request.id, { tools: TOOL_DEFINITIONS }) };
    }
    if (request.method === "tools/call") {
      const name = request.params?.name;
      try {
        const result = await callTool(name, request.params?.arguments ?? {});
        return { status: 200, headers: { "Content-Type": "application/json" }, body: jsonRpcResult(request.id, { content: toolText(result), isError: false }) };
      } catch (error) {
        return { status: 200, headers: { "Content-Type": "application/json" }, body: jsonRpcResult(request.id, { content: [{ type: "text", text: asSafeError(error) }], isError: true }) };
      }
    }
    return { status: 200, headers: { "Content-Type": "application/json" }, body: jsonRpcError(request.id, -32601, "METHOD_NOT_FOUND") };
  }

  return { handle, callTool, tools: TOOL_DEFINITIONS };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new Error("REQUEST_TOO_LARGE"));
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (size === 0) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("INVALID_JSON")); }
    });
    request.on("error", reject);
  });
}

export function createHttpServer({ token, github } = {}) {
  const app = createApp({ token, github });
  return http.createServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readBody(request) : null;
      const result = await app.handle({ method: request.method, path: new URL(request.url, "http://127.0.0.1").pathname, headers: request.headers, body });
      response.statusCode = result.status;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
      for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
      if (result.body === null) return response.end();
      response.end(JSON.stringify(result.body));
    } catch (error) {
      response.statusCode = error?.message === "REQUEST_TOO_LARGE" ? 413 : 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "REQUEST_REJECTED" }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.MCP_AUTH_TOKEN;
  const githubToken = process.env.GITHUB_RESEARCH_TOKEN;
  if (!token || !githubToken) {
    console.error("RESEARCH_COMMANDER_CONFIG_INVALID");
    process.exit(78);
  }
  const github = new GitHubClient({
    token: githubToken,
    writeEnabled: process.env.GITHUB_WRITE_ENABLED === "true",
  });
  const server = createHttpServer({ token, github });
  const port = Number(process.env.PORT ?? "8789");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error("RESEARCH_COMMANDER_PORT_INVALID");
    process.exit(78);
  }
  server.listen(port, "127.0.0.1", () => console.log(`DISDEX_RESEARCH_COMMANDER_READY port=${port} mode=research-only`));
}

