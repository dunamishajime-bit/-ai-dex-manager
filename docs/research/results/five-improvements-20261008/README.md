# 5項目改善検証 — 2026-10-08 JST

検証結果：新しい売買Gate・Exit・SizingをProductionへ昇格させる根拠は得られませんでした。M05だけは注文へ影響しないForward証拠収集を拡張します。

## 比較基準

期間2025-08-10〜2026-08-10 UTC、365日。初期1万円、積立なし、複利、現行Sizing、2026-10-07観測の取引所数量制約、10bps。最終資産201,392,632.84円、PF3.9785465、最大MTM DD-14.5963204%、勝率66.4464%、1362件。

旧40.6736億円アンカーとは入金・V12最終Sizing・数量制約・FET保護条件が異なります。今回は現VPS照合済み候補の参考H1価格モデルに比較軸を固定しました。結果の金額は実約定可能額や将来利益の予測ではありません。

## FET Exit：8案すべて保留

現行は+5%トリガー後+3% floor、72h+2%、24h再エントリー禁止。entryは固定。

|案|最終資産 円|PF|最大DD|
|---|---:|---:|---:|
|現行|201,392,633|3.9785|-14.5963%|
|+5%後2% trailing|198,858,375|3.9546|-14.5963%|
|+5%後3% trailing|198,646,379|3.9527|-14.5963%|
|+7%後2% trailing|199,681,615|3.9620|-14.5963%|
|+8%後2% trailing|199,251,446|3.9590|-14.5963%|
|+5%後3%、+7%後2% trailing|198,997,476|3.9556|-14.5963%|
|+5%後3%、+8%後2% trailing|198,646,379|3.9527|-14.5963%|
|12h後Momentum失速Exit|199,400,373|3.9601|-14.5963%|
|18h後Momentum失速Exit|200,727,086|3.9725|-14.5963%|

採用済み8トレードの7件が勝ち。利益吐き出しはありますが、早期Exitは伸びた利益も削り、今回の全体DDを改善しません。MFE/MAE/Givebackは`fet-giveback-analysis.json`。H1足の決済足高安は、Stop前後の順序が不明なため上限・下限の参考値です。

## 相関連敗Governor：8案、採用せず

6h/12h内の複数cryptoロジックによる同方向損失、同方向Gross>=1.0、BTC3hが方向逆行1%以上かつ以前のトレンドから反転、全条件で次の新規Grossを0.60/0.75倍。

直前3hからの反転では4案すべて発動0・完全同値。12h例では評価1305、複数ロジック損失35、Gross条件まで16、BTC逆行まで3、反転条件まで0。

追加で直前21hトレンドからの反転（ts-24h〜ts-3h）を確認。6h窓は同値、12h窓は各1回の縮小：

|倍率|最終資産 円|最大DD|
|---|---:|---:|
|0.60|200,537,913|-14.7358%|
|0.75|200,872,132|-14.6738%|

利益とDDが両方悪化。この仕様の有効性は証明できません。全ての相関Governorが無効という結論ではありません。

## Q102ルート別Exit：6案、採用せず

HIGH_VOL SHORTのGross0.60xを維持。HIGH_VOLは6h以降の3h反発1%/2%、REV SHORTは+2%/+4%の確定Close利益後50%吐き出し、PB LONGはBTC3h急落1%/2%かつ含み益なし。

|案|最終資産 円|PF|最大DD|
|---|---:|---:|---:|
|HIGH_VOL 1%反発|192,160,039|3.4969|-16.0457%|
|HIGH_VOL 2%反発|178,209,885|3.2771|-16.8134%|
|REV +2%から50%吐き出し|196,002,855|3.9584|-14.9976%|
|REV +4%から50%吐き出し|201,703,894|3.9428|-14.5964%|
|PB BTC急落1%|190,731,047|3.9083|-14.5963%|
|PB BTC急落2%|201,392,633|3.9785|-14.5963%|

REV4だけ10bpsで+0.1546%の微増益ですがPFは低下、DDは改善せず。20bpsでは103,870,007円対現行103,817,988円、30bpsでは46,235,237円対現行46,612,070円。コストを強めると逆転し、独立期間の支持もないため昇格しません。

## High Confidence層

entry前の確定足出来高・方向別24h Momentum・BTC3h・BTC比RS24hで36ルールを比較。前半で30件以上かつ勝率70%以上の条件は0。前半終了後の決済結果を学習へ入れない時系列分割を使用。

前半だけで選んだ最良の探索用ルールの後半：A+191件・128勝67.02%、A174件64.94%、B181件61.88%。70%達成の新crypto A+層としては増額しません。

既存V52の価格モデルでは前半39件76.92%、後半48件85.42%（Wilson95%下限72.83%）。これは既存ルートの結果で、新しいcrypto選別Gateの証明ではありません。既に使った研究期間なので独立未使用OOSと呼びません。

## M05 Forward

条件は確定H1のPENGU72h return<=-0.50%、観測専用。候補はreferenceTs/SHORT_V20で独立化し、実Entry/Exit追跡とreturn集計を追加。永続台帳と15分タイマーで100件のrunner history上限から独立して保存。

別observerはrunner stateを読み取り、public priceだけを取得し、shadow保存領域だけへ書きます。注文・取消・Production state書換えなし。約定/決済途中足を除く完全包含H1のMFE/MAEを計算し、欠損はGAPとして残します。PF/平均損益はProduction overlayのnet account return基準であり、通貨建て実現PnLの取引所完全照合ではありません。

20〜30独立候補の蓄積は未来の発火待ちです。全体とM05差分群を別集計し、自動昇格は行いません。LIVE/HP SHAは `ce1edeead8d0f9e5d88e829d415057117502a335`。GitHub Actions `37670223866` はSUCCESS。7 trading runner＋2 safety serviceは同一SHAでactive/running、再起動0、Kill Switch OFF、Margin Guard HEALTHY。UIも同一SHAでactive/running。独立候補は0件。証拠は`live-evidence.json`・`ui-evidence.json`を参照。

## 検証・再現・限界

23構成、27コストケースの台帳で、独立再集計PF/勝率、入金1回、会計PASS、所有権重複0、candidate-to-trade一致、MTM欠損0を確認。市場入力501ファイルのhashも照合。policy/observerの自動テストは9件。

- `research-summary.json`、各`cases/*/result.json`：全指標。
- `cases/*/runs/*/portfolio-trades.jsonl.gz`・events・candidate-decisions：全台帳。
- `source-input-manifest.json`・`market-input-manifest.json`・`artifact-manifest.json`：入力・出力hash。
- `independent-verification.json`、`confidence-analysis.json`：独立集計と時系列分類。
- source：`scripts/research/run_five_improvements.py`、`five_improvement_policies.py`、`analyze_five_confidence.py`、`verify_five_improvements.py`。

市場入力は既存Windows保存先、エンジンは`research/current-vps-no-dca-bt-20261007`のpinned sourceを使います。初回全ケースは `python scripts/research/run_five_improvements.py`。各caseの原jsonlは圧縮保存されていても再実行時に生成されます。cost stressは環境変数FIVE_RESEARCH_COSTS=10,20,30でBASELINE/Q_REV_4を指定。

Entry候補は監査済み固定streamを再利用。Exit短縮で本来新たに生まれる全signalを再生成したわけではありません。過去板・market impact・pending・lock・取引所清算・実注文の遅延は未再現。current数量制約が過去も同じだったとは断定しません。この検証だけで新Production売買ルールを認証しません。
