# RENDER #4427 — IDLE Client Order ID と Route identity の分離監査（研究専用）

監査日：2026-10-26 JST。**新規確認事項**：GitHubに存在するIDLEのLIVE向け実装では、`deterministicIdleClientOrderId` のハッシュ入力が `IDLE_PRIORITY_SHORT | action | upper(symbol) | signalTs` であり、**Owner/Route/Grossは含まれない**。同じ通貨・action・signal timestampを持つ既存RENDERルートと研究独立SHORTルートは、ルート名が異なっても同じclientOrderIdに写像される。これは実注文衝突が起きた証拠ではなく、同一通貨の重複発注を防ぐための意図的な冪等化でもあり得る。

## GitHub一次コードと境界

- 固定source commit: `031953373ec09e2902e0e6eefa0afb19e4d163f4`
- `lib/idle-priority-short-live.ts` 実バイトSHA256: `185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c`。clientOrderId関数の入力と出力形式を静的照合。
- `lib/idle-priority-short-runner.ts` 実バイトSHA256: `0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33`。ENTRY/EXIT/STOP呼出と、pendingの`route: signal.route`、`idempotencyKey: clientOrderId`を静的照合。
- `config/idlePriorityShortPolicy.ts` 実バイトSHA256: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`。既存RENDERルートの存在と研究Route未登録を確認。

**重要な区別**：`pending.route`は独立した属性として記録される一方、取引所へ渡す`clientOrderId`はルート非依存。同一時刻に複数ルートが競合する場合、取引所注文IDだけではどの研究ルートが選ばれたかを証明できない。ルートの優先順位、Ownerの選択、共通台帳、account lock、same-symbol dedupは別途一次証拠で結合する必要がある。**単にrouteをIDに加えて複数発注を可能にする変更は禁止**。

## 独立検証

GitHubにコミットした監査スクリプト `scripts/dd-reduction/audit_render4427_route_blind_client_id_20261026.py` を所有PCの許可研究領域から、GitHub原本をインメモリ取得して独立Python 2プロセスで実行。実装ファイルはimport/execせず、固定バイトSHAと静的コードアンカーを照合し、ハッシュ入力式の純粋なPython等価モデルのみを合成試験した。

- 3最適化レベル（0/1/2）×7判定×独立2プロセス＝**42/42 PASS**。
- 同一通貨・同一action・同一signalTsでルートだけ変更した合成例は同一ID。時刻、action、symbolの変更ではIDが変わる。大文字小文字は正規化される。
- PC取得監査スクリプト実バイトSHA256: `0db01a34f2f23490d20e64c3f1aaa696e8c2c30f5645b6646f1de124583e1aef`
- 2プロセスのcanonical JSON SHA256: `edcd6d18caa7a05c2e631876cb8b911e7198957494058911da7e50d9d31287f3`（完全一致、exit code 0）。

## 未成立と次の監査

この結果は**GitHub固定コミットの静的コード監査と合成ID計算**であり、現在VPSで動作しているLIVEバイナリ・注文ID・実注文競合を監査したものではない。真正なNative8 preallocation/owner-priority呼出経路、独立operator trust root、完全dynamic import/patch closure、13 GateProof、inventory sequence/freshness、Native8永続dedupとOwner/Route登録は未認証。

今後は、ルート選択の真正な決定証拠と、同一symbol/time/actionに対する共通の冪等キー・単一予約・pending/account lockの原子的結合を**研究専用**で追跡する。5/27同一RENDER建玉競合は引き続き拒否。6/23・6/25は真正一次証拠不足なら拒否。新経済BT、LIVE採用、実注文は行わない。

VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、既存worktree、PCの`C:/tmp`は一切変更していない。成果物は新隔離GitHub研究ブランチのみ。
