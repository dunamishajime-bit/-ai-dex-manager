# PRISM VII P12 — SOURCE native53出口：STOP到達5分足 vs source記録のEXIT時刻（結果閲覧前固定）

**研究のみ。Source pinned PENGU SHORT V20 `1657e173d250ad58f53e62f7bb0a3428fb405496` の元source自然候補53/53 entry・EXIT reason/price/exitTsは変更せず、M5印字時系列との一貫性のみ監査。実注文・STOP再発注・本番反映禁止。**

前提SOURCE理由の予想内訳：`SHORT_HARD_STOP`14、`SHORT_TRAILING_STOP`9、`SHORT_MAX_HOLD`28、`SHORT_V20_DEADLINE_EXIT`2。全件のdecisionReferenceTsはsource raw `pengu-native-lifecycle-modeled-exits.jsonl` から取得し、`sourceExitTs = decisionReferenceTs +1H` を強制確認。source STOP指定価格は元 `sourceExitPrice` とし、基準10/30bpsの元PnLは再計算しない。

### STOP=23件：M5価格印字で到達を確認

- **SOURCE決済判断をした完了H1** `[decisionReferenceTs, exitTs)` のM5 12本に対し、`volume>0` かつM5 `high >= sourceStopPrice` に初めて到達した5分足を検索。元sourceのSHORT STOPはBUY stopであり high 判定。M5 OHLCの価格と出来高を検査し、欠損・時間ずれ・重複・低品質をfail-closed。
- source STOP価格に印字高値が到達していない場合 `STOP_NO_M5_TRADE_TOUCH_IN_DECISION_H1` とする。source H1 high がSTOPに到達したがM5からは確認できないなら、source H1/M5 OHLC不一致の可能性として**モデル証跡の不整合**、ただし個別取引所のSTOP fill不在の断定にはしない。
- 到達した場合 `first_m5_trade_touch_open_ts`, `time_from_first_trade_touch_to_source_exitTs_min` 及び `decisionRefからの経過` を計算。sourceのEXIT時刻がtouch後最大60分遅いという場合、**決済理由と価格が同じでも時刻が実約定時刻と違う**可能性がある。
- trailingSTOPはその時点のsource watermarkに依存するため、初回タッチを決済判断H1のみに限定し、保有期間の以前の高値で判定しない。hardSTOPはentry価格固定だが先行他時刻のsource exit model対比は別研究に分離する。

### STOP以外=30件：次H1 openの印字可用性

- sourceExitTsを新H1の始点とする。次H1のM5に正出来高が現れるか、最初のM5で印字するか、初回印字まで何分遅れるかを全30件で照合。最初の正印字M5 OPENとsource EXIT価格差を記録（こちらもfill証拠ではない）。
- 次H1に一度もM5正印字がなければ `NO_TRADE_IN_SOURCE_EXIT_H1`、遅延印字は `MODEL_PRICE_ONLY_DELAYED_PRINT` とし、source EXITを仮想価格モデルのまま扱う。
- 入口時刻の印字とSTOP時刻の印字が同一ものと仮定しない。P11 source H1 entry検査（33最初5min/19遅延/1全印字なし）とは**別**のEXIT実行可能性監査。

### 全件不変・反証条件

- 元source自然53全行のperiod/route/entryTs/exitTs/entryPrice/exitPrice/native reason/source SHAを確認、全M5データを新規有利な取引として補完しない。
- 結果を勝率改善に使わない。以後、source-native STOPがM5触れたことと、発注サイズ・quote/queue・STOP gap execution・自己約定証跡は区別し、Signed fillsは0のまま。疑義も勝ちを損失に改竄せず、研究上の観測可能性フラグに記録。
- 各periodとHARD/TRAIL/MAXHOLD/DEADLINE内訳、現実に観測できた/touched vs not touched、時刻分布、source OHLC、raw archive SHAを全53個票とsummaryに保存。test/完全再実行のSHAを確認してGitHub PR #595の研究DraftのみへPush。
- 未見OOS、完全な注文/建玉/STOP状態機械、他Runnerの資金使用、Shared Gross、Funding、複利portfolio DD<=20%、PENGU80%を本監査で主張しない。
