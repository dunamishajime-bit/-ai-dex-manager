import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import readline from "node:readline";
import { indexQ102History, q102HistoryAt } from "./q102_window.mjs";

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
        // Resample each native instrument independently; a missing historical
        // pair or a later venue listing must not shift every other symbol's
        // aligned H2 index or suppress BTC/other valid candidates.
        const rawUniverse = Object.fromEntries(Object.entries(h1BySymbol).map(([symbol, rows]) => [
          symbol.toUpperCase().replace(/USDT$/, ""), loaded.v12.resampleV12H1ToH2(rows),
        ]));
        const btc = rawUniverse.BTC || [];
        const btcIndexByTime = new Map(btc.map((bar, index) => [bar.ts, index]));
        const requiredLookback = Math.max(
          loaded.v12Config.V12_X1_ALL.btcRegimeSmaBars,
          loaded.v12Config.V12_X1_ALL.btcRegimeMomentumBars,
          loaded.v12Config.V12_X1_ALL.momentumBars,
          loaded.v12Config.V12_X1_ALL.atrBars,
          loaded.v12Config.V12_X1_ALL.volatilityLookbackBars,
          22,
        ) + 2;
        const universe = {};
        const consecutive = {};
        const eligibleEvaluationWindows = {};
        for (const [symbol, rows] of Object.entries(rawUniverse)) {
          const aligned = new Array(btc.length);
          for (const row of rows) {
            const index = btcIndexByTime.get(row.ts);
            if (index !== undefined && row.endTs === btc[index].endTs) aligned[index] = row;
          }
          const runs = new Array(btc.length);
          let run = 0;
          for (let index = 0; index < btc.length; index += 1) {
            const row = aligned[index];
            if (!row || (index > 0 && (!aligned[index - 1] || aligned[index - 1].endTs !== row.ts))) {
              run = row ? 1 : 0;
            } else run += 1;
            runs[index] = run;
          }
          universe[symbol] = aligned;
          consecutive[symbol] = runs;
          eligibleEvaluationWindows[symbol] = 0;
        }
        const results = [];
        let skippedBtcWarmupOrGap = 0;
        for (let index = 0; index < btc.length; index += 1) {
          const ref = btc[index];
          if (!ref || ref.endTs < startMs || ref.endTs > endMs) continue;
          if ((consecutive.BTC?.[index] || 0) < requiredLookback) {
            skippedBtcWarmupOrGap += 1;
            continue;
          }
          // An unavailable symbol is [] at this decision index, not a padded
          // future bar, so LIVE source candidateMetricsFor cannot inspect it.
          const decisionUniverse = { BTC: universe.BTC };
          eligibleEvaluationWindows.BTC += 1;
          for (const symbol of Object.keys(universe)) {
            if (symbol === "BTC") continue;
            if ((consecutive[symbol][index] || 0) < requiredLookback) continue;
            decisionUniverse[symbol] = universe[symbol];
            eligibleEvaluationWindows[symbol] += 1;
          }
          const observation = loaded.v12.buildV12DecisionObservation(decisionUniverse, index, ref.endTs);
          const signals = loaded.v12.buildV12Signals(decisionUniverse, index);
          results.push({ index, decisionTs: ref.endTs, observation, signals });
        }
        response = { ok: true, result: jsonSafe({
          results,
          h2Counts: Object.fromEntries(Object.entries(rawUniverse).map(([symbol, rows]) => [symbol, rows.length])),
          eligibleEvaluationWindows,
          skippedBtcWarmupOrGap,
          requiredLookback,
        }) };

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
        // Validate the entire immutable H1 stream once. Never join disjoint
        // historical hours: a skipped malformed/listing-gap bar invalidates
        // the corresponding 73h lookback, not every later date.
        const hour = 3_600_000;
        const completed = loaded.fet.normalizeFetH1(rows, endMs + hour)
          .filter(r => r.openTs % hour === 0 && r.closeTs === r.openTs + hour - 1
            && r.high >= Math.max(r.open, r.close, r.low)
            && r.low <= Math.min(r.open, r.close, r.high));
        const results = [];
        let cursor = 0;
        for (let hourTs = Math.ceil(startMs / hour) * hour; hourTs <= endMs; hourTs += hour) {
          if (Math.floor(hourTs / hour) % 4 !== 1) continue;
          const now = hourTs + 30_000;
          while (cursor < completed.length && completed[cursor].closeTs < hourTs) cursor += 1;
          const recent = completed.slice(Math.max(0, cursor - 73), cursor);
          const aligned = recent.length === 73 && recent[72].openTs === hourTs - hour
            && recent.every((bar, i) => i === 0 || recent[i - 1].openTs + hour === bar.openTs);
          const signal = aligned ? loaded.fet.buildFetBrk48Signal(recent, now) : undefined;
          results.push({
            decisionTs: now, signal, historyReady: aligned,
            gapReason: aligned ? null : recent.length < 73 ? "FET_INSUFFICIENT_CAUSAL_73H_HISTORY"
              : "FET_73H_HISTORY_GAP_OR_MALFORMED",
            lastCompletedCloseTs: recent.at(-1)?.closeTs ?? null,
            historicalCompletedBars: recent.length,
          });
        }
        response = { ok: true, result: jsonSafe(results) };
      } else if (request.op === "q102Series") {
        const candlesBySymbol = request.candlesBySymbol;
        const highVolSymbols = request.highVolSymbols;
        const symbols = request.symbols;
        const startMs = Number(request.startMs);
        const endMs = Number(request.endMs);
        if (!candlesBySymbol || !Array.isArray(highVolSymbols) || !Array.isArray(symbols) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("Q102_SERIES_INPUT_INVALID");
        const indexed = indexQ102History(candlesBySymbol);
        const results = [];
        const eligibleRequested = new Set(symbols.map(s => String(s).toUpperCase()));
        const highVolRequested = new Set(highVolSymbols.map(s => String(s).toUpperCase()));
        for (let decisionTs = Math.ceil(startMs / 3_600_000) * 3_600_000;
             decisionTs <= endMs; decisionTs += 3_600_000) {
          const availability = q102HistoryAt(indexed,decisionTs);
          const eligible = availability.eligibleSymbols.filter(symbol => eligibleRequested.has(symbol));
          const validHighVol = eligible.filter(symbol => highVolRequested.has(symbol));
          const exclusions = Object.fromEntries(Object.entries(availability.exclusions)
            .filter(([symbol]) => eligibleRequested.has(symbol) || symbol === "BTCUSDT"));
          if (!availability.ready || validHighVol.length === 0) {
            results.push({ decisionTs, error:availability.exclusions.BTCUSDT ?
              "Q102_BTC_181D_SOURCE_WINDOW_UNVERIFIED" :
              validHighVol.length===0?"Q102_HIGH_VOL_181D_SOURCE_WINDOW_UNVERIFIED":
              "Q102_NO_ELIGIBLE_SOURCE_COMPLETE_SYMBOL",
              exclusions,eligibleSymbols:eligible,minimumHistoryHours:availability.minimumHistoryHours });
            continue;
          }
          const history = {
            candlesBySymbol:Object.fromEntries(Object.entries(availability.history.candlesBySymbol)
              .filter(([symbol]) => symbol==="BTCUSDT" || eligibleRequested.has(symbol))),
            entryOpenBySymbol:Object.fromEntries(Object.entries(availability.history.entryOpenBySymbol)
              .filter(([symbol]) => symbol==="BTCUSDT" || eligibleRequested.has(symbol))),
          };
          try {
            const snapshot = loaded.q102Observability.buildQuality102CausalV4DecisionSnapshot({
              history, decisionTs, highVolSymbols: validHighVol, symbols: eligible,
              runtimeCommitSha: manifest.runtime_sha,
            });
            results.push({decisionTs,snapshot,exclusions,eligibleSymbols:eligible,
              historicalUniverseSubset:eligible.length!==eligibleRequested.size});
          }catch(error){
            results.push({decisionTs,error:error instanceof Error?error.message.split("\n")[0]:"Q102_EVALUATION_FAILED",
              exclusions,eligibleSymbols:eligible,historicalUniverseSubset:eligible.length!==eligibleRequested.size});
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
