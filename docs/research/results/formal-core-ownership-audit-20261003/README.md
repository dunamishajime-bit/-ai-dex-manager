# Core exact parity PASS / LIVE ownership parity BLOCKED

この監査は retained Idle/DOGE/AVAX の統合認証ではない。既存 LIVE は `53eeff5417636369d4709fddfd47d7916ddcf3b1` のまま変更しない。

## 再現

正式 research engine と gated candidates を Desktop 原本から再発見し、read-only で Core を再実行した。

- source handoff: `c7280876ecc3037cf9446e5e58a094e889a96d28`
- audited runtime implementation: `1ad60851b65e185ffd9b54511145a822201625f8`
- raw candidate SHA256: `35d5259ee890c7d1ac19d8d433940f05a8d0c94f793b9d3005d770ea2e8dc10c`
- FET dual-entry-gate 後 input SHA256: `ecc8103dea9ce392ea72fe918ca362416b762f0072a1a43d7f0d496b6755b935`
- policy `PB_REV_HIGHVOL_R2R1`, cooldown `BASE_2H`, BRK/MR `0.75`, FET `1.00`。
- original engine・dependency 6 Python files を bytes 不変で `engine-source.zip` に保存。
- raw/gated candidate folders を `candidate-inputs.zip` に保存。秘密情報・VPS env・口座 state は含まない。
- 市場/Funding/ECB FX/V52 input は Release `bt-v12-score100-volume080-normalonly-20260928` の SHA256 固定 archive を使用。

Fresh trade ledger **1,275全行**・decision ledger **2,588全行** は canonical と JSON field 全一致。Windows local file は bytes SHA も一致。Linux serialization の改行差は semantic parity と明示的に分離する。

元handoffのSHAはCRLF原本。`git show 1ad60851:<ledger>` のGit正本LF SHAも独立取得し固定した。trades LF `57231c264a97177b5a753bba2660d6cdf15eddce65f37b65467c16e0cdb0a839` / decisions LF `48b7b40fb7b807a9cc9e403fa325e551260ebd208d021fd31bb9dfcb24956836`。任意の「改行を直せば一致するファイル」ではなく、この2組のexact digestと全JSON型・field・行順で検証する。

| Metric | Fresh / canonical exact |
|---|---:|
| Final JPY | 1,229,065,462.0472791 |
| PF | 2.4887028036012624 |
| Max MTM DD | -21.296368751349548% |
| Closed trades | 1,275 |
| Accounting | PASS |

## 新たな具体的不整合

Fresh Core 自体に same-symbol simultaneous ownership が **15組**存在する。7組は反対側、8組は同じ側。

- DOGE 3 / AVAX 3 / FET 5 / NEAR 4。
- 後発 owner: V12 9 / Q102 2 / FET 4。
- 全15組の candidate ID・strategy・side・entry・actual exit・重複区間を `core-ownership-audit.json` に保存。

最初の例は Q102 DOGE SHORT `C000156` が open のまま、V12 DOGE LONG `C000158` を入れるモデル経路。さらに Q102 の FET を保持中に FET runner の別 LONG を入れる例がある。

Production `53eeff54` と candidate `1ad60851` の両方に以下の guard が存在することを、ソースと VPS read-only で確認した。

- `lib/disdex-quality102-causal-v1-runner.ts` の `planEntry`: symbol に non-zero 実建玉があれば `Q102 exchange position exists without matching Q102 state; entry blocked.`
- `lib/fet-brk48-live-runner.ts`: Q102 が FET を所有中なら `FET_SYMBOL_CURRENTLY_OWNED_BY_Q102` / HOLD / ordersSent=0。
- V12 venue order/protection は `positionSide=BOTH`。独立の LONG/SHORT model positions をそのまま one-way net position と同一視することはできない。

Core engine は `active_same_strategy` に対する same-symbol check が中心で、これら cross-strategy ownership gate を同一に再現していない。**金額が完全一致しても LIVE execution equivalence の証明にはならない。**

## 判定

`STATUS: BLOCKED_FORMAL_CORE_SYMBOL_OWNERSHIP_PARITY_CONFLICT`

「既存 1,275 台帳 exact parity を維持」と「same-symbol 同時保有違反ゼロ」と「現行 LIVE ownership guard 維持」を同時には満たせない。Guard の削除・strategy の無断変更・数値合わせによる retune は行わない。

次の安全な解決は、owner conflict を実 Runner 同等の gate で拒否する新しい Core causal baseline を正式比較対象として承認し、そこから5構成を同一 engine で再認証すること。元1,275/12.29億は historical model anchor として変更せず残す。これはユーザー指定の exact anchor 契約変更となるため、無断実行しない。

Workflow `formal-core-ownership-audit-20261003.yml` は Core を実際に再実行し、ownership certification が **BLOCKED のままであること**を確認する診断 CI。CI success は LIVE certification success を意味しない。

## Core-only stress (Overlay 統合結果ではない)

| 往復cost | Final JPY | PF | MTM DD | Trades |
|---|---:|---:|---:|---:|
| 8bps | 1,544,226,239.10 | 2.54331393 | -21.1783% | 1,275 |
| **10bps formal** | **1,229,065,462.05** | **2.48870280** | **-21.2964%** | **1,275** |
| 20bps | 396,206,355.54 | 2.22948043 | -21.9770% | 1,274 |
| 30bps | 128,891,643.64 | 1.99834016 | -22.7446% | 1,274 |

4シナリオとも accounting PASS。`core-replay-ledgers.zip` に fresh 全取引・全判定・全資金イベント・metrics/月次結果を保存。zip全体と全memberのSHA256は `source-manifest.json`。これらは同一symbol競合を許していた historical Core model の感応度診断であり、安全な LIVE で同じ値になる証拠ではない。

## Fresh test evidence

- Ownership/source archive regressions: RED確認後 **20/20 PASS** (engine hash mismatch / JSON型差 / 固定Git LF identityの回帰も含む)。
- Whole Python discovery on Windows: **162 tests / 156 PASS / 2 failures / 2 import errors / 2 skips**。
- 未変更の `test_q102_1p0_lump100k_implementation_contract` が古い Q102 `1.50` を要求する failure。
- 未変更の `test_runtime_wiring_script.test_wiring_restores_required_monitor_timers` が削除済み文字列 `DISDEX_MONITOR_TIMER_ACTIVE` を要求する failure。
- `test_ui_retention_contract` / `test_vps_retention_dependency_protection` は Windows に `fcntl` がない import error。
- 新監査追加以外の対象ソース・上記テストには HEAD `1ad60851` との差分なし。既存failureを握り潰して全体PASSとは報告しない。今回のscope外の runtime cap・monitor implementation を変更してこれらを通すことはしない。
- 上記全体集計は新監査17test時点の取得結果。最終20test後の全体再実行はWindowsのconcurrent rate-budget testでKeyboardInterruptとなり集計未完了。最終の全体GREENも主張しない。

既存 LIVE / operator artifact / certificate / current symlink / state / protective orders / HP を変更していない。Orders / cancels / position mutation はすべて0。
