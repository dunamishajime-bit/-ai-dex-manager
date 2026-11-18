# PR #481 — 同一5分時点の複数エントリー／既存時価超過を分けたGross Gate監査（2026-11-15）

## 判定

**`MODEL_ADMISSION_GROSS_CUMULATIVE_VALID_EXISTING_MTM_OVERRUNS_NOT_ORDERS`**。研究用HYPE native TREND/STABLE4の10bps・30bpsについて、5分equity時点のモデルGrossは**同一時点の新規エントリーより前、成熟済みEXITの後に採取される**というSource Gross Reconcilerの契約に基づき、`MODEL_ENTER`の要求Grossを同時刻グループで合算し、Crypto3.0x/Stock1.5x/Total3.5xと照合した。モデルの実装フェーズ順序は保全するが、当時の取引所残高・注文・成行slippage/contract rounding・API遅延は再現されていない。

| 研究モデル入場の観測 | 10bps | 30bps |
| --- | ---: | ---: |
| MODEL_ENTER件数（期末未決済を含む） | 1,025 | 1,026 |
| MODEL_ENTERを含む5分時点数 | 842 | 845 |
| 同一5分時点に複数MODEL_ENTER | **176** | **174** |
| 同一時点の最大入場候補数 | 3 | 3 |
| 入場時点の**既存Stock MTM Gross**が1.5x超過 | **15** | **16** |
| その時点で新規Stock Grossを追加して既存超過を悪化 | **0** | **0** |
| 同一時点のすべての要求Grossを合算して新たにCrypto/Stock/Total上限を超過 | **0** | **0** |

元台帳の5分MTM中には上限を超える価格変動がある。しかし、元のsource equityスナップショット＋同じtickで採用された全戦略の要求Grossを合算した範囲では、新規entryによる**新たな上限超過は検出されない**。15/16時点のStock Gross事前超過はStock既存建玉のMark変動であり、追加されたのはV4などCrypto側。既存Stock超過を「発注直前にStockの無断レバを加えた」と誤認しない。

また、この照合は`MODEL_ENTER`だけが対象のため、もともとのエントリー候補/Blockの順序・予約中Gross・API競合・未約定STOPの拘束・古いpinの実建玉を取引所から検証した証拠ではない。**Production Shared Risk/Grossの証明ではない**。

## 再現実装

- `scripts/bt_hp_admission_gross_asof_tick_audit.py`：両費用についてsource決定IDのユニーク性、全105,121 MTM時点、モデルEntryのGate不通過0、V52はStock・他戦略はCryptoに分離して同一時点のGross合算、preexisting mark超過と新入場超過を別カウントする。新入場が新規超過を引き起こせばfail closed。
- `tests/test_bt_hp_admission_gross_asof_tick_audit.py`：9合成ケース。新規上限違反・既存上限の更なる悪化、欠損、非有限値・合算不正を拒否。全BT Python **252件PASS**。
- Private証跡：`C:\tmp\bt481-source-admission-gross-tick-replay-20261115.json`、SHA256 **`79D8DDC5D78326ED6DC02726388490F75BFCBF29DF585C51140C9A5806CD4C4D`**。

**残る本番一致Gate：** V4最新release/source再生、V52固定バケットの経済妥当性、Market/STOP/order-owner・slippageの署名付きデータ、7売買系統＋管理Runner Shared Riskの当時各ポジション状態。研究中の最大DD10bps−40.24%／30bps−27.37%はDD20%目標未達であり、Gross entry照合PASSだけで解決しない。LIVE Runner・注文・建玉・STOP・Kill Switch・HP承認変更0。