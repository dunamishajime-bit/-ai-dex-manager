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
  q102Pipeline: "lib/disdex-quality102-causal-pipeline.ts",
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

const Q102_HOUR = 3_600_000;
const Q102_DAY = 24 * Q102_HOUR;
const Q102_FEATURE_WARMUP = 336;
const Q102_TRAINING_DAYS = 180;
const Q102_MAX_HOLD = 72;
const Q102_CORRELATION_HOURS = 30 * 24;
const Q102_MIN_CORRELATION_HOURS = 10 * 24;

function q102RuleGrid(symbol) {
  const grid = loaded.q102Pipeline.QUALITY102_HIGH_VOL_GRID;
  const pengu = symbol === "PENGUUSDT";
  const longDrops = pengu ? grid.longDrops : [0.08, 0.10, 0.12];
  const longRsis = pengu ? grid.longRsis : [35, 40];
  const shortRallies = pengu ? grid.shortRallies : [0.05, 0.08, 0.10];
  const shortRsis = pengu ? grid.shortRsis : [60, 65];
  const rules = [];
  for (const longDrop of longDrops) for (const longRsi of longRsis)
    for (const shortRally of shortRallies) for (const shortRsi of shortRsis)
      for (const hardStop of grid.hardStops)
        rules.push({ longDrop, longRsi, shortRally, shortRsi, hardStop });
  return rules;
}

function q102MatchedSide(features, rule) {
  const found = loaded.q102Pipeline.matchQuality102HighVolGrid(features).find((candidate) =>
    candidate.hardStop === rule.hardStop && (
      candidate.side === 1
        ? candidate.threshold === rule.longDrop && candidate.rsi === rule.longRsi
        : candidate.threshold === rule.shortRally && candidate.rsi === rule.shortRsi
    ));
  return found?.side;
}

function q102SummarizeReturns(returns) {
  if (!returns.length) return { trades: 0, wins: 0, totalReturn: 0, winRate: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0 };
  let equity = 1, peak, maxDrawdown = 0, gains = 0, losses = 0, wins = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = peak === undefined ? equity : Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (value > 0) { wins += 1; gains += value; } else losses += value;
  }
  return {
    trades: returns.length, wins, totalReturn: equity - 1, winRate: wins / returns.length,
    profitFactor: losses < 0 ? gains / -losses : 999,
    expectancy: returns.reduce((a, b) => a + b, 0) / returns.length,
    maxDrawdown,
  };
}

function q102TrainRule(rows, features, rule, firstSignalIndex, trainingEndIndex) {
  const returns = [];
  let signalIndex = firstSignalIndex;
  const costs = loaded.q102Pipeline.QUALITY102_RESEARCH_COSTS.normal;
  while (signalIndex < trainingEndIndex - Q102_MAX_HOLD) {
    const side = q102MatchedSide(features.get(signalIndex), rule);
    if (side === undefined) { signalIndex += 1; continue; }
    const entryIndex = signalIndex + 1;
    const entryPrice = rows[entryIndex].open;
    const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
    let exitIndex = signalIndex + Q102_MAX_HOLD;
    let exitPrice = rows[exitIndex].close;
    for (let index = entryIndex; index <= exitIndex; index += 1) {
      if ((side === 1 && rows[index].low <= stopPrice) || (side === -1 && rows[index].high >= stopPrice)) {
        exitIndex = index; exitPrice = stopPrice; break;
      }
    }
    const holdHours = exitIndex - entryIndex + 1;
    const grossReturn = side * (exitPrice / entryPrice - 1);
    returns.push(grossReturn - 2 * costs.perSide - costs.fundingPerDay * holdHours / 24);
    signalIndex = exitIndex + 1;
  }
  return q102SummarizeReturns(returns);
}

