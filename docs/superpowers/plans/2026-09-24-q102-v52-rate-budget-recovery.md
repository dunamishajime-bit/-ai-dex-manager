# Q102 / V52 Rate-Budget復旧 実装計画

> **エージェント実装者向け:** 必須サブスキル: `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` を使い、この計画をタスク単位で実施する。各ステップはチェックボックスで管理する。

**Goal:** 古いQ102 AVAX pendingを証拠に基づいて安全に照合し、Q102のfresh stateを確認した後にV52を復旧する。同時にAster rate-budget混雑をV12/PENGU/Q102/V52/FETで一貫してFail Closed処理する。

**Architecture:** TypeScript/Python共通の事前HTTP rate-budgetエラー判定と、両言語が共有する優先度付きrate-budget queueを実装する。各Runnerは新規exposureを止めて限定backoffし、Q102 one-shot recovery、systemd再起動制限、原因限定Kill Switch recoveryを追加する。戦略ロジックは変更しない。

**Tech Stack:** TypeScript/Node（`tsx --test`）、Python（`unittest`）、systemd runtime wiring、GitHub Actions、Git SHA immutable VPS release、Aster authenticated read-only diagnostics。

**Implementation branch/base:** `codex/q102-v52-runner-recovery-20260924` / `43a604e3940d4f3b4229ef586a178dd1fa258768`（Production runtimeを基点とし、Research branchはsourceにしない）。

**Spec:** `docs/superpowers/specs/2026-09-24-q102-v52-rate-budget-recovery-design.md`

## Global Constraints

- 戦略signal、selection、priority、sizing、gross limit、exit ruleを変更しない。
- operator activation、Global Kill Switch、Shared Risk、Margin Guard、account-order lock、Fail Closed preflightを迂回しない。
- 検証目的のsynthetic/test/forced/cancel/flatten/duplicate orderを出さない。
- state/Kill Switch JSONを手編集しない。既存state schemaの全fieldを保ち、unknown/malformed fieldは書き込み前に拒否する。
- 事前のbudget coordination errorをAster HTTP/API errorとして扱わない。venue requestは未送信である。
- unknown、malformed、stale、credential、HTTP 429/418、connection、execution-state errorを区別し、既存のFail Closedを維持する。

## Review Focus

1. **pendingだけ残り、注文がvenueに到達した可能性:** 3回連続のauthenticated read-only照合、order lookup not-found、userTradesなし、position/open orderなし、pending identity不変を必須化する。矛盾する応答はすべて無変更で拒否するテストを置く。
2. **lock timeoutをHTTP 429やmalformed stateと誤分類:** 既知の事前scheduler errorだけをdeferとし、418/429、malformed、connection reset、unknownを非deferとするテーブルテストを置く。
3. **priority starvationまたは終了processのstale waiter:** cross-process順序、waiter lease期限、bounded saturationをテストし、高priorityがpermit確定前のnew-entry waiterを追い越し、死んだprocessがqueueを塞がないこと、期限内にpermitを得られない低priority waiterはFail Closedで除去され新規exposureを送らないことを確認する。
4. **旧新runtime混在で共有queueを上書き:** v1→v2 migrationとruntime wiringを確認し、全rate-budget consumerが同一SHAへ切替済みであることをdeploy前ゲートにする。
5. **検証とwriteの間にstate/Kill Switchが変化:** lock下でstate bytesとexact latch reasonを再照合し、race時は書き込みゼロとする。

---

### Task 1: 共通rate-budget error policy

**Files:**
- Create: `lib/disdex-aster-rate-budget-policy.ts`
- Create: `scripts/disdex_aster_rate_budget_policy.py`
- Test: `tests/aster-rate-budget-policy.test.ts`
- Test: `tests/test_aster_rate_budget_policy.py`

