# BT parity continuation handoff - 2026-11-11

## 目的と順序

1. 現在Productionで実際に有効な実装・env・Runner挙動を再現した「現行実装一致BT」を先に確定する。
2. そのBTを二重実行し、主要成果物のSHA256再現性を固定する。
3. その後にだけ研究Gateを追加し、同じベースラインとの差分で改善量を測る。
4. 「現行実装再現」と「因果的/OOS性能評価」を混同しない。

## Git / worktree

- Branch: research/bt-direction-v4-pengu-q102-20261110
- Checkpoint作成前HEAD: 22af5c8a4d69f3f916d026c08043a2766accf8c2
- Worktree: C:\Users\dis\-ai-dex-manager.worktrees\bt-direction-v4-pengu-q102-20261110
- Data root: C:\tmp\disdex-bt-20251001-20261001
- 期間: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC
- 初期資金: JPY 10,000
- Cost: 10bps / 30bps

## 確定した実効Production設定

- Crypto Gross 3.0x
- Stock Gross 4.0x
- Total Gross 4.25x
- Shared crypto daily loss 7.5%
- Q102 adopted exits ON / profit floor ON
- Q102 ACK ef1ab178e26a7bf5bddb6473467765edba242e1d
- FET trailing ON / FET_TRAIL_8P_GIVEBACK_4P
- HYPE preemption OFF / max gross 1.5x
- FET max gross 1.0x / residual min 0.05x
- V52 V11 slot 2.0x / V50 slot 2.0x
- V52 worst-case admission buffer 20bps

formal manifest側の3.0 / 1.5 / 3.5と、実効runtime 3.0 / 4.0 / 4.25を混同しない。現行実装一致BTは実効runtime側を使う。

## Runner/source

- V4 active pin: 53a0be396719f0284af4e11b35c66a4ac7d58f79
- Q102: ef1ab178e26a7bf5bddb6473467765edba242e1d
- V52 effective active source: 8495daf24e53a6cf0dd5e38f022008fa8f78c688
- V52 formal manifest pin: 4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81
- Shared Risk newer effective source: 2737c30e1f6d014d24a2c6d025e7f91332bf7962
- Shared Risk監査時PENGU pin: 1657e173d250ad58f53e62f7bb0a3428fb405496
- FET/HYPE/IDLE: 7688ed7c93a1918d8b44837339b7da5584a868f5

独立RESIDUALは正式7 Runner対象外。旧79件欠損を補完してBTへ戻さない。

## V11 / V52

V11は実装に存在するが、full-yearのreference/order-book/depth/spread/2秒逆行/fill履歴がなく完全microstructure再現不可。

確認済み:
- 既存cacheから34件の因果候補。
- 2026-08-10〜09-06を再構築した結果、追加候補0。
- 2026-09-07〜09-30のlive監査: decision 25件、non-null candidate 0、position open 0。
- 34件はALL / WIN_ONLY / LOSS_ONLY感度分析済み。
- canonical基準ではV11をfail-closed omissionとし、34件は不確実性感度試験にのみ使う。

V50はhistorical executable-book parityではなく価格proxy。

## BT世代

### 世代0: b1dba30系 847 fills
旧監査。最終基準に戻らない。

### 世代1: effective-current core 772 fills
EFFECTIVE_CURRENT_AND_RESEARCH_GATE_AUDIT_20261111.md の基準。

- 10bps: Final 2,274,782.96 / DD -46.8861% / 772 fills / Win 61.0104% / PF 1.2631
- 30bps: Final 743,399.95 / DD -54.6892% / 772 fills / Win 58.2902% / PF 1.2006
- 8/8 core artifacts SHA256 rerun PASS

重要: その後V4 runtime / Shared Risk / V52監査が進んだため、これは最終canonicalではない。

### 世代2: exact V4 runtime parity
Output: VPS_EFFECTIVE_CURRENT_V4_RUNTIME_PARITY_Q102_ADOPTED_ON_20261111

V4 exact active adapter 1394 + Production attached Core49 + Production rank/private gross/same-side/cooldown/DD gates。

- 10bps: Final 644,222.38 / DD -56.5463% / 469 fills / Win 58.4222% / PF 1.2292
- 30bps: Final 227,574.41 / DD -62.9814% / 469 fills / Win 56.9296% / PF 1.1654

現行V4実装再現として重要。ただしV4 policy自体は2026研究結果で凍結されており、因果/OOS性能証明ではない。

### 世代3: Shared Risk parity
Output: VPS_EFFECTIVE_CURRENT_SHARED_RISK_PARITY_Q102_ADOPTED_ON_20261111

追加:
- crypto-only settled + unrealized PnL
- sticky 7.5% UTC-day latch
- DAILY_LOSS_TRIPPED: PENGU/Q102 flatten、V4/FET/HYPE/IDLE/V52 entry-block
- V52 V11/V50 independent route slots

- 10bps: Final 1,092,445.73 / DD -59.6876% / 768 fills / Win 59.8958% / PF 1.2093
- 30bps: Final 372,301.91 / DD -67.6461% / 766 fills / Win 57.0496% / PF 1.1528

