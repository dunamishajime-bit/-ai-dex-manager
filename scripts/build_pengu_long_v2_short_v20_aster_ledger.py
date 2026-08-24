#!/usr/bin/env python3
from pathlib import Path
import os
import subprocess

SRC = Path('scripts/research_pengu_v2_aster_ledger.ts')
TMP = Path('scripts/.research_pengu_v20_current_year.ts')


def replace_exact(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} not found; refusing silent patch')
    return text.replace(old, new, 1)


def main() -> None:
    s = SRC.read_text()
    s = replace_exact(
        s,
        'import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";',
        'import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";\nimport { createPenguShortV20State } from "../lib/pengu-short-v20";',
        'V20 import marker',
    )
    s = replace_exact(s, 'const WARM_START = Date.parse("2025-07-20T00:00:00Z");', 'const WARM_START = Date.parse("2025-07-01T00:00:00Z");', 'warm start')
    s = replace_exact(s, 'const EVAL_START = Date.parse("2025-08-10T00:00:00Z");', 'const EVAL_START = Date.parse("2025-08-01T00:00:00Z");', 'eval start')
    s = replace_exact(s, 'const EVAL_END = Date.parse("2026-08-10T00:00:00Z");', 'const EVAL_END = Date.parse("2026-08-01T00:00:00Z");', 'eval end')

    s = replace_exact(
        s,
        '  assert.ok(pengu.length >= 9_200 && btc.length >= 9_200, `Insufficient Aster rows: PENGU=${pengu.length}, BTC=${btc.length}`);',
        '''  const expectedEvalRows = Math.floor((EVAL_END - EVAL_START) / HOUR);
  const requiredWarmRows = 250;
  const penguEvalRows = pengu.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;
  const btcEvalRows = btc.filter((row) => row.openTime >= EVAL_START && row.openTime < EVAL_END).length;
  const penguWarmRows = pengu.filter((row) => row.openTime < EVAL_START).length;
  const btcWarmRows = btc.filter((row) => row.openTime < EVAL_START).length;
  assert.equal(penguEvalRows, expectedEvalRows, `Incomplete PENGU evaluation rows: ${penguEvalRows}/${expectedEvalRows}`);
  assert.equal(btcEvalRows, expectedEvalRows, `Incomplete BTC evaluation rows: ${btcEvalRows}/${expectedEvalRows}`);
  assert.ok(penguWarmRows >= requiredWarmRows && btcWarmRows >= requiredWarmRows, `Insufficient warm-up rows: PENGU=${penguWarmRows}, BTC=${btcWarmRows}, required=${requiredWarmRows}`);''',
        'row completeness guard',
    )
    s = replace_exact(
        s,
        '  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };',
        '''  const penguTimestamps = new Set(pengu.map((row) => row.openTime));
  const alignedBtc = btc.filter((row) => penguTimestamps.has(row.openTime));
  assert.equal(alignedBtc.length, pengu.length, `PENGU/BTC common-timestamp alignment incomplete: PENGU=${pengu.length}, BTC_ALIGNED=${alignedBtc.length}`);
  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: alignedBtc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };''',
        'history alignment',
    )
    s = replace_exact(
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
        '''    const requestedGross = targetGrossForAtr(rows[index].features!.atr24Ratio);
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
        'position initializer',
    )
    s = replace_exact(
        s,
        '    strategyId: PENGU_DUAL_LS_V2.id,\n    researchOnly: true,',
        '''    strategyId: PENGU_DUAL_LS_V2.id,
    longVariant: "PENGU_DUAL_LS_V2_FINAL",
    shortVariant: "COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    shortPreRegistrationSha: "ad7cedb3cafaf9f9680e390112f72375d84b50ac",
    researchOnly: true,''',
        'payload lineage marker',
    )
    TMP.write_text(s)
    env = dict(os.environ)
    env.setdefault('PRODUCTION_SOURCE_SHA', '8ca3f52b0da705c20aa4033769da1af869202f70')
    try:
        subprocess.run(['npx', 'tsx', str(TMP)], env=env, check=True)
    finally:
        TMP.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