const q102MonthlyCache = new Map();
function q102MonthlySelection(symbol, rows, dataCutoffTs) {
  if (!rows.length) return undefined;
  const monthStartTs = loaded.q102Pipeline.monthStartUtc(dataCutoffTs);
  const cacheKey = [symbol, monthStartTs, rows[0].timestampMs].join("|");
  if (q102MonthlyCache.has(cacheKey)) return q102MonthlyCache.get(cacheKey) || undefined;
  const trainingStartTs = monthStartTs - Q102_TRAINING_DAYS * Q102_DAY;
  const trainingEndTs = monthStartTs - Q102_HOUR;
  const firstTs = rows[0].timestampMs;
  if (firstTs > trainingStartTs - Q102_FEATURE_WARMUP * Q102_HOUR || rows.at(-1).timestampMs < trainingEndTs) {
    q102MonthlyCache.set(cacheKey, null); return undefined;
  }
  const firstSignalIndex = (trainingStartTs - firstTs) / Q102_HOUR;
  const trainingEndIndex = (trainingEndTs - firstTs) / Q102_HOUR;
  if (!Number.isInteger(firstSignalIndex) || !Number.isInteger(trainingEndIndex)) {
    q102MonthlyCache.set(cacheKey, null); return undefined;
  }
  const features = new Map();
  for (let index = firstSignalIndex; index < trainingEndIndex - Q102_MAX_HOLD; index += 1) {
    features.set(index, loaded.q102Pipeline.computeQuality102HighVolFeatures(rows, index));
  }
  const evaluations = q102RuleGrid(symbol).map((rule) => ({
    rule,
    ...q102TrainRule(rows, features, rule, firstSignalIndex, trainingEndIndex),
    trainingStartTs, trainingEndTs, availableAtTs: trainingEndTs,
  }));
  const selected = loaded.q102Pipeline.selectQuality102HighVolMonthlyRule({ monthStartTs, evaluations }).selected;
  const result = selected ? {
    rule: selected.rule,
    metrics: {
      trades: selected.trades, wins: selected.wins, totalReturn: selected.totalReturn,
      winRate: selected.winRate, profitFactor: selected.profitFactor,
      expectancy: selected.expectancy, maxDrawdown: selected.maxDrawdown,
    },
  } : undefined;
  q102MonthlyCache.set(cacheKey, result || null);
  return result;
}

function q102ScannerHealthPass(metrics) {
  return metrics.winRate >= 0.58 && metrics.profitFactor >= 1.30 && metrics.expectancy > 0
    && metrics.maxDrawdown >= -0.30 && metrics.trades >= 5;
}

function q102CandidateFor(symbol, rows, dataCutoffTs) {
  const selection = q102MonthlySelection(symbol, rows, dataCutoffTs);
  if (!selection || (symbol !== "PENGUUSDT" && !q102ScannerHealthPass(selection.metrics))) return { selection };
  const features = loaded.q102Pipeline.computeQuality102HighVolFeatures(rows, rows.length - 1);
  const side = q102MatchedSide(features, selection.rule);
  if (side === undefined) return { selection };
  const metrics = selection.metrics;
  const score = 30 * metrics.winRate
    + 10 * Math.min(metrics.profitFactor, 3)
    + 200 * Math.max(-0.05, Math.min(0.10, metrics.expectancy))
    + 60 * Math.min(Math.abs(features.ret24), 0.25)
    + 30 * Math.min(features.atrPct, 0.08)
    + 2 * Math.min(features.volumeRatio, 3)
    + (symbol === "PENGUUSDT" ? 3 : 0);
  return { selection, candidate: { id: `HIGH_VOL:${symbol}:${features.signalTs}`, symbol, side, score } };
}

