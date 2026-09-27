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
  penguRecoveryConfig: "config/penguRecoveryV8.ts",
  penguRiskOverlay: "lib/pengu-route-quarantine-dd-governor.ts",
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
        // The LIVE scorer uses a common numeric index for BTC and every
        // candidate symbol. Passing unaligned native arrays silently reads a
        // different *time* on late-listed coins (sometimes a FUTURE candle).
        // Build one completed, strictly contiguous past H2 window on the BTC
        // clock at every decision, excluding only symbols not yet warmed up
        // or having a gap. Do not require every configured coin to be listed.
        const policy = loaded.v12Config.V12_X1_ALL;
        const historyBars = Math.max(
          policy.btcRegimeSmaBars + 1, policy.btcRegimeMomentumBars + 1,
          policy.momentumBars + 1, policy.atrBars + 2,
          policy.breakoutBars + 1, policy.volatilityLookbackBars + 2,
        );
        const results = [];
        for (let btcIndex = historyBars - 1; btcIndex < btc.length; btcIndex += 1) {
          const ref = btc[btcIndex];
          if (!ref || ref.endTs < startMs || ref.endTs > endMs) continue;
          const btcWindow = btc.slice(btcIndex - historyBars + 1, btcIndex + 1);
          if (btcWindow.length !== historyBars || btcWindow.some(
            (bar, i) => bar.endTs !== bar.ts + 7_200_000 ||
              (i && btcWindow[i - 1].endTs !== bar.ts),
          )) continue;
          const aligned = Object.fromEntries(Object.entries(byTime).map(([symbol, rowMap]) => {
            const window = btcWindow.map((bar) => rowMap.get(bar.ts));
            const ready = window.every((bar, i) =>
              bar && bar.endTs === btcWindow[i].endTs &&
              (!i || window[i - 1]?.endTs === bar.ts));
            return [symbol, ready ? window : []];
          }));
          const index = historyBars - 1;
          const observation = loaded.v12.buildV12DecisionObservation(aligned, index, ref.endTs);
          const signals = loaded.v12.buildV12Signals(aligned, index);
          results.push({ index: btcIndex, decisionTs: ref.endTs, observation, signals });
        }
        response = { ok: true, result: jsonSafe({
          results, historyBars,
          timelineRule: "PER_DECISION_COMPLETED_CONTIGUOUS_H2_LAST_N",
          h2Counts: Object.fromEntries(Object.entries(universe).map(([symbol, rows]) => [symbol, rows.length])),
        }) };
      } else if (request.op === "penguSeries") {
        const history = request.history;
        const now = Number(request.now);
        if (!history || !Number.isFinite(now)) throw new Error("PENGU_SERIES_INPUT_INVALID");
        const rows = loaded.pengu.buildPenguDualLsV2EvaluationSeries(history, now);
        const recoveryEnabled = loaded.penguRecoveryConfig.PENGU_RECOVERY_V8_PROMOTION?.liveEnabled === true;
        const results = rows.map((row, index) => {
          if (!row.features) return { ...row, decision: null, currentDecision: null };
          const baseline = loaded.pengu.evaluatePenguDualLsV2Decision(
            row.features, row.shortSignal, Boolean(rows[index - 1]?.longRaw));
          const v64Long = recoveryEnabled
            ? loaded.pengu.isPenguV8V64DynamicLongSignal(rows, index)
            : row.longSignal;
          const baseCurrent = row.shortSignal
            ? { side: -1, active: true, reason: "PENGU_CURRENT_SHORT_V20" }
            : v64Long
              ? { side: 1, active: true, reason: "PENGU_CURRENT_V64_LONG" }
              : { side: 0, active: false, reason: "PENGU_CURRENT_BASE_IDLE" };
          const recovery = recoveryEnabled
            ? loaded.pengu.selectPenguRecoveryV8Entry(row.recoveryV8, true)
            : undefined;
          const currentDecision = !baseCurrent.active && recovery?.kind === "RECOVERY_V8"
            ? { side: 1, active: true, reason: recovery.reason }
            : baseCurrent;
          const entryVersion = currentDecision.side < 0
            ? "SHORT_V20"
            : (!baseCurrent.active && recovery?.kind === "RECOVERY_V8")
              ? "RECOVERY_V8"
              : currentDecision.side > 0 ? "LONG_V2_FINAL" : undefined;
          const targetGross = entryVersion === "RECOVERY_V8"
            ? Number(recovery.gross)
            : currentDecision.side > 0
              ? loaded.pengu.penguV8V64RequestedLongGross(row.features)
              : currentDecision.side < 0
                ? loaded.pengu.targetGrossForAtr(row.features.atr24Ratio)
                : 0;
          return {
            ...row,
            decision: baseline,
            currentDecision,
            currentSignal: currentDecision.active ? {
              side: currentDecision.side,
              targetGross,
              entryVersion,
              entryTs: row.features.referenceTs + 3_600_000,
              referenceTs: row.features.referenceTs,
              reason: currentDecision.reason,
              features: row.features,
              recoveryV8: row.recoveryV8,
            } : null,
            recoveryV8Enabled: recoveryEnabled,
          };
        });
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
          // Historical universes are point-in-time. A symbol may participate
          // only after its own current-hour entry open and enough prior H1
          // history exist. This prevents a late-listed coin from invalidating
          // every earlier timestamp while preserving the exact audited model.
          // Keep only the latest contiguous, structurally valid H1 suffix.
          // One malformed provider candle must not poison every later date
          // forever; the symbol becomes eligible again only after it rebuilds
          // the required causal warm-up from valid hourly observations.
          const q102ValidSuffix = (rows) => {
            if (!Array.isArray(rows) || !rows.length) return [];
            let start = rows.length - 1;
            const valid = (row) => row
              && Number.isFinite(Number(row.timestampMs)) && Number(row.timestampMs) > 0
              && ["open", "high", "low", "close"].every((key) => Number.isFinite(Number(row[key])) && Number(row[key]) > 0)
              && Number.isFinite(Number(row.quoteVolume)) && Number(row.quoteVolume) >= 0
              && Number(row.high) >= Math.max(Number(row.open), Number(row.close))
              && Number(row.low) <= Math.min(Number(row.open), Number(row.close))
              && Number(row.high) >= Number(row.low);
            if (!valid(rows[start])) return [];
            while (start > 0) {
              const left = rows[start - 1];
              const right = rows[start];
              if (!valid(left) || Number(right.timestampMs) - Number(left.timestampMs) !== 3_600_000) break;
              start -= 1;
            }
            return rows.slice(start);
          };
          const validCandles = Object.fromEntries(
            Object.entries(asofCandles).map(([symbol, rows]) => [symbol, q102ValidSuffix(rows)]));
          const btcReady = (validCandles.BTCUSDT?.length || 0) >= 181 * 24;
          const availableSymbols = symbols.filter((symbol) =>
            Array.isArray(validCandles[symbol])
            && validCandles[symbol].length >= 336
            && entryOpenBySymbol[symbol]?.timestampMs === decisionTs);
          const availableHighVol = highVolSymbols.filter((symbol) =>
            availableSymbols.includes(symbol)
            && validCandles[symbol].length >= 181 * 24
            && btcReady);
          const filteredCandles = Object.fromEntries(
            Object.entries(validCandles).filter(([symbol]) =>
              symbol === "BTCUSDT" || availableSymbols.includes(symbol)));
          const filteredEntryOpen = Object.fromEntries(
            Object.entries(entryOpenBySymbol).filter(([symbol]) => availableSymbols.includes(symbol)));
          const history = { candlesBySymbol: filteredCandles, entryOpenBySymbol: filteredEntryOpen };
          if (!availableSymbols.length || !availableHighVol.length) {
            results.push({
              decisionTs,
              snapshot: {
                items: [], selectedSymbol: null,
                selectedReason: "Q102_POINT_IN_TIME_UNIVERSE_NOT_READY",
                decisionTs, referenceTs: decisionTs,
              },
              availableSymbols,
              availableHighVol,
            });
            continue;
          }
          try {
            const signal = loaded.q102Signal.buildQuality102CausalV4Signal({
              history,
              decisionTs,
              sleeveOccupancy: {
                activePosition: false,
                unresolvedPendingEntry: false,
                basePositionActive: false,
              },
            }, { highVolSymbols: availableHighVol });
            const snapshot = loaded.q102Observability.buildQuality102CausalV4DecisionSnapshot({
              history,
              decisionTs,
              highVolSymbols: availableHighVol,
              symbols: availableSymbols,
              runtimeCommitSha: manifest.runtime_sha,
            });
            results.push({ decisionTs, snapshot, signal, availableSymbols, availableHighVol });
          } catch (error) {
            results.push({
              decisionTs,
              error: error instanceof Error ? error.message.split("\n")[0] : "Q102_EVALUATION_FAILED",
              availableSymbols,
              availableHighVol,
            });
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
