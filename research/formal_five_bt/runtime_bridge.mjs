import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import readline from "node:readline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SNAPSHOT = path.join(HERE, "runtime_source_snapshot");
const MANIFEST = path.join(HERE, "runtime_source_manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertSourceSnapshot() {
  const records = manifest.files;
  if (!Array.isArray(records) || !records.length) throw new Error("SOURCE_MANIFEST_EMPTY");
  for (const record of records) {
    if (!record || typeof record.path !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new Error("SOURCE_MANIFEST_INVALID");
    }
    const relative = record.path.replaceAll("\\", "/");
    if (relative.startsWith("/") || relative.split("/").includes("..")) throw new Error("SOURCE_PATH_INVALID");
    const file = path.resolve(SNAPSHOT, relative);
    if (!file.startsWith(`${path.resolve(SNAPSHOT)}${path.sep}`)) throw new Error("SOURCE_PATH_INVALID");
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`SOURCE_FILE_MISSING:${relative}`);
    if (sha256(readFileSync(file)) !== record.sha256) throw new Error(`SOURCE_HASH_MISMATCH:${relative}`);
  }
  return records.length;
}

const MODULE_PATHS = {
  v12Config: "config/v12X1AllRuntime.ts",
  v12: "lib/v12-x1-all.ts",
  penguConfig: "config/penguDualLsV2Runtime.ts",
  pengu: "lib/pengu-dual-ls-v2.ts",
  penguRecovery: "lib/pengu-recovery-v8.ts",
  penguShortV20: "lib/pengu-short-v20.ts",
  q102Signal: "lib/disdex-quality102-causal-v4-signal.ts",
  q102S34: "lib/disdex-quality102-causal-v4-s34.ts",
  q102Ranking: "lib/disdex-quality102-causal-v4-ranking.ts",
  q102Selector: "lib/disdex-quality102-causal-selector.ts",
  q102Observability: "lib/disdex-quality102-causal-v4-observability.ts",
  fet: "lib/fet-brk48-signal.ts",
  riskConfig: "config/integratedProductionRiskPolicy.ts",
  strictPlanner: "lib/disdex-strict-portfolio-planner.ts",
};
const SOURCE_COUNT = assertSourceSnapshot();

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier.startsWith("@/")) {
      candidate = path.join(SNAPSHOT, specifier.slice(2));
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    } else {
      return nextResolve(specifier, context);
    }
    for (const file of [candidate, `${candidate}.ts`, `${candidate}.js`, `${candidate}.json`]) {
      if (existsSync(file) && statSync(file).isFile()) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    throw new Error("RUNTIME_IMPORT_NOT_IN_AUDITED_SNAPSHOT");
  },
  load(url, context, nextLoad) {
    const file = fileURLToPath(url);
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(file, "utf8")),
        shortCircuit: true,
      };
    }
    if (url.endsWith(".json")) {
      return {
        format: "module",
        source: `export default ${JSON.stringify(JSON.parse(readFileSync(file, "utf8")))};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const loaded = {};
async function loadLogic() {
  for (const [name, relative] of Object.entries(MODULE_PATHS)) {
    const file = path.join(SNAPSHOT, relative);
    loaded[name] = await import(pathToFileURL(file).href);
  }
  return loaded;
}

function exportIndex() {
  return Object.fromEntries(Object.entries(loaded).map(([name, module]) => [
    name,
    Object.keys(module).sort(),
  ]));
}

function jsonSafe(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, child) => {
    if (typeof child === "bigint") return child.toString();
    if (typeof child === "number" && !Number.isFinite(child)) return null;
    return child;
  }));
}

await loadLogic();

if (process.argv.includes("--list")) {
  process.stdout.write(`${JSON.stringify({
    runtimeSha: manifest.runtime_sha,
    verifiedSourceCount: SOURCE_COUNT,
    nodeVersion: process.versions.node,
    exports: exportIndex(),
  })}\n`);
} else {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let response;
    try {
      const request = JSON.parse(line);
      if (request.op === "list") {
        response = { ok: true, result: { runtimeSha: manifest.runtime_sha, verifiedSourceCount: SOURCE_COUNT, exports: exportIndex() } };
      } else if (request.op === "invoke") {
        const target = loaded[request.module];
        const fn = target?.[request.function];
        if (typeof fn !== "function") throw new Error("RUNTIME_FUNCTION_NOT_EXPORTED");
        const args = Array.isArray(request.args) ? request.args : [];
        response = { ok: true, result: jsonSafe(fn(...args)) };
      } else if (request.op === "v12Series") {
        const h1BySymbol = request.h1BySymbol;
        const startMs = Number(request.startMs);
        const endMs = Number(request.endMs);
        if (!h1BySymbol || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("V12_SERIES_INPUT_INVALID");
        const universe = Object.fromEntries(Object.entries(h1BySymbol).map(([symbol, rows]) => [
          symbol.toUpperCase().replace(/USDT$/, ""), loaded.v12.resampleV12H1ToH2(rows),
        ]));
        const btc = universe.BTC || [];
        const byTime = Object.fromEntries(Object.entries(universe).map(([symbol, rows]) => [symbol, new Map(rows.map((row) => [row.ts, row]))]));
        const length = Math.min(...Object.values(universe).map((rows) => rows.length));
        const results = [];
        for (let index = 0; index < length; index += 1) {
          const ref = btc[index];
          if (!ref || ref.endTs < startMs || ref.endTs > endMs) continue;
          const sameAxis = Object.values(byTime).every((rowMap) => rowMap.has(ref.ts));
          if (!sameAxis) continue;
          // V12 takes an explicit index and every signal/feature helper reads
          // only bars at or before that index. Keep full immutable arrays here
          // to avoid quadratic history copies; the no-lookahead golden test
          // changes all future OHLCV and asserts earlier output is unchanged.
          const observation = loaded.v12.buildV12DecisionObservation(universe, index, ref.endTs);
          const signals = loaded.v12.buildV12Signals(universe, index);
          results.push({ index, decisionTs: ref.endTs, observation, signals });
        }
        response = { ok: true, result: jsonSafe({ results, h2Counts: Object.fromEntries(Object.entries(universe).map(([symbol, rows]) => [symbol, rows.length])) }) };
      } else if (request.op === "penguSeries") {
        const history = request.history;
        const now = Number(request.now);
        if (!history || !Number.isFinite(now)) throw new Error("PENGU_SERIES_INPUT_INVALID");
        const rows = loaded.pengu.buildPenguDualLsV2EvaluationSeries(history, now);
        const results = rows.map((row, index) => ({
          ...row,
          decision: row.features
            ? loaded.pengu.evaluatePenguDualLsV2Decision(row.features, row.shortSignal, Boolean(rows[index - 1]?.longRaw))
            : null,
        }));
        response = { ok: true, result: jsonSafe(results) };
      } else if (request.op === "fetSeries") {
        const rows = request.rows;
        const startMs = Number(request.startMs);
        const endMs = Number(request.endMs);
        if (!Array.isArray(rows) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("FET_SERIES_INPUT_INVALID");
        const results = [];
        for (let hourTs = Math.ceil(startMs / 3_600_000) * 3_600_000; hourTs <= endMs; hourTs += 3_600_000) {
          if (Math.floor(hourTs / 3_600_000) % 4 !== 1) continue;
          const now = hourTs + 30_000;
          const normalized = loaded.fet.normalizeFetH1(rows, now);
          const signal = loaded.fet.buildFetBrk48Signal(normalized, now);
          results.push({ decisionTs: now, signal });
        }
        response = { ok: true, result: jsonSafe(results) };
      } else if (request.op === "q102Series") {
        const candlesBySymbol = request.candlesBySymbol;
        const highVolSymbols = request.highVolSymbols;
        const symbols = request.symbols;
        const startMs = Number(request.startMs);
        const endMs = Number(request.endMs);
        if (!candlesBySymbol || !Array.isArray(highVolSymbols) || !Array.isArray(symbols) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("Q102_SERIES_INPUT_INVALID");
        const indexBySymbol = Object.fromEntries(Object.entries(candlesBySymbol).map(([symbol, rows]) => [symbol, 0]));
        const results = [];
        for (let decisionTs = Math.ceil(startMs / 3_600_000) * 3_600_000; decisionTs <= endMs; decisionTs += 3_600_000) {
          const asofCandles = {};
          const entryOpenBySymbol = {};
          for (const [symbol, rows] of Object.entries(candlesBySymbol)) {
            let index = indexBySymbol[symbol];
            while (index < rows.length && rows[index].timestampMs + 3_600_000 <= decisionTs) index += 1;
            indexBySymbol[symbol] = index;
            let end = index;
            while (end < rows.length && rows[end].timestampMs < decisionTs) end += 1;
            asofCandles[symbol] = rows.slice(0, end);
            if (rows[index]?.timestampMs === decisionTs) entryOpenBySymbol[symbol] = { timestampMs: decisionTs, open: rows[index].open };
          }
          const history = { candlesBySymbol: asofCandles, entryOpenBySymbol };
          try {
            const snapshot = loaded.q102Observability.buildQuality102CausalV4DecisionSnapshot({
              history,
              decisionTs,
              highVolSymbols,
              symbols,
              runtimeCommitSha: manifest.runtime_sha,
            });
            results.push({ decisionTs, snapshot });
          } catch (error) {
            results.push({ decisionTs, error: error instanceof Error ? error.message.split("\n")[0] : "Q102_EVALUATION_FAILED" });
          }
        }
        response = { ok: true, result: jsonSafe(results) };
      } else if (request.op === "planStrictPortfolio") {
        if (!request.input || typeof request.input !== "object") throw new Error("STRICT_PORTFOLIO_INPUT_INVALID");
        response = { ok: true, result: jsonSafe(loaded.strictPlanner.planStrictPortfolio(request.input)) };
      } else {
        throw new Error("UNKNOWN_REQUEST");
      }
    } catch (error) {
      response = {
        ok: false,
        error: error instanceof Error ? error.message.split("\n")[0] : "RUNTIME_CALL_FAILED",
      };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