function q102TrailingCorrelation(left, right, cutoffTs) {
  const rightByTs = new Map(right.map((row, index) => [row.timestampMs, index > 0 ? row.close / right[index - 1].close - 1 : undefined]));
  const pairs = [];
  for (let index = 1; index < left.length; index += 1) {
    if (left[index].timestampMs > cutoffTs) break;
    const other = rightByTs.get(left[index].timestampMs);
    if (other !== undefined) pairs.push([left[index].close / left[index - 1].close - 1, other]);
  }
  const tail = pairs.slice(-Q102_CORRELATION_HOURS);
  if (tail.length < Q102_MIN_CORRELATION_HOURS) return 0;
  const lm = tail.reduce((s, p) => s + p[0], 0) / tail.length;
  const rm = tail.reduce((s, p) => s + p[1], 0) / tail.length;
  let cov = 0, lv = 0, rv = 0;
  for (const [l, r] of tail) { cov += (l-lm)*(r-rm); lv += (l-lm)**2; rv += (r-rm)**2; }
  const denominator = Math.sqrt(lv * rv);
  return denominator > 0 ? cov / denominator : 0;
}

function q102ActivePenguSide(rows, rule, dataCutoffTs) {
  const monthStartTs = loaded.q102Pipeline.monthStartUtc(dataCutoffTs);
  const firstIndex = Math.max(Q102_FEATURE_WARMUP, Math.ceil((monthStartTs - rows[0].timestampMs) / Q102_HOUR));
  let signalIndex = firstIndex;
  while (signalIndex < rows.length) {
    const side = q102MatchedSide(loaded.q102Pipeline.computeQuality102HighVolFeatures(rows, signalIndex), rule);
    if (side === undefined) { signalIndex += 1; continue; }
    const entryIndex = signalIndex + 1;
    if (entryIndex >= rows.length) return side;
    const entryPrice = rows[entryIndex].open;
    const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
    const lastObservedIndex = Math.min(rows.length - 1, entryIndex + Q102_MAX_HOLD - 1);
    let stopIndex;
    for (let index = entryIndex; index <= lastObservedIndex; index += 1) {
      if ((side === 1 && rows[index].low <= stopPrice) || (side === -1 && rows[index].high >= stopPrice)) { stopIndex = index; break; }
    }
    if (stopIndex !== undefined) { signalIndex = stopIndex + 1; continue; }
    if (lastObservedIndex < entryIndex + Q102_MAX_HOLD - 1) return side;
    signalIndex = lastObservedIndex + 1;
  }
  return undefined;
}

