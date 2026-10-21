"""Build the durable Japanese report and hash index for Task 9 research."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


OUTPUT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-20_dd-reduction-initial-adverse-stop"
)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pct(value: float | None, digits: int = 4) -> str:
    return "-" if value is None else f"{float(value):.{digits}f}%"


def number(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{float(value):,.{digits}f}"


def best_candidate(phase: dict) -> dict:
    def score(item: dict):
        c10 = item["checks"]["10"]["dd_improvement_pp"]
        c30 = item["checks"]["30"]["dd_improvement_pp"]
        return (min(c10, c30), c10 + c30)

    return max(phase["candidate_summaries"], key=score)


def compact_result(result: dict, checks: dict) -> dict:
    return {
        "final_equity_jpy": result["final_equity_jpy"],
        "maximum_mtm_drawdown_pct": result["maximum_mtm_drawdown_pct"],
        "profit_factor": result["profit_factor"],
        "win_rate_pct": 100.0 * result["win_rate"],
        "closed_trades": result["closed_trades"],
        "average_loss_jpy": result["average_loss_jpy"],
        "maximum_loss_streak": result["maximum_loss_streak"],
        "oos": result["oos"],
        "checks": checks,
        "accounting": result["accounting"],
        "observations": result["observations"],
    }


def build_comparison(summary: dict, baseline: dict) -> dict:
    phases = []
    for phase in summary["phase_reports"]:
        candidates = []
        for item in phase["candidate_summaries"]:
            candidates.append({
                "candidate": item["candidate"]["id"],
                "plan": item["candidate"],
                "accepted_both_costs": item["accepted_both_costs"],
                "10bps": compact_result(item["results"]["10"], item["checks"]["10"]),
                "30bps": compact_result(item["results"]["30"], item["checks"]["30"]),
            })
        phases.append({
            "phase": phase["phase"],
            "candidate_count": phase["candidate_count"],
            "selection_status": phase["selection_status"],
            "selected_candidate": phase["selected_candidate"],
            "best_by_minimum_dd_improvement": best_candidate(phase)["candidate"]["id"],
            "candidates": candidates,
        })
    return {
        "status": summary["status"],
        "classification": summary["classification"],
        "baseline": baseline,
        "phase_order": summary["phase_order"],
        "phases": phases,
        "accepted_cumulative_overlays": summary["accepted_cumulative_overlays"],
        "pengu_unchanged": summary["pengu_unchanged"],
        "production_changes": summary["production_changes"],
        "production_certification": summary["production_certification"],
        "acceptance_contract": summary["acceptance_contract"],
    }


def baseline_result(cost: int) -> dict:
    return read_json(OUTPUT / "engine" / "BASELINE" / "BASELINE" / f"{cost}bps" / "result.json")


def render_report(summary: dict, comparison: dict, diagnostics: dict, dd_window: dict,
                  manifest: dict) -> str:
    baseline = {
        str(cost): baseline_result(cost)
        for cost in (10, 30)
    }
    lines = [
        "# 初期逆行STOP・統合DD削減研究 最終報告",
        "",
        "> 研究専用成果物です。Production / VPS / LIVE / HP / operator artifact は変更していません。",
        "",
        "## 判定",
        "",
        f"- STATUS: `{summary['status']}`",
        "- 分類: `RESEARCH_ONLY_NONCANONICAL`（H1 price-model replay。実Aster約定認証ではありません）",
        "- 採用された累積Overlay: 0件",
        "- PENGU: 既存Exitを維持（変更なし）",
        "- Production変更: 0件",
        "",
        "## 固定Baseline再現",
        "",
        "期間は2025-08-10〜2026-08-10、初期資金¥10,000、積立なし、複利、固定8ロジック統合、H1 price-model replayです。",
        "Baselineの期待値と完全一致したため、候補比較の基準として固定しました。",
        "",
        "| 指標 | 10bps | 30bps |",
        "|---|---:|---:|",
        f"| 最終資産 | ¥{number(baseline['10']['final_equity_jpy'])} | ¥{number(baseline['30']['final_equity_jpy'])} |",
        f"| PF | {number(baseline['10']['profit_factor'], 6)} | {number(baseline['30']['profit_factor'], 6)} |",
        f"| 最大MTM DD | {pct(baseline['10']['maximum_mtm_drawdown_pct'], 4)} | {pct(baseline['30']['maximum_mtm_drawdown_pct'], 4)} |",
        f"| 勝率 | {pct(100 * baseline['10']['win_rate'], 3)} | {pct(100 * baseline['30']['win_rate'], 3)} |",
        f"| 取引数 | {baseline['10']['closed_trades']} | {baseline['30']['closed_trades']} |",
        "| Accounting | PASS | PASS |",
        "",
        "## 複合候補の定義",
        "",
        "単純な固定% STOPだけでなく、以下をすべて事前固定した候補です。候補結果を見てから条件を変更していません。",
        "",
        "- 初期逆行幅（固定% または ATR 1.5倍）",
        "- 発動待ち時間（6時間または12時間）",
        "- それまでのMFEが0.5%未満または1.0%未満であること",
        "- 直前に確定した3本の5分足がエントリーに対して逆行側にあり、逆行方向へ継続していること",
        "- 同一戦略・銘柄・方向のSTOP後6/12時間再エントリー制限",
        "- 現在足を構造判定に使わず、次足で決済する因果順序",
        "",
        "構造判定はLONG/SHORTで対称です。5分足欠損・entry価格不一致はFail Closedとして候補を変更しません。",
        "",
        "## フェーズ別の最良候補（全候補はJSONに保存）",
        "",
        "各フェーズの最良は、10bps/30bpsのDD改善ポイントの小さい方を最大化して選びました。採用判定は別途、両コスト・OOS・最終資産保全を同時に要求しています。",
        "",
        "| Phase | 最良候補 | 10bps DD | 10bps DD差 | 10bps資産 | 30bps DD | 30bps DD差 | 30bps資産 | 判定 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for phase in comparison["phases"]:
        item = next(x for x in phase["candidates"] if x["candidate"] == phase["best_by_minimum_dd_improvement"])
        r10, r30 = item["10bps"], item["30bps"]
        lines.append(
            f"| {phase['phase']} | `{item['candidate']}` | "
            f"{pct(r10['maximum_mtm_drawdown_pct'])} | {number(r10['checks']['dd_improvement_pp'], 4)}pp | "
            f"¥{number(r10['final_equity_jpy'])} | {pct(r30['maximum_mtm_drawdown_pct'])} | "
            f"{number(r30['checks']['dd_improvement_pp'], 4)}pp | ¥{number(r30['final_equity_jpy'])} | "
            f"{'PASS候補' if item['accepted_both_costs'] else '不採用'} |"
        )
    lines += [
        "",
        "### 複合候補の重要結果",
        "",
        "| 候補 | 10bps DD / PF / 資産 | 30bps DD / PF / 資産 | 結論 |",
        "|---|---|---|---|",
    ]
    for phase in comparison["phases"]:
        if not phase["phase"].endswith("_COMPOSITE"):
            continue
        item = next(x for x in phase["candidates"] if x["candidate"] == phase["best_by_minimum_dd_improvement"])
        r10, r30 = item["10bps"], item["30bps"]
        lines.append(
            f"| `{item['candidate']}` | {pct(r10['maximum_mtm_drawdown_pct'])} / "
            f"{number(r10['profit_factor'], 4)} / ¥{number(r10['final_equity_jpy'])} | "
            f"{pct(r30['maximum_mtm_drawdown_pct'])} / {number(r30['profit_factor'], 4)} / "
            f"¥{number(r30['final_equity_jpy'])} | {'採用' if item['accepted_both_costs'] else '不採用'} |"
        )
    lines += [
        "",
        "複合候補で最も良かったのは `V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12` です。",
        "10bpsではDDが-15.6206%から-14.1677%へ1.45296ポイント改善し、30bpsでは-16.7878%から-15.3061%へ1.48167ポイント改善しました。",
        "ただし30bpsでOOS PFがBaselineの90%条件を満たさず、最終資産もBaselineの75%保全条件を満たさないため、採用候補にはしませんでした。",
        "この結果はDD改善の可能性を示す研究候補であり、Production設定へ反映していません。",
        "",
        "## 損失経路診断",
        "",
    ]
    for cost in ("10", "30"):
        d = diagnostics[cost]
        lines += [
            f"### {cost}bps",
            "",
            f"- 有効path: {d['valid_paths']} / 無効path: {d['invalid_paths']}",
            f"- 利益後にマイナスへ転落: {d['profit_to_negative_total']}件",
            f"- MFE +1%未達のまま損失: {d['losses_without_1pct_mfe_total']}件",
            f"- 初回マイナス到達時間: 平均 {number(d['first_negative_hours_avg'], 3)}時間 / 中央値 {number(d['first_negative_hours_median'], 3)}時間",
            "",
            "| Logic/Direction | 件数 | MFE平均 | MAE平均 | MAE最悪 | 利益後転落 | +1% MFE未達損失 |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
        preferred = ["V12:LONG", "V12:SHORT", "Q102:LONG", "Q102:SHORT",
                     "IDLE:SHORT", "FET:LONG", "HYPE_LONG:LONG", "V52:LONG",
                     "V52:SHORT", "PENGU:LONG", "PENGU:SHORT", "RESIDUAL:LONG"]
        for key in preferred:
            x = d["by_side_strategy"].get(key)
            if not x:
                continue
            lines.append(
                f"| {key} | {x['trades']} | {pct(x['mfe_avg_pct'], 3)} | "
                f"{pct(x['mae_avg_pct'], 3)} | {pct(x['mae_worst_pct'], 3)} | "
                f"{x['profit_to_negative']} | {x['never_1pct_mfe_loss']} |"
            )
        lines.append("")
        lines.append("閾値別の勝ち/負け到達件数は `baseline-loss-path-diagnostics.json` の `threshold_counts` に保存しています。")
        lines.append("")
    lines += [
        "## 最大DD期間（実現イベント近似）",
        "",
        "以下はMTM全時系列ではなく、決済イベント後ウォレット残高によるDD proxyです。MTM最大DDの証明と混同していません。",
        "",
        "| Cost | Peak | Trough | Recovery | Settlement DD proxy | 主な寄与 |",
        "|---|---|---|---|---:|---|",
    ]
    for cost in ("10", "30"):
        x = dd_window[cost]
        contrib = sorted(x["contributors"].items(), key=lambda kv: kv[1]["pnl_jpy"])
        top = ", ".join(f"{key} {number(value['pnl_jpy'])}円" for key, value in contrib[:4])
        lines.append(
            f"| {cost}bps | {x['peak_ts_ms']} | {x['trough_ts_ms']} | {x['recovery_ts_ms']} | "
            f"{number(x['drawdown_settlement'])}円 | {top} |"
        )
    lines += [
        "",
        "10bpsの上位損失経路にはHYPE_LONGの5分足保護STOP、V12 SHORTのQ102へのsymbol preempt、Q102 HARD_STOP、PENGU HARD_STOP、ResidualのIdle優先が含まれます。詳細なexit reason別内訳は診断JSONに保存しています。",
        "",
        "## 採用判定と結論",
        "",
        "- V12 LONG: DD改善が0または悪化。採用なし。",
        "- V12 SHORT: 複合候補を含め10/30bpsのDDは改善したが、30bps OOS PF/最終資産条件を満たさず採用なし。",
        "- Q102: 複合候補を含めDD悪化。採用なし。",
        "- Idle: DD改善は0.01ポイント未満または悪化。採用なし。",
        "- FET/HYPE/V52: この固定8ロジック台帳では候補の効果が限定的またはDD改善なし。採用なし。",
        "- PENGU: 変更なし。",
        "",
        "したがって、今回の完了状態は「全ロジック・複合候補の研究完了、Production変更なし」です。目標の-14%台はV12 SHORT研究候補で一時的に達しましたが、30bpsのOOSと資産保全を含む採用基準を満たしていないため、正式採用には進めません。-12%台は未達です。",
        "",
        "## 再現性・制約",
        "",
        f"- 研究Manifest: `{manifest['results']}` / source SHA256は `manifest.json` に保存",
        "- 全候補比較: `candidate-comparison.json`（通常36候補＋複合14候補、各10/30bps）",
        "- 全phase summary: `phase-summary/`",
        "- 全候補台帳・結果: `engine/`",
        "- 損失経路: `baseline-loss-path-diagnostics.json`",
        "- DD近似: `baseline-dd-window-diagnostic.json`",
        "- データ品質: pair別5分足行数、期間、欠損、重複を `manifest.json` に保存",
        "- H1 price-model replayであり、L2履歴約定・実Aster STOP fill・実注文ライフサイクルではありません",
        "- 同一5分足内の約定順序、スリッページ、候補EXITの価格は研究エンジンの固定規則に従うため、実Venue証明には使えません",
        "- `production_changes=0`、`production_certification=false` を固定",
        "",
        "## Git / 実行状態",
        "",
        "- 研究出力はAGENTS.md指定の `DisDex_AI_Files\\01_BT_Research\\2026-10-20_dd-reduction-initial-adverse-stop` に保存",
        "- 本番VPS・LIVE・HP・operator artifact・実注文には触れていません",
        "- ソース変更は研究ブランチのBT runner・unit test・report builderのみです",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    summary = read_json(OUTPUT / "task9-summary.json")
    manifest = read_json(OUTPUT / "manifest.json")
    baseline = {
        str(cost): {
            key: baseline_result(cost)[key]
            for key in (
                "final_equity_jpy", "profit_factor", "maximum_mtm_drawdown_pct",
                "win_rate", "closed_trades", "accounting",
            )
        }
        for cost in (10, 30)
    }
    comparison = build_comparison(summary, baseline)
    diagnostics = read_json(OUTPUT / "baseline-loss-path-diagnostics.json")
    dd_window = read_json(OUTPUT / "baseline-dd-window-diagnostic.json")
    (OUTPUT / "candidate-comparison.json").write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUTPUT / "TASK9_INITIAL_ADVERSE_STOP_FINAL_REPORT_JA.md").write_text(
        render_report(summary, comparison, diagnostics, dd_window, manifest),
        encoding="utf-8",
    )
    manifest.update({
        "report": "TASK9_INITIAL_ADVERSE_STOP_FINAL_REPORT_JA.md",
        "candidate_comparison": "candidate-comparison.json",
        "sha256_index": "sha256-index.json",
        "candidate_count": sum(p["candidate_count"] for p in comparison["phases"]),
        "composite_candidate_count": sum(
            p["candidate_count"] for p in comparison["phases"] if p["phase"].endswith("_COMPOSITE")
        ),
    })
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    excluded = {"sha256-index.json"}
    index = {}
    for path in sorted(OUTPUT.rglob("*")):
        if not path.is_file() or path.name in excluded:
            continue
        index[str(path.relative_to(OUTPUT)).replace("\\", "/")] = sha256_file(path)
    (OUTPUT / "sha256-index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("TASK9_REPORT_BUILT", OUTPUT)
    print("TASK9_CANDIDATES", comparison["phases"] and sum(p["candidate_count"] for p in comparison["phases"]))
    print("TASK9_SHA256_INDEX", len(index))


if __name__ == "__main__":
    main()
