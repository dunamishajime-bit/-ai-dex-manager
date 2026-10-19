#!/usr/bin/env python3
"""Validate and summarize research-only latest Oct-17 full-eight portfolio scenarios."""
from __future__ import annotations
import hashlib,json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/"docs/research/results/idle-atr25-stop20-full8-20261019"
REF=Path(r"C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research/long_two_axis_latest_full8_20261019.py")
SRC=ROOT/"research/idle_atr25_stop20_current_full8_bt_20261019.py"
EXPECTED={
    10:{"final_jpy":222818966.87803495,"max_dd_pct":-15.62063681288941,
        "pf":3.4587962777009813,"trades":1310},
    30:{"final_jpy":124289206.81827945,"max_dd_pct":-16.78776877493442,
        "pf":3.0785603081685435,"trades":1307},
}
CASES=[
 ("ATR_ONLY","ATR 2.5% only"),
 ("ATR_BUDGET20_FULL_REJECT_GAP2_OTHERSTOP10","ATR + 20% budget (full/reject)"),
 ("ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP10","ATR + 20% budget (residual 0.25x+)"),
 ("ATR_BUDGET20_PARTIAL_GAP0_OTHERSTOP10","Stress gap 0% / other SHORT stop 10%"),
 ("ATR_BUDGET20_PARTIAL_GAP1_OTHERSTOP10","Stress gap 1% / other SHORT stop 10%"),
 ("ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP5","Stress gap 2% / other SHORT stop 5%"),
 ("ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP15","Stress gap 2% / other SHORT stop 15%"),
]
def money(v):return f"¥{round(v):,}"
def row(a,b):return f"| {a} | {b} |"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    values={}
    for case,title in CASES:
        for cost in (10,30):
            p=DIR/f"{case}_{cost}BPS.json"
            assert p.is_file(),p
            x=json.loads(p.read_text("utf8"))
            assert x["accounting"]=="PASS"
            assert x["research_only"] is True
            assert x["case"]==case and x["cost_bps"]==cost
            assert x["trades"]==sum(x["trade_counts"].values())
            if "PARTIAL" in case:
                assert all(t["accepted_gross"]>=.2475-1e-9 for t in x["idle_trade_details"]),case
            assert x["max_dd_pct"]<0
            assert x["baseline_jpy"]==EXPECTED[cost]["final_jpy"]
            values.setdefault(case,{})[cost]=x
    nominal=values["ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP10"]
    assert all(nominal[c]["delta_jpy"]<0 and nominal[c]["dd_improvement_pp"]<0 for c in (10,30))
    assert all(values[case][c]["delta_jpy"]<0 for case,title in CASES[2:] for c in (10,30))
    sha_inputs={
        "research_scenario_source":sha(SRC),
        "full8_replay_bootstrap":sha(REF),
    }
    final={
        "status":"RESEARCH_COMPLETED_REJECT_INTEGRATED_LIVE_PROMOTION",
        "date":"2026-10-19",
        "anchor":"2026-10-17 latest eight-strategy frozen full8 research; 2025-08-10 through 2026-08-10",
        "initial_jpy":10000,
        "costs_bps":[10,30],
        "baseline":EXPECTED,
        "scenarios":{case:{
            str(c):{k:values[case][c][k] for k in (
            "final_jpy","max_dd_pct","pf","win_pct","trades","idle_trades",
            "delta_jpy","dd_improvement_pp","idle_rejected_reasons")}
            for c in (10,30)}
            for case,_ in CASES},
        "all_accounting":"PASS",
        "fatal_caveats":[
          "Historical Aster venue-signed resident STOP data is absent; other-runner SHORT STOP widths modeled 5/10/15%. This is NOT a signed STOP lifecycle BT.",
          "Historical pending reservation ledger is absent in frozen atomic H1 simulator; no model of live cross-runner pending exposure.",
          "Partial scenarios widen fractional venue admission beyond DOT/RENDER to all Idle routes, changing eligible trade set; control scenario preserves original sizing feasibility.",
          "The 0.25x pre-order minimum uses up to 1% one-step venue-rounding allowance; staged runtime quantity gate must be aligned before any activation.",
          "In-sample only; public M5 rescaled to Aster historical H1, incomplete independent stock M5 and real execution evidence.",
          "No LIVE/cutover actions; operator, margin, kill switch and protective STOP gates not bypassed.",
        ],
        "source_sha256":sha_inputs,
        "adoption":"REJECT full ATR2.5 + SHORT STOP risk20 + residual sizing as a production upgrade on latest full8"
    }
    (DIR/"FULL8_ATR25_STOP20_VERDICT_20261019.json").write_text(
        json.dumps(final,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    m=[
      "# Latest 8-strategy integrated backtest — ATR2.5% + SHORT STOP-risk20% + Idle residual sizing",
      "",
      "**2026-10-19 | STATUS: REJECT production adoption after current full8 re-test.**",
      "",
      "Backtest anchor: 2025-08-10–2026-08-10, starting ¥10,000, no deposits, compounded H1 mark-to-market, 10/30bps. Original 2026-10-17 eight-strategy 5-minute overlay source was independently replayed to the exact frozen result at both costs. V12 V4, Q102, HYPE, FET, V52, PENGU and RESIDUAL signals and exits retained; only Idle SHORT admission/size modified.",
      "",
      "## Exact comparison",
      "",
      "| Scenario | 10bps final JPY | 10bps DD | 10bps PF | 10bps trades | 30bps final JPY | 30bps DD | 30bps PF | 30bps trades |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
      f"| Frozen original | {money(EXPECTED[10]['final_jpy'])} | {EXPECTED[10]['max_dd_pct']:.4f}% | {EXPECTED[10]['pf']:.3f} | {EXPECTED[10]['trades']} | {money(EXPECTED[30]['final_jpy'])} | {EXPECTED[30]['max_dd_pct']:.4f}% | {EXPECTED[30]['pf']:.3f} | {EXPECTED[30]['trades']} |",
    ]
    for case,title in CASES:
        a,b=values[case][10],values[case][30]
        m.append(f"| {title} | {money(a['final_jpy'])} | {a['max_dd_pct']:.4f}% | {a['pf']:.3f} | {a['trades']} | {money(b['final_jpy'])} | {b['max_dd_pct']:.4f}% | {b['pf']:.3f} | {b['trades']} |")
    a,b=nominal[10],nominal[30]
    m += [
      "",
      "## Formal nominal proposal verdict (2% adverse STOP gap, other shorts 10% native stop proxy)",
      "",
      f"- 10bps: {money(a['final_jpy'])} vs {money(EXPECTED[10]['final_jpy'])}, **{money(a['delta_jpy'])}** final-wealth loss; DD {a['max_dd_pct']:.4f}% vs {EXPECTED[10]['max_dd_pct']:.4f}% (**{a['dd_improvement_pp']:.4f} percentage-points deterioration**).",
      f"- 30bps: {money(b['final_jpy'])} vs {money(EXPECTED[30]['final_jpy'])}, **{money(b['delta_jpy'])}** final-wealth loss; DD {b['max_dd_pct']:.4f}% vs {EXPECTED[30]['max_dd_pct']:.4f}% (**{b['dd_improvement_pp']:.4f} percentage-points deterioration**).",
      f"- Idle accepted modeled trades: 10bps original 71 vs nominal {a['idle_trades']}; 30bps original 74 vs nominal {b['idle_trades']}. Whole-portfolio trades above. After lot normalization, nominal partial accepted Idle gross never below 0.2475x.",
      f"- 10bps full-width budget candidate reason counters include {a['idle_rejected_reasons'].get('IDLE:BASKET20_LT_MIN025',0)} budget-below-floor and {a['idle_rejected_reasons'].get('IDLE:BASKET20_VENUE_FLOOR_BELOW_MIN025',0)} venue-rounding-below-floor rejections (candidate-level, not independent winning trades).",
      "",
      "## Integrity and interpretation",
      "",
      "- The 20% is the **account-equity budget for modeled maximum SHORT loss to STOP** before a new Idle SHORT order, not a 20% portfolio maximum-drawdown threshold. Existing SHORTs are marked at the causal H1 admission timestamp; unrealized winner profit is not counted as negative risk credit. New Idle 10% STOP + 2% stressed gap + 10bps conservative round trip is the nominal risk assumption.",
      "- The old five-runner ~JPY 208 million residual-sizing result came from a different, 1,284-event portfolio and **cannot** validate the October-17 eight-strategy candidate.",
      "- The scenario sweeps show profit loss across all tested gap and cross-runner STOP assumptions. DD sensitivity is at most a few hundredths of one percentage-point; this is not a material improvement.",
      "- Crucially, the frozen H1 engine does **not** have actual historical cross-runner signed STOP prices, unsigned pending orders, margin treatment, or exchange execution. The modeled 5%/10%/15% other-short STOPs are scenario assumptions, not verified past orders.",
      "- The research-only partial venue policy includes a 1% one-step rounding tolerance around 0.25x; current staged TS code must match whichever final physical minQty/stepSize rule is adopted.",
      "- Independent forward/out-of-sample validation remains outstanding. V52 stock M5 historical coverage was previously incomplete.",
      "- No new LIVE deployment, safety latch change, order, position, or protective STOP change.",
      "",
      "## Recommendation",
      "",
      "**Reject ATR2.5% + global SHORT STOP-risk20% + residual sizing as a combined LIVE change in the latest eight-strategy version.** Even ATR2.5% alone has zero meaningful drawdown improvement and mixed 10/30bps asset effect. Investigate specific Idle losing routes, or account-wide SHORT overlap behavior with real signed STOP and pending data before considering a replacement candidate.",
      "",
      "## Source inputs and reproducibility",
      "",
      f"- Current full8 model: `{SRC.relative_to(ROOT).as_posix()}` SHA256 `{sha_inputs['research_scenario_source']}`",
      f"- Frozen baseline bootstrap: `{REF.as_posix()}` SHA256 `{sha_inputs['full8_replay_bootstrap']}`",
      "- Outputs: this folder's `*_10BPS.json` and `*_30BPS.json`, plus `FULL8_ATR25_STOP20_VERDICT_20261019.json`.",
    ]
    (DIR/"FULL8_ATR25_STOP20_VERDICT_20261019.md").write_text("\n".join(m)+"\n",encoding="utf8")
    print("RESEARCH_VERDICT",json.dumps({
      "status":final["status"],"cases":len(CASES)*2,
      "nominal10":{k:a[k] for k in ("final_jpy","max_dd_pct","pf","trades","delta_jpy")},
      "nominal30":{k:b[k] for k in ("final_jpy","max_dd_pct","pf","trades","delta_jpy")},
      "source_shas":sha_inputs,
      "outputs":["FULL8_ATR25_STOP20_VERDICT_20261019.md","FULL8_ATR25_STOP20_VERDICT_20261019.json"]},ensure_ascii=False))

if __name__=="__main__":main()