注意: 世代2のexact V4 runtime修正と完全統合済みとは認定しない。

### 世代4: V52 fail-closed bound
Output: VPS_EFFECTIVE_CURRENT_V52_FAILCLOSED_Q102_ADOPTED_ON_20261111

- shared-risk timing 5分評価
- full-year executable-book/microstructureと3.5% latch pathが再構築不能なV52をfail-closed exclusion

- 10bps: Final 269,483.49 / DD -65.7547% / 682 fills / Win 57.1848% / PF 1.1630
- 30bps: Final 116,245.79 / DD -72.6098% / 683 fills / Win 53.7335% / PF 1.1132

これは保守bound。単独で最終truthにしない。

## V4後知恵問題と因果参照

current live adapter replayはpure native source 2018件から:
- candidates 1394
- filtered 268
- deferred 200
- errors 65
- noOutput 91

旧1394候補との比較:
- exact 1394/1394
- route mismatch 0
- rank mismatch 0
- gross mismatch 0
- entry mismatch 0

つまり「現在のV4実装を過去へreplay」は再現できる。
ただしV4順位/repairは2026 full-development結果を使って凍結されているため、unbiased causal performanceではない。

Base41 PRE-only因果参照:
- PRE outcomes 738件のみでroute priority固定
- TARGET outcomeはrank計算に未使用
- target Base41 candidates 1662
- current tier sizing適用
- route catalog自体は2026 research-derived

NO_CORE:
- 10bps: Final 2,352,492.30 / DD -66.5588% / 812 fills / Win 58.6207% / PF 1.1963
- 30bps: Final 616,579.93 / DD -72.6984% / 809 fills / Win 55.0062% / PF 1.1301

PLUS_CORE49:
- 10bps: Final 2,432,339.77 / DD -67.0284% / 843 fills / Win 58.4816% / PF 1.1925
- 30bps: Final 604,786.89 / DD -73.1686% / 840 fills / Win 54.5238% / PF 1.1254

これは現行実装一致BTではなく、V4後知恵影響を見る因果参照。

## 研究Gate

世代1の772-fill基準では以下を検証済み:
- IDLE JUP: features.rel24 >= -0.04089204262472046
- PENGU V8: btc24h <= 0.011611625094354983
- Q102 FET: ret14 <= 0.048722800378429465

THREE:
- 10bps: Final 4,050,805.95 / DD -34.5468% / 761 fills
- 30bps: Final 1,365,296.98 / DD -44.3713% / 761 fills

PENGU V8単独がDD改善の中心。Q102 FET単独は10bps DDを悪化させるケースあり。

重要: 世代2/3/4の監査が進んだため、final canonical baseline確定後に研究Gateを必ず再実行する。古いTHREE値を採用判断に使わない。

## 次回再開地点 - 最優先

古い確認からやり直さない。

### Task A: canonical current-implementation simulatorを1本へ統合

以下を同じスクリプトへ統合:
1. portfolio_effective_current_v4_runtime_parity_20261111.py
   - exact V4 active adapter + Core49
   - Production private V4 gates/envelope
2. portfolio_effective_current_shared_risk_parity_20261111.py
   - actual Shared Risk semantics
   - sticky 7.5% daily latch
   - correct flatten vs block
3. portfolio_effective_current_v52_daily_latch_5m_20261111.py
   - 5m timing semantics
4. V11 canonical = fail-closed omission; sensitivityは別
5. V52 V50 = proxyであることを明記して残す。fail-closed boundは別結果として維持
6. Q102/FET/HYPE/IDLEの既確認設定を維持
7. effective caps 3.0 / 4.0 / 4.25

Task A完了前に「最終現行BT」と認定しない。

### Task B: deterministic rerun
canonical simulatorを10/30bpsで2回独立実行。
少なくとも SUMMARY / FILLS / DECISIONS / EQUITY_30MIN のSHA256を完全一致させる。

### Task C: research A/B再実行
Task A/Bで固定したcanonical baselineに対し:
- IDLE JUP
- PENGU V8
- Q102 FET
- pairwise
- THREE
を同条件で再実行。

### Task D: 最終レポート
2つを分離:
1. Implementation parity result
2. Causal / research performance evidence

「現在実装を再現できた」と「未来情報なしに同じ成績を得られた」を混同しない。

## 主要スクリプト

- scripts/portfolio_effective_current_core_parity_audit_20261111.py
- scripts/portfolio_effective_current_v4_runtime_parity_20261111.py
- scripts/portfolio_effective_current_shared_risk_parity_20261111.py
- scripts/portfolio_effective_current_shared_risk_5m_sensitivity_20261111.py
- scripts/portfolio_effective_current_v52_daily_latch_5m_20261111.py
- scripts/portfolio_effective_current_v52_failclosed_20261111.py
- scripts/portfolio_effective_current_v52_v11_upper_20261111.py
- scripts/v11_price_evidence_envelope_audit_20261111.py
- scripts/v4_current_live_adapter_exact_replay_20261111.mjs
- scripts/portfolio_effective_current_no_v4_hindsight_20261111.py
- scripts/portfolio_effective_current_base41_preonly_causal_20261111.py
- scripts/portfolio_effective_current_base41_preonly_currentsize_20261111.py
- scripts/portfolio_effective_current_native_v12_causal_reference_20261111.py
- scripts/portfolio_current_effective_threegate_research_ab_20261110.py
- scripts/portfolio_effective_current_core_threegate_ab_20261111.py
- scripts/portfolio_effective_current_v11_uncertainty_modes_20261111.py
- scripts/portfolio_effective_current_v11_threegate_sensitivity_20261111.py

