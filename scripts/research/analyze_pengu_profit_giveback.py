"""Validate and package this research run; makes no API/venue calls."""
import pathlib,json,gzip,math,hashlib,statistics,zipfile,collections,datetime
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/pengu-profit-giveback-20261009'
DATA=pathlib.Path('C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests')
REF=pathlib.Path('C:/tmp/current-vps-no-dca-bt-20261007/docs/research/results/current-vps-no-dca-20261007')
def rows(p):
 if not p.exists() and pathlib.Path(str(p)+'.gz').exists():p=pathlib.Path(str(p)+'.gz')
 with (gzip.open(p,'rt',encoding='utf-8') if str(p).endswith('.gz') else open(p,encoding='utf-8')) as f:return [json.loads(l) for l in f if l.strip()]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 res=json.loads((OUT/'comparison.json').read_text());assert len(res)==15
 assert 'BT_COMPLETED 15' in (OUT/'final-run.log').read_text()
 checks=[]
 for x in res:
  assert len(x['scenarios'])==3
  for s in x['scenarios']:
   assert s['accounting_reconciliation']['status']=='PASS'
   assert s['contributed_jpy']==10000 and s['monthly_jpy']==0
   assert all(math.isfinite(s[k]) for k in ['final_equity_jpy','win_rate','profit_factor','maximum_mtm_drawdown'])
   tr=rows(OUT/x['scope']/x['name']/'runs'/s['scenario_id']/'portfolio-trades.jsonl')
   assert len(tr)==s['closed_trades']
   ps=sorted([t for t in tr if t['strategy_id']=='PENGU'],key=lambda t:t['entry_ts_ms'])
   assert all(t['exit_ts_ms']<=u['entry_ts_ms'] for t,u in zip(ps,ps[1:]))
   assert all(t['quantity']>=0 and t['original_quantity']>0 for t in tr)
   checks.append({'scope':x['scope'],'case':x['name'],'cost':s['scenario_id'],'accounting':'PASS','no_pengu_overlap':True,'initial_jpy':10000,'monthly_jpy':0,'closed_trades':len(tr)})
 for fill in ['H1_TRIGGER_PRICE','H1_NEXT_OPEN']:
  a=rows(OUT/'candidates'/f'{fill}__BASELINE.jsonl.gz');am={(x['entry_ts_ms'],x['side']):x for x in a}
  assert len(am)==113
  for p in (OUT/'candidates').glob(fill+'__SHORT*.jsonl.gz'):
   b=rows(p);assert set(am)=={(x['entry_ts_ms'],x['side']) for x in b}
   assert all(am[(x['entry_ts_ms'],x['side'])]==x for x in b if x['side']=='LONG')
 assert json.loads((OUT/'partial-order-test.json').read_text())['status']=='PASS'
 verification={'scenario_count':45,'checks':checks,'eligible_entries':113,'independent_short_candidates':44,'short_only_long_lifecycles_unchanged':True,'source_signal_samples_matched':6,'partial_order_test':'PASS','independent_review':'NO_REMAINING_IMPORTANT_FINDINGS','no_live_changes':True}
 (OUT/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
 base=rows(OUT/'candidates/H1_NEXT_OPEN__BASELINE.jsonl.gz')
 actual=rows(OUT/'standalone/H1_NEXT_OPEN__BASELINE/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl')
 keys={(x['entry_ts_ms'],x['side']) for x in actual if x['side']=='SHORT'}
 allkeys={(x['entry_ts_ms'],x['side']) for x in base if x['side']=='SHORT'}
 paired={}
 for p in (OUT/'candidates').glob('H1_NEXT_OPEN*.jsonl.gz'):
  rs=rows(p);bykey={(x['entry_ts_ms'],x['side']):x for x in rs};buckets={}
  for label,ks in [('same_20_baseline_admitted_shorts',keys),('all_44_independent_short_candidates',allkeys)]:
   vals=[bykey[k] for k in ks];raw=[1-x['exit_price']/x['entry_price'] for x in vals];bm={(x['entry_ts_ms'],x['side']):x for x in base}
   delta=[(bm[(x['entry_ts_ms'],x['side'])]['exit_price']-x['exit_price'])/x['entry_price'] for x in vals]
   buckets[label]={'n':len(vals),'average_price_return':statistics.mean(raw),'sum_price_returns':sum(raw),'median_price_return':statistics.median(raw),'gross_win_rate':sum(x>0 for x in raw)/len(raw),'improved':sum(x>1e-10 for x in delta),'worsened':sum(x< -1e-10 for x in delta),'unchanged':sum(abs(x)<=1e-10 for x in delta),'mean_mfe_h1_bound':statistics.mean(x['mfe'] for x in vals),'mean_mae_h1_bound':statistics.mean(x['mae'] for x in vals),'average_hold_hours':statistics.mean((x['exit_ts_ms']-x['entry_ts_ms'])/3600000 for x in vals),'costs_and_funding':'EXCLUDED_FROM_THIS_GROSS_PAIRED_DIAGNOSTIC_INCLUDED_IN_PORTFOLIO_BT'}
  paired[p.name]=buckets
 (OUT/'paired-short-diagnostics.json').write_text(json.dumps(paired,indent=2),encoding='utf-8')
 inputs={}
 for rel in ['normalized/aster/klines/PENGUUSDT.jsonl','normalized/aster/klines/BTCUSDT.jsonl','normalized/aster/funding/PENGUUSDT.jsonl']:
  p=DATA/rel;inputs[rel]={'sha256':sha(p),'bytes':p.stat().st_size,'rows':len(rows(p))}
 for rel in ['lib/pengu-dual-ls-v2.ts','lib/pengu-short-v20.ts','lib/pengu-recovery-v8.ts','config/penguDualLsV2Runtime.ts','config/penguRecoveryV8.ts']:
  inputs[rel]={'sha256':sha(ROOT/rel)}
 for rel in ['run-current-vps-no-dca.py','venue_constraints.py','venue-filters-observed-20261007.json','engine/docs/research/results/formal-core-ownership-audit-20261003/engine-source.zip']:
  p=REF/rel;inputs['engine/'+rel]={'sha256':sha(p),'bytes':p.stat().st_size}
 (OUT/'input-manifest.json').write_text(json.dumps({'runtime_sha':'ce1edeead8d0f9e5d88e829d415057117502a335','inputs':inputs},indent=2),encoding='utf-8')
 labels={'BASELINE':'現行','SHORT_PRICE_TRAIL4_FROM_PROFIT':'SHORT：利益が出た後、安値から4%反発','SHORT_PEAK_PROFIT_MINUS4PP':'SHORT：最大利益率から4ポイント低下','SHORT_PEAK_PROFIT_GIVEBACK4PCT':'SHORT：最大利益額の4%減','ALL_PEAK_PROFIT_MINUS4PP':'全PENGUルート：最大利益率から4ポイント低下'}
 text='# PENGU 利益吐き出しExit比較BT — 2026-10-09\n\n結論：今回の期間では、追従開始条件を外した4%早期決済は現行より利益とDDを悪化させた。本番変更なし。\n\n'
 text+='期間：2025-08-10 00:00 UTC〜2026-08-10 00:00 UTC。Aster H1、BTC/PENGU共通足と実Funding。初期資金10,000円、積立なし、Gross1固定、複利。現在のpure entry/exit関数を利用。損切り・最大保有・V20追加Exit・Recovery部分防御・Q60/DD17/H72・cooldown・数量丸めを維持。\n\n'
 text+='「4%」を利益率の4ポイントと最大利益額の4%減に分けた。4ポイント案は最大利益率+10%なら+6%で決済判定する。価格追従4%は安値×1.04。最大利益額4%減は最大利益率+10%なら+9.6%で判定する。どの早期案も一度含み益が出た後に有効になる。\n\n'
 text+='主要結果は、確定H1でソフトウェアExit判定後に次足始値で市場決済する価格モデル。ハードストップとRecovery部分決済はvenue resident stopとしてモデル化。往復コスト10bps（追加Fundingは実データ）で比較。\n\n'
 for scope,title in [('standalone','PENGU単体：LONG/SHORT/Recoveryすべてを含む'),('integrated','統合H1参考：他ロジックとのGross競合込み')]:
  text+='## '+title+'\n\n|変更|最終資産（円）|勝率|PF|最大MTM DD|件数|SHORT勝率|\n|---|---:|---:|---:|---:|---:|---:|\n'
  for x in res:
   if x['scope']!=scope or not x['name'].startswith('H1_NEXT_OPEN'):continue
   s=x['scenarios'][0];policy=x['name'].split('__')[1]
   text+=f"|{labels[policy]}|{s['final_equity_jpy']:,.2f}|{s['win_rate']*100:.2f}%|{s['profit_factor']:.4f}|{s['maximum_mtm_drawdown']*100:.2f}%|{s['closed_trades']}|{s['pengu_short']['win_rate']*100:.2f}%|\n"
  text+='\n'
 text+='## 同じSHORTを比較した原因分析\n\n現行単体BTで採用された同じ20件のSHORTの価格差利益（コスト/Funding前）の平均は現行+6.46%、4ポイント案+2.12%、利益額4%減案+0.71%。4ポイント案は6件改善・10件悪化・4件同じ。最大の勝ちを早期に切る影響が大きい。現行20件SHORTに対し4ポイント案は24件、利益額4%減は25件になるため、同じ候補の比較と再エントリー込み比較を分離した。44件の全SHORT候補は重複し得る独立シグナルであり、44件すべてを同時に実取引する集計ではない。\n\n'
 text+='## 検証と限界\n\n- 113候補のEntry日時/方向は従来referenceと完全一致。内訳SHORT44、通常LONG19、Recovery50。6候補をProduction buildSignalと照合。SHORTのみの変更では全LONG候補のlifecycle不変を確認。\n- 5条件×2約定方式×3コストのPENGU単体30ケースと、5条件×3コストの統合参考15ケース、計45ケース。すべて会計整合・重複なし・積立なしの検証PASS。20/30bpsでも主要な優劣は不変。\n- 追加2候補のテストで、同一H1時刻にresident部分決済と全決済が発生したとき、時刻を遡らせずに部分決済→残量決済を計上できることを確認。外部レビューのImportant指摘を修正し、再計算済み。\n- 単体結果は全ロジックの勝率/資産ではない。統合参考はV12 source Exitとidle数量修正込み、Q102条件緩和はなし。以前の431.9万円や40億円BTと前提が異なるため同じ基準結果として扱わない。\n- 統合参考には既存V52データのcoverage/funding制約とH1モデルの制約を引き継ぐ。全非同期LIVEの完全再現・本番認証ではない。\n- 確定H1→次足始値は実際の市場決済価格の近似であり、tick/1分足による連続追従ではない。H1_TRIGGER_PRICEは別の価格仮定の診断。V20の明示的open-reference actionはその診断のみ元の参照時刻を維持。\n- 終了足の高安を含むMFE/MAEはH1 bounds。実約定時点までの正確な最大利益ではなく、バー内順序のambiguityはunknown。決済閾値は必ず直前までの最高/最安値を使い、同足内の未来ピークは使わない。\n- 会計は数量×価格差の線形SHORT損益。旧台帳のtotal_pnl_jpyという列名はUSD settlement値を保持するため、USDの内訳として扱い、final_equity_jpyを円資産として表示する。\n\n'
 text+='## 再実行\n\n環境変数PENGU_BT_DATA/PENGU_BT_OUTを設定し、tsx scripts/research/pengu_profit_giveback_source.ts → python scripts/research/run_pengu_profit_giveback.py standalone integrated → python scripts/research/analyze_pengu_profit_giveback.py。既存ローカル市場データとreference engineはinput-manifest.jsonのSHAで固定。Source evaluatorsはcurrent trading SHA ce1edee…から変更なし。結果台帳はledgers.zip。\n'
 (OUT/'README.md').write_text(text,encoding='utf-8')
 # Preserve complete ledgers as one compressed, inspectable bundle.
 with zipfile.ZipFile(OUT/'ledgers.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for scope in ['standalone','integrated']:
   for p in sorted((OUT/scope).rglob('*')):
    if p.is_file():z.write(p,p.relative_to(OUT).as_posix())
 manifests={p.relative_to(OUT).as_posix():{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(OUT.rglob('*')) if p.is_file() and not any(part in {'standalone','integrated'} for part in p.relative_to(OUT).parts) and p.name!='artifact-manifest.json'}
 (OUT/'artifact-manifest.json').write_text(json.dumps(manifests,indent=2),encoding='utf-8')
 print('FINAL_VERIFICATION_PASS',len(checks),'ledger_zip_bytes',(OUT/'ledgers.zip').stat().st_size)
 for x in res:
  if x['scope']=='standalone' and x['name'].startswith('H1_NEXT_OPEN'):
   s=x['scenarios'][0];print(x['name'],s['final_equity_jpy'],s['maximum_mtm_drawdown'])
if __name__=='__main__':main()
