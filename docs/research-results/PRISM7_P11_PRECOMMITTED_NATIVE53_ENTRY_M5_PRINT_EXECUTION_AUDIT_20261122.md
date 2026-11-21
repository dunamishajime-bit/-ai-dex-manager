# PRISM VII / P11 — 元natural SHORT V20実市場53件のH1 entryとM5の初回約定印字照合（分析前固定）

**Research only, no trading.** 元source固定 `1657e173d250ad58f53e62f7bb0a3428fb405496` のnatural ENTRY全53件を使用。今回の検証は**取引所の約定可能性を証明するものではない**。H1 entryTs/entryPriceは元ネイティブpure sourceと一致を固定し、診断値のみ別に出す。開発中のP10はREJECT済み。新しいEXIT条件を同時に変えない。

## 事前固定の個別判定

- 元source実市場3期間（PRE:2025-08〜09=6件、BASE:2025-10〜2026-09=40件、POST:2026-10〜11=7件）のSHORT自然ENTRY53全件を、M5公的アーカイブ4ファイルの正出来高印字に結合する。二重IDは `(period,id,entryTs)` で識別。元SOURCE H1 entryPrice（発火時点の次H1 OPEN価格モデル）を保持し**書き換えない**。
- そのH1の `entryTs +0/5/…/55min` の12本が全て連続存在するか確認し、各5mの`open, high, low, close, volume,takerBuy`を検査。欠損・重複はFAIL CLOSED。volume=0は約定なし、quote/orderbookがないためtime=entryTsの執行には使えない。
- `has_trade_in_first_m5`, `has_trade_during_entry_hour`, `first_trade_delay_min`(>=0またはnull), `first_positive_m5_open`, `first_positive_m5_close`, `sourceH1_open_minus_first_print_pct`, `first_trade_volume`, `before_first_trade_no_print_m5` を1件ずつ算出する。SOURCE H1 openとM5初回正出来高openが一致しても、取引所の特定注文fillを意味しない。
- 正出来高がH1開始時に無いがH1内後半に発生する場合、SOURCE H1 openで即時約定したという**timing claimは未確認**。H1全体に印字なしならSOURCE仮想エントリーの証拠がない（source H1 volume0の意味も別表示）。元取引の「勝ち」を勝ちのまま保持し、データの欠損を負けや勝ちへ勝手に変換しない。
- SOURCE H1のopenとM5初回正印字openの絶対乖離が>0.05%、>0.1%、>0.5%、>1.0%となる件数を区別。元の source H1/M5 provider mismatchがこの53候補とどの程度重なるか確認する目的。見かけの取引PnL/STOPはこの工程で再計算しない（entry repriceはSTOP価格とポジション履歴を変えるため）。
- 集計は3期間別／元native元勝ち29対負け24／exit理由で独立。source SHA256と全53台帳を保存、1件も欠落させない。未来の初回正M5印字は**実際の執行があった証拠ではなく研究用の事後観測**なので、entryの事前判定特徴には使用禁止。
- この検査結果をもってモデル勝率54.717%、P8B人工49.045%、P10不採用などの過去報告を修正しない。代わりに「経済シミュレーションを現実のfillへ結びつけるために何が不足しているか」を判定する。

依然未検証：独立未見OOS、指値/成行実約定価格とサイズ・手数料/SLippage/STOP gap fill、Funding、他Runner/Shared Gross、複利ポートフォリオ最大DD≤20%、PENGU勝率80%。本番VPS/Runner/STOP/注文/建玉/KillSwitch/HYPE変更なし。