## 安全状態

この監査・BTでProduction mutationなし:
- LIVE order 0
- cancel 0
- position change 0
- STOP change 0
- Kill Switch change 0
- systemd Production activation 0

## 再開時の指示

「BT_PARITY_CONTINUATION_HANDOFF_20261111.md の Task A から続ける。772 fills版へ戻らず、exact V4 runtime + Shared Risk + V52 5m semanticsを1本へ統合してcanonical BTを確定する。」


## Task A implementation strategy discovered after checkpoint

最短の統合経路は次。

- Baseに portfolio_effective_current_v52_daily_latch_5m_20261111.py を使う。
  - Shared Risk parityを継承済み。
  - 5分timing、V52 own 3.5% daily latch、Aster 5m mark、deferred exit処理を含む。
- そこへ portfolio_effective_current_v4_runtime_parity_20261111.py の exact V4 部分だけを移植する。
  - current-live-adapter 1394 exact replay
  - native Core49
  - Production V4 rank ordering
  - private V4 gross envelope: request<=1.0, V4<=3.0, recovery<=2.5, crypto new risk<=3.0, total<=4.75
  - same-side / foreign-symbol ownership
  - 12h short cooldown
  - V4 max-DD 21% hold
  - recovery route slots 16
- Shared Risk / V52 5m側の処理を移植時に上書きで失わないこと。
- 統合後、10/30bps二重実行のSHA一致を取ってから研究Gateへ戻る。

この比較まで完了済み。次回は3本の監査スクリプトを最初から読み直さず、この統合から開始する。


## Canonical checkpoint completed after Task A/B

Task A/B are now complete.

Canonical simulator:
- `scripts/portfolio_effective_current_canonical_parity_20261111.py`

Canonical result:
- 10bps: JPY 235,605.78 / DD -58.0771% / 446 fills / Win 56.7265% / PF 1.1874
- 30bps: JPY 77,865.09 / DD -65.0500% / 425 fills / Win 54.3529% / PF 1.1232
- 21/21 output artifacts SHA256 matched across two full reruns.

V4 21% DD hold was re-audited against pin 53a0be...:
- maxDrawdown is computed from signed ACCOUNT_MARK whole-account equity versus account equity peak.
- V4 shared reservation blocks new V4 risk once maxDrawdown > 0.21.
- Therefore whole modeled account MTM equity is the correct BT analogue; do not replace this with V4-only DD.

V4 gross semantics re-audited:
- new crypto entry control requested cap 3.0;
- existing crypto exposure allowance/recheck 3.5;
- V12 3.0;
- Recovery 2.5;
- Total 4.75.

Detailed checkpoint:
- `CANONICAL_CURRENT_IMPLEMENTATION_PARITY_20261111.md`
- `evidence/CANONICAL_PARITY_PASS1_SHA256_20261111.txt`
- `evidence/CANONICAL_PARITY_PASS2_SHA256_20261111.txt`

### New resume point

Task A/Bをやり直さない。
次は **Task C: canonical baseline上で研究Gate A/Bを再実行** する。

対象:
1. IDLE JUP
2. PENGU V8 BTC24
3. Q102 FET ret14
4. pairwise
5. THREE

古い772-fill baselineの研究改善値は採用判断に使わない。

## Task C completed: canonical research-gate A/B

- Harness: `scripts/portfolio_effective_current_canonical_research_ab_20261111.py`
- Deterministic harness commit: `517c1cced0f1a25ecfca635375cbdbccf398b6b5`
- 7 cases x 21 artifacts; Pass1/Pass2 **147/147 SHA256 exact match**.
- Best tested bundle: THREE.
  - 10bps: JPY 472,102.93 / DD -42.4237% / 440 fills / Win 59.09% / PF 1.4197
  - 30bps: JPY 226,988.18 / DD -45.4596% / 434 fills / Win 57.14% / PF 1.3378
- PENGU_V8 + Q102_FET gives the same best 10bps DD (-42.42%) among pairwise tests; THREE improves profit and 30bps DD.
- IDLE_JUP alone increases final equity but slightly worsens DD, so its benefit is interaction-dependent.
- These thresholds were evaluated on the target period and are **research-only**, not unbiased OOS certification.

### New resume point after Task C

Do not repeat canonical parity or the 7-case A/B. Continue with:
1. causal/pre-period availability audit for IDLE rel24 / PENGU btc24h / Q102 FET ret14;
2. validate the frozen THREE thresholds without target-period retuning where data permits;
3. decompose the remaining THREE drawdown window to identify the next DD source using causal features only.

Goal status: DD <=20% / win ~70% is **not achieved** by THREE; more research is required.

