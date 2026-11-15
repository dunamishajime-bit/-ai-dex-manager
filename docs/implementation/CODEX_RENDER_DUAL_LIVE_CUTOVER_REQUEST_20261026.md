# Codex本番切替依頼：既存RENDERと独立RENDER SHORT

対象 repository: dunamishajime-bit/-ai-dex-manager
研究branch: research/render-dual-production-prep-20261025 (remote HEADを正本としてSHA確定)
必読: docs/implementation/RENDER_DUAL_PRELIVE_CODEX_FINAL_HANDOFF_20261026.md
状況: CODE_STAGED_NOT_VENUE_CERTIFIED、すべての新規LIVE Gateは標準OFF。実機実注文の認証証拠は未成立。

## 二つの実装契約

(1) 既存RENDER SHORT：既存エントリー、0.25x Gross、12時間保有、元のSTOP/TP/利益保護は変えない。最初の確定M5でマイナス1%以上なら120分監視し、120分後なおマイナス1%以上で最大含み益MFE+0.25%未満なら既存の保護付きreduce-only決済。約定直後のM5/初期MFE/部分約定/再起動を正確に検証。認証できない場合は新EXITだけOFF。

(2) 独立RENDER SHORT：OI不要。BTC確定H1 +0.15%以上、RENDER確定H1 -0.50%以下、直前確定H4 -0.15%以下、H1 taker売り53%以上、H1上ヒゲ/始値0.35%以上。6時間仮想Shadowの過去N/WR/PF Gateは不要（journalは監視だけ）。Gross上限0.75x（共有余力不足時は0.25〜0.75xに縮小）、レバ5倍クロス、TP+2.5%、STOP-2%、最大6時間、再エントリー12時間停止。全ロジック無条件最優先にはせず、既存V12/Q102/PENGUなどの所有権、採用済み同時刻候補、既存建玉、他の共有リスクを尊重する。追加Routeとして既存RENDERと別計上。

## 当方で完了した事前作業

独立worktreeでロジック分離、Gross、STOP/TP、6時間出口、永続状態、SHA-bound認証Gate、資金余力縮小計算、Shadow診断、初期損切りM5を実装しテストを完了。GitHub branchへPush済み。型チェックとテストPASS。参照VPSは前回read-only測定で current=7688ed7c93a1918d8b44837339b7da5584a868f5、V4 runtime=23ddd4b01fcff38cd10d4d4614221f93dc6b44e5。実行時に必ず最新SHAを再測定。

8ロジック研究BTは2025-08-10〜2026-08-10、10bps/30bps。
- 独立0.75x、既存通常優先：最終資産281,254,554円/169,494,414円、独立採用3件。
- 独立0.75x、無条件最優先：281,150,307円/167,935,780円、独立4件。利益悪化したため不採用。
- 現行IDLEの基幹建玉なし/同時刻core発火なしGateに合わせたより厳格な研究BT：281,029,648円/169,522,781円、独立採用1件、DD約14.515%/15.015%、各3回再現PASS。
研究は公開Binance M5 + 旧Native8 H1 walletモデルであり、LIVE Aster 約定・L2・Funding・現在のVPS 8戦略アンカーとの完全一致は未証明。成果ファイル：docs/research/results/render-dual-20261026/RENDER_CORE_FLAT_PARITY_NATIVE8_20261026.json

## Codexが最終切替前に必ず解決・実測すること

1. GitHub/VPSの最新ProductionとV4別runtime SHAを完全照合し、旧SHAへのロールバックや8ロジックの変更欠落なしに実装branchをマージ。systemd全Runner/PID/再起動数・positions/orders/pending/shared lock/risk/margin guard/kill switch/ディスクも点検。
2. 既存RENDERの実約定時刻、最初のM5確定足、部分約定中MFE、2時間watch、reduce-only保護、再起動復元を実取引所一次証拠で認証。断定できないときは認証Gate OFFのまま。
3. 独立RENDERの5xクロス、0.25〜0.75x容量制約、実STOP/TP readback、部分約定、価格/数量精度、6時間期限、保護付きreduce-only決済、同通貨排他と再起動復元の実Aster証拠を取る。
4. 現行のIDLE基幹建玉ゼロGateにより年間11の市場候補中、歴史的に1候補しか発注可能でない点を検証。既存建玉との同時保有を増やすなら新しいshared wallet/ownership条件・再統合10/30bps BTと承認を必須にし、勝手に優先度を上げない。
5. 最新Production条件と10bps/30bpsの真の8ロジック統合BT再計算、GitHub CI、Forward Shadow、SHAに署名された正式証拠、rollback artifact準備まで証明。証拠を偽造したり、Shared RiskやKill Switchを迂回してLIVEにしない。
6. 上記全てPASSで初めて、operator認証の元で最終LIVE切替。VPSリリースSHA、既存Runner稼働、保護注文、HP判定状況内の二つのルート名/入口/方向/Gross/EXIT/watch/異常の表示を検証。PushとCI、rollback後を追跡可能に記録。
7. 未達なら無理に切替えず、何が不足かを具体的な証拠とともに BLOCKED_* で報告。済んでいない作業をCOMPLETEとは報告しない。

サブエージェントは使える場合 gpt-5.6-luna / High reasoning。Discord問い合わせ不要。Xserver VPS root秘密鍵は接続済Windows PCのDesktop。秘密鍵やAPI keysは絶対にログへ出力しない。