**Interfaces:**
- TypeScript: `classifyAsterRateBudgetFailure(error: unknown): { kind: "RATE_BUDGET_DEFERRED"; reason: string; waitMs?: number; priority?: AsterRatePriority } | undefined`。
- Python: `classify_aster_rate_budget_failure(error: BaseException | str) -> dict | None`。`kind/reason/waitMs/priority`はTypeScriptと同じ意味。
- Queue saturation errorは既存message prefixを維持しつつ、`waitMs`と要求`priority`を機械可読fieldとして保持する。
- TypeScript/Pythonのbackoff helperは`max(waitMs, baseMs * 2^attempt)`を基礎にbounded positive jitterを足し、`maxMs`を上限とする。依存注入したrandomで決定的にテストできる。
- defer対象は、整数ミリ秒suffixを持つ`ASTER_GLOBAL_RATE_BUDGET_SATURATED:<ms>`、および`ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT` / `...LOCK_RELEASE_FAILED` / `...RECOVERY_LOCK_RELEASE_FAILED`のみ。

- [ ] **Step 1: TypeScript REDテストを追加する。**

```ts
test("classifies only known pre-request Aster budget failures", () => {
  assert.deepEqual(classifyAsterRateBudgetFailure(new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005")), {
    kind: "RATE_BUDGET_DEFERRED", reason: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005", waitMs: 5005,
  });
  for (const message of ["ASTER_GLOBAL_RATE_BUDGET_MALFORMED", "HTTP 429", "ECONNRESET", "UNKNOWN"]) {
    assert.equal(classifyAsterRateBudgetFailure(new Error(message)), undefined);
  }
});
```

- [ ] **Step 2: `npx tsx --test tests/aster-rate-budget-policy.test.ts`を実行し、export未実装による想定REDを確認する。**
- [ ] **Step 3: 同じ受理/拒否表をPython testへ追加し、`python -m unittest tests.test_aster_rate_budget_policy -v`がmodule未実装でREDになることを確認する。**
- [ ] **Step 4: 2言語のclassifierとbackoff helperのみ実装し、両testをGREENにする。**部分文字列`"rate limit"`のような広い分類は禁止。wait/priority metadataを保持し、backoffがqueueのwait時間より早くならず、上限を超えないことを確認する。
- [ ] **Step 5: `feat: add canonical Aster rate-budget error policy`でcommitする。**

### Task 2: Node/Python共通の優先度付きbudget queue

**Files:**
- Modify: `lib/disdex-aster-global-rate-budget.ts`
- Modify: `scripts/disdex_v13d_v11eq_stock_live_engine.py`
- Test: `tests/aster-global-rate-budget.test.ts`
- Test: `tests/test_aster_global_rate_budget_python.py`

**Interfaces:**
- 優先度: `PROTECTIVE` > `RECONCILIATION` > `RISK_READ` > `MARKET_DATA` > `NEW_EXPOSURE`。
- TypeScript `reserveAsterGlobalRateSlot({path,minIntervalMs,maxQueueMs,weight,priority})`とPython `wait_for_aster_global_rate_budget(weight, priority)`が同一queue JSON contractを使用する。
- queue schema `disdex-aster-rate-budget/v2`: `nextAllowedAt`, `updatedAt`, `pid`, `waiters[]`に加え、現行rate-limit cooldown metadata（`cooldownUntil/lastRateLimitStatus`）を保持する。waiterは`requestId/priority/enqueuedAt/leaseUntil/weight/pid`を持つ。lock file schemaは現行v1を維持する。
- 既存v1 budget stateはlock下でv2へ移行し`nextAllowedAt`を保つ。permitを未来のrequestへ先行予約せず、`nextAllowedAt <= now`の時だけ最優先waiterがclaimする。これによりpermit確定前なら後着high-priorityがnew-entryを追い越せる。