function q102FastSignal(history, decisionTs, highVolSymbols) {
  const entries = Object.entries(history.candlesBySymbol).sort(([a],[b]) => a.localeCompare(b));
  const highSet = new Set(highVolSymbols);
  const highEntries = entries.filter(([symbol]) => symbol === "BTCUSDT" || highSet.has(symbol));
  if (highVolSymbols.length && highEntries.length) {
    const dataCutoffTs = Math.min(...highEntries.map(([, rows]) => rows.at(-1).timestampMs));
    const normalized = highEntries.map(([symbol, rows]) => [symbol, rows.filter((row) => row.timestampMs <= dataCutoffTs)]);
    const generated = normalized.filter(([symbol]) => symbol !== "BTCUSDT").map(([symbol, rows]) => ({
      symbol, rows, ...q102CandidateFor(symbol, rows, dataCutoffTs),
    }));
    const penguState = generated.find((item) => item.symbol === "PENGUUSDT");
    const penguRows = penguState?.rows;
    const activePengu = penguRows && penguState.selection
      ? q102ActivePenguSide(penguRows, penguState.selection.rule, dataCutoffTs) : undefined;
    const candidates = generated.flatMap((item) => item.candidate ? [{ ...item.candidate, rows: item.rows }] : [])
      .filter((item) => activePengu === undefined || item.symbol === "PENGUUSDT" || item.side !== activePengu || !penguRows
        || Math.abs(q102TrailingCorrelation(item.rows, penguRows, dataCutoffTs)) < 0.80)
      .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol) || left.id.localeCompare(right.id));
    const selected = candidates[0];
    if (selected) {
      const source = generated.find((item) => item.candidate?.id === selected.id);
      return {
        strategyId: "QUALITY102_CAUSAL_V1", referenceTs: dataCutoffTs, side: selected.side,
        symbol: selected.symbol, family: "HIGH_VOL",
        requestedGross: loaded.riskConfig.quality102GrossForFamily("HIGH_VOL"),
        reason: "QUALITY102_CAUSAL_V1_HIGH_VOL_SIGNAL", dataCutoffTs,
        hardStop: source?.selection?.rule.hardStop, maxHoldHours: Q102_MAX_HOLD,
        exitPolicy: "HIGH_VOL_TRAIL72", brkEnabled: true,
      };
    }
  }
  const layerRank = { S3: 1, S4: 2 };
  const familyRank = { BRK: 1, PB: 2, MR: 3, REV: 4 };
  const s34 = [];
  for (const [symbol, rows] of entries) {
    if (symbol === "BTCUSDT") continue;
    const entryOpen = history.entryOpenBySymbol?.[symbol];
    if (!entryOpen) continue;
    for (const candidate of loaded.q102S34.generateQuality102CausalV4S34Candidates({ symbol, rows, entryOpen })) s34.push(candidate);
  }
  s34.sort((a,b) => layerRank[a.layer] - layerRank[b.layer]
    || familyRank[a.family] - familyRank[b.family]
    || b.margin - a.margin || a.key.localeCompare(b.key));
  const candidate = s34[0];
  if (!candidate) return {
    strategyId: "QUALITY102_CAUSAL_V1", referenceTs: decisionTs, side: 0, requestedGross: 0,
    reason: "QUALITY102_CAUSAL_V4_NO_SIGNAL", dataCutoffTs: decisionTs, brkEnabled: true,
  };
  const improvement = loaded.q102Selector.evaluateQuality102CausalV4ImprovementGate({
    family: candidate.family, side: candidate.side, ret14: candidate.ret14,
  });
  if (!improvement.accepted) return {
    strategyId: "QUALITY102_CAUSAL_V1", referenceTs: decisionTs, side: 0, requestedGross: 0,
    reason: "QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL",
    dataCutoffTs: candidate.dataCutoffTs, brkEnabled: true,
  };
  return {
    strategyId: "QUALITY102_CAUSAL_V1", referenceTs: candidate.entryTs,
    side: candidate.side, symbol: candidate.symbol, family: candidate.family,
    variant: candidate.variant, layer: candidate.layer,
    requestedGross: loaded.riskConfig.quality102GrossForFamily(candidate.family),
    reason: "QUALITY102_CAUSAL_V4_NATURAL_SIGNAL", dataCutoffTs: candidate.dataCutoffTs,
    hardStop: candidate.hardStop, maxHoldHours: candidate.maxHoldHours,
    exitPolicy: candidate.exitPolicy, brkEnabled: true,
  };
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
      } else if (request.op === "penguTradeOutcomes") {
        const history = request.args?.[0];
        const endMs = Number(request.args?.[1]);
        if (!history || !Number.isFinite(endMs)) throw new Error("penguTradeOutcomes requires history and endMs");
        const rows = loaded.pengu.buildPenguDualLsV2EvaluationSeries(history, endMs);
        const recoveryEnabled = loaded.penguRecoveryConfig.PENGU_RECOVERY_V8_PROMOTION?.liveEnabled === true;
        const candidates = [];
        const currentSignalAt = (index) => {
          const row = rows[index];
          if (!row?.features) return null;
          const v64Long = recoveryEnabled
            ? loaded.pengu.isPenguV8V64DynamicLongSignal(rows, index)
            : row.longSignal;
          const base = row.shortSignal
            ? { side: -1, active: true, reason: "PENGU_CURRENT_SHORT_V20" }
            : v64Long
              ? { side: 1, active: true, reason: "PENGU_CURRENT_V64_LONG" }
              : { side: 0, active: false, reason: "PENGU_CURRENT_BASE_IDLE" };
          const recovery = recoveryEnabled
            ? loaded.pengu.selectPenguRecoveryV8Entry(row.recoveryV8, true)
            : undefined;
          const decision = !base.active && recovery?.kind === "RECOVERY_V8"
            ? { side: 1, active: true, reason: recovery.reason }
            : base;
          if (!decision.active) return null;
          const entryVersion = decision.side < 0
            ? "SHORT_V20"
            : (!base.active && recovery?.kind === "RECOVERY_V8")
              ? "RECOVERY_V8" : "LONG_V2_FINAL";
          const targetGross = entryVersion === "RECOVERY_V8"
            ? Number(recovery.gross)
            : decision.side > 0
              ? loaded.pengu.penguV8V64RequestedLongGross(row.features)
              : loaded.pengu.targetGrossForAtr(row.features.atr24Ratio);
          return { side: decision.side, entryVersion, targetGross, reason: decision.reason };
        };
        for (let index = 0; index + 1 < rows.length; index += 1) {
          const spec = currentSignalAt(index);
          if (!spec) continue;
          const source = rows[index];
          const entryRow = rows[index + 1];
          if (!entryRow?.features || Number(entryRow.candle.openTime) !== Number(source.features.referenceTs) + 3_600_000) continue;
          const entryPrice = Number(entryRow.candle.open);
          const entryTs = Number(entryRow.candle.openTime);
          if (!(entryPrice > 0) || !(entryTs > 0)) continue;
          let position = {
            side: spec.side,
            entryTs,
            entryPrice,
            quantity: 1,
            gross: spec.targetGross,
            highWaterMark: entryPrice,
            lowWaterMark: entryPrice,
            entryVersion: spec.entryVersion,
          };
          if (spec.entryVersion === "SHORT_V20") {
            position.shortV20 = loaded.penguShortV20.createPenguShortV20State({
              entryPrice,
              requestedGross: spec.targetGross,
              entryAtr24Ratio: source.features.atr24Ratio,
              btcEma168Distance: source.features.btcEma168Distance,
              btcReturn24h: source.features.btcReturn24h,
            });
          }
          if (spec.entryVersion === "RECOVERY_V8") {
            position.recoveryV8 = {
              version: "RECOVERY_V8",
              side: 1,
              entryTs,
              entryPrice,
              logicalEntryPrice: entryPrice,
              recoveryExecutionPrice: entryPrice,
              quantity: 1,
              originalQuantity: 1,
              originalGross: spec.targetGross,
              remainingGross: spec.targetGross,
              partialDefenseTriggered: false,
              highWaterMark: entryPrice,
              protectionLifecycle: "FULL_HARD_STOP",
            };
          }
          let exit = null;
          let partial = null;
          for (let j = index + 1; j < rows.length; j += 1) {
            const bar = rows[j];
            if (!bar?.features) continue;
            if (spec.entryVersion === "RECOVERY_V8" && position.recoveryV8 && bar.recoveryV8) {
              const evaluation = loaded.penguRecovery.evaluateRecoveryV8PositionBar(position.recoveryV8, bar.recoveryV8);
              if (evaluation.kind === "PARTIAL_DEFENSE") {
                const logicalEntry = Number(position.recoveryV8.logicalEntryPrice || position.entryPrice);
                partial = partial || {
                  ts: Number(bar.features.referenceTs),
                  price: logicalEntry * (1 - Number(loaded.penguRecoveryConfig.PENGU_RECOVERY_V8.partial.stopPct)),
                  quantityFraction: 0.5,
                };
                position = {
                  ...position,
                  quantity: Number(evaluation.updatedPosition.quantity),
                  recoveryV8: { ...position.recoveryV8, ...evaluation.updatedPosition },
                };
                continue;
              }
              position = {
                ...position,
                quantity: Number(evaluation.updatedPosition.quantity),
                recoveryV8: { ...position.recoveryV8, ...evaluation.updatedPosition },
              };
              const reason = evaluation.kind === "HARD_STOP" ? "RECOVERY_V8_HARD_STOP"
                : evaluation.kind === "TRAILING_STOP" ? "RECOVERY_V8_TRAILING_STOP"
                : evaluation.kind === "MAX_HOLD" ? "RECOVERY_V8_MAX_HOLD"
                : evaluation.kind === "YIELD_BASE_LONG" ? "RECOVERY_V8_YIELD_BASE_LONG"
                : null;
              if (reason) {
                exit = {
                  ts: Number(bar.features.referenceTs) + 3_600_000,
                  price: Number(evaluation.stopPrice || bar.features.close),
                  reason,
                  stopPrice: evaluation.stopPrice,
                };
                break;
              }
              continue;
            }
            const evaluated = loaded.pengu.evaluatePenguDualLsV2PositionBar(position, bar.features);
            position = evaluated.updatedPosition;
            if (evaluated.exit) {
              exit = {
                ts: Number(bar.features.referenceTs) + 3_600_000,
                price: Number(evaluated.exit.stopPrice || bar.features.close),
                reason: evaluated.exit.reason,
                stopPrice: evaluated.exit.stopPrice,
              };
              break;
            }
          }
          const route = loaded.penguRiskOverlay.routeForPenguEntryVersion(spec.entryVersion);
          const sideName = spec.side > 0 ? "LONG" : "SHORT";
          let unitPriceReturn = null;
          if (exit && exit.price > 0) {
            const direction = spec.side > 0 ? 1 : -1;
            const finalFraction = partial ? 0.5 : 1;
            const partialReturn = partial
              ? 0.5 * direction * (partial.price / entryPrice - 1)
              : 0;
            unitPriceReturn = partialReturn + finalFraction * direction * (exit.price / entryPrice - 1);
          }
          candidates.push({
            strategyId: "PENGU_DUAL_LS_V2",
            symbol: "PENGUUSDT",
            signalReferenceTs: Number(source.features.referenceTs),
            entryTs,
            entryPrice,
            side: sideName,
            targetGross: spec.targetGross,
            entryVersion: spec.entryVersion,
            route,
            reason: spec.reason,
            exit,
            partial,
            unitPriceReturn,
            hardStopExit: Boolean(exit?.reason?.includes("HARD_STOP")),
            sourceRuntimeSha: manifest.runtime_sha,
          });
        }
        response = { ok: true, result: jsonSafe({
          runtimeSha: manifest.runtime_sha,
          recoveryV8Enabled: recoveryEnabled,
          candidateCount: candidates.length,
          entryVersions: candidates.reduce((acc, row) => {
            acc[row.entryVersion] = (acc[row.entryVersion] || 0) + 1;
            return acc;
          }, {}),
          candidates,
        }) };
      } else if (request.op === "q102FastSeries") {
        const candlesBySymbol = request.candlesBySymbol;
        const highVolSymbols = request.highVolSymbols;
        const symbols = request.symbols;
        const startMs = Number(request.startMs);
        const endMs = Number(request.endMs);
        if (!candlesBySymbol || !Array.isArray(highVolSymbols) || !Array.isArray(symbols)
            || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
          throw new Error("Q102_FAST_SERIES_INPUT_INVALID");
        }
        const valid = (row) => row
          && Number.isFinite(Number(row.timestampMs)) && Number(row.timestampMs) > 0
          && ["open", "high", "low", "close"].every((key) => Number.isFinite(Number(row[key])) && Number(row[key]) > 0)
          && Number.isFinite(Number(row.quoteVolume)) && Number(row.quoteVolume) >= 0
          && Number(row.high) >= Math.max(Number(row.open), Number(row.close))
          && Number(row.low) <= Math.min(Number(row.open), Number(row.close))
          && Number(row.high) >= Number(row.low);
        const meta = {};
        for (const [symbol, rows] of Object.entries(candlesBySymbol)) {
          const contiguousStart = new Array(rows.length);
          let currentStart = 0;
          for (let i = 0; i < rows.length; i += 1) {
            if (!valid(rows[i])) currentStart = i + 1;
            else if (i > 0 && (!valid(rows[i - 1])
              || Number(rows[i].timestampMs) - Number(rows[i - 1].timestampMs) !== Q102_HOUR)) currentStart = i;
            contiguousStart[i] = currentStart;
          }
          meta[symbol] = {
            rows,
            times: rows.map((row) => Number(row.timestampMs)),
            contiguousStart,
          };
        }
        const lowerBound = (times, target) => {
          let lo = 0, hi = times.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (times[mid] < target) lo = mid + 1; else hi = mid;
          }
          return lo;
        };
        const results = [];
        for (let decisionTs = Math.ceil(startMs / Q102_HOUR) * Q102_HOUR;
             decisionTs <= endMs; decisionTs += Q102_HOUR) {
          const historyRows = {};
          const entryOpenBySymbol = {};
          const monthStart = loaded.q102Pipeline.monthStartUtc(decisionTs - Q102_HOUR);
          const highVolEarliest = monthStart - Q102_TRAINING_DAYS * Q102_DAY - Q102_FEATURE_WARMUP * Q102_HOUR;
          const btcInfo = meta.BTCUSDT;
          let btcReady = false;
          if (btcInfo) {
            const currentIndex = lowerBound(btcInfo.times, decisionTs) - 1;
            if (currentIndex >= 0 && valid(btcInfo.rows[currentIndex])) {
              const segmentStart = btcInfo.contiguousStart[currentIndex];
              const desired = lowerBound(btcInfo.times, highVolEarliest);
              const start = Math.max(segmentStart, Math.min(desired, currentIndex));
              const slice = btcInfo.rows.slice(start, currentIndex + 1);
              historyRows.BTCUSDT = slice;
              btcReady = slice.length >= 181 * 24;
            }
          }
          const availableSymbols = [];
          const availableHighVol = [];
          for (const symbol of symbols) {
            const info = meta[symbol];
            if (!info) continue;
            const entryIndex = lowerBound(info.times, decisionTs);
            if (entryIndex >= info.rows.length || info.times[entryIndex] !== decisionTs) continue;
            const completedIndex = entryIndex - 1;
            if (completedIndex < 0 || !valid(info.rows[completedIndex])) continue;
            const segmentStart = info.contiguousStart[completedIndex];
            const segmentLength = completedIndex - segmentStart + 1;
            if (segmentLength < Q102_FEATURE_WARMUP) continue;
            const isHigh = highVolSymbols.includes(symbol) && btcReady;
            const desiredStartTs = isHigh ? highVolEarliest : decisionTs - Q102_FEATURE_WARMUP * Q102_HOUR;
            const desired = lowerBound(info.times, desiredStartTs);
            const start = Math.max(segmentStart, Math.min(desired, completedIndex));
            const slice = info.rows.slice(start, completedIndex + 1);
            historyRows[symbol] = slice;
            entryOpenBySymbol[symbol] = { timestampMs: decisionTs, open: info.rows[entryIndex].open };
            availableSymbols.push(symbol);
            if (isHigh && segmentLength >= 181 * 24) availableHighVol.push(symbol);
          }
          if (!availableSymbols.length || !availableHighVol.length || !historyRows.BTCUSDT) {
            results.push({
              decisionTs,
              signal: {
                strategyId: "QUALITY102_CAUSAL_V1", referenceTs: decisionTs,
                side: 0, requestedGross: 0, reason: "Q102_POINT_IN_TIME_UNIVERSE_NOT_READY",
                dataCutoffTs: decisionTs, brkEnabled: true,
              },
              availableSymbols, availableHighVol,
            });
            continue;
          }
          const history = { candlesBySymbol: historyRows, entryOpenBySymbol };
          try {
            const signal = q102FastSignal(history, decisionTs, availableHighVol);
            results.push({ decisionTs, signal, availableSymbols, availableHighVol });
          } catch (error) {
            results.push({
              decisionTs,
              error: error instanceof Error ? error.message.split("\n")[0] : "Q102_FAST_EVALUATION_FAILED",
              availableSymbols, availableHighVol,
            });
          }
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
