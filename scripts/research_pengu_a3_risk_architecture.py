from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

START = "2025-08-23T15:00:00Z"
END = "2026-08-23T15:00:00Z"
WARM = "2025-08-01T00:00:00Z"
EXPECTED = {
    "startInclusive": "2025-08-23T15:00:00.000Z",
    "endExclusive": "2026-08-23T15:00:00.000Z",
}
PROD_SHA = "ac254e897b7514d14c3a34c0679388978b5c3d32"


def patch_harness(source: Path, target: Path) -> None:
    s = source.read_text()
    s = s.replace('const WARM_START = Date.parse("2025-07-20T00:00:00Z");', f'const WARM_START = Date.parse("{WARM}");')
    s = s.replace('const EVAL_START = Date.parse("2025-08-10T00:00:00Z");', f'const EVAL_START = Date.parse("{START}");')
    s = s.replace('const EVAL_END = Date.parse("2026-08-10T00:00:00Z");', f'const EVAL_END = Date.parse("{END}");')
    s = s.replace('type Reason = "hard" | "trail" | "time";', 'type Reason = "hard" | "trail" | "time" | "failfast";')

    a = s.index('function replay(history: PenguDualLsV2History, funding: FundingPoint[], mode: Mode) {')
    b = s.index('\nfunction metrics(trades: LedgerTrade[]) {', a)
    replay = r'''function replay(history: PenguDualLsV2History, funding: FundingPoint[], mode: Mode) {
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);
  const trades: LedgerTrade[] = [];
  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_ADVERSE_SLIPPAGE_PER_SIDE : 0);
  const a3Mode = String(process.env.A3_MODE || "REL_STAGE");
  let index = 250;
  let cooldown = -1;
  while (index < rows.length - 2) {
    if (index <= cooldown) { index += 1; continue; }
    const side: Side | undefined = rows[index].shortSignal ? "S" : rows[index].longSignal ? "L" : undefined;
    if (!side || !rows[index].features) { index += 1; continue; }
    const entryIndex = index + 1;
    const entry = rows[entryIndex].candle;
    const targetGross = targetGrossForAtr(rows[index].features!.atr24Ratio);
    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: targetGross,
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
    };
    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);
    let exitIndex = last;
    let exitPrice = rows[last].candle.close;
    let exitReason: Reason = "time";
    let firstBarExited = false;

    for (let cursor = entryIndex; cursor <= last; cursor += 1) {
      const features = rows[cursor].features;
      assert(features, `Production features missing at ${cursor}`);
      const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {
        exitIndex = cursor;
        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
        exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";
        firstBarExited = cursor === entryIndex;
        break;
      }
      if (side === "S" && cursor === entryIndex && a3Mode === "FAIL_FAST_REL") {
        const pRet = rows[cursor].candle.close / entry.open - 1;
        const bRet = rows[cursor].btcCandle.close / rows[cursor].btcCandle.open - 1;
        const confirmed = pRet < 0 && pRet < bRet;
        if (!confirmed && cursor + 1 < rows.length) {
          exitIndex = cursor + 1;
          exitPrice = rows[cursor + 1].candle.open;
          exitReason = "failfast";
          break;
        }
      }
    }

    if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) {
      const exitTs = rows[exitIndex].candle.openTime;
      const baseFundingRate = fundingBetween(funding, entry.openTime, exitTs);
      const baseFundingUnitReturn = side === "L" ? -baseFundingRate : baseFundingRate;
      const baseRawUnitReturn = side === "L" ? exitPrice / entry.open - 1 : entry.open / exitPrice - 1;
      const baseCostUnitReturn = -2 * costPerSide;
      let deployedGross = targetGross;
      let accountReturn: number;
      let rawUnitReturn = baseRawUnitReturn;
      let fundingUnitReturn = baseFundingUnitReturn;
      let costUnitReturn = baseCostUnitReturn;
      let netUnitReturn = baseRawUnitReturn + baseFundingUnitReturn + baseCostUnitReturn;

      if (side === "S" && (a3Mode === "REL_STAGE" || a3Mode === "PRICE_STAGE")) {
        const starterGross = targetGross / 3;
        const addGross = targetGross - starterGross;
        const starterNet = baseRawUnitReturn + baseFundingUnitReturn + baseCostUnitReturn;
        accountReturn = starterGross * starterNet;
        deployedGross = starterGross;

        if (!firstBarExited && entryIndex + 1 < rows.length && exitIndex > entryIndex) {
          const confirm = rows[entryIndex];
          const pRet = confirm.candle.close / entry.open - 1;
          const bRet = confirm.btcCandle.close / confirm.btcCandle.open - 1;
          const confirmed = a3Mode === "PRICE_STAGE" ? pRet < 0 : (pRet < 0 && pRet < bRet);
          if (confirmed) {
            const addEntryTs = rows[entryIndex + 1].candle.openTime;
            const addEntry = rows[entryIndex + 1].candle.open;
            const addFundingRate = fundingBetween(funding, addEntryTs, exitTs);
            const addRaw = addEntry / exitPrice - 1;
            const addNet = addRaw + addFundingRate - 2 * costPerSide;
            accountReturn += addGross * addNet;
            deployedGross = targetGross;
            rawUnitReturn = (starterGross * baseRawUnitReturn + addGross * addRaw) / targetGross;
            fundingUnitReturn = (starterGross * baseFundingUnitReturn + addGross * addFundingRate) / targetGross;
            costUnitReturn = -2 * costPerSide;
            netUnitReturn = accountReturn / targetGross;
          } else {
            rawUnitReturn = baseRawUnitReturn;
            fundingUnitReturn = baseFundingUnitReturn;
            costUnitReturn = baseCostUnitReturn;
            netUnitReturn = starterNet;
          }
        }
      } else {
        accountReturn = targetGross * netUnitReturn;
      }

      trades.push({
        side,
        signalTs: rows[index].candle.openTime,
        entryTs: entry.openTime,
        exitTs,
        entryPrice: entry.open,
        exitPrice,
        requestedGross: deployedGross,
        rawUnitReturn,
        fundingUnitReturn,
        costUnitReturn,
        netUnitReturn,
        accountReturn,
        exitReason,
      });
    }
    cooldown = exitIndex + PENGU_DUAL_LS_V2.cooldownHours;
    index = exitIndex + 1;
  }
  return trades;
}
'''
    s = s[:a] + replay + s[b:]

    old = '''  assert.ok(pengu.length >= 9_200 && btc.length >= 9_200, `Insufficient Aster rows: PENGU=${pengu.length}, BTC=${btc.length}`);\n  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };'''
    new = '''  const expectedEvalRows = Math.floor((EVAL_END - EVAL_START) / HOUR);\n  const penguEvalRows = pengu.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;\n  const btcEvalRows = btc.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;\n  assert.equal(penguEvalRows, expectedEvalRows);\n  assert.equal(btcEvalRows, expectedEvalRows);\n  const penguTimestamps = new Set(pengu.map((row) => row.openTime));\n  const alignedBtc = btc.filter((row) => penguTimestamps.has(row.openTime));\n  assert.equal(alignedBtc.length, pengu.length);\n  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: alignedBtc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };'''
    if old not in s:
        raise RuntimeError("history patch target missing")
    s = s.replace(old, new)
    s = s.replace(
        '''  assert.ok(normalMetrics.trades >= 25 && normalMetrics.trades <= 40, `Implausible Aster production replay trade count: ${normalMetrics.trades}`);\n  assert.ok(normalMetrics.returnPct > 0 && finiteMetric(normalMetrics.profitFactor) > 1.5, `Aster production replay lost its normal edge: ${JSON.stringify(normalMetrics)}`);\n  assert.ok(stressMetrics.returnPct > 0 && finiteMetric(stressMetrics.profitFactor) > 1.2, `Aster production replay lost its stress edge: ${JSON.stringify(stressMetrics)}`);''',
        '''  assert.ok(normalMetrics.trades > 0);\n  assert.ok(stressMetrics.trades > 0);''',
    )
    target.write_text(s)


