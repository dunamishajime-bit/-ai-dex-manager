# Task9統合経済コア：全8ロジック因果BT・台帳完全再現（2026-10-21）

## 判定

**PASS_NATIVE_SINGLE_ECONOMIC_CORE_CROSS_LANGUAGE_PARITY**

凍結された旧8ロジックの資金配分・採用・ロット・費用・Funding・Exit・時価評価に新Task9のSTOPとSTOP後のクールダウンを組み込み、同じ時系列でBTを実行。PythonとTypeScriptが同じ元経済台帳から独立に計算して財務指標を一致させた。コスト10bps/30bps共にPASS。

**対象は共通経済コアであり、独立TypeScript版のdynamic-replay.ts配分ロジックの完全一致を意味しない。** 元の独立TypeScript版はまだ経済認証不可。二つの経済結果を合算したり片方の資産数値をもう片方のDDに混ぜたりしない。実約定取引所・署名付き保護注文の証拠は含まれない。LIVE・VPS・HP・実注文は変更なし。

## BT実測（2025-08-10～2026-08-10、初期資金1万円、積立なし、複利）

| 条件 | 最終資産（円） | PF | 最大MTM DD | 決済件数 |
|---|---:|---:|---:|---:|
| 10bps Baseline | 222,818,966.8780 | 3.4587963 | -15.62064% | 1,310 |
| 10bps STOP＋Cooldown | 204,448,513.2453 | 3.1966032 | -14.79603% | 1,311 |
| 30bps Baseline | 124,289,206.8183 | 3.0785603 | -16.78777% | 1,307 |
| 30bps STOP＋Cooldown | 91,181,051.2294 | 2.7499987 | -15.41170% | 1,308 |

- STOP対象：V12 SHORT限定。エントリーから12時間経過**後**、過去のMFEが+1%未満かつ価格逆行2.5%で、保存済み5分足を使った研究用決済。翌バーの未来値で過去STOPを認可しない。
- 「発火候補」だけでクールダウンを発生させず、**統合BT内で実際に採用されSTOP決済された建玉のみ**、同一通貨・同方向の12時間クールダウンを開始。LONGへの誤ブロックを防ぐ。PENGUは変更なし。
- STOP決済件数は10bpsが**52件**、30bpsが**51件**。STOP成立後の同方向クールダウンによる見送り件数は両コスト**20件**。
- 最大DDの改善は10bps **+0.8246ポイント**、30bps **+1.3761ポイント**。
- 最終資産維持率は10bps **91.76%**、30bps **73.36%**。
- **研究採用ゲートFAIL**：30bpsの資産維持率が75%未満。利益の削り過ぎを踏まえ、今回の2.5% STOPをLIVEにそのまま採用しない。

## 完全一致した範囲

1. 35銘柄422ZIPの市場データと凍結元エンジンを用い、候補**3,185件**の採否・決定順序・Gross・数量を旧モデルの配分判定地点から直接採録。事前除外16件を除く**3,169件**をTask9候補入力に正規化できた。
2. 4ケースすべてで「採用候補ID集合」と「モデル建玉・決済取引ID集合」は完全一致。約定・決済・資金・手数料・Fundingは元の時系列コアを共用。
3. 4ケースすべてで**8,761点の完全H1 MTM**を価格モデルの計算中に保存し、最大DD、最終資産、PF、決済件数を別のPython検証器とTypeScript検証器で再計算して一致。
4. **完全に別ディレクトリで独立2回BT**し、4ケース×5ファイルの**20/20台帳SHA256が1バイトまで一致**。5ファイル：candidate-decisions、portfolio-trades、portfolio-events、task9-mtm、metrics。
5. STOPが決済された時刻と12時間後の解除時刻、建玉とのIDリンク、STOPより後で解除前に拒否された候補のsymbol/sideを検証。例外・証拠欠落はFail Closed。
6. 元の8ロジックBaselineは資産、PF、DD、決済件数が厳密一致しており、Instrumentを追加しても経済計算そのものは不変。

## 単一入口

研究用Windows PCで以下を実行する。コード・値・テスト条件は研究ブランチ上で固定する。

    python -B scripts/dd-reduction/run-task9-unified-research-20261021.py --native-evidence --refresh-model --model-root "C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-21_task9_full8_evidence_mtm_v3_independent" --output "C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-21_task9_full8_evidence_mtm_v3_independent\unified-core"

### 成果物

- 共通実行入口：scripts/dd-reduction/run-task9-unified-research-20261021.py
- 旧8ロジックの因果証拠採録：scripts/dd-reduction/task9_legacy_evidence_capture.py
- Python取引・Funding・STOP・H1 MTM検証：scripts/dd-reduction/verify-task9-native-full8-parity.py
- TypeScript台帳・金融値照合：scripts/dd-reduction/run-task9-native-full8-unified.ts
- Regressionテスト：scripts/dd-reduction/test_task9_native_full8.py
- compact GitHub監査：task9-native-full8-causal-parity-20261021.json
- CI検証：scripts/dd-reduction/verify-task9-native-compact-artifacts.py
- 生の取引・市場台帳はユーザーWindows研究ディレクトリに保管し、公開GitHubにはプッシュしない。

## 残る認証と制約

独立版TypeScriptの動的配分・MARK・注文予約・部分約定・STOP実行の意味論は、いまの共通経済コアと一致が証明されていない。新統合実行経路では共通旧8ロジック原本を**研究の唯一の経済正本**とし、独立TS旧配分器の結果は経済採否に使用しない。Future-forward・実取引所のSTOPと建玉確認・本番承認は別工程。

CIは元のローカル価格ZIPを持たないため、GitHub上で検証できるのは**保存済み20ファイルのSHA256の整合性と研究集約値**まで。生データ完全再現の実行証拠はWindows PC内の独立2回の全台帳で確認した。

**STATUS: RESEARCH_NATIVE_SINGLE_ECONOMIC_CORE_PARITY_PASS / SEPARATE_TS_ALLOCATOR_UNVERIFIED / STOP_30BPS_RESEARCH_GATE_FAIL / LIVE_UNCHANGED**
