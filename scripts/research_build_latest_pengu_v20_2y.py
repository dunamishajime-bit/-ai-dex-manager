#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} marker count={count}; refusing silent patch")
    return text.replace(old, new, 1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", default=".pengu-current")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(args.source_root)
    src = root / "scripts" / "research_pengu_v2_aster_ledger.ts"
    tmp = root / "scripts" / ".research_pengu_latest_v20_2y.generated.ts"
    s = src.read_text(encoding="utf-8")
    s = replace_once(
        s,
        'import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";',
        'import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";\nimport { createPenguShortV20State } from "../lib/pengu-short-v20";',
        "V20 import",
    )
    s = replace_once(s, 'const WARM_START = Date.parse("2025-07-20T00:00:00Z");', 'const WARM_START = Date.parse("2024-07-01T00:00:00Z");', "warm start")
    s = replace_once(s, 'const EVAL_START = Date.parse("2025-08-10T00:00:00Z");', 'const EVAL_START = Date.parse("2024-08-10T00:00:00Z");', "eval start")
    s = replace_once(s, 'const EVAL_END = Date.parse("2026-08-10T00:00:00Z");', 'const EVAL_END = Date.parse("2026-08-10T00:00:00Z");', "eval end")
    s = replace_once(
        s,
        '  assert.ok(pengu.length >= 9_200 && btc.length >= 9_200, `Insufficient Aster rows: PENGU=${pengu.length}, BTC=${btc.length}`);',
        '''  const expectedEvalRows = Math.floor((EVAL_END - EVAL_START) / HOUR);
  const penguEvalRows = pengu.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;
  const btcEvalRows = btc.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;
  assert.ok(penguEvalRows >= 250, `Insufficient available PENGU rows: ${penguEvalRows}/${expectedEvalRows}`);
  assert.ok(btcEvalRows >= 250, `Insufficient available BTC rows: ${btcEvalRows}/${expectedEvalRows}`);''',
        "available coverage guard",
    )
    s = replace_once(
        s,
        '  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };',
        '''  const btcByTs = new Set(btc.map((row) => row.openTime));
  const alignedPengu = pengu.filter((row) => btcByTs.has(row.openTime));
  const penguByTs = new Set(alignedPengu.map((row) => row.openTime));
  const alignedBtc = btc.filter((row) => penguByTs.has(row.openTime));
  assert.equal(alignedPengu.length, alignedBtc.length, `PENGU/BTC common timestamp mismatch: PENGU=${alignedPengu.length}, BTC=${alignedBtc.length}`);
  assert.ok(alignedPengu.length >= 250, `Insufficient PENGU/BTC common rows: ${alignedPengu.length}`);
  const history: PenguDualLsV2History = { pengu1h: alignedPengu, btc1h: alignedBtc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };''',
        "history alignment",
    )
    s = replace_once(
        s,
        '''    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: targetGrossForAtr(rows[index].features!.atr24Ratio),
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
    };''',
        '''    const requestedGross = targetGrossForAtr(rows[index].features!.atr24Ratio, side === "L" ? 1 : -1);
    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: requestedGross,
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
      entryVersion: side === "S" ? "SHORT_V20" : "LONG_V2_FINAL",
      shortV20: side === "S" ? createPenguShortV20State({
        entryPrice: entry.open,
        requestedGross,
        entryAtr24Ratio: rows[index].features!.atr24Ratio,
        btcEma168Distance: rows[index].features!.btcEma168Distance,
        btcReturn24h: rows[index].features!.btcReturn24h,
      }) : undefined,
    };''',
        "position initializer",
    )
    s = replace_once(
        s,
        '  assert.ok(normalMetrics.trades >= 25 && normalMetrics.trades <= 40, `Implausible Aster production replay trade count: ${normalMetrics.trades}`);',
        '  assert.ok(normalMetrics.trades >= 25, `Insufficient available-period PENGU replay trade count: ${normalMetrics.trades}`);',
        "trade count guard",
    )
    s = replace_once(
        s,
        '    strategyId: PENGU_DUAL_LS_V2.id,\n    researchOnly: true,',
        '''    strategyId: PENGU_DUAL_LS_V2.id,
    longVariant: "PENGU_DUAL_LS_V2_FINAL_V56_SIDE_AWARE",
    shortVariant: "COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    shortPreRegistrationSha: "ad7cedb3cafaf9f9680e390112f72375d84b50ac",
    currentProductionSourceSha: process.env.PRODUCTION_SOURCE_SHA || null,
    researchOnly: true,''',
        "lineage marker",
    )
    s = replace_once(
        s,
        '    data: { penguRows: pengu.length, btcRows: btc.length, fundingRows: funding.length },',
        '''    data: {
      penguRows: alignedPengu.length,
      btcRows: alignedBtc.length,
      fundingRows: funding.length,
      availableStart: new Date(alignedPengu[0].openTime).toISOString(),
      availableEndExclusive: new Date(alignedPengu.at(-1)!.openTime + HOUR).toISOString(),
      requestedStart: new Date(EVAL_START).toISOString(),
      requestedEndExclusive: new Date(EVAL_END).toISOString(),
      coverageNote: "No pre-listing PENGU data is synthesized; replay begins at the first common Aster PENGU/BTC H1 timestamp.",
    },''',
        "data coverage marker",
    )
    tmp.write_text(s, encoding="utf-8")
    env = dict(os.environ)
    env["PENGU_LEDGER_OUT"] = str(Path(args.output).resolve())
    try:
        subprocess.run(["npx", "tsx", str(tmp)], check=True, env=env)
    finally:
        tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
