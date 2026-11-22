# PRISM VII P36 — gross0.75固定：元native EXITとM5利益保護の出口再設計、事前登録

ユーザー依頼「続けて利益とdd改善させて」。研究専用。結果を見る前にP36の検証内容と合否基準を固定する。

元SOURCE pin SHA 1657e173d250ad58f53e62f7bb0a3428fb405496、元V20自然53/53 EXACT、S4新ENTRY自然120 candidate、P32 native V20 pure EXIT on S4, P33 causal shock 1件、P34 SELLERルート限定のBTC6H<=0 gate を完全に保持。grossは全条件0.75、30bps roundtrip、元本1万円、1slot複利、PENGU5M CLOSE mark NAV/DD と前完了M5峰に対する当M5 HIGH stress DDの双方を計測。元SOURCE H1/M5、120候補の参照入口、native STOP/EXIT優先を変えない。

## 事前固定の出口14系統

1. NATIVE_ONLY：P32 pinned native EXITに追加処理なし。
2. P25_SHOCK_ONLY：P33で既に検出済みのPENGU/BTC確定同時暴落1件だけを、完成M5確定後の正出来高M5 OPEN価格で買い戻す原P34ショック案。
3. MFE_TP_20 / MFE_TP_40：PENGU元ENTRYからの、完成済み正出来高M5 CLOSE価格の短期SHORT含み益が20%/40%に達したらシグナル確定。未来M5を使わず次の正出来高M5 OPENでbuy price proxy。
4. MFE_TRAIL_12_25 / MFE_TRAIL_12_50 / MFE_TRAIL_20_25 / MFE_TRAIL_20_50：過去の完成した正出来高M5 CLOSEの自己最大gross含み益MFE>=12%または20%を過去に達成した後、現時点の完成M5 CLOSEで保有中SHORT含み益が過去最良利益の75%または50%以下へ下がった時、信号確定。native SOURCE EXITが先なら絶対優先。現M5の終値より前にピーク更新してはいけない。
5. 上記TP2+TRAIL4の6種に P25_SHOCK_ONLY の既存事象を時刻OR統合した6案を追加し、P25かMFEの信号確定時刻が早い側を選ぶ。SOURCE native EXITも先なら優先。同時ならP25を優先。元120候補を再admitし、P25以外の新出口によって新候補が1slotに入る可能性も計上。

すべて SOURCE PENGU M5 positive volume >= 0? ではなく厳密に **>0** だけprice proxyを認める。シグナル時刻は完成M5 t+300000 ms。BUY価格はこの確定時刻以後、元native EXIT前の次の正出来高M5 OPEN第2/第3印字、元native出力が先ならnative priority。追加入り滑り0/1000bpsを第2/3印字で測定。実市場ask買い戻し価格・板数量・実約定は未知であり実績と混同しない。

事前固定グリッドは 13候補出口×4執行stress（第2/第3 positive M5 OPEN、extra0/1000bps）＋NATIVE_ONLY無改変1=**53 scenario**。各source120候補全件、経済モデル単一slot、1件ごとのM5 mark high stressを含む台帳、勝率・確定勝ち件数・PF・平均損益口座比・最終NAV/右打切り・最大DD/最悪source timeを保存。

基準パリティはP34のBTC方向gateあり固定0.75・30bps、P25 shockのみ第2 positiveM5 OPEN / extra0で21元S4中19決済14勝73.68421053%、DD17.03139963%、PF5.75530091。第3/extra1000ではDD18.81773579%。MFE/P25なしのnative onlyではP34 shock OFF DD24.85495896%。baseline 120 setup, source S4 native53 sourcePin、H1 source SHA、源M5 hash不一致なら全体FAIL。

レイヤー比較には次を必ず載せる：
- 利益を改善したように見えて、元native winnerの利益の取り逃がしが何件／何ポイント発生したか（native基準とP34 P25基準）。
- 新しいentry admission / 履歴中元負け機会の回避の影響、元SOURCE120の意図全保持、PRE/BASE/POST（POSTは過去研究で見ており完全未見OOSではない）。
- **P25+MFE** と **MFEのみ** を分離して、1件のflash特別価格に依存したDD20以下か否かを識別。
- 標準第2印字だけでなく第3印字/追加1000bpsのストレス条件とM5 HIGH stress DDも20%未満か、滑りによって元勝者が負けに変わる場合も数える。
- 真正未見将来相場とP29/P31人工の同一過去・異なる未来反例に耐えない案はLIVE適用禁止。母数減少による勝率改善と利益率改善を混同しない。

研究結果が強くても本番 Production/master/VPS/Runner/注文/建玉/STOP/KillSwitch/SharedRisk/HYPE/Codex worktree に変更しない。PR #595 Draftへ研究資料だけPush。