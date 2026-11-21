# PRISM VII P20 — PENGU S3: 市場構造からSHORT入口を新規再設計（結果取得前固定）

**研究新名称:** `PENGU_S3_STRUCTURE_V1`。V2・Recovery V8・本番SHORT V20は一切書き換えない。既存の固定ピン `1657e173d250ad58f53e62f7bb0a3428fb405496` とP14源SOURCE53の実績を独立に保持。P19分割利確まで元の利益を削る手法が失敗したため、EXITで損失を隠すのでなく、**SOURCE本体とは独立の新しいSHORTエントリー発生器**をゼロから比較する。

## 共通の原因仮説

SELLERが優勢でも一時反騰がある。BTCが全体買い方向に変わった時、PENGUだけ弱い一時落ち込みを追ってSHORTに入るとsqueezeで負ける。トレンド・構造破れ・反発失敗・相対弱化は本質的に別の現象なので、混ぜて閾値投票せず、**3つの独立した入口アーキタイプ**で母集団を生成する。新candidateはSOURCE53の採否を変えず**全H1から発火を別計数**。SOURCE53の既見ラベルを入口の特徴へ入れない。

## 毎時H1確定の情報制約

- SOURCE PENGU/BTC公的Aster H1を2025-08-01〜2026-11-18（source M5が存在する期間）で使用。2025-07月初期PENGU warmupはH1 72〜168本不足、PRE先頭はH1データ先頭から72本経過してからの評価とし、SOURCE53の固定baselineも同じ期間窓を個別記録。市場open/close/volumeは署名済取引所自己注文ではない。BTC/PENGU源ファイル各SHA256をmanifestに固定し、SOURCE H1+M5品質を検査。元の1本のBTC M5不正OHLC `1757771400000` はSOURCE active positionsと一致した場合fail closed。BTC H1の公的SOURCE修正済-RESEARCH_M5QA資料を使用。
- **直近H1 tが完全確定**してからのみSHORT候補生成。各EMA/SMA, 24H support, candle high/low, 6H/BTC retの参照バーはt以前。PENGU当前/直前のvolume>0必須、BTC対象tのvolume>0必須。新たな入口はt+1 H1の最初の正出来高M5 openを執行価格モデルとする。H1開始時点に取引がない場合は約定時刻を最初のprintまで遅延、H1全12M5 print0なら`ENTRY_PRINT_MISSING`を記録し、自動に次時間へ繰り越さない。
- 3独立パターンの「最初の成立ルート」を1候補として記録、複数同時成立は`matchedRoutes`にも残す。元sourceや新市場で利益を見てルール閾値を後から変えない。

### Route A: SELLER_PULLBACK_REJECTION
直近24HのPENGUが下落 `ret24<=-5%`、PENGU `EMA24<EMA72`、BTC `close<EMA72` and `ret24<=-1.5%`。前のH1が上昇足 `close[-1]>open[-1]`、直近H1が下降足 `close<open` and `close<previous_close`、上髭 `high-max(open,close)>=(high-low)*0.25`。市場構造優勢下の戻り売り失敗確認。

### Route B: BREAKDOWN_RETEST_FAILURE
`support24 = min(low[t-25]..low[t-2])` という **現在/過去直近2本よりも前に確定済み**のサポート。二つ前H1がsupport以上で引け、1つ前H1がsupportより下で引け（breakdown）。直近H1はsupportを高値で再訪 `high>=support*(1-.005)` し、`close<support` and `close<open`。BTC直近6H return<=-1%。これは **Breakdown→retest→reject**の三つの時間構造に依拠。買い戻しや損切りが直後に集中する場合でも、実市場で勝つ保証はない。

### Route C: RELATIVE_WEAKNESS_DOWNSHIFT
PENGU6H return<=-4%、BTC6H return>=-0.5%、PENGU/BTC相対6H差<=-3%。PENGU `close<EMA24<EMA72`、直近2つの印字H1終値がそれぞれ前H1終値より下落。直近3H PENGU volumeが prior24H の平均3H出来高比>=1.2。BTCが急落しているだけの同方向フォローと区別して、相対的な売り圧力の継続を探る。

## 経済比較の独立固定ルール

- 新P20は本番ロジックではなく、元PENGU純SOURCE exitと同値との主張はしない。出口で恣意的な改善を導入しないため、SOURCE53候補にも新P20候補にも同一 `REFERENCE_STOP72` を適用して**入口優位性だけ**を比較する：SHORT hardStop = entryProxy*1.08、取引後正印字最小低値から+15%以上の順行が前の**完成H1**までに成立した場合、prevBest*(1+.04)でtrailing stop、高値へのM5正印字初回到達で `max(stopLevel,M5 open)` のbuy価格代理、最大72H保持でそれ以降最初のM5正印字openでtime exit。元SOURCEのV20独自time/phase/grossルールと違う参考出口なので、SOURCE P14本来の55%/PF1.314とは別の比較として明示。
- 入口候補は時間順で全部計数。各戦略は1 slotのみ（同時ロング/追加SHORTはしない）、他の候補がslot使用中なら **`OCCUPIED_SLOT`を必ず記録**し、候補ごとの勝率改善を捨てたせいで上がったと偽らない。Entry未印字 `ENTRY_PRINT_MISSING`、SOURCE price mismatches、終了未印字はUNKNOWN。PENGU/BTCの2 dataset源と全M5印字/stop初回touchを検算。
- コスト10bpsと30bpsは独立した両側合計手数料、追加EXIT滑り0/10/25bps。勝ち・PF・取引数、source winning absolute profit・source losers、最大期間別価格DD、時刻未観測を表示。Portfolio compound/DD21%リミット・funding/他Runner shared grossは再現していないためDD指標は単独マーク参考に留める。
- 特に Route A/B/C を混ぜて平均してマイナスルートを隠さず、各ルートの候補数、ENTRY fill proxy、STOP理由、勝率/平均/ PF/PnLを分ける。PRE/BASE/POST を別 cohort で切る（既見市場であり独立OOSと呼ばない）。
- **採用 Gate**：候補の数を減らしただけでは不可。比較SOURCE53と同じ停止ルール/印字価格の下で自然SHORT候補の経済的な改善・勝ち取引の利益の保持、新独立人工市場でsqueeze/上昇/レンジ強弱への耐性、最終未見OOS、DD20%以下を必要とする。PENGU目標80%は目的に留め、未検証なら未達。BTC/価格過去を人為的に上書きしない。

P20は元SHORT V20と別実装・別名でGitHub Draft PR #595の研究専用branchに保存。Production master/VPS/Runner/注文/建玉/STOP/HYPE/Kill Switch変更なし。