- [ ] **Step 1: REDテストを書く。** high-priority overtaking、同priority FIFO、期限切れwaiter除去、saturation時の自己waiter cleanup、v1→v2 migrationで`nextAllowedAt`維持、cooldown/status metadata保持、安全優先requestのdeadline失敗時はFail Closed、期限超過した`NEW_EXPOSURE` waiterがpermitを奪わず除去されることをそれぞれテストする。
- [ ] **Step 2: `npx tsx --test tests/aster-global-rate-budget.test.ts`を実行し、追加assertがpriority/lease/migration未実装で失敗することを確認する。**
- [ ] **Step 3: Python parity testを追加し、`python -m unittest tests.test_aster_global_rate_budget_python -v`で同じREDを確認する。**
- [ ] **Step 4: locked waiter登録、FIFO/priority選択、lease更新とprune、permit claim、timeout cleanup、v1→v2 migrationを実装する。** weighted request accounting、既存min interval、`nextAllowedAt`、418/429 cooldown metadata、malformed state Fail Closedを保つ。`PROTECTIVE/RECONCILIATION/RISK_READ`がdeadline内にslotを得られない場合、既存hold/fail-closed経路へ渡し、古い状態をfresh扱いしない。
- [ ] **Step 5: Node/Python subprocessを同じ一時budget pathへ並行接続するintegration testを追加し、両test suiteで同一schema・単一permit・priority順・bounded completionを確認する。**
- [ ] **Step 6: telemetry testを追加する。** queue wait、priority、decision classを記録し、credential/signed payloadを含めずmutation countersが0であることを確認する。
- [ ] **Step 7: `feat: prioritize shared Aster rate-budget requests`でcommitする。**

### Task 3: Aster clientのpriority割当

**Files:**
- Modify: `lib/aster-v3-client.ts`
- Modify: `scripts/disdex_v13d_v11eq_stock_live_engine.py`
- Test: `tests/aster-global-rate-budget.test.ts`
- Test: `tests/test_aster_global_rate_budget_python.py`

**Interfaces:**
- `AsterV3Client`はmethod/path/order paramsからpriorityを決める。reduce-only/protectiveは`PROTECTIVE`、state/account照合は`RECONCILIATION`または`RISK_READ`、market dataは`MARKET_DATA`、non-reduce-only orderは`NEW_EXPOSURE`。
- Python request adapterは同じ分類表を使う。

- [ ] **Step 1: REDテストを追加する。** 注文の`reduceOnly=true`とprotective orderが`PROTECTIVE`、non-reduce-only entryが`NEW_EXPOSURE`、position/openOrdersが`RECONCILIATION`、quotes/klinesが`MARKET_DATA`になることをassertする。
- [ ] **Step 2: TS/Python rate-budget testを実行し、request priorityが未配線のためREDになることを確認する。**
- [ ] **Step 3: 各request adapterにpriorityを配線する。**署名対象payloadやrequest weightは変更しない。
- [ ] **Step 4: TS/Python budget suiteを再実行し、同一priority分類を確認する。**
- [ ] **Step 5: `feat: classify Aster request priority`でcommitする。**

### Task 4: V12/PENGU runnerの共通defer

