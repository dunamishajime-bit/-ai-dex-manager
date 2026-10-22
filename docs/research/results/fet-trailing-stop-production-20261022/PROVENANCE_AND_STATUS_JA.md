# FET BRK48 LONG 追従STOP Production実装の研究証跡

## 実装対象

- Policy: `FET_TRAIL_8P_GIVEBACK_4P`
- 対象: FET BRK48 LONG のみ
- アーム: 確定5分足終値で実約定平均価格比 `+8.0%`
- 追従: 最高確定含み益から `4.0` パーセントポイントを差し引く
- 実行: LONGに対してのみ、reduce-only `STOP_MARKET`
- 既存出口: 初期ハードSTOP、`+5% -> +3%` 利益保護、24時間決済を維持

## 研究一次ソース

- Branch: `research/fet-after-hype-render-tao-exit-20261022`
- SHA: `e0f39b9bf642f7cbffe0371b4c656ab64a4b91cb`
- Report: `FET_EXIT_FULL8_REPORT_20261022.md`
- Results: `FET_EXIT_FULL8_RESULTS_20261022.json`
- Selected case: `FET_TRAIL_8P_GIVEBACK_4P`
- 10bps selected ledger SHA256: `efb1603a83397da174423855f4143ea5bcb139c680b1d8aa01aba7d6c77502e1`
- 30bps selected ledger SHA256: `25d07849173423eae6beee104e988e388cf3725787d7842ab005ec7f05972885`

## 研究値（研究報告の固定値）

| 指標 | 10bps | 30bps |
| --- | ---: | ---: |
| 現行研究基準 Final Equity | ¥239,985,734.6618664 | ¥135,946,895.1553796 |
| 追従STOP後 Final Equity | ¥247,247,316.48637345 | ¥143,906,605.34174916 |
| Final Equity差分 | +¥7,261,581.82450705 | +¥7,959,710.18636956 |
| Max MTM DD | -14.603309760733396% | -15.80770763869479% |
| FET取引数 | 8 | 8 |
| FET追従STOP決済 | 3 | 3 |

この値はH1 price-model / confirmed-M5 research replayであり、実取引所のSTOP約定認証ではありません。

## 再現性確認

Pinned SHAの研究スクリプトを分離worktreeで指定ケース実行した。スクリプトは、Git管理下の現行研究ソースではなく、過去の絶対パスにあるlegacy bootstrap (`disdex-idle-basket-bt-20261019` など) を読み込み、その外部ツリーへ `state-pool.jsonl` を書き込む構造だった。現在の実行環境ではその外部書込みが `PermissionError: [Errno 13] Permission denied` となったため、今回のProductionブランチ上で新たな再計算値を生成したとは扱わない。

したがって、上表はPinned SHAに保存された研究報告・結果JSONと台帳ハッシュの provenance として保持し、今回のTypeScript実装を研究BTと完全Parityしたとは主張しない。研究BTと実venue証拠は別クラスである。

## LIVE実装の安全契約

- 完了済み確定5分足だけを読む。未確定足・欠損・不正OHLCは既存STOPを維持してFail Closed。
- 追従STOPは高値水準から緩めない。重複・古い足は無視する。
- 新STOPを取引所へ送信し、reduce-only・数量・価格をread-backしてから旧STOPを整理する。
- 旧STOPの整理に失敗した場合は新STOPと旧STOPを残し、手動レビューへ移行する。無保護化やテスト成行は行わない。
- 部分約定後は実建玉数量に合わせて新STOPを先に設置し、再起動後は永続化した高水位・STOP IDを復元する。
- 実際のFET追従STOPのvenue fillが未観測なら、Production完全認証済みとは報告しない。
