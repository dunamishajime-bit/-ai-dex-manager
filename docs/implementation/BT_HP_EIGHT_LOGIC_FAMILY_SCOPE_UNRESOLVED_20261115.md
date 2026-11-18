# BT #481 — 8ロジックと元研究BTの名称スコープ照合（2026-11-15）

## 判定

**`NAMED_STRATEGY_SCOPE_NOT_PROVEN`**。STABLE4 Gross Capture V1の元エントリー台帳には10bps/30bpsとも7個の異なるロジック名称のみが存在する。要求されている「8ロジック」は8つの独立戦略なのか、V12等の統合管理Runnerを含めた数なのかは、現段階では**未確認**。8番目が取引0件だったとも、BTから除外されたとも断定しない。

| 元研究モデル採用エントリー数 | 10bps | 30bps |
| --- | ---: | ---: |
| V4 | 801 | 797 |
| Q102 | 107 | 107 |
| PENGU | 45 | 44 |
| V52 | 52 | 52 |
| IDLE | 10 | 11 |
| HYPE | 5 | 5 |
| FET | 8 | 8 |
| 合計 | 1,028 | 1,024 |

この行数は決済済み取引数でもシグナル候補総数でもない。台帳に存在したモデル採用エントリーのみ。

## Fail-Closed検証

`scripts/bt_hp_family_scope_audit.py`：10bps/30bps両モデルの元エントリーCSVから、完全SHA、モデル取引IDの重複、ロジック名称集合、各名称のruntime source SHA、route数を照合する。両コストケースのロジック/ソース差分は拒否。要求8個に対し独立名称7個のときはstatus `NAMED_STRATEGY_SCOPE_NOT_PROVEN`、終了コード2。名称数が8に達しても、独立戦略の証拠、経済パリティ、実約定は証明したとは扱わない。

合成テスト：`tests/test_bt_hp_family_scope_audit.py`（7件）。Python BT検証回帰テスト全101件PASS。

Private出力：`C:\tmp\bt481-eight-family-scope-audit-20261115.json`、SHA256 `14B342E7E013056E486304F5801B6E29D55694F906C2A9872F29A65E8F138E34`。元台帳はPCのprivate領域のみ。

## 次に必要なもの

登録済みの全戦略・Runnerの一覧と責務（独立エントリー戦略、統合execution manager、単なる監視Runner、無効化された戦略）を、現行本番source/pinと一致させて確定する。8番目がマネージャーなら「7戦略系統＋管理Runner」と明示、独立戦略なら元候補・発火0件の証拠や対象外の理由を揃える。V4はCodex切替中で競合を避け、こちらで本番変更・注文はしない。