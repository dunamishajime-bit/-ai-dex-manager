from __future__ import annotations

import argparse
import concurrent.futures
import json
from pathlib import Path
from typing import Dict, List, Tuple

import v96_stock_cross_venue_perp_v12 as v12


def corrected_load_xyz(cache_dir: Path) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], dict]:
    meta = v12.load_xyz_meta(cache_dir)
    missing = [symbol for symbol in v12.SYMBOLS if v12.XYZ_COIN[symbol] not in meta["names"]]
    candles: Dict[str, List[dict]] = {}
    funding: Dict[str, List[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        candle_futures = {
            pool.submit(v12.fetch_xyz_candles, symbol, cache_dir): symbol
            for symbol in v12.SYMBOLS if symbol not in missing
        }
        for future in concurrent.futures.as_completed(candle_futures):
            symbol = candle_futures[future]
            candles[symbol] = future.result()
            print(f"loaded XYZ candles {symbol}: {len(candles[symbol])}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        funding_futures = {
            pool.submit(v12.fetch_xyz_funding, symbol, cache_dir): symbol
            for symbol in v12.SYMBOLS if symbol not in missing
        }
        for future in concurrent.futures.as_completed(funding_futures):
            symbol = funding_futures[future]
            funding[symbol] = future.result()
            print(f"loaded XYZ funding {symbol}: {len(funding[symbol])}")
    diagnostics = {
        "dex": "xyz",
        "metaNames": meta["names"],
        "missingSymbols": missing,
        "symbols": {
            symbol: {
                "coin": v12.XYZ_COIN[symbol],
                "candles": len(candles.get(symbol, [])),
                "fundingRows": len(funding.get(symbol, [])),
            }
            for symbol in v12.SYMBOLS
        },
    }
    return candles, funding, diagnostics


def self_test() -> None:
    v12.self_test()
    fake_names = [v12.XYZ_COIN[symbol] for symbol in v12.SYMBOLS]
    assert all(v12.XYZ_COIN[symbol] in fake_names for symbol in v12.SYMBOLS)
    print("V96 Stock Cross-Venue Perp V12B prefix fix self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aster-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--aster-funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--xyz-cache-dir", default=".cache/v96-stock-cross-venue-v12")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cross-venue-v12")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    v12.load_xyz = corrected_load_xyz
    result = v12.analyze(
        Path(args.aster_cache_dir),
        Path(args.aster_funding_cache_dir),
        Path(args.xyz_cache_dir),
    )
    v12.write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
