# BT #481 — HYPE TREND native出口モデルの独立M5再計算（2026-11-15）

## 主要結果

**`ARCHIVED_HYPE_EXIT_MODEL_EXACT_M5_PROXY_MATCH`**。2025-10-01 00:00〜2026-10-01 00:00 UTC (end exclusive) におけるHYPE TRENDの発火候補78件について、現行releaseの入口シグナル、ATR距離、本番Risk 5%×Gross上限1.5xのサイズ算定、Wallet Risk 2%の保護STOP計算、5分足STOP優先の出口モデルを独立に再計算した。

| 対象 | 結果 |
| --- | ---: |
| HYPE TREND入口シグナル | 78候補（前回のnative H1再生で78/78一致） |
| native ATR・保護STOP・利確レベル | **78 / 78一致** |
| 保存済みモデル決済時刻 | **78 / 78一致** |
| モデル決済価格 | **78 / 78一致** |
| モデル決済理由（STOP / TAKE_PROFIT） | **78 / 78一致** |
| 同一M5でSTOPとTPが両方成立 | 0件 |
| 追跡可能なM5履歴欠損 | 0件 |

個別78候補の再計算は**ポートフォリオ採用・実約定78件を意味しない**。別途保存済みHYPE単独single-slot・Funding考慮モデルの採用は56件（10bps/30bps共通）、そのモデル勝率26.79%。詳細な集計は本書後半参照。

## 現行ソースから確認した出口・資金算定

- イミュータブル本番HYPE release `a7eee1f91d86d51f2333da117243d044ae1332dc`。
- `lib/hype-trend-long-signal.ts`：確定済みH1からATR14を計算。STOP候補 `entry - ATR×2.5`、利確距離 `ATR×3`。
- `lib/hype-zec-long-runner.ts`：TRENDでは **`actualEntry + signal.trailingDistance`をTAKE_PROFIT_MARKET注文に使う**。この経路にdynamic trailing stop更新は確認できない。`trailingDistance`という名前だけで追従STOPと解釈しない。
- 同Runnerは保護 `STOP_MARKET` と `TAKE_PROFIT_MARKET` の取引所注文と読戻しを要求し、価格と最大168時間で退出する。モデルはvenueでの約定や注文同時競合を証明しない。
- `lib/hype-zec-long-sleeves.ts` のリスク数量：5% risk budget と1.5x Gross capの小さい方。単純な固定1.5xではなく、ATRが大きい局面ではGrossが下がる。
- `lib/disdex-exit-overlay-contract.ts` のWallet Stop：取引後保護として2% wallet risk、設定上の見積り `2×4bps fee + 20bps slippage + 2bps funding = 30bps`。長期LONGで `max(ATR STOP, Wallet STOP)` を採用する。
- `config/hypeTrendLongPolicy.ts` 最大保有168時間。ただし今回アーカイブ78件の決済はすべて先にSTOP/TPで起きたモデルで、168h決済と保有中のvenue quote出口の完全再現を検証したわけではない。
- native数式の検証対象は、アーカイブ研究モデルのNEXT H1 OPENでのエントリー価格・連続数量（端数なし）。実LIVEのre-quote、stepSize、tickSize、口座Wallet、他Runnerの既存建玉、Owner STOP所有は再現していない。

元研究台帳のexit UTCは5分足の**終了時刻**だったため、足の開始時刻との差5分を正しく調整した。また、最初に固定Gross=1.5xと誤認した53件は、ATRに応じた5%リスクベースの連続数量へ修正後78件すべて一致。これは検証器自身の修正であり、本番エンジンを改変してはいない。

## 単独Fundingモデルのリスク再評価（別物）

| 旧pin HYPE single-slotモデル | 10bps | 30bps |
| --- | ---: | ---: |
| 口座初期1万円→期間末 | 10,180.11円 | 8,856.34円 |
| 採用モデル取引数 | 56 | 56 |
| 勝率 | 26.79% | 26.79% |
| 最大実現DD | 19.32% | 23.26% |

当該旧モデルは他RunnerとのShared Gross、LossLimit、KillSwitch、V4 STOP owner、必要口座残高を再現しない。FundingはAster public funding eventsと推定Markに依存し、署名済みvenue funding cashflowではない。30bpsの単独モデル最大DDはユーザーの20%制約を超えるため、現状ではこのままLIVE戦略改善済みとは判定できない。

## 再現手順・private証拠

- 検証コード：`scripts/bt-hp-native-hype-exit-contract-audit.ts`。合成テスト：`scripts/bt-hp-native-hype-exit-contract-selftest.ts`（15ケース、source dataのギャップ・future/invalid input・M5 STOP/TP競合・bar end証拠をカバー）。
- 入力：Owner PCの`hype-aster-historical`内 Aster public BTC/HYPE H1、HYPE M5、`hype-trend-pinned-candidates.json`。現行releaseのimmutable `lib/hype-trend-long-signal.ts`、`lib/hype-zec-long-runner.ts`、`lib/hype-zec-long-sleeves.ts`、`lib/disdex-exit-overlay-contract.ts`、runtime policy等。非機密Runtime costはPC内のsanitized JSONで照合。生の秘密鍵は使用せず、公開/秘密のトレード情報はGitHubに添付しない。
- Private監査結果：`C:\tmp\bt481-hype-native-exit-contract-m5-audit-20261115.json`。
- 最新結果SHA256：`765a42e82d946d3da5b0b26c05e84071725ce9aec1932871bc860ea2b1040b48`。
- 出力には入力ソース全ファイルのSHA256と78モデル行の比較証跡を含む。

## 残存ブロッカー

**本番経済パリティと8ロジック統合BTは未完成**。HYPE候補78件を、HYPE単独single-slotの56件の扱いだけでなく、V4/PENGU/Q102/FET/IDLE/V52等との時系列競合、portfolio opportunity、risk cap、既存・pending exposure、venue tick/step、保護STOP受理・exit fill、funding cashflowへ接続して10/30bps全体系を再計算する必要がある。誤判定改善の採否は、再計算後にwalk-forward・人工相場・閾値揺らしを通す。

V4切替はCodex担当のため、この研究実行からV4サービス、本番HYPE Runner、注文・取消・STOP、正式HP、GitHub承認を変更していない。PR #481はDraft維持。