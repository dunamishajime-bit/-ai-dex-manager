# PR #481 — Q102 HIGH_VOL 19候補とOne-shot 18件の年度末未決済境界監査（2026-11-15）

## 結論

**`Q102_NATIVE_19_SIGNAL_18_CLOSED_ONE_OPEN_PERIOD_END_EXPLAINED`**。Source PIN `ef1ab178e26a7bf5bddb6473467765edba242e1d` のNative `q102-high-vol-production-signals/exits/base-exits.jsonl` それぞれ**19件**を全IDで突合。対象期間2025-10-01 00:00Z〜2026-10-01 00:00Z（終端除外）内で**18件だけ決済済み**、SUI LONG 1件が期末未決済。別の90d Online shadow target studyの**baseline18件**と数値上の差の理由を期間境界として説明できる。

### 右打ち切り（right-censoring）で損益を創作しない

| 元Native証拠 | 値 |
| --- | --- |
| HIGH_VOL信号総数 | 19件（ONDO10・SUI7・ARB2） |
| Exitが2026-10-01より前 | **18件** |
| ExitがBT対象期間より後 | **1件** |
| 未決済1件のNative ID | `HIGH_VOL:SUIUSDT:1790650800000` |
| Entry確定時刻 | **2026-09-29 04:00 UTC** |
| 元Native将来予定Exit時刻 | **2026-10-02 03:00 UTC**（72h time） |
| 正式期間内の基本出口証拠 | **`RIGHT_CENSORED_PERIOD_END`**（価格・日時の確定Exitフィールドなし） |
| 統合10bps・30bps双方のSource Signal ID | `Q102P_00224` |
| 統合モデル入場状態 | 両費用とも `MODEL_ENTER`／未決済1件 |
| 同じIDに対応する決済モデルFill | **両費用0件** |

元 `q102-high-vol-production-exits.jsonl` には研究用の予定出口が記載されるが、基本出口 `q102-high-vol-base-exits.jsonl` は**期間末時点では未決済として右打ち切り**。そのためBTC/Altを先読みした将来Exitをこの年度のモデル実現PnLや勝率に混ぜない。以前の統合MTM時点の建玉評価・Grossのみ扱い、勝ち負け確定のFillと分離する。

### One-shot 18コホートとの照合範囲

- Online研究元Shadow targetの `baseline.n=18` は、この年度に決済できたNative18と同数。Targetで拒否された3件のNativeシグナルIDは、いずれも完了済Native18の集合に含まれる。
- ただし、Online研究で通過した15件すべてのIDレベル一覧は、参照した元集計には含まれず、**18件集合が完全同一であると厳密に証明したわけではない**。差は一致しており追加のNative OPEN候補のIDも特定できたが、全15の成績一致は未認証。元NativeとOnline候補の全ID台帳を取得したら改めて突合する。
- これによりQ102 HIGH_VOLの固定90d/min5/PF0.60 Gateを復活させる理由にはならない。前タスクではPreの勝率が49.01→44.20%、Target 33.33→20.00%と悪化を確認済み。

## 再現と証跡

- `scripts/bt_hp_q102_highvol_19_vs_18_boundary_audit.py`：19 native source/exit/basic exitのID集合・source PIN・time/entry/exit・期末打切り1件、Shadow拒否Native ID3件、各費用の統合モデル未決済信号 `Q102P_00224` のEntry1/Fill0/Terminal1を照合。
- `tests/test_bt_hp_q102_highvol_19_vs_18_boundary_audit.py`：10合成テスト。終端ちょうどのExitは期末未決済、Future Fill創作、PIN変更、Shadow不一致、重複IDを拒否。全BT Python **282件PASS**。
- Private照合JSON `C:\tmp\bt481-q102-highvol-19-vs-18-period-end-ledger-20261115.json`、SHA256 **`02E6C80B40C6DB41009AEF6518DC8C39C79E006F1BD8D42FF3665E863E1594A9`**。

**未達：** Q102 HIGH_VOLのNative 19候補全件とOnline Shadow18件の完全ID行単位照合、2026-10-01以降の本当に独立したForward、一体Gross・Stop Exitと口座DD≤20%、最新V4ソースのBT完全一致。今回は研究用PC/GitHubへの証拠追加のみ。本番Runner・注文・STOP・Kill Switch・HP承認へ変更0件。