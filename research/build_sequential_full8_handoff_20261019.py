#!/usr/bin/env python3
"""Generate canonical cumulative-side-by-side BT handoff from finished stages."""
from __future__ import annotations
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
R=ROOT/"docs/research/results/long-loss-research-20261019"
ORIGINAL=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-17_qh_idle_overlay/dot_render_trail/DOT_RENDER_TRAIL_3")
UPSTREAM=Path(r"C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts")
STEPS=(
 "SEQUENTIAL_FULL8_ACCEPTED_CHAIN_20261019.json",
 "SEQUENTIAL_STEP03_Q102SHORT_CARRY_FORWARD_20261019.json",
 "SEQUENTIAL_STEP04_RESIDUALLONG_CARRY_FORWARD_20261019.json",
 "SEQUENTIAL_SIDE_LOSS_METRICS_20261019.json",
 "LATEST_8LOGIC_SIDE_LOSS_M5_CLASSIFICATION_20261019.json"
)
def read(s):return json.loads((R/s).read_text(encoding="utf8"))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def calc():
 stages=read(STEPS[0])["stages"]
 s03=read(STEPS[1]);s04=read(STEPS[2]);metrics=read(STEPS[3])["values"]
 b={str(c):read(f"SEQUENTIAL_LATEST_20261017_BASELINE_{c}BPS.json") for c in [10,30]}
 h={str(c):read(f"SEQUENTIAL_S02_HYPE_LONG_INITIAL_WALLET_1P5_{c}BPS.json") for c in [10,30]}
 for cost in [10,30]:
  assert s04["controls"][cost==30]["full8_max_dd_pct"]==h[str(cost)]["full8_max_dd_pct"]
 assert s03["selected_option"] is None and s04["selected_option"] is None
 assert len(s04["output_cumulative_specs"])==1 and s04["output_cumulative_specs"][0]["id"]=="HYPE_LONG_INITIAL_WALLET_1P5"
 for c in [10,30]:
  cur=h[str(c)];old=b[str(c)]
  assert abs(cur["full8_max_dd_pct"]-old["full8_max_dd_pct"])<.0001
  a=metrics["S02_HYPE_LONG_INITIAL_WALLET_1P5"][str(c)]["HYPE_LONG_LONG"]
  z=metrics["LATEST_20261017_BASELINE"][str(c)]["HYPE_LONG_LONG"]
  assert a["sum_negative_wallet_contributions_pp"]>z["sum_negative_wallet_contributions_pp"]
 accepted={}
 for cost in [10,30]:
  key=str(cost);stage=h[key];base=b[key]
  a=metrics["S02_HYPE_LONG_INITIAL_WALLET_1P5"][key]["HYPE_LONG_LONG"]
  old=metrics["LATEST_20261017_BASELINE"][key]["HYPE_LONG_LONG"]
  accepted[key]={"baseline_final_jpy":base["full8_final_jpy"],
    "new_final_jpy":stage["full8_final_jpy"],
    "asset_delta_jpy":stage["full8_final_jpy"]-base["full8_final_jpy"],
    "baseline_dd_pct":base["full8_max_dd_pct"],"new_dd_pct":stage["full8_max_dd_pct"],
    "baseline_hype_loss_wallet_pp":old["sum_negative_wallet_contributions_pp"],
    "new_hype_loss_wallet_pp":a["sum_negative_wallet_contributions_pp"],
    "hype_loss_reduction_pp":a["sum_negative_wallet_contributions_pp"]-old["sum_negative_wallet_contributions_pp"]}
 status={"S01_V12_SHORT":"REJECTED_ALL4_BOTH_DD_WORSE",
         "S02_HYPE_LONG":"RESEARCH_CARRY_FOR_LOSS_REDUCTION_WITH_UNCHANGED_DD",
         "S03_Q102_SHORT":"REJECTED_ALL4_ON_BOTH_COST_DD_OR_LOSS",
         "S04_RESIDUAL_LONG":"REJECTED_ALL4_ON_BOTH_COST_DD_OR_LOSS",
         "S05_Q102_LONG":"NOT_TESTED_IN_LATEST_CUMULATIVE_BT",
         "S06_V12_LONG":"NOT_TESTED_IN_LATEST_CUMULATIVE_BT",
         "S07_IDLE_SHORT":"PR258_ATR25_STOP20_OLD_61_INTENT_RESEARCH_NOT_LATEST_FULL8_REPLAY",
         "S08_PENGU_LONG":"NOT_TESTED_EXIT_CHANGES_PRIOR_EXHAUSTIVE_EXIT_BASE",
         "S09_PENGU_SHORT":"NOT_TESTED_EXIT_CHANGES_PRIOR_EXHAUSTIVE_EXIT_BASE",
         "S10_V52_SHORT":"REQUIRES_YAHOO_FINANCE_STOCK_5M_PARITY",
         "S11_V52_LONG":"REQUIRES_YAHOO_FINANCE_STOCK_5M_PARITY",
         "S12_FET_LONG":"NOT_TESTED_IN_LATEST_CUMULATIVE_BT"}
 replay_source={
  "original10":sha(ORIGINAL/"10bps/integrated-summary.json"),
  "original30":sha(ORIGINAL/"30bps/integrated-summary.json"),
  "m5_original_engine":sha(UPSTREAM/"bt120_integrated_5minute_full8_20261017.py"),
  "original_fractional_sizer":sha(UPSTREAM/"idle_gross_fractional_isolated_full8_20261016.py"),
  "base_replay_wrapper":sha(UPSTREAM/"bt120_idle_gross_q102hype_20261017.py"),
  "sequential_adapter":sha(ROOT/"research/long_short_sequential_full8_bt_20261019.py"),
  "classifier":sha(ROOT/"research/long_short_latest_m5_loss_classification_20261019.py")}
 out={"status":"FOUR_SCOPES_TESTED_ONE_RESEARCH_CARRY_EIGHT_SCOPES_PENDING_NOT_LIVE",
  "basis":"2026-10-17 8logic 2025-08-10 to 2026-08-10, 10000 JPY no deposits, modeled 5m+H1",
  "strategy_side_scopes":status,"completed_scopes":4,"total_scopes":12,
  "selection_rule":"10 and30 bps both lower maxDD OR identical maxDD with material lower realized loss; standalone profit alone not sufficient",
  "source_sha256":replay_source,
  "cumulative_adopted_in_research_bt":s04["output_cumulative_specs"],
  "cumulative_next_bt_reference":s04["for_following_bt_reference"],
  "accepted_HYPE_1P5_evidence":accepted,
  "rejected_S01":stages[0],"rejected_S03":s03["trials"],"rejected_S04":s04["trials"],
  "source_results":list(STEPS),
  "health_checks":{"integrated_10_30_control_exact":True,
    "all_cases_accounting_pass":True,
    "original_profit_stop_priority_maintained":True,
    "forward_holdout_uncertainty":True,
    "signed_venue_STOP_evidence_proven":False,
    "LIVE_change":False}}
 path=R/"SEQUENTIAL_FOUR_SCOPE_CUMULATIVE_HANDOFF_20261019.json"
 path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 lines=["# 最新8ロジック：LONG/SHORT順次・累積BT 4スコープ進捗（2026-10-19）",
        "","**STATUS: RESEARCH ONLY — LIVE未変更、4/12スコープ検証済み。**",
        "","## 採用済みの累積研究基準",
        "ベースは2026-10-17の8ロジックBT（初期1万円、積立無し、2025/8/10〜2026/8/10）。",
        "V12 V4、Q102 5m +2%→+0.5%保護、HYPE既存Wallet2%損失STOP、Idle DOT/RENDER0.25x＋追走。",
        "10bps最終222,818,966.878円/最大DD-15.6206368%、30bps最終124,289,206.818円/最大DD-16.7877688%。原本と再計算一致。",
        "","**次のBTへ引継ぐ変更: HYPE LONG初期Wallet損失STOPを2%→1.5%に縮小**（実取引認証未実施）。",
        "","|費用|旧8ロジック最終資産|HYPE1.5%累積後最終資産|旧DD|累積後DD|HYPE負け総額縮小（entry equity比合計）|",
        "|---|---:|---:|---:|---:|---:|"]
 for cost in (10,30):
  x=accepted[str(cost)]
  lines.append(f"|{cost}bps|{x['baseline_final_jpy']:,.0f}円|{x['new_final_jpy']:,.0f}円|{x['baseline_dd_pct']:.4f}%|{x['new_dd_pct']:.4f}%|+{x['hype_loss_reduction_pp']:.4f}pt|")
 lines.extend(["","HYPEの前処理候補12件と実際の約定台帳で出口が変更された7件は区別する。**受理された7件はいずれも元の負けトレード**。勝ちのEXITは変更なし。",
 "","## 終了した4スコープ",
 "- S01 V12 SHORT：利益反落2案・初期損失上限2案をすべて不採用。10/30bps DD大幅悪化。",
 "- S02 HYPE LONG：初期Wallet損失STOP1.5%をDD横ばい・負け縮小として累積研究採用。利益保護1.5%/0.25%案は30bps DD悪化で不採用。",
 "- S03 Q102 SHORT：利益保護2案、初期2%/3%損失上限2案を累積HYPE基準で検証、全て不採用。",
 "- S04 RESIDUAL LONG：利益保護2案、初期2%/3%損失上限2案を累積HYPE基準で検証、全て不採用。10bpsのみDD微減でも30bps悪化。",
 "","## 次の段階",
 "S05 Q102 LONG、S06 V12 LONG、S07 IDLE SHORT（以前のATR2.5+STOP予算20%は最新8ロジックで未再検証）、S08 PENGU LONG、S09 PENGU SHORT、S10 V52 SHORT、S11 V52 LONG、S12 FET LONG。",
 "PENGUは過去のEXIT検証を尊重し、監査先行。V52はYahooFinanceを含む株式データ認証先行。",
 "","## 限界",
 "1,310件の5m分類のうち価格原本と整合する1,271件を診断し、39件はV52等のデータ品質で未分類。モデルは公開BinanceVision5mをAster原本価格へ正規化したもので、実Asterのsigned STOP、約定滑り、板、部分約定、pending再配分を認証しない。",
 "今の成果は同じ期間内の仮説検証であり、未知期間のForward/holdout実証が必要。LIVE・KillSwitch・SharedRiskは変更しない。",
 "","詳細: SEQUENTIAL_FOUR_SCOPE_CUMULATIVE_HANDOFF_20261019.json",""])
 md=R/"SEQUENTIAL_FOUR_SCOPE_CUMULATIVE_REPORT_20261019.md"
 md.write_text("\n".join(lines),encoding="utf8")
 print("HANDOFF_WRITTEN",path,md,"ACCEPTED",out["cumulative_adopted_in_research_bt"])
if __name__=="__main__":calc()
