# PRISM VII P23 — 5分足保有中の未実現DDを追加するとS4はDD20%条件を満たさない

**Production切替不可。** 結果を見る前に `PRISM7_P23_PRECOMMITTED_SOURCE_M5_MARK_TO_MARKET_RISK_GATE_20261122.md` に固定した同一source M5正印字から、原SOURCE V20自然53と新P20/P21/P22を**実現損益＋保有中マーク**で個別再計算。源ピン `1657e173d250ad58f53e62f7bb0a3428fb405496` 本番ロジックは不変更。全群に同一1.0x gross、口座開始10,000円、共通REFERENCE_STOP72、両側合計10bps/30bps・追加EXIT滑り0/10/25bps（合計24scenario）を使用。未来の相場をentrySignalに混ぜず、実口座を呼び出さない。

## 比較結果（30bps、追加EXIT滑り0、単一枠）

| 4グループ | 完了した価格proxy取引 | 計算終端時の未決済 | 元の実現済みDD | **正出来高M5確定CLOSEを含むDD** | **M5 HIGH不利stress DD** |
|---|---:|---:|---:|---:|---:|
| SOURCE V20 fixed自然入口+同一参考STOP | 33 | 0 | 28.075% | **32.453%** | **32.453%** |
| S3独立構造P20 | 53 | 0 | 44.743% | **47.302%** | **47.462%** |
| S3売り成立P21 | 34 | 0 | 31.167% | **40.511%** | **41.073%** |
| **S4買い戻り失敗P22** | **21** | **1** | **16.102%** | **35.942%** | **37.647%** |

S4で参考口座1万円・単純1倍元本での実現済み決済21取引だけを順次複利した値は25,847.774円。**未決済1建玉の最終正印字価格を含めると25,557.317円**となり、SOURCEモデルの未実現損益を無視した数字との相違も明示。これは実口座残高の推定や未来に必ず達成する金額ではなく、価格モデルの研究経済値。

- 終値ベースでS4の最悪ポートフォリオDDを生んだ取引は `S3_02173`（マークモデルの参考equity 約10,850円、SOURCE M5 time `1761873900000`）。M5足内HIGHを先に観測するストレスenvelopeでは `S3_01700` が最悪で、equity 約10,561円（SOURCE M5時刻 `1760132100000`）。highはSTOP発動**後**に発生していた可能性もあるため `HIGH_ADVERSE_ENVELOPE` は厳密な本番約定DDでなく、足内順序が未知な保守シナリオ。
- SOURCE V20も元のnative本来のSTOPを再演したわけではなく、**全グループの入口構造の相違を共通参考STOPで比較している**。PENGU V2/RecoveryV8等の建玉共有、実際の数量、Funding、quote/BidAsk、STOP Market gap、Cross gross、手数料の段階計算、owner signed fillsは含まない。
- 正出来高M5 closeで経過をマークし、0出来高M5は直前正印字closeを持ち越し、取引可能なBid/Askと主張しない。Source OPEN価格もM5確定以降に初めて観測できる部分がある（P11/P12）。
- HARD STOP +8%と30bps total feesの参考1x負けは約−8.3%。**shared daily loss7.5%閾値との整合性を更に慎重に検査すべき**。本検証はKill Switchや日次計算境界の時系列を実装しておらず、正式risk systemが超過することを証明したわけではない。
- P22の既見21件勝ち15（71.43%）と条件付きPF3.906・平均+4.934%は、**未実現含むDD35.94%という不合格**を覆せない。Portf現物と他Runnerを含む最大DD≤20%は証明されず、Production/LIVEには採用不可。

## 全証跡、再検算

- `scripts/research/prism7_p23_m5_mark_to_market_censored_position_risk_20261122.py`：SOURCE native original、S3 P20、S3 P21、S4 P22を同じPENGU M5 raw SHAで個別比較。最新正印字H1/M5相場情報のみで時点の含み損益を計算、SOURCE STOP/fillの価格モデル自体には手を触れない。
- `scripts/research/test_prism7_p23_m5_mark_to_market_censored_dd_contract_20261122.py` **5/5 PASS**。全24 cost scenarios、4groupの未決済SOURCE1保持、5M終値DDとHIGH stress DD大小関係、元source event ID/feeの一致を検証。
- P22 regression `scripts/research/test_prism7_p22_failed_rebound_fsm_source120_20261122.py`も6/6 PASS（併せて11/11）。
- 全24条件の報告 `docs/research-results/prism-phase2-20261122/PRISM7_P23_M5_MARK_TO_MARKET_RISK_SUMMARY_20261122.json`
- 4群の建玉別worst M5/時刻/直近正印字/無出来高/途中DDを付記した142個票 `docs/research-results/prism-phase2-20261122/PRISM7_P23_M5_MARK_TO_MARKET_TRADE_RISK_LEDGER_20261122.json`
- INPUT Source H1/M5 gzip及びP20/P21/P22台帳SHA256を固定、**独立再実行でsummary+riskledger 2出力SHA256一致**
  - summary `36651dd5579ec84da5db4d7b2d80abe4520f62faa34fff7d7e63710c21764b70`
  - 142個票 `573ef0dcb44503151463df0eee32d9b4f6b3e5902a793e3c721c3012dd201373`

## 判定と次の必要工程

**P20 REJECT、P21・P22は候補研究のみ、Production反映はREJECT**。P22でENTRY構造を段階化した結果、条件付き勝率・PF・絶対利益の源モデルは良くなったが、総合DD20%を大幅超過しており、同時取引リスク制御は不成立。次の研究は**DDが大きくなった個別保有中の価格経路、売り構造の失敗率、entry直後BUYER squeeze・取り戻しの区別**へ戻る。局所STOPや部分利確率の最適化だけでは、P10/P19で既に期待利益を破壊した。利益を守りつつDDを減らすこと、実市場約定による検証、独立真正OOSを最終採用条件とし、数件勝ちだけでPENGU80%を認定しない。

**本番master/VPS/Runner/建玉/実注文/STOP/HYPE/KillSwitch未変更。GitHub PR #595 Draft研究のみ。**