def run_variant(harness: Path, out_path: Path, mode: str, log_path: Path) -> None:
    env = os.environ.copy()
    env.update({"A3_MODE": mode, "PENGU_LEDGER_OUT": str(out_path), "PRODUCTION_SOURCE_SHA": PROD_SHA})
    with log_path.open("w") as log:
        proc = subprocess.run(["npx", "tsx", str(harness)], stdout=log, stderr=subprocess.STDOUT, env=env)
    if proc.returncode:
        raise RuntimeError(f"A3 variant failed: {mode}; see {log_path}")


def detail(payload: dict, mode: str) -> dict:
    rows = payload["modes"][mode]["trades"]
    metrics = payload["modes"][mode]["metrics"]
    reasons = Counter(row["exitReason"] for row in rows)
    months: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        key = datetime.fromtimestamp(row["exitTs"] / 1000, tz=timezone.utc).strftime("%Y-%m")
        months[key].append(float(row["accountReturn"]))
    monthly: dict[str, float] = {}
    for key, values in sorted(months.items()):
        equity = 1.0
        for value in values:
            equity *= 1 + value
        monthly[key] = (equity - 1) * 100
    return {"metrics": metrics, "exitReasons": dict(reasons), "monthlyReturnPct": monthly}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    baseline = json.loads((input_dir / "baseline.json").read_text())
    a = json.loads((input_dir / "a-rsi45.json").read_text())
    assert baseline["period"] == EXPECTED and a["period"] == EXPECTED

    harness = Path("scripts/.pengu_a3_runtime.ts")
    patch_harness(Path("scripts/research_pengu_v2_aster_ledger.ts"), harness)
    try:
        specs = {
            "A3_REL_STAGE": ("REL_STAGE", "rel_stage.json"),
            "A3_PRICE_STAGE": ("PRICE_STAGE", "price_stage.json"),
            "A3_FAIL_FAST_REL": ("FAIL_FAST_REL", "fail_fast_rel.json"),
        }
        for key, (mode, filename) in specs.items():
            run_variant(harness, output_dir / filename, mode, output_dir / f"{key.lower()}.log")
    finally:
        harness.unlink(missing_ok=True)

    payloads = {
        "BASELINE": baseline,
        "A_RSI45": a,
        "A3_REL_STAGE": json.loads((output_dir / "rel_stage.json").read_text()),
        "A3_PRICE_STAGE": json.loads((output_dir / "price_stage.json").read_text()),
        "A3_FAIL_FAST_REL": json.loads((output_dir / "fail_fast_rel.json").read_text()),
    }
    definitions = {
        "BASELINE": "current PENGU V2",
        "A_RSI45": "short RSI14 <=45 entry gate",
        "A3_REL_STAGE": "short starts at 1/3 target gross; add remaining 2/3 after first H1 only if PENGU is down and weaker than BTC",
        "A3_PRICE_STAGE": "short starts at 1/3 target gross; add remaining 2/3 after first H1 only if PENGU is down",
        "A3_FAIL_FAST_REL": "short enters full target gross; if first H1 is not down and weaker than BTC, exit next open",
    }
    variants: dict[str, dict] = {}
    for key, payload in payloads.items():
        assert payload["period"] == EXPECTED
        assert payload["safety"] == {"ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False}
        variants[key] = {
            "definition": definitions[key],
            "NORMAL": detail(payload, "normal"),
            "SEVERE": detail(payload, "stress"),
        }

    summary: dict[str, dict] = {}
    for key, value in variants.items():
        normal = value["NORMAL"]["metrics"]
        severe = value["SEVERE"]["metrics"]
        summary[key] = {
            "normalReturnPct": normal["returnPct"],
            "normalPF": normal["profitFactor"],
            "normalDDPct": normal["maxDrawdownPct"],
            "normalWinRatePct": normal["winRatePct"],
            "normalTrades": normal["trades"],
            "severeReturnPct": severe["returnPct"],
            "severePF": severe["profitFactor"],
            "severeDDPct": severe["maxDrawdownPct"],
            "july2026Pct": value["NORMAL"]["monthlyReturnPct"].get("2026-07", 0.0),
            "hardStops": value["NORMAL"]["exitReasons"].get("hard", 0),
            "failFast": value["NORMAL"]["exitReasons"].get("failfast", 0),
        }

    result = {
        "status": "PASS_RESEARCH_ONLY",
        "schema": "pengu-a3-risk-architecture-recent-365d/v1",
        "period": EXPECTED,
        "selectionPolicy": "three structurally different A3 variants were fixed before execution; no RSI threshold retuning or post-result candidate mutation",
        "variants": variants,
        "summary": summary,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    }
    (output_dir / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