**Files:**
- Modify: `lib/v12-live-execution-engine.ts`
- Modify: `lib/pengu-live-scheduling.ts`
- Modify: `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- Test: `tests/v12-rate-budget-resilience.test.ts`
- Test: `tests/pengu-live-scheduling.test.ts`

**Interfaces:**
- rate-budget classifierはTask 1の共通関数のみ使用する。
- V12/PENGU daemonは`RATE_BUDGET_DEFERRED`をbounded backoffへ変換し、manual review/unknown/staleは短周期retryしない。
- 各runnerは構造化defer eventに`errorClass/queueWaitMs/priority/decision/ordersSent/cancelsSent/positionChangesSent`を記録する。秘密情報・署名payloadは記録しない。

- [ ] **Step 1: V12/PENGU REDテストを書く。** exact budget saturationで新規order/cancel/position change=0、shared KSW call=0、retryがboundedであること、unknown/429/malformedでは既存Fail Closedであることをassertする。
- [ ] **Step 2: `npx tsx --test tests/v12-rate-budget-resilience.test.ts tests/pengu-live-scheduling.test.ts`を実行し、各追加assertが未配線で失敗することを確認する。**
- [ ] **Step 3: V12 local classifierをTask 1の共通classifierへ置換し、PENGUのscheduling helperは共通bounded-backoff helperを使ってbudget deferだけを限定retryする。**signal/rank/gross gateは変更しない。
- [ ] **Step 4: 構造化defer telemetryを実装する。**exact reason, queue wait, priority, decision, mutation counters=0を出力し、HTTP/secret/signature情報を出さない。
- [ ] **Step 5: focused testsとV12/PENGU self-testsを再実行し、mutation counters=0を確認して`fix: defer rate-budget saturation in V12 and PENGU`でcommitする。**

### Task 5: Q102/FET runnerの共通defer

**Files:**
- Modify: `lib/quality102-live-scheduling.ts`
- Modify: `scripts/disdex-quality102-causal-v1-live-runner.ts`
- Modify: `lib/fet-brk48-live-runner.ts`
- Modify: `scripts/disdex-fet-brk48-live-runner.ts`
- Modify: `tests/quality102-live-scheduling.test.ts`
- Test: `tests/fet-brk48-live-runner.test.ts`

**Interfaces:**
- Q102/FETもTask 1の共通classifierを使用し、budget deferとpending/state preflight拒否を区別する。
- FET budget errorはprotection failureのemergency flatten pathへ流さない。protection未確認時はmanual-review/Fail Closedを維持する。
- 両runnerのdefer telemetryはTask 4と同じfield/counter contractを使う。protective/reconciliation deadline不成立はdefer成功やfreshnessとして記録しない。

- [ ] **Step 1: REDテストを書く。** Q102のbudget errorだけbounded backoff、pending preflight errorはshort retryなし。FETのbudget deferではorders/cancels/position changesとflattenが0、protection errorでは既存safety behaviorを維持する。
- [ ] **Step 2: `npx tsx --test tests/quality102-live-scheduling.test.ts tests/fet-brk48-live-runner.test.ts`を実行し、追加assertが失敗することを確認する。**
- [ ] **Step 3: Q102 scheduling/daemon catchを共通classifierへ接続し、pending reconciliation failureは従来どおりFail Closedにする。**
- [ ] **Step 4: FET runnerがbudget denialをorder/protection failureとして誤処理しないようにする。**共通bounded backoffと構造化telemetryを使い、protective/reconciliation deadline failureは既存hold/fail-closedへ渡す。
- [ ] **Step 5: focused tests、Q102/FET self-testsを実行し、orders/cancels/position changes=0を確認して`fix: defer rate-budget saturation in Q102 and FET`でcommitする。**

### Task 6: V52 Python runnerの共通defer

**Files:**
- Modify: `scripts/disdex_v13d_v11eq_stock_live_engine.py`
- Modify: `scripts/disdex_v52_aster_only_legacy_engine.py`
- Test: `tests/test_aster_global_rate_budget_python.py`
- Test: `tests/test_v52_upstream_fail_closed.py`
- Test: `tests/test_v52_transient_opportunity_retry.py`

**Interfaces:**
- V52は同じ`RATE_BUDGET_DEFERRED` structured eventとbounded backoff contractを使い、単発のlocal queue missをShared Kill Switch causeにしない。
- safety-critical V52 account/protection readsがdeadlineを越えた場合はfresh/healthyを主張せず、既存Fail Closedを維持する。

- [ ] **Step 1: REDテストを書く。**`ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005`でshared Kill Switch、flatten、order、cancel、position mutationが起きずdefer eventが1件記録されることをassertする。未知fatalは既存KSW動作を維持する。
- [ ] **Step 2: 3つのPython suiteを実行し、budget saturation testの想定REDを確認する。**
- [ ] **Step 3: Task 1 policyと共通bounded backoffをV52 catch境界へ接続し、構造化defer telemetryを追加する。**HTTP 429/418やunknown errorをlocal deferへ落とさない。
- [ ] **Step 4: 該当suiteに加え`python scripts/disdex-v52-daily-loss-selftest.py`と`python scripts/disdex_v96_v52_margin_guard_selftest.py`を実行し、loss/margin挙動不変を確認する。**
- [ ] **Step 5: `fix: keep V52 local rate backpressure out of shared kill switch`でcommitする。**

### Task 7: Q102 planned pendingのone-shot recovery

**Files:**
- Create: `scripts/disdex-quality102-pending-order-recovery.ts`
- Modify: `lib/disdex-quality102-causal-v1-state.ts`（型付きstate遷移が必要な場合のみ）
- Test: `tests/quality102-pending-order-recovery.test.ts`
- Test: `tests/quality102-preflight-protective-order.test.ts`

**Interfaces:**
- `reconcilePlannedQ102Pending(input, deps): Promise<{status:"NO_EXPOSURE_PENDING_RECOVERED";requestId:string;backupPath:string;rounds:3}>`。order mutation APIを一切呼ばない。
- depsはstate store、authenticated `getOrder/getUserTrades/positions/openOrders`、file snapshot/backup、shared account lockを注入可能にする。
- unknown state fieldは現行strict Q102 schemaによりwrite前に拒否する。受理schemaは明示fieldのみとし、unknown keyを黙って落とさない。
- 成功時のstate遷移は現行runnerのterminal-without-exposureと同型にし、`pending`を除去し、`lastCompletedIdempotencyKey`と`lastReconciledAt`を設定する。他の認識済みfieldと`failures`履歴は保持し、追加の未知fieldで履歴を拡張しない。
- recovery targetは実VPSで採取した対象pendingの完全なidentity（source SHA/state hash、phase、symbol、side、quantity、clientOrderId、idempotencyKey、createdAt）に固定し、単に同じsymbolのpendingというだけで別注文を対象にしない。

- [ ] **Step 1: REDテストを書く。**3回安定no-order/no-trade/no-positionケースの成功と、order/trade/position/open order、`-2013`以外のlookup error、ページング未完了/履歴欠落、age不足、pending identity不一致、state race、lock失敗、wrong owner/mode、unknown/malformed field、backup失敗の拒否をそれぞれテストし、失敗時state bytes不変をassertする。
- [ ] **Step 2: `npx tsx --test tests/quality102-pending-order-recovery.test.ts`を実行し、helper未実装によるREDを確認する。**
- [ ] **Step 3: verify-only経路を実装する。**exact source SHA/state hash、pending identity、configured reconciliation horizon、完全取得済みuserTrades履歴、3回のauthenticated read-only結果を検証し、state bytesをround間で比較する。
- [ ] **Step 4: `--apply`は明示ackを必須とし、account-order lock下の最終state/latch再確認に通った場合だけ、timestamped 0600 backup後に既存state storeで当該pendingをterminal-without-exposureにする。**source runtime SHA、`lastProcessedReferenceTs`、`lastReduction`、`initialDaemonReconciliation`を含む全認識済みfieldを保持し、現行runner遷移と同様にcompleted idempotency/reconciliation timestampを更新する。
- [ ] **Step 5: 既存正式Q102 migration helperを使い、recovered flat stateをcandidate SHAへ別backup付きmigrationし、candidate self-check/preflightがLIVE/CAUSAL_V4/one-slot/flat/no-pending/reconciliation PASSとなることをテストする。**
- [ ] **Step 6: Q102 state/runner/preflight/Causal V4 suiteを実行し`feat: reconcile proven no-fill Q102 pending safely`でcommitする。**

**Lineage migration note:** Production cutover後、各stateの実schemaとAster ownershipをread-onlyで確定してから既存正式helperだけを使う。Flat V12/FET stateには`scripts/disdex-flat-state-sha-migrate.ts`、active V12には`scripts/disdex-v12-active-state-sha-migrate.ts`、Q102には`scripts/disdex-quality102-causal-v1-state-migrate.ts`を使う。active/unowned/mismatched stateにflat migrationを適用しない。PENGU/V52にruntime SHA fieldがない場合はstateを改変せず、runtime wiring/heartbeatでlineageを証明する。

### Task 8: systemd restart-loop containment

**Files:**
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Test: `tests/test_runtime_wiring_script.py`
- Test: `tests/test_runtime_wiring_hygiene.py`
- Test: `tests/ops-current-runtime-safety-daemon-contract.test.mjs`

**Interfaces:**
- current-runtime wiringが生成するV12/PENGU/Q102/V52/FET SHA-scoped drop-inに`StartLimitIntervalSec=300s`、`StartLimitBurst=3`、`RestartSec=30s`を設定する。3回の失敗が5分以内に起きた場合はsystemdで停止し、手動調査まで自動再試行しない。

- [ ] **Step 1: RED wiring testsを書く。**生成されるV12/PENGU/Q102/V52/FET unitすべてで`300s/3/30s`が出力されること、operator gateとQ102 pending preflightが残ることをassertする。
- [ ] **Step 2: 3つのwiring testを実行し、既存unit定義に対する想定REDを確認する。**
- [ ] **Step 3: current-runtime wiringが生成するSHA-scoped runner drop-inだけを更新する。**`[Unit]`のStartLimitと`[Service]`のRestartSecを正しいsectionに出力する。timer/pathを有効化せず、operator gate/preflightを変更しない。
- [ ] **Step 4: wiring testとself-testを再実行し、5 runner全てで`300s/3/30s`を検査する。**drop-in末尾順序と既存ExecStartPreも確認する。
- [ ] **Step 5: `fix: bound automatic restarts for trading runner units`でcommitする。**

### Task 9: 原因限定Kill Switch recovery

**Files:**
- Modify: `lib/aster-upstream-recovery-policy.ts`
- Modify: `scripts/disdex-aster-upstream-live-recovery.ts`
- Test: `tests/aster-upstream-recovery-policy.test.ts`
- Test: `tests/aster-upstream-live-recovery-script-contract.test.ts`
- Test: `tests/test_v52_daily_loss_recovery.py`

**Interfaces:**
- `isRecoverableAsterRateBudgetKillReason(reason: unknown): boolean`は、正確なV52 recoverable-tick prefixとvalid budget saturation suffixだけを許可する。
- 既存の公式recovery scriptに専用modeを追加し、Q102/V12/PENGU/V52/FET stateを初期化・書換えず、exact shared latchだけをclearする。

- [ ] **Step 1: RED policy/script testsを書く。**incidentのexact reasonと有効証拠だけ成功対象にし、他のV52 fatal reason、追加manual review、state/SHA mismatch、古いbudget、stale Shared Risk、unhealthy Margin Guard、1回でもAster read失敗を拒否する。
- [ ] **Step 2: recovery policyとscript contract suiteを実行し、exact allowlist未実装でREDを確認する。**
- [ ] **Step 3: narrow allowlist、全5 runner停止確認、全state SHA/freshness/ownership照合、Shared Risk/Margin Guard検査、3 consecutive authenticated flat rounds、budget quiet検査を実装する。**
- [ ] **Step 4: account-order lock下でstate/latch bytesとexact reasonを再比較し、timestamped latch backupとaudit receiptの後にのみlatchを更新する。**既存 runner stateやoperator artifactは書かない。
- [ ] **Step 5: V52 daily latchがfresh Q102データから既存recovery contractでのみ解除され、stale時は引き続きfail-closedであるテストを通す。**
- [ ] **Step 6: recovery testsを再実行し`fix: allow audited recovery from local rate-budget hold`でcommitする。**

### Task 10: 全回帰、typecheck、build

**Files:**
- Task 1–9で列挙した変更ファイルとテストのみ。無関係なproduction/research artifactは編集しない。

- [ ] **Step 1: Task 1–9のfocused RED/GREEN suitesをfresh runし、pass countとexit codeを保存する。**
- [ ] **Step 2: strategy self-testsを実行する。**`npm run strategy:v12-x1-all:selftest`、`npm run strategy:pengu-dual-ls-v2:selftest`、`npm run strategy:quality102-causal-v1:runner:selftest`、V52 Python self-tests、Shared Risk、Margin Guard、FET runner tests。
- [ ] **Step 3: safety/regression suitesを実行する。**Aster budget TS/Python、recovery policy/script、watchdog、health snapshot、runtime wiring、operator activation hardening、Q102 state/lock/preflight、`git diff --check`。
- [ ] **Step 4: `npx tsc --noEmit`と`npm run build`を実行し、1件でもfailならreleaseへ進まない。**
- [ ] **Step 5: diff auditで信号・ranking・sizing・gross・Q102 selector/slot・V52 strategy・Kill Switch semanticsが変わっていないと確認し、未解決差分があれば報告する。**

### Task 11: Push、CI、immutable release、条件付き復旧

**Files:**
- production sourceはTask 1–9の差分のみ
- VPS release: `/home/deploy/disdex-trading/releases/<GitHub remote SHA>`

- [ ] **Step 1: branch/base/worktreeを確認し、実装をcommit/pushする。**local HEADとGitHub remote HEADの完全一致を確認する。
- [ ] **Step 2: 実GitHub Actions runのjobs/logsまで確認する。**`No jobs were run`、未実行、skip、失敗はGreenにしない。
- [ ] **Step 3: VPS変更前にauthenticated read-only preflightを取り、current/rollback、全active Aster budget consumer、units、operator artifact、strategy state、Shared Risk、Margin Guard、Kill Switch、equity、positions/open/protective orders、mutation countersを記録する。**
- [ ] **Step 4: position/orderが存在するか、証拠がstale/unknownなら切替を停止しstateを保全する。**条件pass時だけ対象Aster clients/runnersを止め、exact remote SHAのimmutable releaseを構築し、runtime wiring `--check` → `--apply` → `--check`を行う。rollback releaseを保持する。
- [ ] **Step 5: marker/dependency、service ExecStart/env/source SHAを照合し、全budget consumer停止下でbudget v1→v2 migrationを行う。**migration前にtimestamped exact backupを作り、`nextAllowedAt`と418/429 cooldown metadataが保たれることをread-backする。旧新budget clientを同時稼働させない。
- [ ] **Step 6: Q102 recoveryをverify-onlyで実行し、全3 read-only round pass時だけapplyする。**続けて正式Q102 migration helperとcandidate preflightを実行する。
- [ ] **Step 7: Shared Risk、Margin Guard、Kill Switch exact eligibility、全state、exact-SHA operator artifactを照合する。**operator artifact不一致ならreal-money runnerは起動せず、必要なoperator操作のみ報告する。
- [ ] **Step 8: 全gate pass時のみ公式Kill Switch recoveryを実行し、正式state migration（V12/FET/Q102は上記helper、その他は現在のschemaが要求する正式経路）を完了してから、Q102→V52→V12/PENGU/FETの順で同一SHAのunitを1つずつ起動する。**各起動後にactive/running、PID、NRestarts=0、state/runtime SHA、fresh heartbeat、operator gate、mutation=0を確認する。
- [ ] **Step 9: exact SHA/operator gate付きwatchdog/recovery timersだけ再開し、watchdogとhealth snapshotを1回実行する。**restartCalls/errors/old-SHA active=0を確認する。
- [ ] **Step 10: 最終authenticated read-only Aster reconciliationを行い、positions/orders/protectionの前後差、KSW、Shared Risk、Margin Guard、runner freshness、budget telemetry、orders/cancels/positionChangesを報告する。**test orderは送らない。
