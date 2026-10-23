#!/usr/bin/env python3
"""Write final research-only report for RENDER SHORT entrance-vs-exit improvement.
Requires completed 10bps/30bps three-pass native all8 ledger audit for each tested case.
"""
import json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
D=REPO/'docs/research/results/idle-entry-three-20261024'
j=json.loads((D/'IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json').read_text('utf8'))
cases=j['testedCases']
anchors=['COMBO_BTC_DOT_JUP3_GE_M1P5','COMBO_BTC_DOT_JUP3_GE_M1']
addition=['RENDER_CO_DECLINE_AND_JUP_M1P5','RENDER_CO_DECLINE_STRONG_AND_JUP_M1P5',
          'RENDER_PROFIT_F05_JUP_M1P5','RENDER_PROFIT_F075_JUP_M1P5']
names={
 'COMBO_BTC_DOT_JUP3_GE_M1P5':'JUP−1.5%を追加、現時点の件数重視研究基準',
 'COMBO_BTC_DOT_JUP3_GE_M1':'JUP−1%を追加、高勝率候補',
 'RENDER_CO_DECLINE_AND_JUP_M1P5':'RENDER+BTC同時急落だけを拒否、JUP−1.5%',
 'RENDER_CO_DECLINE_STRONG_AND_JUP_M1P5':'RENDER+BTC同時急落の閾値を強く、JUP−1.5%',
 'RENDER_PROFIT_F05_JUP_M1P5':'JUP−1.5%・RENDER含益1.5%後利益保護+0.5%',
 'RENDER_PROFIT_F075_JUP_M1P5':'JUP−1.5%・RENDER含益1.5%後利益保護+0.75%'
}
for name in [*anchors,*addition]:
 assert name in cases and set(cases[name])=={'10','30'},('MISSING_FULL8_EVIDENCE',name)
 for cost in ('10','30'):
  assert cases[name][cost]['accounting']=='PASS'
def fmt(x):return f'{x:,.0f}'
def sign(x):return ('+' if x>=0 else '−')+fmt(abs(x))
def wr(x,s):
 y=x['symbols'][s]
 return f"{y['wins']}/{y['n']}={y['wrPct']:.1f}%" if y['n'] else '-'
prior=cases[anchors[0]]
lines=[
 '# IDLE RENDER SHORT：入口の同時急落回避・利益保護上方修正の累積検証（2026-10-24）',
 '',
 '**RESEARCH ONLY / NO LIVE / NO PRODUCTION / NO ORDERS / NO HP CHANGES.**',
 '',
 '## 固定した研究契約',
 '- 2025-08-10〜2026-08-10、10bps主 / 30bpsストレス、最新AVAX/PENGU初期逆行改善候補とDOT 1時間−1%制限、JUP 12時間−5%+3時間−1.5%制限を引き継ぐ。',
 '- 8ロジック共有資金、各コストにつき動的再選択3パス、ledger SHAとモデル会計PASS。実取引所の部分約定・reduce-only・TP/STOP競合・約定gapは研究モデル内の代理計算でありLIVE認証未了。',
 '- RENDERの利益保護は既存+1.5%含益到達後+0.25%建値比の下限。保護が発動しても30bpsでは4件がネット損失となる。利益保護下限を+0.5%/+0.75%へ強化する候補を試す。',
 '- 同時急落を条件にすると既存採択22/24件が残り、静的では勝ちの減少0件でも、統合8ロジック資金再選択で経済結果は変わり得る。',
 '',
 '## 全8ロジック共通財布の再選択後',
 '| 候補 | 10bps最終資産 | vs件数重視基準 | 全体取引 | RENDER勝率 | 30bps最終資産 | vs件数重視基準 | 全体取引 | RENDER勝率 | 30bps DD |',
 '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
]
for name in [*anchors,*addition]:
 a=cases[name]['10'];b=cases[name]['30']
 lines.append('| '+names[name]+' | '+fmt(a['finalEquityJpy'])+' | '+sign(a['finalEquityJpy']-prior['10']['finalEquityJpy'])+' | '+str(a['portfolioTrades'])+' | '+wr(a,'RENDERUSDT')+
 ' | '+fmt(b['finalEquityJpy'])+' | '+sign(b['finalEquityJpy']-prior['30']['finalEquityJpy'])+
 ' | '+str(b['portfolioTrades'])+' | '+wr(b,'RENDERUSDT')+' | '+f"{b['ddPct']:.5f}%"+' |')
m=json.loads((D/'IDLE_RENDER_ENTRY_VETO_WINRETENTION_STATIC_SCREEN_20261024.json').read_text('utf8'))
for cost in ('10','30'):
 assert m['costs'][cost]['initial']['n']==24
lines+=['',
 '## RENDER初期逆行と30bps勝率の構造',
 '- 最新の既存3通貨併用時、10bps RENDER16勝24件=66.7%、30bps RENDER12勝24件=50%。30bpsの負け12件のうち4件は+1.5%→+0.25%保護で小幅損失、8件はTIME EXIT。',
 '- 採択済みコホートで「RENDER3h<-1.5% かつ BTC3h<-1%」だけ拒否すると、10bpsは24→22件、勝ち16件維持、30bpsは勝ち12件維持。ただしこれは後付けの選別結果で、統合BTと同一ではない。',
 '- 30bpsの利益保護は費用0.30%対建値+0.25%のため、保護注文が成功しても実現モデル上の勝ちとは限らない。実際の30bpsは費用ストレスで、10bpsを主評価にする。',
 '- 利益保護+0.5%/+0.75%は確定済M5終値でarmし、次M5以降に閾値に反発した時のみstop fill。寄付きgapは低い利益保護を保証しない。元の早いSTOP／EXITを優先する。',
 '- 含益+1.5%自体に達しない入口直後の負けは、利益保護の強化では回避できない。ENTRYとEXITの双方を別々に分析する。',
 '',
 '## 判断・制限',
 '- 複数閾値を同一期間で研究したため、多重比較による過学習リスクが高い。+0.5%/+0.75%及び同時急落条件は暫定研究候補で、未使用OOSやForward Shadow証拠が必要。',
 '- 利益保護の上方修正は勝率だけでなく勝ち幅と資金再配置が悪化する場合に不採用。',
 '- 入口制限はロング・他戦略に一切適用していない。Shared Risk/Margin Guard/Kill Switch/元のExchange hard stop緩和なし。',
 '- 現実のvenue部分約定、再起動復元、二重STOP防止、real average entry basis、フルProduction parityは未認証。正式採用/Push=LIVE反映ではない。',
 '',
 '## 再現資料',
 '- scripts/dd-reduction/idle-render-profit-floor-upgrade-20261024.py',
 '- scripts/dd-reduction/test-idle-render-profit-floor-upgrade-20261024.py',
 '- scripts/dd-reduction/screen-idle-render-winretention-plus-profit-floor-20261024.py',
 '- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py',
 '- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_ENTRY_VETO_WINRETENTION_STATIC_SCREEN_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json'
]
f=D/'IDLE_RENDER_ENTRY_PROFIT_FULL8_DECISION_20261024.md'
f.write_text('\n'.join(lines).rstrip()+'\n',encoding='utf8',newline='\n')
print('RESEARCH_REPORT',f,f.stat().st_size,'VERIFIED_CASES',len(anchors+addition),flush=True)
