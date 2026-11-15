# BTページ — 切替後V4 SHA差分を研究成績と共に表示（2026-11-15）

PR #481 の研究用 `app/bt-verification/page.tsx` に、研究ソース `STABLE4_OPPORTUNITY_PROD_CAPS_20261114_GROSS_CAPTURE_V1` を選択した場合の明示的なV4 source pin差分メッセージを追加。

表示する重要な事実：2026-11-15にread-only manifestで確認したV4登録SHAは `e788abc82e80f9fc7ab0e1ba83fdb8be267eb513` であり、旧STABLE4研究モデルのV4ソースSHAと不一致。既に表示されているHYPE H48研究5件/Native TREND候補78件の別実装警告もそのまま保持。

この表示は **有効な研究ページのsourceCaseが当該STABLE4に一致する場合のみ**描画し、他の研究ケースが同じSHA・同じ不一致に該当するかを勝手に推測しない。画面メニュー／チャート構成／ローソク足・Balance UIは変更しない。

登録SHAの確認が直接証明しないもの：V4 main service LIVE稼働、当日の実約定・実建玉、STOP保護、Shared Risk/Gross、経済的な本番BT一致。研究モデルのDD・勝率を切替後のV4の成績として表示しない。

検証コード：`scripts/bt-hp-v4-pin-notice-selftest.ts`（条件・重要文言・正しいSHA・日付・HYPE警告保持・LIVE非認証を10 assertionで確認）。TypeScript型検査とNext.js buildを完了した後に独立Pushする。正式HPへのデプロイ・本番Runnerの変更なし。