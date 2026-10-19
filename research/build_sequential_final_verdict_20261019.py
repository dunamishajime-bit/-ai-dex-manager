#!/usr/bin/env python3
"""Assemble accountable 8-logic side exit full-portfolio evidence and research handoff."""
from pathlib import Path
import json,hashlib,datetime,statistics
ROOT=Path(__file__).resolve().parents[1]
R=ROOT/'docs/research/results/long-loss-research-20261019'
F=R/'SEQUENTIAL_FINAL_HANDOFF_20261019.json'
MD=R/'SEQUENTIAL_FINAL_INTEGRATED_VERDICT_20261019.md'
PREVIOUS=R/'SEQUENTIAL_FOUR_SCOPE_CUMULATIVE_HANDOFF_20261019.json'
PRIMARY=R/'SEQUENTIAL_STEP05_TO_12_CUMULATIVE_20261019.json'
ROBUST=R/'SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json'
COMBO=R/'SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json'
HYPE=R/'SEQUENTIAL_HYPE_LONG_1P5_STOP_SLIPPAGE_20261019.json'
LOSS=R/'LATEST_8LOGIC_SIDE_LOSS_M5_CLASSIFICATION_20261019.json'
def read(p):
 if not p.is_file():raise FileNotFoundError(str(p))
 return json.loads(p.read_text('utf8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def money(n):return f'{n:,.0f}'
def mark(s):
 return {'NO_CANDIDATE_ADOPTED':'不採用','BLOCKED_HISTORICAL_STOCK_5M_COVERAGE':'欠損のため採用判定不可',
 'RESEARCH_CARRY_ROBUST_0_1_2_STRESS':'研究採用候補（滑り耐性PASS）','NO_ACCEPTED_TRADES_IN_THIS_SIDE':'受理取引0件',
 'NOMINAL_IMPROVEMENT_BUT_STRESS_FAILED':'候補の滑り耐性不合格',
 'NO_COMBINATION_IMPROVED_BOTH_COST_CASES':'複合案不採用',
 'NO_BOTH_COST_SLIPPAGE_ROBUST_ADOPTION':'不採用'}.get(s,s)
def run():
 a=read(PREVIOUS);b=read(PRIMARY);r=read(ROBUST);k=read(COMBO);h=read(HYPE);l=read(LOSS)
 assert b['status']=='COMPLETED_EIGHT_SCOPES_RESEARCH_ONLY'
 assert r['status']=='COMPLETED_EIGHT_SCOPES_RESEARCH_ONLY'
 assert k['status']=='COMPLETED_COMBINED_EXPERIMENTS_WITH_MARKET_DATA_GAPS'
 assert h['status']=='COMPLETE_STRESS_CASES_RESEARCH_ONLY'
 assert not h['robust_to_2pct_slippage']
 assert all(q['accounting']=='PASS' for q in k['final_integrated_replay'])
 assert len(k['final_integrated_replay'])==2
 by_side={s['target']+'_'+s['direction']:s for s in r['stages']}
 comb={s['scope']:s for s in k['stages']}
 base={c:read(R/f'SEQUENTIAL_LATEST_20261017_BASELINE_{c}BPS.json') for c in (10,30)}
 final={q['cost_bps']:q for q in k['final_integrated_replay']}
 info={'status':'COMPLETED_RESEARCH_WITH_V52_STOCK_M5_CERTIFICATION_GAP','research_only':True,
 'side_acceptances':r['cumulative_spec'],'post_combination_specs':k['current_specs'],
 'original_controls':base,'final_portfolio':k['final_integrated_replay'],
 'source_sha256':{p.name:sha(p) for p in [PREVIOUS,PRIMARY,ROBUST,COMBO,HYPE,LOSS]},
 'rejected_hype_due_to_slippage':True,
 'V52_M5_coverage':{'LONG':{'valid':l['groups']['V52_LONG']['valid'],'total':l['groups']['V52_LONG']['trades']},
 'SHORT':{'valid':l['groups']['V52_SHORT']['valid'],'total':l['groups']['V52_SHORT']['trades']}},
 'uncertainties':['Actual venue STOP readback/partial fill absent','historical M5 public prices scaled to Aster H1',
 'Yahoo Finance historical V52 5m parity missing','independent forward holdout absent'],
 'production_changed':False}
 F.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 lines=['# 最新8ロジック LONG/SHORT出口改善・最終統合BT研究報告 (2026-10-19)','',
  '**STATUS: 研究上の全範囲の再実行結果。V52実株5mデータ不足および実取引所STOP認証未完了のためLIVE認証ではない。**','',
  '- 2025-08-10〜2026-08-10、初期1万円、追加積立0、複利。現行実運用成果を示すものではない。',
  '- 統合8ロジック同時ポジション・優先順位・共有Gross・複利口座MTM-DDを毎案で再計算。',
  '- 10bps/30bps往復相当コストでDDと損失を比較。候補のSTOP約定滑りを別に0/1/2%で検証。',
  '- PENGU LONG/SHORT既存出口は意図的に維持。戦略・入口・LIVEに変更を加えていない。',
  '- 因果H1研究7件および独立M5 STOP投影単体テスト8件は計15/15 PASS（実venue証明ではない）。','',
  '## 統合BT：原本と採用条件累積後','',
  '| コスト | 原本最終資産 | 累積最終資産 | 原本最大DD | 累積最大DD | 取引数 | PF |',
  '|---|---:|---:|---:|---:|---:|---:|']
 for c in (10,30):
  v=base[c];z=final[c]
  lines.append(f"| {c}bps | ¥{money(v['full8_final_jpy'])} | ¥{money(z['final_jpy'])} | {v['full8_max_dd_pct']:.6f}% | {z['max_dd_pct']:.6f}% | {z['trade_count']} | {z['pf']:.4f} |")
 lines+=['', '研究上の採用条件（滑り耐性0/1/2%）：'+ (', '.join(x['id'] for x in k['current_specs']) if k['current_specs'] else '**新規追加なし**')+'。','',
 '## 方向別検証判定','',
 '| 対象 | 利益保護/初期逆行単独 | 同時組合せ | 結論・補足 |',
 '|---|---|---|---|']
 cases=[('HYPE_LONG_LONG','HYPE LONG'),
  ('RESIDUAL_LONG','RESIDUAL LONG'),('Q102_LONG','Q102 LONG'),
  ('V12_LONG','V12 V4 LONG'),('Q102_SHORT','Q102 SHORT'),('V12_SHORT','V12 V4 SHORT'),
  ('IDLE_SHORT','Idle SHORT'),('FET_LONG','FET LONG'),
  ('V52_LONG','V52 LONG'),('V52_SHORT','V52 SHORT'),
  ('IDLE_LONG','Idle LONG'),('RESIDUAL_SHORT','RESIDUAL SHORT')]
 for key,label in cases:
  z=by_side.get(key)
  if key=='HYPE_LONG_LONG':
   simple='HYPE 1.5%初期STOP：滑り耐性不合格'
  elif z:simple=mark(z['status'])
  else:simple='元の受理取引0件'
  combstage=comb.get(key)
  if not combstage and key in ('IDLE_LONG','RESIDUAL_SHORT'):combo='検証不要（受理0）'
  elif not combstage:combo='検証対象外'
  else:combo=mark(combstage['status'])
  extra=''
  if key in ('V52_LONG','V52_SHORT'):
   v=l['groups'][key];extra=f"5m観測有効 {v['valid']}/{v['trades']}。比較未成立"
  if key=='HYPE_LONG_LONG':extra='0%でのみ損失削減、1%/2%では逆転'
  lines.append(f'| {label} | {simple} | {combo} | {extra} |')
 # Include accepted-trade and mean loss impact (entry equity-normalized) for every long/short.
 import sys
 sys.path.insert(0,str(ROOT/'research'))
 import sequential_full8_side_loss_metrics_20261019 as lm
 original_losses=lm.losses(lm.ledger('LATEST_20261017_BASELINE',10))
 cumulative_losses=lm.losses(lm.ledger('FINAL_FULL8_ROBUST_CUMULATIVE_20261019',10))
 lines+=['','## 勝ちトレードと平均負けへの影響 (10bps・全体採用系列)','',
 '|戦略方向|元勝数|累積勝数|元平均負け（エントリー時口座比）|累積平均負け|元最悪負け|累積最悪負け|',
 '|---|---:|---:|---:|---:|---:|---:|']
 for key in sorted(original_losses):
  z=original_losses[key];b=cumulative_losses.get(key,z)
  avg=lambda q: q['sum_negative_wallet_contributions_pp']/q['losses'] if q['losses'] else 0
  lines.append(f"|{key}|{z['wins']}|{b['wins']}|{avg(z):.3f}%|{avg(b):.3f}%|{z['worst_trade_wallet_pct']:.3f}%|{b['worst_trade_wallet_pct']:.3f}%|")
 lines+=['','平均負けは損失取引ごとのPnL/エントリー時点の口座資産の単純平均であり、口座全体のMTM-DDとは異なる。']
 lines+=['','PENGU LONG/SHORT：出口変更は行っていない。','',
 '## HYPE LONG 1.5% wallet STOP：不利なSTOP約定滑りの影響','',
 '| STOP不利滑り | 10bps損失削減（entry equity比の累積pt） | 30bps同 | 最大DD変化 |',
 '|---|---:|---:|---|']
 for st in h['studies']:
  l10,l30=st['cases']
  lines.append(f"| {st['stop_slippage_pct']:.0f}% | {l10['hype_loss_saved_wallet_pp']:+.4f}pt | {l30['hype_loss_saved_wallet_pp']:+.4f}pt | 10/30bpsとも変化なし |")
 lines+=['','**1%と2%で負け総量が悪化するため、HYPE1.5%案は今回の正式累積基準には採用しない。**','',
 '## ソースの限界と認証に必要なもの','',
 f"- V52株式ロジック5m足の利用可能範囲はLONG {l['groups']['V52_LONG']['valid']}/{l['groups']['V52_LONG']['trades']}、SHORT {l['groups']['V52_SHORT']['valid']}/{l['groups']['V52_SHORT']['trades']}。エラーをゼロ変化と誤認して採用しない。",
 '- バックテストは確定5m足と過去H1データ。実約定の板・MarkPrice・Partial fills・Funding差異や実resident STOP読み戻しは認証していない。',
 '- 独立holdoutとForward Shadowがないため、過剰最適化のリスクがある。LIVEロジックの自動切替は行っていない。',
 '- 営業日の長期株式M5やYahoo Financeの同じ欠損期間が完全再現できる一次データでV52を再確認すること。',
 '','## 再現に使ったコードとエビデンス',
 '- research/sequential_remaining_8_sides_20261019.py',
 '- research/sequential_robust_oct17_baseline_sweep_20261019.py',
 '- research/sequential_hype_stop_slippage_20261019.py',
 '- research/sequential_combined_robust_baseline_20261019.py',
 '- tests/test_sequential_exit_projection_20261019.py',
 '- tests/test_long_loss_h1_causal_research_20261019.py',
 '- docs/research/results/long-loss-research-20261019/SEQUENTIAL_STEP05_TO_12_CUMULATIVE_20261019.json',
 '- docs/research/results/long-loss-research-20261019/SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json',
 '- docs/research/results/long-loss-research-20261019/SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json',
 '- docs/research/results/long-loss-research-20261019/SEQUENTIAL_HYPE_LONG_1P5_STOP_SLIPPAGE_20261019.json',
 '']
 MD.write_text('\n'.join(lines),encoding='utf8')
 print('FINAL_REPORT_CREATED',MD,'json',F, 'final_specs',len(k['current_specs']),flush=True)
if __name__=='__main__':run()
