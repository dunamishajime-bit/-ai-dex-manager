# PR #481 — HYPE native TREND対照比較を研究BTライブラリ画面へ実装（2026-11-15）

## 変更

BT `/bt-verification` の保存済み研究ライブラリに、native HYPE TRENDとHYPE未採用対照を **10bps/30bps各ペア**で比較する読み取り専用表を追加。元データはPCの非公開研究ライブラリだけにあり、APIでOwner認証された `ResearchLibraryEntry` のINDEXメタ情報から描画する。4件そろわない・ペア重複・実装status不正・Gross caps/初期資金/現金額/モデル件数条件が異なる場合は表を表示しない。

### 研究モデルとして検証済みの値（正式LIVEではない）

| 研究費用 | HYPE native TREND DD | HYPEなし対照 DD | DD差（絶対値・モデル） | HYPEあり勝率／なし勝率 |
| --- | ---: | ---: | ---: | ---: |
| 10bps | −40.24% | −36.69% | **3.55ポイント** | 62.70%／63.06% |
| 30bps | −27.37% | −23.71% | **3.66ポイント** | 60.10%／60.29% |

**双方DD20%を超過**。HYPEなしでは資金予約や代替戦略の採用時点も変化するため、この差をHYPE自体の純粋な損益寄与と解釈してはならない。さらにユーザー方針はHYPEを捨てずに入口・出口を再設計することであり、HYPE停止の正式提案ではない。10bps/30bpsは個別の複利モデル結果であって、平均して勝率を表現しない。

## 実装と証拠

- `lib/bt-verification/native-hype-sensitivity-comparison.ts`：非公開Owner一覧のsourceCase/費用/モデル出所/status/Gross上限・BTC足数を厳密照合。絶対DD差は研究INDEXの統計から再計算。
- `components/bt-verification/NativeHypeSensitivityPanel.tsx`：一画面に10/30bps両費用を比較。INDEXのみなら未照合と記載し、研究ファイル本体のSHA256は既存のOwner認証済み`再生`経路に任せる。
- `app/bt-verification/page.tsx`：研究ライブラリTabでINDEXの4ケースが揃った場合のみ比較表を表示。設定・再生・証跡ZIP・BTCローソク足の構成は維持。
- `scripts/bt-hp-native-hype-sensitivity-panel-selftest.ts`：本物のPrivate研究INDEX4件を照合し、不足/重複/モデルGross改ざん/LIVE偽装/未知sourceをfail closedでテスト。
- 実行テスト：比較4件PASS、V4 source mismatch UI assertion PASS、TypeScript型検査PASS、Next.js 16.2.6 webpackビルドPASS、研究Python **234件PASS**。

まだPR #481はDraft。正式HPデプロイ・LIVE Runner切替・注文・STOP・建玉・Kill Switchには変更を入れない。新V4 source pinの経済完全一致は引き続き`BLOCKED_REPLAY_REQUIRED`。