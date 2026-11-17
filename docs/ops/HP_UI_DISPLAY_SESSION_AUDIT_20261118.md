# HP UI表示・セッション・判定進行監査（2026-11-18）

## 結論

- HPの表示層を小数点以下の上限付きフォーマッタへ統一した。
- 10分無操作で強制ログアウトするクライアントタイマーを廃止し、30日Cookieと15分ごとのkeepalive、focus/visibility復帰更新へ変更した。
- UI-onlyの正式GitHub Actions切替は成功し、ProductionのUI SHAは `6bc132fb543ba27b37eefbe0b87d93fbe8dc2a51`。
- 売買RuntimeのSHA、建玉、STOP、Kill Switch、Shared Risk、Gross制限は変更していない。
- UI切替後も判定周期は進行している。ただし、現在の注文発火0件はUI不具合ではなく、GLOBAL Kill Switch、V4 peer attestation、エントリー条件不成立、Q102のrate/kill-switch保護により安全側へ抑止されている。

## 実装

主なコミット：

- `d2a3d6e3a447f85271ce667dc53bda9e1dd4f166` — 表示桁数上限、セッション保持、UIテスト。
- `0e5f63bf3` — Q102の独立runtime lineage照合。
- `4fcd2275d` / `3eb0bdb17` — 正式切替ゲートの診断ログとheredoc修正。
- `2a5a740b4` — UI-only不変性証明の対象を取引runnerへ限定。
- `01f11979b` / `6bc132fb5` — realtime-rankingゲート診断と最終構文修正。

表示フォーマッタは `apps/production-ui/lib/display-format.ts` に集約し、ダッシュボード、建玉、判定状況、ランキング、HYPE/V4/Q102/FETの各パネルから利用する。無効値は長い小数や `NaN` を表示せず、`—` 等の安全なプレースホルダへ落とす。

認証セッションは `apps/production-ui/context/AuthContext.tsx` で30日Cookieを使用し、15分間隔と画面復帰時にkeepaliveする。旧 `jdex_last_activity` / `INACTIVITY_LIMIT_MS` は本番静的チャンクに存在しないことを確認した。`visibilitychange` のkeepaliveコードは本番静的チャンクに存在する。

## 検証

- UIテスト: 153 passed。
- TypeScript: `npx tsc --noEmit` 成功。
- Lint: `npm run lint` 成功。
- Production build: `npm run build` 成功。
- 正式Actions: [run 44148127128](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/44148127128) 成功。
- Actions内のranking API: HTTP 200、49 rows、`ok: true`。
- Actions内のQ102 detail: HTTP 200、`rankingAvailable: true`、`snapshotSource: ranking`、Q102 production SHA `ef1ab178e26a7bf5bddb6473467765edba242e1d`、19 items。
- `COMPLETE_SCORE_100_INVARIANT=PASS`。
- 公開 `/realtime`: HTTP 200。

## Production UIと取引Runtimeの分離確認

- `ai-dex-manager-ui.service`: active/running、MainPID `84785`。
- UI WorkingDirectory: `/home/deploy/disdex-trading/ui-releases/ui-realtime-ranking-6bc132fb543b`。
- UI release marker: `6bc132fb543ba27b37eefbe0b87d93fbe8dc2a51`。
- 取引Runtime `current`: `/home/deploy/disdex-trading/releases/7688ed7c93a1918d8b44837339b7da5584a868f5`。
- Actionsの不変性証明: `TRADING_SHA_UNCHANGED=7688ed7c93a1918d8b44837339b7da5584a868f5`、`TRADING_RUNNER_PIDS_UNCHANGED=PASS`、`ORDER_MUTATION_ATTEMPTED=FALSE`。

## 判定周期・発火監査（read-only）

| Runner | 周期/状態 | 発火判定 | 現在の理由 |
|---|---|---|---|
| V4 | active/running。03:28、03:30、03:33、03:35 JSTに判定 | `candidateCount=0`, `orderEnabled=false` | `V4_PEER_ATTESTATION_RETRY_REQUIRED`。PENGU peer inactive、IDLE peer failedのため安全BLOCK |
| HYPE | active/running。約15分周期で02:24〜03:25 JSTにtick | `ordersSent` なし、accepted entryなし | `HYPE_ZEC_NO_ACCEPTED_ENTRY`（entry window/条件不成立） |
| Q102 | active/running。01:02、02:02、03:00〜03:01 JSTに周期ログ | `ordersSent=0` | `V96 Kill Switch file is active but invalid` または `ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT` の `blocked-local` |
| FET | active/running。30秒前後で継続評価 | `ordersSent=0` | `FET_NO_BRK48_SIGNAL`。一部周期は `ASTER_GLOBAL_RATE_BUDGET_SATURATED` でdefer |

従って「判定処理が止まっている」のではなく、各runnerは実周期を進めた上で、安全ゲートまたはシグナル条件により発注を抑止している。V4のpeer不在、Q102の保護BLOCK、HYPE/FETのno-signalは、今回のUI変更範囲を超える本番Runtime課題であり、UI切替のために解除・迂回していない。

## 保護状態

- GLOBAL Kill Switch: `active=true`、`STABLE4_H48_CUTOVER`、理由 `STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f`。
- Crypto daily risk: `tripped=false`、loss `0%`、最大損失 `7.5%`。
- Margin guard: `HEALTHY`、`ordersSent=false`、`positionChangesSent=false`。
- Resident STOP observation: `ok=true`、positions `0`、unprotected `0`、orphan STOP `0`。

### 次の作業候補

UIの桁数・セッション問題は完了。注文発火を増やすには、UIを変更するのではなく、Owner承認の別タスクとしてV4 peer構成、Q102のKill Switch/rate-budget根因、HYPE/FETのシグナル条件をそれぞれ調査する必要がある。現行の保護機構を解除する変更は行わない。
