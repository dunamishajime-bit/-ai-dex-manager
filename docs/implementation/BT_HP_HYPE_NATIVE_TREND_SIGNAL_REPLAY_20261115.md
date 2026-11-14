# BT #481 — 現行HYPE TREND入口シグナルの独立時系列再計算（2026-11-15）

## 結果

**`CURRENT_HYPE_TREND_SIGNAL_MATCHES_PRIOR_PINNED_CANDIDATES`**。現行HYPEソース由来のネイティブ `buildHypeTrendSignal()` を、アーカイブしたBTC・HYPEのH1確定足で、各時点までのprefixのみを渡して実行した。

| 指標 | 実測結果 |
| --- | ---: |
| 使用したBTC H1足 | 8,928本 |
| 使用したHYPE H1足 | 8,928本 |
| 再実行した本番TREND入口シグナルの発火候補 | 78件 |
| 過去pinモデルの既存HYPE TREND候補 | 78件 |
| signal timestampの一致 | 78件 |
| 余剰発火候補 | 0件 |
| 不足発火候補 | 0件 |
| 本番約定/保護STOP/出口の再現 | **未証明** |

モデル対象期間：`2025-10-01T00:00:00Z` から `2026-10-01T00:00:00Z`（終端除外）。データの開始は2025年9月24日、初期の240期間レジームEMA等の計算に必要なwarmupの不足は保留/不発火として扱う。

旧リサーチpin `d6bcc94512a6416189cd92d7203b2c98e70` と、本番release `a7eee1f91d86d51f2333da117243d044ae1332dc` の入口関数とポリシーをCRLF正規化して比較し完全一致。

- `lib/hype-trend-long-signal.ts` の正規化SHA256：`ee81fe2beeaeacaf5ce3bd06cbeb9aa76cb00086e35878e9b7435d8584d5f13c`
- `config/hypeTrendLongPolicy.ts` の正規化SHA256：`9c848a911dabcb8b5827eeb1072a3943034aa76671beaefca2e3854c3923cdad`

独立リプレイ実装：`scripts/bt-hp-native-hype-trend-h1-signal-replay.ts`、9件の入力連続性・不正足・候補集合検証：`scripts/bt-hp-native-hype-trend-h1-selftest.ts`。

private原データ：Owner PC `C:\tmp\disdex-bt-20251001-20261001\hype-aster-historical`。旧pinソース：同 `pinned-source\HYPE`。現行releaseソースコピー：`C:\tmp\bt481-hype-live-source-20261115`。

private再計算JSON：`C:\tmp\bt481-native-hype-trend-h1-replay-20261115.json`。

結果JSONのSHA256：`bc6e50172b642cf325a621ff11e8662f18ca2a3ddee0cea46f49555073346adf`。

## 一致範囲と未検証範囲

入口関数の算出条件と過去の候補集合は一致したが、**78件は建玉や実約定78件を意味しない**。Shared Kill Switch、V4 STOP所有、Portfolio Opportunity比較、Shared Risk/Gross、価格スリッページ、Funding、exit STOP、実数量、日次損失上限、優先順位など、Runner実行時の制約を通過した証明ではない。

また、STABLE4研究モデルHYPE `HYPE_REDESIGN_CAUSAL_H48R4_WSIG` の5採用取引は別の研究ロジックであり、78件の本番TRENDシグナルに置換するだけでは他Runnerとの資金競合が変化する。単なる5→78件置換、勝ち負けの選別、過去PnLの合算は禁じる。入口・出口・Gross・全Runner競合を含めて10bps/30bpsの統合BT全体を再実行すること。

同時にV4はCodexが切替作業中であり、本検証でV4または本番HP/Runner/注文/STOPは操作していない。PR #481はDraftのままとする。