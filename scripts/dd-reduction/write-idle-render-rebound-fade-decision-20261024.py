#!/usr/bin/env python3
"""Evidence-locked note comparing new price action gates in native all8 dynamic portfolio."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]
D=R/'docs/research/results/idle-entry-three-20261024'
j=json.loads((D/'IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json').read_text('utf8'))
s=json.loads((D/'IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json').read_text('utf8'))
base='COMBO_BTC_DOT_JUP3_GE_M1P5'
cases=['RENDER_REBOUND_NO_LATE_DUMP','RENDER_REBOUND_NO_SHARP1H_DUMP']
for name in [base,*cases]:
 assert name in j['testedCases'],('INCOMPLETE_FULL8',name)
 for cost in ('10','30'):
  a=j['testedCases'][name][cost]
  assert a['accounting']=='PASS' and a['ledgerSha256'] and a['portfolioTrades']>0
fmt=lambda x:f'{x:,.0f}'
sign=lambda x:('+' if x>=0 else '−')+fmt(abs(x))
base10=j['testedCases'][base]['10'];base30=j['testedCases'][base]['30']
m={'RENDER_REBOUND_NO_LATE_DUMP':'反発が弱く直近15分で再急落する場合だけ見送り',
   'RENDER_REBOUND_NO_SHARP1H_DUMP':'直近1時間急落かつ反発1%未満なら見送り'}
lines=['# RENDER SHORT 反発・再失速入口：取引回数維持×8ロジック因果BT（2026-10-24）','',
 '**STATUS: RESEARCH_ONLY / NOT ADOPTED / NO LIVE OR PRODUCTION CHANGE**','',
 '## 前提',
 '- 期間 2025-08-10〜2026-08-10。10bps通常、30bpsストレス、毎回全8ロジック動的資金再選択3パス、モデル会計PASSとSHA照合。AVAX/PENGU初期逆行改善研究条件・DOT 直近1h>=−1%・JUP 12h>=−5%＋3h>=−1.5%を維持。',
 '- 毎候補についてエントリー時までに確定済の5分足だけから直前3hの値幅、反発高値、直近15分リターンを作成。未来のMFE/MAE・決済価格は入口判定に一切使用しない。',
 '- 既存候補の並べ直し・再選択のみ。新しい未発火5分足注文を作るモデルではない。保護STOPと資金のHard Cap/Shared Riskは変更していない。',
 '- 基準RENDER30bps勝率12/24=50%、RENDER10bps勝率16/24=66.7%。',
 '',
 '## 旧採択24件における入口15方式のスクリーニング（正式BTではない）',
 '| RENDER入口方式 | 10bps採択後残数 | 10bps残存勝率 | 30bps採択後残数 | 30bps残存勝率 | 全H1候補164件中の残数 |',
 '|---|---:|---:|---:|---:|---:|']
for name in ('BASE','BOUNCE_FADE_TIGHT','BOUNCE_FADE_LIGHT','VETO_KNIFE_WITHOUT_REBOUND',
 'VETO_WEAK_REBOUND_LATE_DUMP','VETO_LAST1H_SHARP_DUMP'):
 a=s['costs']['10']['rules'][name];b=s['costs']['30']['rules'][name]
 lines.append('| '+name+' | '+str(a['selected']['n'])+
 ' | '+str(a['selected']['wr'])+'% | '+str(b['selected']['n'])+' | '+
 str(b['selected']['wr'])+'% | '+str(a['candidateAcceptedByGate']['n'])+' |')
lines+=['',
 '同じ期間への多重閾値スクリーニングであり、参考の勝率は未使用OOSではない。新規候補には既存ポジション・クールダウン・他戦略との共有資金制約があるため、H1候補数をLIVEの発注可能件数とは呼ばない。',
 '',
 '## 8ロジック共有財布の統合再選択BT',
 '| ケース | 10bps最終資産 | 対基準差 | RENDER勝率10bps | 全体取引10bps | 30bps最終資産 | 対基準差 | RENDER勝率30bps | 全体取引30bps | DD10/30bps |',
 '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
]
for name in [base,*cases]:
 a=j['testedCases'][name]['10'];b=j['testedCases'][name]['30']
 def wr(x):
  z=x['symbols']['RENDERUSDT']
  return f"{z['wins']}/{z['n']}={z['wrPct']:.2f}%"
 lines.append('| '+m.get(name,'前回JUP−1.5%の件数重視基準')+' | '+fmt(a['finalEquityJpy'])+
 ' | '+sign(a['finalEquityJpy']-base10['finalEquityJpy'])+' | '+wr(a)+
 ' | '+str(a['portfolioTrades'])+' | '+fmt(b['finalEquityJpy'])+
 ' | '+sign(b['finalEquityJpy']-base30['finalEquityJpy'])+' | '+wr(b)+
 ' | '+str(b['portfolioTrades'])+' | '+f"{a['ddPct']:.4f}% / {b['ddPct']:.4f}%"+' |')
lines+=['',
 '## 年間勝率が低い根因（事後分解、入口には使用不可）',
 '- RENDERの30bps基準採択24件のうち、2026-01〜03は3/12勝=25%、2026-04〜08は9/12勝=75%。日時固定の市場ゲート導入は過学習のため禁止。',
 '- 5分足の反発・失速を厳格な新規エントリー条件にすると採択件数が24件から5〜8件へ激減し、件数維持要件を満たせない。',
 '- 緩い危険局面拒否では参考上約23/24件を維持できたが、ポートフォリオ全体での経済改善は表の全8結果による。',
 '',
 '## 採否と次の研究',
 '- この段階は過去1年に条件を繰り返し調整したin-sample研究であり未使用OOS未認証。過去サンプルの数件の差は再現性不明。',
 '- 改善候補をForward Shadowする場合、同じ予算の既存シグナル順序と並走比較し、勝率/平均損益/全体取引数/最大DD/約定スリッページを記録する。',
 '- 今回の入口案が不採用なら前回件数重視のJUP−1.5%+DOT 1h−1%+RENDER BTC3h−1.5%を保持する。',
 '- 実venue保護注文ACK/partial fill/restart/cancel race、latest Production SHA一致、Hard Stop ownership、OOS未認証。VPS/Production/LIVE/HP一切変更なし。',
 '',
 '## 研究ファイル',
 '- scripts/dd-reduction/research-idle-render-rebound-fade-20261024.py',
 '- scripts/dd-reduction/screen-idle-render-rebound-fade-selected-native-20261024.py',
 '- scripts/dd-reduction/test-idle-render-rebound-fade-20261024.py',
 '- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py',
 '- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json']
target=D/'IDLE_RENDER_REBOUND_FADE_FULL8_FINAL_DECISION_20261024.md'
target.write_text('\n'.join(lines).rstrip()+'\n',encoding='utf8',newline='\n')
print('REPORT_DONE',target,target.stat().st_size,'CASES',len(j['testedCases']))
